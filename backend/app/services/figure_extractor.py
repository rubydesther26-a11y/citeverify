import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
import pymupdf as fitz

CAPTION_REGEX = re.compile(
    r"^\s*(?:(Figure|Fig\.?|Table|Chart|Graph)\s+(\d+[a-zA-Z]?|[IVX]+))\s*(?:[:.\-–—]\s*(.*))?$",
    re.IGNORECASE | re.DOTALL,
)
SENTENCE_SPLIT_REGEX = re.compile(r"(?<=[.!?])\s+")


@dataclass
class ExtractedFigure:
    order_index: int
    figure_label: str
    evidence_type: str  # "figure" | "graph" | "table"
    page_number: int
    caption: Optional[str]
    related_claims: List[str] = field(default_factory=list)
    image_bytes: bytes = b""
    image_width: int = 0
    image_height: int = 0
    extracted_plot_text: Optional[str] = None
    extracted_table_rows: List[List[str]] = field(default_factory=list)


def _find_related_claims(full_text: str, figure_label: str) -> List[str]:
    if not full_text or not figure_label:
        return []
    m = re.match(r"^(Figure|Fig\.?|Table|Chart|Graph)\s+([A-Za-z0-9]+)", figure_label, re.IGNORECASE)
    if not m:
        return []
    kind = m.group(1).lower()
    num = m.group(2)
    if kind.startswith("fig"):
        pattern = re.compile(rf"\b(?:Figure|Fig\.?)\s+{re.escape(num)}\b", re.IGNORECASE)
    elif kind.startswith("table"):
        pattern = re.compile(rf"\bTable\s+{re.escape(num)}\b", re.IGNORECASE)
    else:
        pattern = re.compile(rf"\b{re.escape(m.group(1))}\s+{re.escape(num)}\b", re.IGNORECASE)

    normalized_text = re.sub(r"\s+", " ", full_text)
    claims: List[str] = []
    for sentence in SENTENCE_SPLIT_REGEX.split(normalized_text):
        cleaned = sentence.strip()
        if len(cleaned) < 25 or len(cleaned) > 520:
            continue
        if pattern.search(cleaned):
            # Exclude the caption itself if it starts with "Figure N:" / "Table N:"
            if re.match(rf"^(?:Figure|Fig\.?|Table|Chart|Graph)\s+{re.escape(num)}\s*[:.\-]", cleaned, re.IGNORECASE):
                continue
            # Strip leading section heading prefix like "5.2 Analyzing Runs " before prose sentence
            cleaned = re.sub(r"^\d+(?:\.\d+)+\s+[A-Z][A-Za-z0-9\s\-:,]{3,70}?(?=(?:We|Our|The|In|As|From|Manually|Comparing|Table|Figure|Fig\.?)\b)", "", cleaned).strip()
            # Skip raw dumped table cell blocks (very high number density and >260 chars without normal prose ending)
            num_tokens = re.findall(r"\b\d+(?:\.\d+)?%?\b", cleaned)
            if len(num_tokens) >= 12 and len(cleaned.split()) > 35:
                continue
            if cleaned and cleaned not in claims:
                claims.append(cleaned)
        if len(claims) >= 4:
            break
    return claims


def _infer_evidence_type(
    label: str,
    caption: Optional[str],
    has_table: bool,
    plot_text: Optional[str] = None,
) -> str:
    combined = f"{label} {caption or ''}".lower()
    if has_table or label.lower().startswith("table"):
        return "table"
    if any(
        k in combined
        for k in (
            "plot",
            "graph",
            "chart",
            "curve",
            "accuracy",
            "loss",
            "distribution",
            "trend",
            "bar",
            "scatter",
            "roc",
            "vs.",
            "versus",
            "frequency",
            "percent",
            "histogram",
            "heatmap",
            "comparison",
        )
    ):
        return "graph"
    if plot_text:
        pt_lower = plot_text.lower()
        nums = re.findall(r"(?<![A-Za-z0-9.])\d+(?:\.\d+)?%?(?![A-Za-z0-9])", plot_text)
        if len(nums) >= 3 and any(
            u in pt_lower
            for u in ("%", "percent", "accuracy", "epoch", "loss", "score", "frequency", "rate", "latency", "ms", "f1", "auc")
        ):
            return "graph"
    return "figure"


def _clip_pixmap_to_png(page: fitz.Page, clip_rect: fitz.Rect) -> Tuple[bytes, int, int]:
    page_rect = page.rect
    bounded = clip_rect & page_rect
    if bounded.is_empty or bounded.width < 24 or bounded.height < 24:
        return b"", 0, 0
    pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), clip=bounded, alpha=False)
    return pix.tobytes("png"), pix.width, pix.height


def _extract_region_text(page: fitz.Page, clip_rect: fitz.Rect) -> str:
    bounded = clip_rect & page.rect
    if bounded.is_empty:
        return ""
    text = page.get_text("text", clip=bounded) or ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)[:2000]


def extract_figures_from_pdf_bytes(pdf_bytes: bytes) -> List[ExtractedFigure]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        full_text_parts: List[str] = []
        for page in doc:
            full_text_parts.append(page.get_text("text") or "")
        full_text = "\n".join(full_text_parts)

        extracted: List[ExtractedFigure] = []
        order_idx = 0

        for page_index, page in enumerate(doc, start=1):
            page_rect = page.rect
            blocks = page.get_text("blocks") or []
            caption_blocks: List[Tuple[fitz.Rect, str, str, str]] = []

            for blk in blocks:
                if len(blk) < 5:
                    continue
                x0, y0, x1, y1, raw_txt = blk[:5]
                if not isinstance(raw_txt, str):
                    continue
                txt = re.sub(r"\s+", " ", raw_txt).strip()
                m = CAPTION_REGEX.match(txt)
                if m:
                    kind_raw = m.group(1)
                    num_raw = m.group(2)
                    kind_norm = "Table" if kind_raw.lower().startswith("table") else "Figure"
                    label = f"{kind_norm} {num_raw}"
                    caption_blocks.append((fitz.Rect(x0, y0, x1, y1), label, txt, kind_norm.lower()))

            # Detect structured tables via PyMuPDF only when a Table caption exists on this page
            page_tables = []
            if any(kind_norm == "table" for _, _, _, kind_norm in caption_blocks):
                try:
                    table_finder = page.find_tables()
                    page_tables = list(table_finder.tables) if table_finder else []
                except Exception:
                    page_tables = []

            # Collect embedded image rects on this page
            image_rects: List[Tuple[int, fitz.Rect]] = []
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                for rect in page.get_image_rects(xref):
                    if rect.width >= 40 and rect.height >= 40:
                        image_rects.append((xref, rect))

            # Collect vector drawing cluster bounds
            drawing_rects: List[fitz.Rect] = []
            try:
                for d in page.get_drawings():
                    r = d.get("rect")
                    if r and r.width >= 8 and r.height >= 8 and r.width < page_rect.width * 0.95:
                        drawing_rects.append(fitz.Rect(r))
            except Exception:
                drawing_rects = []

            used_image_indices = set()

            for cap_rect, label, caption_text, kind_norm in caption_blocks:
                target_rect: Optional[fitz.Rect] = None
                matched_table_rows: List[List[str]] = []

                if kind_norm == "table":
                    # Look for table immediately below or above caption
                    best_table = None
                    best_dist = 99999.0
                    for tbl in page_tables:
                        t_rect = fitz.Rect(tbl.bbox)
                        dist = min(abs(t_rect.y0 - cap_rect.y1), abs(cap_rect.y0 - t_rect.y1))
                        if dist < best_dist and dist < 240:
                            best_dist = dist
                            best_table = tbl
                    if best_table is not None:
                        target_rect = fitz.Rect(best_table.bbox) + (-8, -8, 8, 8)
                        try:
                            raw_rows = best_table.extract() or []
                            matched_table_rows = [
                                [str(cell or "").strip() for cell in row]
                                for row in raw_rows[:30]
                            ]
                        except Exception:
                            matched_table_rows = []
                    else:
                        # Crop table area below caption
                        target_rect = fitz.Rect(
                            max(24, cap_rect.x0 - 20),
                            max(24, cap_rect.y1 + 2),
                            min(page_rect.width - 24, max(cap_rect.x1 + 20, page_rect.width * 0.88)),
                            min(page_rect.height - 24, cap_rect.y1 + 210),
                        )
                else:
                    # Figure / Graph: gather all embedded raster images above (or slightly below) caption
                    matched_img_indices: List[int] = []
                    for idx, (_, img_r) in enumerate(image_rects):
                        if idx in used_image_indices:
                            continue
                        if img_r.y1 <= cap_rect.y0 + 25:
                            dist = cap_rect.y0 - img_r.y1
                        else:
                            dist = img_r.y0 - cap_rect.y1 + 60
                        if 0 <= dist < 240:
                            matched_img_indices.append(idx)

                    if matched_img_indices:
                        # Group images that share the same horizontal figure band directly above caption
                        closest_idx = min(
                            matched_img_indices,
                            key=lambda i: abs(cap_rect.y0 - image_rects[i][1].y1),
                        )
                        anchor_r = image_rects[closest_idx][1]
                        band_indices = [
                            i
                            for i in matched_img_indices
                            if abs(image_rects[i][1].y1 - anchor_r.y1) < 120
                            and abs(image_rects[i][1].y0 - anchor_r.y0) < 120
                        ]
                        union_img = fitz.Rect(anchor_r)
                        for i in band_indices:
                            used_image_indices.add(i)
                            union_img |= image_rects[i][1]
                        target_rect = union_img + (-8, -8, 8, 8)
                    else:
                        # Check vector drawing cluster directly above caption (typical matplotlib / LaTeX vector plots!)
                        above_drawings = [
                            dr for dr in drawing_rects
                            if dr.y1 <= cap_rect.y0 + 14 and (cap_rect.y0 - dr.y1) < 280
                        ]
                        if above_drawings:
                            union = fitz.Rect(above_drawings[0])
                            for dr in above_drawings[1:]:
                                union |= dr
                            if union.width >= 60 and union.height >= 45:
                                target_rect = union + (-14, -14, 14, 10)
                        if target_rect is None:
                            # Fallback region directly above the figure caption
                            top_y = max(36, cap_rect.y0 - 240)
                            if cap_rect.y0 - top_y >= 60:
                                target_rect = fitz.Rect(
                                    max(28, cap_rect.x0 - 30),
                                    top_y,
                                    min(page_rect.width - 28, max(cap_rect.x1 + 30, page_rect.width * 0.88)),
                                    cap_rect.y0 - 2,
                                )

                if target_rect is None:
                    continue

                png_bytes, width, height = _clip_pixmap_to_png(page, target_rect)
                if not png_bytes:
                    continue

                plot_text = _extract_region_text(page, target_rect)
                evidence_type = _infer_evidence_type(
                    label,
                    caption_text,
                    has_table=bool(matched_table_rows),
                    plot_text=plot_text,
                )
                order_idx += 1
                extracted.append(
                    ExtractedFigure(
                        order_index=order_idx,
                        figure_label=label,
                        evidence_type=evidence_type,
                        page_number=page_index,
                        caption=caption_text,
                        related_claims=_find_related_claims(full_text, label),
                        image_bytes=png_bytes,
                        image_width=width,
                        image_height=height,
                        extracted_plot_text=plot_text or None,
                        extracted_table_rows=matched_table_rows,
                    )
                )
                if len(extracted) >= 24:
                    return extracted

            # Also capture large standalone embedded images on pages without detected captions
            for idx, (xref, img_r) in enumerate(image_rects):
                if idx in used_image_indices:
                    continue
                if img_r.width < 110 or img_r.height < 90:
                    continue
                png_bytes, width, height = _clip_pixmap_to_png(page, img_r + (-6, -6, 6, 6))
                if not png_bytes:
                    continue
                order_idx += 1
                extracted.append(
                    ExtractedFigure(
                        order_index=order_idx,
                        figure_label=f"Embedded Figure (p.{page_index})",
                        evidence_type="figure",
                        page_number=page_index,
                        caption=None,
                        related_claims=[],
                        image_bytes=png_bytes,
                        image_width=width,
                        image_height=height,
                        extracted_plot_text=_extract_region_text(page, img_r) or None,
                    )
                )
                if len(extracted) >= 24:
                    return extracted

        return extracted
    finally:
        doc.close()
