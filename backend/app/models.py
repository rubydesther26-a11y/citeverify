import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional
from sqlalchemy import DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class VerificationDocument(Base):
    __tablename__ = "verification_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False, default="application/pdf")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    file_data: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    source_type: Mapped[str] = mapped_column(String(24), nullable=False, default="pdf")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_text_preview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    total_citations: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verified_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mismatch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    contradictory_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unverified_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    figure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    figure_mismatch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    citations: Mapped[List["CitationEntry"]] = relationship(
        "CitationEntry",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="CitationEntry.order_index",
    )

    figures: Mapped[List["FigureEvidence"]] = relationship(
        "FigureEvidence",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="FigureEvidence.order_index",
    )


class CitationEntry(Base):
    __tablename__ = "citation_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("verification_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    extracted_title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_authors: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_year: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    extracted_doi: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    extracted_venue: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    in_text_mentions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    status: Mapped[str] = mapped_column(String(24), nullable=False, default="unverified")
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    verification_source: Mapped[str] = mapped_column(String(48), nullable=False, default="None")

    matched_title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    matched_authors: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    matched_year: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    matched_doi: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    matched_venue: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    matched_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    discrepancies: Mapped[List[Any]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"),
        nullable=False,
        default=list,
    )
    bibtex: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    document: Mapped["VerificationDocument"] = relationship("VerificationDocument", back_populates="citations")


class FigureEvidence(Base):
    __tablename__ = "figure_evidences"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("verification_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    figure_label: Mapped[str] = mapped_column(String(120), nullable=False)
    evidence_type: Mapped[str] = mapped_column(String(32), nullable=False, default="figure")
    page_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    caption: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    related_claims: Mapped[List[Any]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"),
        nullable=False,
        default=list,
    )

    image_data: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    image_width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image_height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    extracted_plot_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    analysis_status: Mapped[str] = mapped_column(String(32), nullable=False, default="human_review")
    vision_provider: Mapped[str] = mapped_column(String(48), nullable=False, default="none")

    axes_and_units: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    numerical_values: Mapped[List[Any]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"),
        nullable=False,
        default=list,
    )
    legends: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trends: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    statistical_results: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    experimental_conditions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    findings_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    mismatch_flags: Mapped[List[Any]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"),
        nullable=False,
        default=list,
    )
    confidence_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    document: Mapped["VerificationDocument"] = relationship("VerificationDocument", back_populates="figures")
