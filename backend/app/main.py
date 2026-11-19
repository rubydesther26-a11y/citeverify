import asyncio
import csv
import hashlib
import io
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.database import check_db_health, get_db, init_db, session_scope
from app.models import CitationEntry, FigureEvidence, VerificationDocument
from app.schemas import (
    CitationOut,
    DocumentDetailOut,
    DocumentSummaryOut,
    FigureEvidenceOut,
    HealthResponse,
    VerifyTextRequest,
)
from app.services.figure_extractor import extract_figures_from_pdf_bytes
from app.services.pdf_parser import extract_text_from_pdf_bytes, parse_citations_from_text
from app.services.verifier import verify_citations_batch
from app.services.vision_verifier import analyze_figures_batch


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    if settings.normalized_database_url:
        try:
            init_db()
        except Exception as exc:
            print(f"[CiteVerify] Database initialization warning: {exc}")
    yield


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Open-registry academic citation and scientific visual evidence verification backend backed by PostgreSQL.",
    lifespan=lifespan,
)

allow_wildcard = "*" in settings.allowed_origins_list
cors_kwargs = {
    "allow_origins": ["*"] if allow_wildcard else settings.allowed_origins_list,
    "allow_credentials": not allow_wildcard,
    "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allow_headers": ["*"],
}
if settings.cors_origin_regex:
    cors_kwargs["allow_origin_regex"] = settings.cors_origin_regex

app.add_middleware(CORSMiddleware, **cors_kwargs)


def _to_figure_out(fig: FigureEvidence) -> FigureEvidenceOut:
    return FigureEvidenceOut(
        id=fig.id,
        order_index=fig.order_index,
        figure_label=fig.figure_label,
        evidence_type=fig.evidence_type,
        page_number=fig.page_number,
        caption=fig.caption,
        related_claims=list(fig.related_claims or []),
        has_image=bool(fig.image_data),
        image_width=fig.image_width,
        image_height=fig.image_height,
        extracted_plot_text=fig.extracted_plot_text,
        analysis_status=fig.analysis_status,
        vision_provider=fig.vision_provider,
        axes_and_units=fig.axes_and_units,
        numerical_values=list(fig.numerical_values or []),
        legends=fig.legends,
        trends=fig.trends,
        statistical_results=fig.statistical_results,
        experimental_conditions=fig.experimental_conditions,
        findings_summary=fig.findings_summary,
        mismatch_flags=list(fig.mismatch_flags or []),
        confidence_note=fig.confidence_note,
    )


def _to_summary(doc: VerificationDocument) -> DocumentSummaryOut:
    return DocumentSummaryOut(
        id=doc.id,
        filename=doc.filename,
        content_type=doc.content_type,
        file_size=doc.file_size,
        file_sha256=doc.file_sha256,
        has_stored_file=bool(doc.file_data or doc.storage_path),
        source_type=doc.source_type,
        status=doc.status,
        error_message=doc.error_message,
        total_citations=doc.total_citations,
        verified_count=doc.verified_count,
        mismatch_count=doc.mismatch_count,
        contradictory_count=doc.contradictory_count,
        unverified_count=doc.unverified_count,
        figure_count=doc.figure_count,
        figure_mismatch_count=doc.figure_mismatch_count,
        created_at=doc.created_at,
        completed_at=doc.completed_at,
    )


def _to_detail(doc: VerificationDocument) -> DocumentDetailOut:
    summary = _to_summary(doc)
    return DocumentDetailOut(
        **summary.model_dump(),
        extracted_text_preview=doc.extracted_text_preview,
        citations=[CitationOut.model_validate(c) for c in doc.citations],
        figures=[_to_figure_out(f) for f in doc.figures],
    )


def _persist_optional_disk_copy(doc_id: str, pdf_bytes: bytes) -> Optional[str]:
    if settings.storage_dir:
        target_dir = Path(settings.storage_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        file_path = target_dir / f"{doc_id}.pdf"
        file_path.write_bytes(pdf_bytes)
        return str(file_path)
    return None


async def _run_document_verification(document_id: str, from_pdf: bool, raw_text_input: Optional[str] = None) -> None:
    try:
        pdf_bytes: Optional[bytes] = None
        with session_scope() as db:
            doc = db.get(VerificationDocument, document_id)
            if not doc:
                return
            doc.status = "processing"
            doc.error_message = None

            if from_pdf:
                pdf_bytes = doc.file_data
                if not pdf_bytes and doc.storage_path and os.path.exists(doc.storage_path):
                    pdf_bytes = Path(doc.storage_path).read_bytes()
                if not pdf_bytes:
                    doc.status = "failed"
                    doc.error_message = "Uploaded PDF payload could not be retrieved from persistent storage."
                    return
                extracted_text = extract_text_from_pdf_bytes(pdf_bytes)
            else:
                extracted_text = raw_text_input or doc.extracted_text_preview or ""

            if not extracted_text.strip() and not from_pdf:
                doc.status = "failed"
                doc.error_message = "No citation text provided."
                return

            doc.extracted_text_preview = extracted_text[:4000] if extracted_text else ""
            parsed_items = parse_citations_from_text(extracted_text, from_pdf=from_pdf) if extracted_text.strip() else []

        extracted_figures = extract_figures_from_pdf_bytes(pdf_bytes) if (from_pdf and pdf_bytes) else []

        if not extracted_text.strip() and not extracted_figures:
            with session_scope() as db:
                doc = db.get(VerificationDocument, document_id)
                if doc:
                    doc.status = "failed"
                    doc.error_message = "No selectable text or figures could be extracted from this PDF."
            return

        citation_results = await verify_citations_batch(parsed_items) if parsed_items else []
        figure_results = await analyze_figures_batch(extracted_figures) if extracted_figures else []

        with session_scope() as db:
            doc = db.execute(
                select(VerificationDocument)
                .options(selectinload(VerificationDocument.citations), selectinload(VerificationDocument.figures))
                .where(VerificationDocument.id == document_id)
            ).scalar_one_or_none()
            if not doc:
                return

            doc.citations.clear()
            doc.figures.clear()
            db.flush()

            verified = 0
            mismatch = 0
            contradictory = 0
            unverified = 0
            for parsed, res in zip(parsed_items, citation_results):
                if res.status == "verified":
                    verified += 1
                elif res.status == "mismatch":
                    mismatch += 1
                elif res.status == "contradictory":
                    contradictory += 1
                else:
                    unverified += 1

                entry = CitationEntry(
                    document_id=doc.id,
                    order_index=parsed.order_index,
                    raw_text=parsed.raw_text,
                    extracted_title=parsed.extracted_title,
                    extracted_authors=parsed.extracted_authors,
                    extracted_year=parsed.extracted_year,
                    extracted_doi=parsed.extracted_doi,
                    extracted_venue=parsed.extracted_venue,
                    in_text_mentions=parsed.in_text_mentions,
                    status=res.status,
                    confidence_score=res.confidence_score,
                    verification_source=res.verification_source,
                    matched_title=res.matched_title,
                    matched_authors=res.matched_authors,
                    matched_year=res.matched_year,
                    matched_doi=res.matched_doi,
                    matched_venue=res.matched_venue,
                    matched_url=res.matched_url,
                    discrepancies=res.discrepancies,
                    bibtex=res.bibtex,
                )
                doc.citations.append(entry)

            fig_mismatches = 0
            for fig, fres in zip(extracted_figures, figure_results):
                if fres.analysis_status in ("numerical_mismatch", "context_mismatch"):
                    fig_mismatches += 1
                fig_row = FigureEvidence(
                    document_id=doc.id,
                    order_index=fig.order_index,
                    figure_label=fig.figure_label,
                    evidence_type=fres.detected_evidence_type or fig.evidence_type,
                    page_number=fig.page_number,
                    caption=fig.caption,
                    related_claims=fig.related_claims,
                    image_data=fig.image_bytes,
                    image_width=fig.image_width,
                    image_height=fig.image_height,
                    extracted_plot_text=fig.extracted_plot_text or fres.ocr_text_extracted,
                    analysis_status=fres.analysis_status,
                    vision_provider=fres.vision_provider,
                    axes_and_units=fres.axes_and_units,
                    numerical_values=fres.numerical_values,
                    legends=fres.legends,
                    trends=fres.trends,
                    statistical_results=fres.statistical_results,
                    experimental_conditions=fres.experimental_conditions,
                    findings_summary=fres.findings_summary,
                    mismatch_flags=fres.mismatch_flags,
                    confidence_note=fres.confidence_note,
                )
                doc.figures.append(fig_row)

            doc.total_citations = len(parsed_items)
            doc.verified_count = verified
            doc.mismatch_count = mismatch
            doc.contradictory_count = contradictory
            doc.unverified_count = unverified
            doc.figure_count = len(extracted_figures)
            doc.figure_mismatch_count = fig_mismatches
            doc.status = "completed"
            doc.completed_at = datetime.now(timezone.utc)
    except Exception as exc:
        with session_scope() as db:
            doc = db.get(VerificationDocument, document_id)
            if doc:
                doc.status = "failed"
                doc.error_message = f"Verification error: {str(exc)[:300]}"


def _schedule_verification(document_id: str, from_pdf: bool, raw_text_input: Optional[str] = None) -> None:
    asyncio.run(_run_document_verification(document_id, from_pdf=from_pdf, raw_text_input=raw_text_input))


@app.get("/", tags=["Health"])
def root_status():
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "health": "/api/health",
        "ai_key_required": False,
    }


@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
def health_check():
    db_ok, db_state = check_db_health()
    overall = "ok" if db_ok else "degraded"
    return HealthResponse(
        status=overall,
        service=settings.app_name,
        version=settings.app_version,
        database=db_state if db_ok else f"error ({db_state})",
        storage_mode=settings.storage_mode,
        ai_key_required=False,
        vision_model_configured=settings.vision_configured,
        verification_sources=["Crossref", "OpenAlex", "arXiv"],
    )


@app.get("/api/documents", response_model=List[DocumentSummaryOut], tags=["Documents"])
def list_documents(db: Session = Depends(get_db)):
    docs = db.execute(
        select(VerificationDocument).order_by(desc(VerificationDocument.created_at)).limit(50)
    ).scalars().all()
    return [_to_summary(d) for d in docs]


@app.post(
    "/api/documents/upload",
    response_model=DocumentSummaryOut,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Documents"],
)
async def upload_pdf_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files (.pdf) are supported.")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(pdf_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of {settings.max_upload_mb} MB.",
        )
    if not pdf_bytes.lstrip().startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Invalid PDF file header.")

    sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    doc = VerificationDocument(
        filename=os.path.basename(file.filename)[:255],
        content_type=file.content_type or "application/pdf",
        file_size=len(pdf_bytes),
        file_sha256=sha256,
        file_data=pdf_bytes,
        source_type="pdf",
        status="queued",
    )
    db.add(doc)
    db.flush()

    storage_path = _persist_optional_disk_copy(doc.id, pdf_bytes)
    if storage_path:
        doc.storage_path = storage_path

    db.commit()
    db.refresh(doc)

    background_tasks.add_task(_schedule_verification, doc.id, True, None)
    return _to_summary(doc)


@app.post("/api/documents/verify-text", response_model=DocumentDetailOut, tags=["Documents"])
async def verify_pasted_references(
    payload: VerifyTextRequest,
    db: Session = Depends(get_db),
):
    raw_bytes = payload.references_text.encode("utf-8")
    doc = VerificationDocument(
        filename=payload.title.strip()[:255],
        content_type="text/plain",
        file_size=len(raw_bytes),
        file_sha256=hashlib.sha256(raw_bytes).hexdigest(),
        file_data=raw_bytes,
        source_type="text",
        status="processing",
        extracted_text_preview=payload.references_text[:4000],
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    await _run_document_verification(doc.id, from_pdf=False, raw_text_input=payload.references_text)

    refreshed = db.execute(
        select(VerificationDocument)
        .options(selectinload(VerificationDocument.citations), selectinload(VerificationDocument.figures))
        .where(VerificationDocument.id == doc.id)
    ).scalar_one()
    return _to_detail(refreshed)


@app.post("/api/documents/{document_id}/analyze-figures", response_model=DocumentDetailOut, tags=["Figures"])
async def analyze_document_figures(document_id: str, db: Session = Depends(get_db)):
    doc = db.execute(
        select(VerificationDocument)
        .options(selectinload(VerificationDocument.citations), selectinload(VerificationDocument.figures))
        .where(VerificationDocument.id == document_id)
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    if doc.source_type != "pdf":
        raise HTTPException(status_code=400, detail="Figure and graph comparison is supported for uploaded PDF manuscripts only.")

    pdf_bytes = doc.file_data
    if not pdf_bytes and doc.storage_path and os.path.exists(doc.storage_path):
        pdf_bytes = Path(doc.storage_path).read_bytes()
    if not pdf_bytes:
        raise HTTPException(status_code=404, detail="Stored PDF payload could not be retrieved.")
    extracted_figures = await asyncio.to_thread(extract_figures_from_pdf_bytes, pdf_bytes)

    figure_results = await analyze_figures_batch(extracted_figures) if extracted_figures else []

    doc.figures.clear()
    db.flush()

    fig_mismatches = 0
    for fig, fres in zip(extracted_figures, figure_results):
        if fres.analysis_status in ("numerical_mismatch", "context_mismatch"):
            fig_mismatches += 1
        doc.figures.append(
            FigureEvidence(
                document_id=doc.id,
                order_index=fig.order_index,
                figure_label=fig.figure_label,
                evidence_type=fres.detected_evidence_type or fig.evidence_type,
                page_number=fig.page_number,
                caption=fig.caption,
                related_claims=fig.related_claims,
                image_data=fig.image_bytes,
                image_width=fig.image_width,
                image_height=fig.image_height,
                extracted_plot_text=fig.extracted_plot_text or fres.ocr_text_extracted,
                analysis_status=fres.analysis_status,
                vision_provider=fres.vision_provider,
                axes_and_units=fres.axes_and_units,
                numerical_values=fres.numerical_values,
                legends=fres.legends,
                trends=fres.trends,
                statistical_results=fres.statistical_results,
                experimental_conditions=fres.experimental_conditions,
                findings_summary=fres.findings_summary,
                mismatch_flags=fres.mismatch_flags,
                confidence_note=fres.confidence_note,
            )
        )

    doc.figure_count = len(extracted_figures)
    doc.figure_mismatch_count = fig_mismatches
    db.commit()

    refreshed = db.execute(
        select(VerificationDocument)
        .options(selectinload(VerificationDocument.citations), selectinload(VerificationDocument.figures))
        .where(VerificationDocument.id == document_id)
    ).scalar_one()
    return _to_detail(refreshed)


@app.get("/api/documents/{document_id}", response_model=DocumentDetailOut, tags=["Documents"])
def get_document_detail(document_id: str, db: Session = Depends(get_db)):
    doc = db.execute(
        select(VerificationDocument)
        .options(selectinload(VerificationDocument.citations), selectinload(VerificationDocument.figures))
        .where(VerificationDocument.id == document_id)
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return _to_detail(doc)


@app.get("/api/documents/{document_id}/file", tags=["Documents"])
def download_stored_pdf(document_id: str, db: Session = Depends(get_db)):
    doc = db.get(VerificationDocument, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    data = doc.file_data
    if not data and doc.storage_path and os.path.exists(doc.storage_path):
        data = Path(doc.storage_path).read_bytes()
    if not data:
        raise HTTPException(status_code=404, detail="No binary PDF stored for this entry.")
    return Response(
        content=data,
        media_type=doc.content_type or "application/pdf",
        headers={"Content-Disposition": f'inline; filename="{doc.filename}"'},
    )


@app.get("/api/documents/{document_id}/figures/{figure_id}/image", tags=["Figures"])
def get_figure_evidence_image(document_id: str, figure_id: str, db: Session = Depends(get_db)):
    fig = db.execute(
        select(FigureEvidence).where(
            FigureEvidence.id == figure_id,
            FigureEvidence.document_id == document_id,
        )
    ).scalar_one_or_none()
    if not fig or not fig.image_data:
        raise HTTPException(status_code=404, detail="Figure image not found.")
    return Response(
        content=fig.image_data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.post("/api/documents/{document_id}/reverify", response_model=DocumentSummaryOut, tags=["Documents"])
def reverify_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    doc = db.get(VerificationDocument, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    doc.status = "queued"
    doc.error_message = None
    db.commit()
    db.refresh(doc)

    is_pdf = doc.source_type == "pdf"
    raw_text = None
    if not is_pdf:
        raw_text = doc.file_data.decode("utf-8") if doc.file_data else doc.extracted_text_preview
    background_tasks.add_task(_schedule_verification, doc.id, is_pdf, raw_text)
    return _to_summary(doc)


@app.delete("/api/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Documents"])
def delete_document(document_id: str, db: Session = Depends(get_db)):
    doc = db.get(VerificationDocument, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc.storage_path and os.path.exists(doc.storage_path):
        try:
            os.remove(doc.storage_path)
        except OSError:
            pass
    db.delete(doc)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/documents/{document_id}/export", tags=["Documents"])
def export_document_report(
    document_id: str,
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    db: Session = Depends(get_db),
):
    doc = db.execute(
        select(VerificationDocument)
        .options(selectinload(VerificationDocument.citations), selectinload(VerificationDocument.figures))
        .where(VerificationDocument.id == document_id)
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    if format == "json":
        detail = _to_detail(doc)
        return JSONResponse(
            content=detail.model_dump(mode="json"),
            headers={"Content-Disposition": f'attachment; filename="{doc.id}-citeverify.json"'},
        )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Index",
        "Status",
        "Confidence",
        "Source",
        "Extracted Title",
        "Extracted Authors",
        "Extracted Year",
        "Extracted DOI",
        "Matched Title",
        "Matched Authors",
        "Matched Year",
        "Matched DOI",
        "Matched Venue",
        "Discrepancies",
        "Raw Citation",
    ])
    for c in doc.citations:
        writer.writerow([
            c.order_index,
            c.status,
            c.confidence_score,
            c.verification_source,
            c.extracted_title or "",
            c.extracted_authors or "",
            c.extracted_year or "",
            c.extracted_doi or "",
            c.matched_title or "",
            c.matched_authors or "",
            c.matched_year or "",
            c.matched_doi or "",
            c.matched_venue or "",
            " | ".join(c.discrepancies or []),
            c.raw_text,
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{doc.id}-citeverify.csv"'},
    )
