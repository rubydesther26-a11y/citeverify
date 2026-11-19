import io
import re
from dataclasses import dataclass
from typing import List, Optional, Tuple
from pypdf import PdfReader

DOI_REGEX = re.compile(r"(?:https?://(?:dx\.)?doi\.org/|doi:\s*)?(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)", re.IGNORECASE)
ARXIV_REGEX = re.compile(r"arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)", re.IGNORECASE)
YEAR_REGEX = re.compile(r"\b((?:19|20)\d{2})\b")
SECTION_HEADER_REGEX = re.compile(
    r"^\s*(?:\d+\.?\s+)?(references|bibliography|works cited|literature cited|reference list)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
NUMBERED_START_REGEX = re.compile(r"^\s*(?:\[(\d{1,4})\]|(\d{1,4})\.(?=\s+[A-Z\"“']))")


@dataclass
class ParsedCitation:
    order_index: int
    raw_text: str
    extracted_title: Optional[str]
    extracted_authors: Optional[str]
    extracted_year: Optional[str]
    extracted_doi: Optional[str]
    extracted_arxiv_id: Optional[str]
    extracted_venue: Optional[str]
    in_text_mentions: int


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages: List[str] = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(page_text)
    return "\n".join(pages)


def _clean_whitespace(text: str) -> str:
    # Rejoin hyphenated line breaks and normalize internal spaces
    text = re.sub(r"-\s*\n\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def split_body_and_references(full_text: str) -> Tuple[str, str]:
    matches = list(SECTION_HEADER_REGEX.finditer(full_text))
    if matches:
        last_match = matches[-1]
        body = full_text[: last_match.start()]
        refs = full_text[last_match.end():]
        # Stop if another major section like Appendix follows
        appendix_match = re.search(
            r"^\s*(?:appendix|acknowledgements?|supplementary)\b",
            refs,
            re.IGNORECASE | re.MULTILINE,
        )
        if appendix_match and appendix_match.start() > 120:
            refs = refs[: appendix_match.start()]
        return body, refs.strip()
    return full_text, full_text


def split_reference_entries(references_text: str) -> List[str]:
    lines = [line.rstrip() for line in references_text.splitlines()]
    non_empty = [line for line in lines if line.strip()]
    if not non_empty:
        return []

    numbered_hits = sum(1 for line in non_empty if NUMBERED_START_REGEX.match(line))

    entries: List[str] = []
    if numbered_hits >= 2:
        current: List[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if NUMBERED_START_REGEX.match(stripped):
                if current:
                    entries.append(_clean_whitespace(" ".join(current)))
                current = [stripped]
            else:
                if current:
                    current.append(stripped)
                else:
                    current = [stripped]
        if current:
            entries.append(_clean_whitespace(" ".join(current)))
    else:
        # Paragraph / line-wrapped bibliographic entries
        blocks = re.split(r"\n\s*\n+", references_text.strip())
        if len(blocks) <= 1:
            # Fall back to grouping lines where lines ending in year/period/DOI signal entry ends
            current_lines: List[str] = []
            for line in non_empty:
                current_lines.append(line.strip())
                joined = " ".join(current_lines)
                if (
                    len(joined) > 40
                    and (
                        DOI_REGEX.search(line)
                        or re.search(r"\b(19|20)\d{2}[a-z]?\.\s*$", line.strip())
                        or line.strip().endswith(".")
                        and len(current_lines) >= 2
                    )
                ):
                    entries.append(_clean_whitespace(joined))
                    current_lines = []
            if current_lines:
                entries.append(_clean_whitespace(" ".join(current_lines)))
        else:
            entries = [_clean_whitespace(block) for block in blocks if len(_clean_whitespace(block)) >= 15]

    # Filter tiny non-citation fragments
    cleaned = [entry for entry in entries if len(entry) >= 15]
    return cleaned[:200]


def _clean_doi(raw_doi: str) -> str:
    return raw_doi.rstrip(".,;)]}>\"'")


def _extract_fields(raw_entry: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    doi_match = DOI_REGEX.search(raw_entry)
    doi = _clean_doi(doi_match.group(1)) if doi_match else None

    arxiv_match = ARXIV_REGEX.search(raw_entry)
    arxiv_id = arxiv_match.group(1) if arxiv_match else None

    # Strip leading [1] or 1.
    body = re.sub(r"^\s*(?:\[\d{1,4}\]|\d{1,4}\.)\s*", "", raw_entry).strip()

    # Year detection (prefer parenthesized year or standalone 4-digit year)
    paren_year = re.search(r"\(((?:19|20)\d{2})[a-z]?\)", body)
    if paren_year:
        year = paren_year.group(1)
    else:
        years = YEAR_REGEX.findall(body)
        year = years[0] if years else None

    # Quoted title check: "Title Here" or “Title Here”
    quoted_title = re.search(r"[\"“]([^\"”]{10,280})[\"”]", body)
    authors: Optional[str] = None
    title: Optional[str] = None
    venue: Optional[str] = None

    if quoted_title:
        title = quoted_title.group(1).strip().rstrip(".,")
        authors_part = body[: quoted_title.start()].strip().rstrip(",.")
        if paren_year and paren_year.start() < quoted_title.start():
            authors_part = body[: paren_year.start()].strip().rstrip(",.")
        authors = authors_part or None
        remainder = body[quoted_title.end():].strip().lstrip(",.")
        if remainder:
            venue = re.sub(r"(?:https?://\S+|doi:\S+)", "", remainder, flags=re.IGNORECASE).strip(" .,;")[:160] or None
    elif paren_year:
        # APA / Author-Year style: Authors (2020). Title of the paper. Journal Name...
        authors = body[: paren_year.start()].strip().rstrip(",.") or None
        after_year = body[paren_year.end():].strip().lstrip(".,) ")
        sentences = [s.strip() for s in re.split(r"\.\s+", after_year) if s.strip()]
        if sentences:
            title = sentences[0].rstrip(".")
        if len(sentences) > 1:
            venue = sentences[1][:160]
    else:
        # IEEE / plain period-separated style: Authors, Title, Venue, Year
        parts = [p.strip() for p in re.split(r"\.\s+", body) if p.strip()]
        if len(parts) >= 2:
            authors = parts[0][:220]
            title = parts[1][:280]
            if len(parts) >= 3:
                venue = parts[2][:160]
        else:
            title = body[:240]

    return title, authors, year, doi, arxiv_id, venue


def _count_in_text_mentions(body_text: str, raw_entry: str, authors: Optional[str], year: Optional[str]) -> int:
    if not body_text or body_text == raw_entry:
        return 0
    num_match = NUMBERED_START_REGEX.match(raw_entry)
    if num_match:
        ref_num = num_match.group(1) or num_match.group(2)
        if ref_num:
            bracket_hits = len(re.findall(rf"\[[^\]]*\b{re.escape(ref_num)}\b[^\]]*\]", body_text))
            return bracket_hits
    if authors and year:
        first_surname = re.split(r"[\s,]+", authors.strip())[0]
        if len(first_surname) >= 3:
            hits = len(re.findall(rf"\b{re.escape(first_surname)}\b[^.\n]{{0,40}}\b{re.escape(year)}\b", body_text))
            return hits
    return 0


def parse_citations_from_text(full_text: str, from_pdf: bool = True) -> List[ParsedCitation]:
    if from_pdf:
        body_text, refs_text = split_body_and_references(full_text)
    else:
        body_text, refs_text = "", full_text

    entries = split_reference_entries(refs_text)
    parsed: List[ParsedCitation] = []
    for idx, entry in enumerate(entries, start=1):
        title, authors, year, doi, arxiv_id, venue = _extract_fields(entry)
        mentions = _count_in_text_mentions(body_text, entry, authors, year) if from_pdf else 0
        parsed.append(
            ParsedCitation(
                order_index=idx,
                raw_text=entry,
                extracted_title=title,
                extracted_authors=authors,
                extracted_year=year,
                extracted_doi=doi,
                extracted_arxiv_id=arxiv_id,
                extracted_venue=venue,
                in_text_mentions=mentions,
            )
        )
    return parsed
