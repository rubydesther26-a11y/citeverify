export type DocumentStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type CitationStatus = 'verified' | 'mismatch' | 'contradictory' | 'unverified';
export type FigureAnalysisStatus = 'verified' | 'numerical_mismatch' | 'context_mismatch' | 'human_review';

export interface CitationRecord {
  id: string;
  order_index: number;
  raw_text: string;
  extracted_title: string | null;
  extracted_authors: string | null;
  extracted_year: string | null;
  extracted_doi: string | null;
  extracted_venue: string | null;
  in_text_mentions: number;
  status: CitationStatus;
  confidence_score: number;
  verification_source: string;
  matched_title: string | null;
  matched_authors: string | null;
  matched_year: string | null;
  matched_doi: string | null;
  matched_venue: string | null;
  matched_url: string | null;
  discrepancies: string[];
  bibtex: string | null;
}

export interface FigureEvidence {
  id: string;
  order_index: number;
  figure_label: string;
  evidence_type: 'figure' | 'graph' | 'table';
  page_number: number;
  caption: string | null;
  related_claims: string[];
  has_image: boolean;
  image_width: number;
  image_height: number;
  extracted_plot_text: string | null;
  analysis_status: FigureAnalysisStatus;
  vision_provider: string;
  axes_and_units: string | null;
  numerical_values: string[];
  legends: string | null;
  trends: string | null;
  statistical_results: string | null;
  experimental_conditions: string | null;
  findings_summary: string | null;
  mismatch_flags: string[];
  confidence_note: string | null;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  content_type: string;
  file_size: number;
  file_sha256: string | null;
  has_stored_file: boolean;
  source_type: 'pdf' | 'text';
  status: DocumentStatus;
  error_message: string | null;
  total_citations: number;
  verified_count: number;
  mismatch_count: number;
  contradictory_count: number;
  unverified_count: number;
  figure_count: number;
  figure_mismatch_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  extracted_text_preview: string | null;
  citations: CitationRecord[];
  figures: FigureEvidence[];
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  database: string;
  storage_mode: string;
  ai_key_required: boolean;
  vision_model_configured: boolean;
  verification_sources: string[];
}
