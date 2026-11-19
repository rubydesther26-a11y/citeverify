import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  FileImage,
  Loader2,
  RefreshCw,
  Table2,
  UserCheck,
  X,
} from 'lucide-react';
import { getFigureImageUrl } from '../lib/api';
import type { DocumentDetail, FigureAnalysisStatus, FigureEvidence } from '../types/citation';

interface VisualEvidencePanelProps {
  document: DocumentDetail;
  onAnalyzeFigures: (documentId: string) => Promise<void>;
}

const ANALYSIS_META: Record<
  FigureAnalysisStatus,
  { label: string; colorClass: string; icon: typeof CheckCircle2 }
> = {
  verified: {
    label: 'Verified',
    colorClass: 'text-emerald-400',
    icon: CheckCircle2,
  },
  numerical_mismatch: {
    label: 'Numerical Mismatch',
    colorClass: 'text-red-400',
    icon: AlertTriangle,
  },
  context_mismatch: {
    label: 'Context Mismatch',
    colorClass: 'text-amber-400',
    icon: AlertTriangle,
  },
  human_review: {
    label: 'Human Review',
    colorClass: 'text-[#E5C158]',
    icon: UserCheck,
  },
};

export function VisualEvidencePanel({ document, onAnalyzeFigures }: VisualEvidencePanelProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'figure_graph' | 'table' | 'mismatch' | 'human_review'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(document.figures[0]?.id ?? null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyzeClick = async () => {
    setIsAnalyzing(true);
    try {
      await onAnalyzeFigures(document.id);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const filteredFigures = useMemo(() => {
    return document.figures.filter((f) => {
      if (filterMode === 'figure_graph') return f.evidence_type === 'figure' || f.evidence_type === 'graph';
      if (filterMode === 'table') return f.evidence_type === 'table';
      if (filterMode === 'mismatch') {
        return f.analysis_status === 'numerical_mismatch' || f.analysis_status === 'context_mismatch';
      }
      if (filterMode === 'human_review') return f.analysis_status === 'human_review';
      return true;
    });
  }, [document.figures, filterMode]);

  const activeFigure: FigureEvidence | null = useMemo(() => {
    if (!filteredFigures.length) return null;
    return filteredFigures.find((f) => f.id === selectedId) || filteredFigures[0];
  }, [filteredFigures, selectedId]);

  const counts = useMemo(() => {
    let verified = 0;
    let mismatches = 0;
    let humanReview = 0;
    for (const f of document.figures) {
      if (f.analysis_status === 'verified') verified += 1;
      else if (f.analysis_status === 'numerical_mismatch' || f.analysis_status === 'context_mismatch') {
        mismatches += 1;
      } else {
        humanReview += 1;
      }
    }
    return { verified, mismatches, humanReview };
  }, [document.figures]);

  if (document.source_type !== 'pdf') {
    return (
      <div className="p-10 text-center text-sm text-slate-400">
        Visual evidence comparison requires an uploaded research PDF manuscript. Upload a PDF above to extract and compare its embedded figures, graphs, tables, captions, and citing claims.
      </div>
    );
  }

  if (document.figures.length === 0) {
    return (
      <div className="p-10 text-center space-y-4">
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          No extracted figures, graphs, or tables are stored for this PDF yet. Run PyMuPDF + RapidOCR figure and graph comparison on the persisted PDF now.
        </p>
        <button
          type="button"
          disabled={isAnalyzing}
          onClick={handleAnalyzeClick}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-[#D4AF37] rounded-lg hover:bg-[#E5C158] disabled:opacity-60 transition-colors whitespace-nowrap"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Extracting &amp; Analyzing Figures...</span>
            </>
          ) : (
            <>
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Run Figure &amp; Graph Analysis</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Filter & Summary Bar */}
      <div className="px-6 py-4 bg-[#0D1118] border-b border-white/10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#141A24] border border-white/10 rounded-lg self-start">
          {(
            [
              { id: 'all', label: `All (${document.figures.length})` },
              { id: 'figure_graph', label: 'Figures & Graphs' },
              { id: 'table', label: 'Tables' },
              { id: 'mismatch', label: `Mismatches (${counts.mismatches})` },
              { id: 'human_review', label: `Human Review (${counts.humanReview})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                filterMode === tab.id
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 tabular-nums">
          <span>
            Verified: <strong className="font-mono text-emerald-400">{counts.verified}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Flagged Mismatches: <strong className="font-mono text-red-400">{counts.mismatches}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Human Review: <strong className="font-mono text-[#E5C158]">{counts.humanReview}</strong>
          </span>
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleAnalyzeClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F3E5AB] bg-[#D4AF37]/15 border border-[#D4AF37]/30 hover:bg-[#D4AF37]/25 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3 w-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
            <span>{isAnalyzing ? 'Analyzing...' : 'Re-analyze Figures'}</span>
          </button>
        </div>
      </div>

      {/* Split List + Visual Evidence Explorer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10">
        {/* Left Extracted Evidence Queue */}
        <div className="xl:col-span-5 divide-y divide-white/10 max-h-[680px] overflow-y-auto bg-[#0A0D13]">
          {filteredFigures.map((fig) => {
            const meta = ANALYSIS_META[fig.analysis_status] || ANALYSIS_META.human_review;
            const StatusIcon = meta.icon;
            const TypeIcon = fig.evidence_type === 'table' ? Table2 : fig.evidence_type === 'graph' ? BarChart3 : FileImage;
            const selected = activeFigure?.id === fig.id;

            return (
              <button
                key={fig.id}
                type="button"
                onClick={() => setSelectedId(fig.id)}
                className={`w-full text-left p-4 flex items-start gap-3.5 transition-colors ${
                  selected ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="w-20 h-16 rounded-lg overflow-hidden bg-[#141A24] border border-white/10 shrink-0 flex items-center justify-center">
                  {fig.has_image ? (
                    <img
                      src={getFigureImageUrl(document.id, fig.id)}
                      alt={`${fig.figure_label} from page ${fig.page_number}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain bg-white"
                    />
                  ) : (
                    <TypeIcon className="h-5 w-5 text-slate-500" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-semibold text-slate-100 truncate">
                      {fig.figure_label}
                    </span>
                    <span className="font-mono text-xs text-slate-400 tabular-nums shrink-0">
                      p.{fig.page_number}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {fig.caption || 'No caption text detected near this figure.'}
                  </p>

                  <div className="flex items-center gap-2 pt-0.5 text-xs">
                    <span className={`inline-flex items-center gap-1 font-medium ${meta.colorClass}`}>
                      <StatusIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>{meta.label}</span>
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-400 capitalize">{fig.evidence_type}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Scientific Evidence Inspector */}
        <div className="xl:col-span-7 p-6 bg-[#0E1219] space-y-5">
          {activeFigure ? (
            (() => {
              const meta = ANALYSIS_META[activeFigure.analysis_status] || ANALYSIS_META.human_review;
              const StatusIcon = meta.icon;
              const imageUrl = getFigureImageUrl(document.id, activeFigure.id);

              return (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
                        <span className="text-[#D4AF37]">{activeFigure.figure_label}</span>
                        <span aria-hidden="true">·</span>
                        <span>Page {activeFigure.page_number}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{activeFigure.evidence_type}</span>
                        {activeFigure.image_width > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {activeFigure.image_width}×{activeFigure.image_height}px
                            </span>
                          </>
                        )}
                      </div>
                      <div className={`mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold ${meta.colorClass}`}>
                        <StatusIcon className="h-4 w-4 shrink-0" />
                        <span>{meta.label}</span>
                      </div>
                    </div>

                    {activeFigure.has_image && (
                      <button
                        type="button"
                        onClick={() => setLightboxOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#141A24] border border-white/15 rounded-lg hover:border-emerald-500/50 transition-colors whitespace-nowrap shrink-0 self-start"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Inspect Full Image</span>
                      </button>
                    )}
                  </div>

                  {/* Preserved Original Figure Image */}
                  {activeFigure.has_image && (
                    <div className="rounded-xl border border-white/10 bg-[#080A0F] p-3 flex items-center justify-center">
                      <img
                        src={imageUrl}
                        alt={`${activeFigure.figure_label} extracted from page ${activeFigure.page_number}`}
                        referrerPolicy="no-referrer"
                        className="max-h-72 w-auto object-contain rounded bg-white"
                      />
                    </div>
                  )}

                  {/* Caption */}
                  <div className="space-y-1.5 text-xs">
                    <div className="font-medium text-slate-400">Extracted PDF Caption</div>
                    <p className="p-3.5 rounded-lg bg-[#0A0D13] border border-white/10 text-slate-200 leading-relaxed">
                      {activeFigure.caption || 'No explicit caption block was matched for this embedded figure.'}
                    </p>
                  </div>

                  {/* Mismatch Flags */}
                  {activeFigure.mismatch_flags.length > 0 && (
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 space-y-1.5">
                      <div className="text-xs font-semibold text-red-300">
                        Visual vs. Manuscript Claim Discrepancies
                      </div>
                      <ul className="space-y-1 text-xs text-red-200 list-disc pl-4">
                        {activeFigure.mismatch_flags.map((flag, i) => (
                          <li key={i}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Human Review / Confidence Note */}
                  {activeFigure.confidence_note && (
                    <div
                      className={`p-4 rounded-lg border text-xs leading-relaxed ${
                        activeFigure.analysis_status === 'human_review'
                          ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#F3E5AB]'
                          : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                      }`}
                    >
                      <div className="font-semibold mb-1">
                        {activeFigure.analysis_status === 'human_review'
                          ? 'Marked for Human Review'
                          : 'Verification Summary'}
                      </div>
                      <p>{activeFigure.confidence_note}</p>
                    </div>
                  )}

                  {/* Structured Visual Evidence Matrix */}
                  <div className="rounded-lg border border-white/10 bg-[#0A0D13] divide-y divide-white/10 text-xs">
                    <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                      <span className="text-slate-400">Axes &amp; Units</span>
                      <span className="col-span-2 text-slate-200">
                        {activeFigure.axes_and_units || 'Requires vision review or manual inspection'}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                      <span className="text-slate-400">Numerical Values</span>
                      <span className="col-span-2 font-mono text-slate-200 break-words">
                        {activeFigure.numerical_values.length > 0
                          ? activeFigure.numerical_values.join(', ')
                          : 'None extracted deterministically'}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                      <span className="text-slate-400">Legends</span>
                      <span className="col-span-2 text-slate-200">
                        {activeFigure.legends || '—'}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                      <span className="text-slate-400">Trends</span>
                      <span className="col-span-2 text-slate-200">
                        {activeFigure.trends || '—'}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                      <span className="text-slate-400">Statistical Results</span>
                      <span className="col-span-2 text-slate-200">
                        {activeFigure.statistical_results || '—'}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                      <span className="text-slate-400">Experimental Conditions</span>
                      <span className="col-span-2 text-slate-200">
                        {activeFigure.experimental_conditions || '—'}
                      </span>
                    </div>
                    {activeFigure.findings_summary && (
                      <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                        <span className="text-slate-400">Analysis Summary</span>
                        <span className="col-span-2 text-slate-200">
                          {activeFigure.findings_summary}
                        </span>
                      </div>
                    )}
                    {activeFigure.extracted_plot_text && (
                      <div className="px-4 py-2.5 grid grid-cols-3 gap-3">
                        <span className="text-slate-400">OCR / Plot Labels</span>
                        <span className="col-span-2 font-mono text-[11px] text-slate-300 break-words leading-relaxed">
                          {activeFigure.extracted_plot_text}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Citing Manuscript Claims */}
                  <div className="space-y-2 text-xs">
                    <div className="font-medium text-slate-400">
                      Manuscript Claims Referencing {activeFigure.figure_label}
                    </div>
                    {activeFigure.related_claims.length > 0 ? (
                      <ul className="space-y-2">
                        {activeFigure.related_claims.map((claim, i) => (
                          <li
                            key={i}
                            className="p-3 rounded-lg bg-[#0A0D13] border border-white/10 text-slate-300 leading-relaxed"
                          >
                            {claim}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-500">
                        No explicit body-text sentence citing {activeFigure.figure_label} was detected.
                      </p>
                    )}
                  </div>
                </>
              );
            })()
          ) : (
            <p className="text-sm text-slate-400">Select an extracted figure or table to inspect evidence.</p>
          )}
        </div>
      </div>

      {/* Full Image Lightbox Modal */}
      {lightboxOpen && activeFigure && activeFigure.has_image && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="max-w-4xl w-full bg-[#0E1219] border border-white/15 rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-slate-100">
                {activeFigure.figure_label} · Page {activeFigure.page_number}
              </div>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                aria-label="Close figure preview"
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 bg-[#080A0F] flex items-center justify-center max-h-[75vh] overflow-auto">
              <img
                src={getFigureImageUrl(document.id, activeFigure.id)}
                alt={activeFigure.figure_label}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[65vh] object-contain bg-white rounded"
              />
            </div>
            {activeFigure.caption && (
              <div className="px-5 py-3 border-t border-white/10 text-xs text-slate-300 leading-relaxed">
                {activeFigure.caption}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
