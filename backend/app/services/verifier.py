import asyncio
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib.parse import quote
import httpx
from rapidfuzz import fuzz
from app.config import get_settings
from app.services.pdf_parser import ParsedCitation


@dataclass
class VerificationResult:
    status: str  # "verified" | "mismatch" | "unverified"
    confidence_score: float
    verification_source: str
    matched_title: Optional[str] = None
    matched_authors: Optional[str] = None
    matched_year: Optional[str] = None
    matched_doi: Optional[str] = None
    matched_venue: Optional[str] = None
    matched_url: Optional[str] = None
    discrepancies: List[str] = field(default_factory=list)
    bibtex: Optional[str] = None


def _normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9\s]", " ", value.lower()).strip()


def _format_crossref_authors(authors_raw: List[Dict[str, Any]]) -> str:
    names: List[str] = []
    for author in authors_raw[:8]:
        family = author.get("family", "")
        given = author.get("given", "")
        if family and given:
            names.append(f"{given} {family}")
        elif family:
            names.append(family)
        elif author.get("name"):
            names.append(str(author["name"]))
    if len(authors_raw) > 8:
        names.append("et al.")
    return ", ".join(names)


def _extract_crossref_year(item: Dict[str, Any]) -> Optional[str]:
    for key in ("published-print", "published-online", "issued", "created"):
        part = item.get(key, {})
        date_parts = part.get("date-parts")
        if date_parts and isinstance(date_parts, list) and date_parts[0]:
            return str(date_parts[0][0])
    return None


def _build_bibtex(
    key_seed: str,
    title: Optional[str],
    authors: Optional[str],
    year: Optional[str],
    venue: Optional[str],
    doi: Optional[str],
    url: Optional[str],
) -> str:
    first_word = re.sub(r"[^a-zA-Z0-9]", "", (authors or "ref").split(",")[0].split()[-1]) or "ref"
    cite_key = f"{first_word.lower()}{year or 'nd'}"
    lines = [f"@article{{{cite_key},"]
    if title:
        lines.append(f"  title = {{{title}}},")
    if authors:
        lines.append(f"  author = {{{authors}}},")
    if year:
        lines.append(f"  year = {{{year}}},")
    if venue:
        lines.append(f"  journal = {{{venue}}},")
    if doi:
        lines.append(f"  doi = {{{doi}}},")
    if url:
        lines.append(f"  url = {{{url}}},")
    lines.append("}")
    return "\n".join(lines)


def _compare_candidate(
    parsed: ParsedCitation,
    source: str,
    cand_title: Optional[str],
    cand_authors: Optional[str],
    cand_year: Optional[str],
    cand_doi: Optional[str],
    cand_venue: Optional[str],
    cand_url: Optional[str],
) -> VerificationResult:
    discrepancies: List[str] = []

    target_title = parsed.extracted_title or parsed.raw_text
    norm_target = _normalize_text(target_title)
    norm_cand = _normalize_text(cand_title)
    if norm_target and norm_cand:
        set_score = fuzz.token_set_ratio(norm_target, norm_cand)
        sort_score = fuzz.token_sort_ratio(norm_target, norm_cand)
        title_score = (set_score * 0.45) + (sort_score * 0.55)
    else:
        title_score = 0.0

    # If the manuscript provided a DOI that differs from the matched DOI
    if parsed.extracted_doi and cand_doi and parsed.extracted_doi.lower() != cand_doi.lower():
        discrepancies.append(f"DOI mismatch: cited '{parsed.extracted_doi}', registry records '{cand_doi}'.")

    # Author comparison (check surname overlap)
    author_score = 100.0
    if parsed.extracted_authors and cand_authors:
        author_score = fuzz.token_set_ratio(_normalize_text(parsed.extracted_authors), _normalize_text(cand_authors))
        if author_score < 48:
            discrepancies.append(
                f"Author discrepancy: cited '{parsed.extracted_authors[:80]}', registry lists '{cand_authors[:80]}'."
            )

    # Year comparison
    if parsed.extracted_year and cand_year and parsed.extracted_year != cand_year:
        try:
            diff = abs(int(parsed.extracted_year) - int(cand_year))
        except ValueError:
            diff = 99
        if diff >= 1:
            discrepancies.append(
                f"Publication year mismatch: cited {parsed.extracted_year}, {source} lists {cand_year}."
            )

    # Title comparison
    if title_score < 62:
        discrepancies.append(
            f"Title divergence (similarity {round(title_score)}%): registry title is '{cand_title or 'Unknown'}'."
        )

    confidence = round((title_score * 0.65) + (author_score * 0.25) + (10.0 if not discrepancies else 0.0), 1)
    confidence = max(0.0, min(100.0, confidence))

    exact_doi_match = bool(parsed.extracted_doi and cand_doi and parsed.extracted_doi.lower() == cand_doi.lower())
    exact_arxiv_match = bool(parsed.extracted_arxiv_id and source == "arXiv" and cand_url and parsed.extracted_arxiv_id.lower() in cand_url.lower())

    if exact_doi_match and title_score < 45:
        discrepancies.insert(
            0,
            f"Contradictory citation: DOI '{parsed.extracted_doi}' resolves to a different publication ('{cand_title or 'Unknown'}').",
        )
        return VerificationResult(
            status="contradictory",
            confidence_score=confidence,
            verification_source=source,
            matched_title=cand_title,
            matched_authors=cand_authors,
            matched_year=cand_year,
            matched_doi=cand_doi,
            matched_venue=cand_venue,
            matched_url=cand_url,
            discrepancies=discrepancies,
            bibtex=_build_bibtex(parsed.raw_text, cand_title, cand_authors, cand_year, cand_venue, cand_doi, cand_url),
        )

    if title_score < 58 and not exact_doi_match and not exact_arxiv_match:
        return VerificationResult(
            status="unverified",
            confidence_score=confidence,
            verification_source="None",
            discrepancies=["No confident bibliographic match found in Crossref, OpenAlex, or arXiv."],
        )

    status = "mismatch" if discrepancies else "verified"
    bibtex = _build_bibtex(parsed.raw_text, cand_title, cand_authors, cand_year, cand_venue, cand_doi, cand_url)

    return VerificationResult(
        status=status,
        confidence_score=confidence,
        verification_source=source,
        matched_title=cand_title,
        matched_authors=cand_authors,
        matched_year=cand_year,
        matched_doi=cand_doi,
        matched_venue=cand_venue,
        matched_url=cand_url,
        discrepancies=discrepancies,
        bibtex=bibtex,
    )


async def _lookup_crossref_doi(client: httpx.AsyncClient, doi: str, parsed: ParsedCitation) -> Optional[VerificationResult]:
    url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
    resp = await client.get(url)
    if resp.status_code != 200:
        return None
    item = resp.json().get("message", {})
    titles = item.get("title") or []
    cand_title = titles[0] if titles else None
    cand_authors = _format_crossref_authors(item.get("author") or [])
    cand_year = _extract_crossref_year(item)
    cand_doi = item.get("DOI")
    containers = item.get("container-title") or []
    cand_venue = containers[0] if containers else item.get("publisher")
    cand_url = item.get("URL") or (f"https://doi.org/{cand_doi}" if cand_doi else None)
    return _compare_candidate(parsed, "Crossref", cand_title, cand_authors, cand_year, cand_doi, cand_venue, cand_url)


async def _lookup_crossref_search(client: httpx.AsyncClient, parsed: ParsedCitation) -> Optional[VerificationResult]:
    query = parsed.extracted_title or parsed.raw_text[:240]
    if parsed.extracted_authors:
        first_author = parsed.extracted_authors.split(",")[0].strip()
        query = f"{query} {first_author}"
    resp = await client.get("https://api.crossref.org/works", params={"query.bibliographic": query[:280], "rows": 3})
    if resp.status_code != 200:
        return None
    items = resp.json().get("message", {}).get("items", [])
    best: Optional[VerificationResult] = None
    for item in items:
        titles = item.get("title") or []
        cand_title = titles[0] if titles else None
        cand_authors = _format_crossref_authors(item.get("author") or [])
        cand_year = _extract_crossref_year(item)
        cand_doi = item.get("DOI")
        containers = item.get("container-title") or []
        cand_venue = containers[0] if containers else item.get("publisher")
        cand_url = item.get("URL") or (f"https://doi.org/{cand_doi}" if cand_doi else None)
        res = _compare_candidate(parsed, "Crossref", cand_title, cand_authors, cand_year, cand_doi, cand_venue, cand_url)
        if best is None or res.confidence_score > best.confidence_score:
            best = res
    return best


async def _lookup_openalex(client: httpx.AsyncClient, parsed: ParsedCitation) -> Optional[VerificationResult]:
    query = parsed.extracted_title or parsed.raw_text[:200]
    resp = await client.get("https://api.openalex.org/works", params={"search": query[:220], "per-page": 3})
    if resp.status_code != 200:
        return None
    results = resp.json().get("results", [])
    best: Optional[VerificationResult] = None
    for item in results:
        cand_title = item.get("title")
        authorships = item.get("authorships") or []
        author_names = [a.get("author", {}).get("display_name", "") for a in authorships[:8] if a.get("author")]
        if len(authorships) > 8:
            author_names.append("et al.")
        cand_authors = ", ".join([n for n in author_names if n])
        cand_year = str(item.get("publication_year")) if item.get("publication_year") else None
        raw_doi = item.get("doi") or ""
        cand_doi = raw_doi.replace("https://doi.org/", "").strip() or None
        primary_loc = item.get("primary_location") or {}
        source_obj = primary_loc.get("source") or {}
        cand_venue = source_obj.get("display_name")
        cand_url = item.get("doi") or item.get("id")
        res = _compare_candidate(parsed, "OpenAlex", cand_title, cand_authors, cand_year, cand_doi, cand_venue, cand_url)
        if best is None or res.confidence_score > best.confidence_score:
            best = res
    return best


async def _lookup_arxiv(client: httpx.AsyncClient, parsed: ParsedCitation) -> Optional[VerificationResult]:
    params: Dict[str, Any] = {"max_results": 2}
    if parsed.extracted_arxiv_id:
        params["id_list"] = parsed.extracted_arxiv_id
    else:
        title_query = re.sub(r"[^a-zA-Z0-9\s]", " ", (parsed.extracted_title or parsed.raw_text[:140])).strip()
        params["search_query"] = f"ti:{title_query}"
    resp = await client.get("https://export.arxiv.org/api/query", params=params)
    if resp.status_code != 200:
        return None
    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError:
        return None
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    best: Optional[VerificationResult] = None
    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        cand_title = re.sub(r"\s+", " ", title_el.text).strip() if title_el is not None and title_el.text else None
        if not cand_title or cand_title.lower() == "error":
            continue
        authors_els = entry.findall("atom:author/atom:name", ns)
        cand_authors = ", ".join([a.text.strip() for a in authors_els[:8] if a.text])
        pub_el = entry.find("atom:published", ns)
        cand_year = pub_el.text[:4] if pub_el is not None and pub_el.text else None
        id_el = entry.find("atom:id", ns)
        cand_url = id_el.text.strip() if id_el is not None and id_el.text else None
        res = _compare_candidate(parsed, "arXiv", cand_title, cand_authors, cand_year, None, "arXiv Preprint", cand_url)
        if best is None or res.confidence_score > best.confidence_score:
            best = res
    return best


async def verify_single_citation(client: httpx.AsyncClient, parsed: ParsedCitation, sem: asyncio.Semaphore) -> VerificationResult:
    async with sem:
        try:
            # 1. Exact DOI check first if DOI present
            if parsed.extracted_doi:
                doi_res = await _lookup_crossref_doi(client, parsed.extracted_doi, parsed)
                if doi_res and doi_res.status != "unverified":
                    return doi_res

            # 2. Exact arXiv ID check if present
            if parsed.extracted_arxiv_id:
                arxiv_res = await _lookup_arxiv(client, parsed)
                if arxiv_res and arxiv_res.status != "unverified":
                    return arxiv_res

            # 3. Crossref bibliographic query
            cr_res = await _lookup_crossref_search(client, parsed)
            if cr_res and cr_res.status == "verified":
                return cr_res

            # 4. OpenAlex fallback
            oa_res = await _lookup_openalex(client, parsed)
            if oa_res and (not cr_res or oa_res.confidence_score > cr_res.confidence_score):
                best = oa_res
            else:
                best = cr_res

            # 5. arXiv title search if still unverified
            if not best or best.status == "unverified":
                ax_res = await _lookup_arxiv(client, parsed)
                if ax_res and (not best or ax_res.confidence_score > best.confidence_score):
                    best = ax_res

            if best:
                return best

            return VerificationResult(
                status="unverified",
                confidence_score=0.0,
                verification_source="None",
                discrepancies=["No matching publication record found in Crossref, OpenAlex, or arXiv."],
            )
        except httpx.RequestError as exc:
            return VerificationResult(
                status="unverified",
                confidence_score=0.0,
                verification_source="None",
                discrepancies=[f"External scholarly lookup unavailable ({exc.__class__.__name__})."],
            )


async def verify_citations_batch(parsed_citations: List[ParsedCitation]) -> List[VerificationResult]:
    settings = get_settings()
    ua = "CiteVerify/1.0 (https://github.com/citeverify)"
    if settings.crossref_mailto:
        ua = f"CiteVerify/1.0 (mailto:{settings.crossref_mailto})"
    headers = {"User-Agent": ua, "Accept": "application/json"}
    sem = asyncio.Semaphore(5)

    async with httpx.AsyncClient(timeout=settings.lookup_timeout_seconds, headers=headers, follow_redirects=True) as client:
        tasks = [verify_single_citation(client, item, sem) for item in parsed_citations]
        return await asyncio.gather(*tasks)
