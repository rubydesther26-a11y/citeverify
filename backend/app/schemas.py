from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class CitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_index: int
    raw_text: str
    extracted_title: Optional[str] = None
    extracted_authors: Optional[str] = None
    extracted_year: Optional[str] = None
    extracted_doi: Optional[str] = None
    extracted_venue: Optional[str] = None
    in_text_mentions: int
    status: str
    confidence_score: float
    verification_source: str
    matched_title: Optional[str] = None
    matched_authors: Optional[str] = None
    matched_year: Optional[str] = None
    matched_doi: Optional[str] = None
    matched_venue: Optional[str] = None
    matched_url: Optional[str] = None
    discrepancies: List[str] = Field(default_factory=list)
    bibtex: Optional[str] = None


class FigureEvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_index: int
    figure_label: str
    evidence_type: str
    page_number: int
    caption: Optional[str] = None
    related_claims: List[str] = Field(default_factory=list)
    has_image: bool = False
    image_width: int
    image_height: int
    extracted_plot_text: Optional[str] = None
    analysis_status: str
    vision_provider: str
    axes_and_units: Optional[str] = None
    numerical_values: List[str] = Field(default_factory=list)
    legends: Optional[str] = None
    trends: Optional[str] = None
    statistical_results: Optional[str] = None
    experimental_conditions: Optional[str] = None
    findings_summary: Optional[str] = None
    mismatch_flags: List[str] = Field(default_factory=list)
    confidence_note: Optional[str] = None


class DocumentSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    content_type: str
    file_size: int
    file_sha256: Optional[str] = None
    has_stored_file: bool = False
    source_type: str
    status: str
    error_message: Optional[str] = None
    total_citations: int
    verified_count: int
    mismatch_count: int
    contradictory_count: int = 0
    unverified_count: int
    figure_count: int = 0
    figure_mismatch_count: int = 0
    created_at: datetime
    completed_at: Optional[datetime] = None


class DocumentDetailOut(DocumentSummaryOut):
    extracted_text_preview: Optional[str] = None
    citations: List[CitationOut] = Field(default_factory=list)
    figures: List[FigureEvidenceOut] = Field(default_factory=list)


class VerifyTextRequest(BaseModel):
    title: str = Field(default="Pasted References", min_length=1, max_length=200)
    references_text: str = Field(..., min_length=8, max_length=150000)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    database: str
    storage_mode: str
    ai_key_required: bool
    vision_model_configured: bool
    verification_sources: List[str]
