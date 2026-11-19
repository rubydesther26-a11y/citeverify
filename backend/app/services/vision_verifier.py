import asyncio
import base64
import io
import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import httpx
from PIL import Image
from app.config import get_settings
from app.services.figure_extractor import ExtractedFigure

NUMBER_TOKEN_REGEX = re.compile(r"(?<![A-Za-z0-9.])(-?\d+(?:\.\d+)?%?)(?![A-Za-z0-9])")
UNIT_REGEX = re.compile(
    r"(\[%\]|\(%\)|%|\b(?:percent|percentage|accuracy|f1|auc|loss|epoch|epochs|ms|sec|seconds|minutes|hours|frequency|count|score|tokens|samples|mb|gb|hz|nm|mm|cm|kg|mg)\b)",
    re.IGNORECASE,
)
STAT_REGEX = re.compile(
    r"(p\s*[<≤=]\s*0?\.\d+|r\^?2\s*=\s*0?\.\d+|\b(?:mean|std|sd|ci|rmse|mae|f1|auc|accuracy)\b\s*[:=]?\s*\d+(?:\.\d+)?%?|\d+(?:\.\d+)?\s*±\s*\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
CONDITION_REGEX = re.compile(
    r"\b(?:across|on|using|with|under|for|evaluated on|trained on)\s+([^.,;]{4,70})",
    re.IGNORECASE,
)

_ocr_instance: Any = None
_ocr_unavailable: bool = False


def _get_ocr():
    global _ocr_instance, _ocr_unavailable
    if _ocr_unavailable:
        return None
    if _ocr_instance is None:
        try:
            from rapidocr_onnxruntime import RapidOCR

            _ocr_instance = RapidOCR()
        except Exception:
            _ocr_unavailable = True
            return None
    return _ocr_instance


@dataclass
class FigureAnalysisResult:
    analysis_status: str  # "verified" | "numerical_mismatch" | "context_mismatch" | "human_review"
    vision_provider: str  # "none" | "pymupdf_rapidocr" | "pymupdf_table_check" | "openai_compatible" | "gemini"
    axes_and_units: Optional[str] = None
    numerical_values: List[str] = field(default_factory=list)
    legends: Optional[str] = None
    trends: Optional[str] = None
    statistical_results: Optional[str] = None
    experimental_conditions: Optional[str] = None
    findings_summary: Optional[str] = None
    mismatch_flags: List[str] = field(default_factory=list)
    confidence_note: Optional[str] = None
    ocr_text_extracted: Optional[str] = None
    detected_evidence_type: Optional[str] = None


def _extract_numeric_tokens(text: str, limit: Optional[int] = 24) -> List[str]:
    if not text:
        return []
    seen: List[str] = []
    for match in NUMBER_TOKEN_REGEX.findall(text):
        val = match.strip()
        if val not in seen:
            seen.append(val)
        if limit is not None and len(seen) >= limit:
            break
    return seen


def _analyze_image_palette_and_ocr(
    image_bytes: bytes,
    run_ocr: bool = True,
) -> Tuple[List[Tuple[List[List[float]], str, float]], int, int, List[str]]:
    if not image_bytes:
        return [], 0, 0, []

    img_w = 0
    img_h = 0
    distinct_colors: List[str] = []
    ocr_input_bytes = image_bytes
    ocr_scale = 1.0
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            rgb = im.convert("RGB")
            img_w, img_h = rgb.size
            thumb = rgb.resize((64, 64))
            quant = thumb.quantize(colors=8, method=Image.Quantize.MEDIANCUT).convert("RGB")
            color_counts = quant.getcolors(maxcolors=64) or []
            for count, (r, g, b) in sorted(color_counts, reverse=True):
                if count < 18:
                    continue
                # Skip near-white, near-black, and neutral greys (background / axes)
                spread = max(r, g, b) - min(r, g, b)
                if spread < 28:
                    continue
                hex_code = f"#{r:02X}{g:02X}{b:02X}"
                if hex_code not in distinct_colors:
                    distinct_colors.append(hex_code)
                if len(distinct_colors) >= 5:
                    break
            max_dim = max(img_w, img_h)
            if run_ocr and max_dim > 1280:
                ocr_scale = 1280.0 / float(max_dim)
                resized = rgb.resize(
                    (max(1, int(img_w * ocr_scale)), max(1, int(img_h * ocr_scale))),
                    Image.Resampling.BILINEAR,
                )
                buf = io.BytesIO()
                resized.save(buf, format="PNG")
                ocr_input_bytes = buf.getvalue()
    except Exception:
        pass

    ocr_boxes: List[Tuple[List[List[float]], str, float]] = []
    ocr = _get_ocr() if run_ocr else None
    if ocr is not None:
        try:
            raw_res, _ = ocr(ocr_input_bytes)
            inv_scale = 1.0 / ocr_scale if ocr_scale > 0 else 1.0
            for item in raw_res or []:
                box, text, score = item[0], str(item[1]).strip(), float(item[2])
                if text and score >= 0.45:
                    scaled_box = [[pt[0] * inv_scale, pt[1] * inv_scale] for pt in box]
                    ocr_boxes.append((scaled_box, text, score))
        except Exception:
            pass

    return ocr_boxes, img_w, img_h, distinct_colors


def _extract_local_graph_and_image_features(fig: ExtractedFigure) -> Dict[str, Any]:
    skip_ocr = bool(fig.extracted_table_rows and fig.extracted_plot_text)
    ocr_boxes, img_w, img_h, distinct_colors = _analyze_image_palette_and_ocr(
        fig.image_bytes,
        run_ocr=not skip_ocr,
    )
    w = img_w or fig.image_width or 1
    h = img_h or fig.image_height or 1

    ocr_texts = [t for _, t, _ in ocr_boxes]
    combined_plot_text = "\n".join(
        part for part in [fig.extracted_plot_text or "", " ".join(ocr_texts)] if part.strip()
    )
    numerical_values = _extract_numeric_tokens(combined_plot_text)

    # Spatial axis detection from OCR boxes
    y_axis_labels: List[str] = []
    x_axis_labels: List[str] = []
    legend_candidates: List[str] = []

    for box, text, _ in ocr_boxes:
        xs = [pt[0] for pt in box]
        ys = [pt[1] for pt in box]
        cx = sum(xs) / 4.0
        cy = sum(ys) / 4.0
        box_w = max(xs) - min(xs)
        box_h = max(ys) - min(ys)
        is_pure_number = bool(re.fullmatch(r"-?\d+(?:\.\d+)?%?", text.strip()))

        # Left margin or vertical text -> Y-axis label/ticks
        if cx < w * 0.25 or (box_h > box_w * 1.4 and len(text) > 2):
            if not is_pure_number and text not in y_axis_labels:
                y_axis_labels.append(text)
        # Bottom band -> X-axis labels/ticks
        elif cy > h * 0.78:
            if not is_pure_number and text not in x_axis_labels:
                x_axis_labels.append(text)
        else:
            if not is_pure_number and len(text) <= 42 and text not in legend_candidates:
                legend_candidates.append(text)

    unit_matches = list(dict.fromkeys(m.strip() for m in UNIT_REGEX.findall(f"{combined_plot_text} {fig.caption or ''}")))
    axes_parts: List[str] = []
    if y_axis_labels:
        axes_parts.append(f"Y-axis / vertical: {', '.join(y_axis_labels[:4])}")
    if x_axis_labels:
        axes_parts.append(f"X-axis / horizontal: {', '.join(x_axis_labels[:5])}")
    if unit_matches:
        axes_parts.append(f"Detected units/metrics: {', '.join(unit_matches[:6])}")
    axes_and_units = " | ".join(axes_parts) if axes_parts else None

    # Refined graph detection from OCR spatial features
    has_numeric_ticks = len(_extract_numeric_tokens(combined_plot_text, limit=None)) >= 3
    has_axis_structure = bool((y_axis_labels or x_axis_labels) and (unit_matches or has_numeric_ticks))
    detected_type: Optional[str] = None
    if fig.evidence_type == "figure" and has_numeric_ticks and has_axis_structure:
        detected_type = "graph"

    # Legend & visual color series
    legend_parts: List[str] = []
    if legend_candidates:
        legend_parts.append(f"Detected labels: {', '.join(legend_candidates[:8])}")
    if distinct_colors:
        legend_parts.append(f"Series palette: {', '.join(distinct_colors)}")
    legends = " | ".join(legend_parts) if legend_parts else None

    # Statistical expressions
    stat_hits = list(
        dict.fromkeys(
            m.strip()
            for m in STAT_REGEX.findall(f"{combined_plot_text} {fig.caption or ''} {' '.join(fig.related_claims)}")
        )
    )
    statistical_results = "; ".join(stat_hits[:6]) if stat_hits else None

    # Experimental conditions from caption & claims
    cond_hits = list(
        dict.fromkeys(
            m.strip()
            for m in CONDITION_REGEX.findall(f"{fig.caption or ''} {' '.join(fig.related_claims)}")
        )
    )
    experimental_conditions = "; ".join(cond_hits[:4]) if cond_hits else None

    return {
        "ocr_texts": ocr_texts,
        "combined_plot_text": combined_plot_text,
        "numerical_values": numerical_values,
        "axes_and_units": axes_and_units,
        "legends": legends,
        "statistical_results": statistical_results,
        "experimental_conditions": experimental_conditions,
        "unit_matches": unit_matches,
        "has_ocr": bool(ocr_texts),
        "detected_evidence_type": detected_type,
    }


def _strip_non_claim_numbers(text: str) -> str:
    # Remove section numbers (e.g. "5.2 Analyzing", "Section 4.1"), model version tags ("Claude-3.5", "LLaMa-3.1"), and figure/table indices
    cleaned = re.sub(r"\b(?:Section|Sec\.?|Appendix|App\.?|Figure|Fig\.?|Table|Eq\.?)\s*\d+(?:\.\d+)*", " ", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"(?:^|\s)\d+(?:\.\d+)+\s+(?=[A-Z])", " ", cleaned)
    cleaned = re.sub(r"\b[A-Za-z]+[-–]\d+(?:\.\d+)+\b", " ", cleaned)
    return cleaned


def _check_local_claims_and_tables(fig: ExtractedFigure, local_feats: Dict[str, Any]) -> FigureAnalysisResult:
    extracted_nums = local_feats["numerical_values"]
    table_flat = " ".join(cell for row in fig.extracted_table_rows for cell in row if cell)
    all_extracted_text = f"{table_flat} {local_feats['combined_plot_text']}".strip()
    extracted_num_set = {n.rstrip("%") for n in _extract_numeric_tokens(all_extracted_text, limit=None)}

    num_mismatches: List[str] = []
    ctx_mismatches: List[str] = []
    claim_nums_checked = 0
    matched_claim_nums: List[str] = []

    if fig.extracted_table_rows or local_feats["has_ocr"] or (fig.extracted_plot_text and fig.related_claims):
        for claim in fig.related_claims:
            sanitized_claim = _strip_non_claim_numbers(claim)
            for token in _extract_numeric_tokens(sanitized_claim, limit=None):
                norm = token.rstrip("%")
                if norm.isdigit() and (int(norm) <= 20 or (1900 <= int(norm) <= 2099)):
                    continue
                # Compare decimals and significant percentages against extracted table/OCR/PDF-region values
                if "." in norm or token.endswith("%"):
                    claim_nums_checked += 1
                    if extracted_num_set:
                        # Exact match or single-decimal/trailing-zero equivalence (e.g. 94.2 == 94.20)
                        matched = norm in extracted_num_set
                        if not matched:
                            try:
                                val_f = float(norm)
                                matched = any(abs(float(ex) - val_f) < 0.051 for ex in extracted_num_set if ex.replace(".", "", 1).lstrip("-").isdigit())
                            except ValueError:
                                matched = False
                        if matched:
                            matched_claim_nums.append(token)
                        else:
                            source_kind = "table cells" if fig.extracted_table_rows else "OCR/plot values"
                            num_mismatches.append(
                                f"Numerical mismatch: manuscript claim cites '{token}', which was not observed in {source_kind} for {fig.figure_label}."
                            )

    # Context / unit consistency comparison between PDF claims and extracted figure/graph axes & caption
    if fig.related_claims and (local_feats["unit_matches"] or local_feats["axes_and_units"]):
        visual_context = f"{local_feats['axes_and_units'] or ''} {fig.caption or ''} {local_feats['combined_plot_text']}".lower()
        claims_joined = " ".join(fig.related_claims).lower()
        distinct_metric_pairs = [
            ("latency_time", ("millisecond", "milliseconds", "latency", "runtime"), ("accuracy", "percent", "%", "f1", "auc")),
            ("error_loss", ("rmse", "mae", "perplexity", "cross-entropy loss"), ("accuracy", "precision", "recall", "f1")),
        ]
        for _, claim_terms, visual_terms in distinct_metric_pairs:
            claim_hit = next((t for t in claim_terms if re.search(rf"\b{re.escape(t)}\b", claims_joined)), None)
            visual_hit = next((t for t in visual_terms if t in visual_context), None)
            claim_also_mentions_visual = any(t in claims_joined for t in visual_terms)
            visual_also_mentions_claim = any(t in visual_context for t in claim_terms)
            if claim_hit and visual_hit and not claim_also_mentions_visual and not visual_also_mentions_claim:
                ctx_mismatches.append(
                    f"Context mismatch: citing claim references '{claim_hit}', whereas extracted {fig.figure_label} axes/caption measure '{visual_hit}'."
                )

    mismatches = num_mismatches + ctx_mismatches
    det_type = local_feats.get("detected_evidence_type")
    effective_type = det_type or fig.evidence_type

    if fig.extracted_table_rows:
        summary = (
            f"Extracted {len(fig.extracted_table_rows)} table rows via PyMuPDF"
            + (f" and {len(local_feats['ocr_texts'])} OCR tokens" if local_feats["has_ocr"] else "")
            + f" on page {fig.page_number}; compared against {len(fig.related_claims)} PDF claim(s)."
        )
        if mismatches:
            return FigureAnalysisResult(
                analysis_status="numerical_mismatch" if num_mismatches else "context_mismatch",
                vision_provider="pymupdf_table_check",
                axes_and_units=local_feats["axes_and_units"],
                numerical_values=extracted_nums,
                legends=local_feats["legends"],
                trends="Tabular comparison (no curve trend applicable).",
                statistical_results=local_feats["statistical_results"],
                experimental_conditions=local_feats["experimental_conditions"],
                findings_summary=summary,
                mismatch_flags=mismatches,
                confidence_note="Deterministic PyMuPDF table inspection flagged discrepancies between PDF citing claims and extracted table cells.",
                ocr_text_extracted=" | ".join(local_feats["ocr_texts"][:30]) or None,
                detected_evidence_type=det_type,
            )
        if claim_nums_checked > 0:
            return FigureAnalysisResult(
                analysis_status="verified",
                vision_provider="pymupdf_table_check",
                axes_and_units=local_feats["axes_and_units"],
                numerical_values=extracted_nums,
                legends=local_feats["legends"],
                trends="Tabular comparison verified.",
                statistical_results=local_feats["statistical_results"],
                experimental_conditions=local_feats["experimental_conditions"],
                findings_summary=f"{summary} Matched {len(matched_claim_nums)}/{claim_nums_checked} numerical claims against extracted table cells.",
                mismatch_flags=[],
                confidence_note="Verified deterministically from PDF table cells via PyMuPDF.",
                ocr_text_extracted=" | ".join(local_feats["ocr_texts"][:30]) or None,
                detected_evidence_type=det_type,
            )

    provider = "pymupdf_rapidocr" if local_feats["has_ocr"] else "none"
    if mismatches:
        return FigureAnalysisResult(
            analysis_status="numerical_mismatch" if num_mismatches else "context_mismatch",
            vision_provider=provider,
            axes_and_units=local_feats["axes_and_units"],
            numerical_values=extracted_nums,
            legends=local_feats["legends"],
            trends="Visual trend confirmation requires Human Review (no vision LLM configured).",
            statistical_results=local_feats["statistical_results"],
            experimental_conditions=local_feats["experimental_conditions"],
            findings_summary=(
                f"Compared {fig.figure_label} ({effective_type}, p.{fig.page_number}) against {len(fig.related_claims)} citing PDF claim(s); "
                f"extracted {len(local_feats['ocr_texts'])} OCR labels/values."
            ),
            mismatch_flags=mismatches,
            confidence_note="Local RapidOCR + PyMuPDF comparison flagged a discrepancy against the PDF's citing claim. Confirm visually via Human Review.",
            ocr_text_extracted=" | ".join(local_feats["ocr_texts"][:30]) or None,
            detected_evidence_type=det_type,
        )

    if local_feats["has_ocr"]:
        claim_cmp = (
            f" Compared against {len(fig.related_claims)} PDF claim(s)"
            + (f" ({len(matched_claim_nums)} numerical citation(s) matched extracted values)." if claim_nums_checked > 0 else " (no numeric discrepancies detected).")
            if fig.related_claims
            else " No body-text claim sentence cited this label."
        )
        summary = (
            f"Local PyMuPDF + RapidOCR analyzed {fig.figure_label} ({effective_type}, p.{fig.page_number}): "
            f"{len(local_feats['ocr_texts'])} OCR tokens, {len(extracted_nums)} numeric values.{claim_cmp}"
        )
    else:
        summary = "Figure preserved via PyMuPDF (no embedded OCR text tokens detected)."

    return FigureAnalysisResult(
        analysis_status="human_review",
        vision_provider=provider,
        axes_and_units=local_feats["axes_and_units"],
        numerical_values=extracted_nums,
        legends=local_feats["legends"],
        trends="Visual curve/slope direction requires Human Review (configure VISION_API_BASE_URL + VISION_MODEL for automated vision inference).",
        statistical_results=local_feats["statistical_results"],
        experimental_conditions=local_feats["experimental_conditions"],
        findings_summary=summary,
        mismatch_flags=[],
        confidence_note=(
            "Axes, units, legends, and numerical values were extracted locally from the PDF figure/graph and compared against citing manuscript claims. "
            "Visual slope/trend interpretation remains marked for Human Review."
        ),
        ocr_text_extracted=" | ".join(local_feats["ocr_texts"][:30]) or None,
        detected_evidence_type=det_type,
    )


def _build_vision_prompt(fig: ExtractedFigure, local_feats: Dict[str, Any]) -> str:
    claims_block = "\n".join(f"- {c}" for c in fig.related_claims) if fig.related_claims else "(No citing sentences detected)"
    ocr_hint = ", ".join(local_feats["ocr_texts"][:25]) if local_feats["ocr_texts"] else "(None)"
    return (
        "You are a scientific figure verification assistant. Analyze ONLY what is clearly legible in this extracted figure/graph/table image. "
        "Do NOT fabricate numbers, axes, or statistical metrics that are illegible or missing.\n"
        f"Figure Label: {fig.figure_label} (Page {fig.page_number})\n"
        f"Caption: {fig.caption or '(No caption extracted)'}\n"
        f"OCR Extracted Tokens: {ocr_hint}\n"
        f"Manuscript Claims Citing This Figure:\n{claims_block}\n\n"
        "Return strict JSON with keys:\n"
        "{\n"
        '  "axes_and_units": string or null,\n'
        '  "numerical_values": array of short strings of clearly readable values,\n'
        '  "legends": string or null,\n'
        '  "trends": string or null,\n'
        '  "statistical_results": string or null,\n'
        '  "experimental_conditions": string or null,\n'
        '  "findings_summary": string,\n'
        '  "numerical_mismatches": array of strings,\n'
        '  "context_mismatches": array of strings,\n'
        '  "uncertain": boolean,\n'
        '  "confidence_note": string\n'
        "}"
    )


def _parse_vision_json(raw_content: str, provider: str, local_feats: Dict[str, Any]) -> FigureAnalysisResult:
    cleaned = raw_content.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1)
    data: Dict[str, Any] = json.loads(cleaned)

    num_mismatches = [str(x) for x in (data.get("numerical_mismatches") or []) if str(x).strip()]
    ctx_mismatches = [str(x) for x in (data.get("context_mismatches") or []) if str(x).strip()]
    uncertain = bool(data.get("uncertain", False))

    if num_mismatches:
        status = "numerical_mismatch"
    elif ctx_mismatches:
        status = "context_mismatch"
    elif uncertain:
        status = "human_review"
    else:
        status = "verified"

    return FigureAnalysisResult(
        analysis_status=status,
        vision_provider=provider,
        axes_and_units=data.get("axes_and_units") or local_feats["axes_and_units"],
        numerical_values=[str(v) for v in (data.get("numerical_values") or local_feats["numerical_values"])[:24]],
        legends=data.get("legends") or local_feats["legends"],
        trends=data.get("trends"),
        statistical_results=data.get("statistical_results") or local_feats["statistical_results"],
        experimental_conditions=data.get("experimental_conditions") or local_feats["experimental_conditions"],
        findings_summary=data.get("findings_summary"),
        mismatch_flags=num_mismatches + ctx_mismatches,
        confidence_note=data.get("confidence_note"),
        ocr_text_extracted=" | ".join(local_feats["ocr_texts"][:30]) or None,
        detected_evidence_type=local_feats.get("detected_evidence_type"),
    )


async def _analyze_via_openai_compatible(
    client: httpx.AsyncClient, fig: ExtractedFigure, local_feats: Dict[str, Any]
) -> FigureAnalysisResult:
    settings = get_settings()
    base = (settings.vision_api_base_url or "").rstrip("/")
    b64 = base64.b64encode(fig.image_bytes).decode("ascii")
    headers = {"Content-Type": "application/json"}
    if settings.vision_api_key:
        headers["Authorization"] = f"Bearer {settings.vision_api_key}"

    payload = {
        "model": settings.vision_model,
        "temperature": 0.1,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _build_vision_prompt(fig, local_feats)},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }
        ],
    }
    resp = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return _parse_vision_json(content, "openai_compatible", local_feats)


async def _analyze_via_optional_gemini(
    client: httpx.AsyncClient, fig: ExtractedFigure, local_feats: Dict[str, Any]
) -> FigureAnalysisResult:
    settings = get_settings()
    b64 = base64.b64encode(fig.image_bytes).decode("ascii")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={settings.gemini_api_key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": _build_vision_prompt(fig, local_feats)},
                    {"inline_data": {"mime_type": "image/png", "data": b64}},
                ]
            }
        ],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
    }
    resp = await client.post(url, json=payload)
    resp.raise_for_status()
    candidates = resp.json().get("candidates") or []
    content = candidates[0]["content"]["parts"][0]["text"]
    return _parse_vision_json(content, "gemini", local_feats)


async def analyze_single_figure(client: Optional[httpx.AsyncClient], fig: ExtractedFigure) -> FigureAnalysisResult:
    settings = get_settings()
    local_feats = await asyncio.to_thread(_extract_local_graph_and_image_features, fig)
    local_result = await asyncio.to_thread(_check_local_claims_and_tables, fig, local_feats)

    if client is not None and settings.vision_configured:
        try:
            if settings.vision_api_base_url and settings.vision_model:
                res = await _analyze_via_openai_compatible(client, fig, local_feats)
            elif settings.gemini_api_key:
                res = await _analyze_via_optional_gemini(client, fig, local_feats)
            else:
                res = None

            if res is not None:
                if local_result.mismatch_flags:
                    res.mismatch_flags = list(dict.fromkeys(res.mismatch_flags + local_result.mismatch_flags))
                    if res.analysis_status == "verified":
                        res.analysis_status = "numerical_mismatch"
                return res
        except Exception as exc:
            local_result.confidence_note = (
                f"{local_result.confidence_note} (External vision model fallback: {exc.__class__.__name__})"
            )
            return local_result

    return local_result


async def analyze_figures_batch(figures: List[ExtractedFigure]) -> List[FigureAnalysisResult]:
    if not figures:
        return []
    settings = get_settings()
    if settings.vision_configured:
        async with httpx.AsyncClient(timeout=settings.vision_timeout_seconds) as client:
            results: List[FigureAnalysisResult] = []
            for fig in figures:
                results.append(await analyze_single_figure(client, fig))
            return results
    return [await analyze_single_figure(None, fig) for fig in figures]
