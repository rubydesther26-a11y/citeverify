import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  HelpCircle,
  Loader2,
  Network,
  RefreshCw,
  Search,
  TableProperties,
  Image as ImageIcon,
  XCircle,
} from 'lucide-react';
import { getExportUrl, getStoredPdfUrl } from '../lib/api';
import type { CitationRecord, CitationStatus, DocumentDetail } from '../types/citation';
import { CitationNetworkGraph } from './CitationNetworkGraph';
import { VisualEvidencePanel } from './VisualEvidencePanel';

interface VerificationResultsProps {
  document: DocumentDetail | null;
  isLoading: boolean;
  onReverify: (documentId: string) => Promise<void>;
  onAnalyzeFigures: (documentId: string) => Promise<void>;
}

type ExplorerTab = 'evidence' | 'network' | 'figures';

const STATUS_META: Record<
  CitationStatus,
  { label: string; colorClass: string; icon: typeof CheckCircle2 }
> = {
  verified: {
    label: 'Supported',
    colorClass: 'text-emerald-400',
    icon: CheckCircle2,
  },
  mismatch: {
    label: 'Partial',
    colorClass: 'text-amber-400',
    icon: AlertTriangle,
  },
  contradictory: {
    label: 'Contradictory',
    colorClass: 'text-red-400',
    icon: XCircle,
  },
  unverified: {
    label: 'Unverified',
    colorClass: 'text-slate-400',
    icon: HelpCircle,
  },
};

export function VerificationResults({
  document,
  isLoading,
  onReverify,
  onAnalyzeFigures,
}: VerificationResultsProps) {
  const [activeTab, setActiveTab] = useState<ExplorerTab>('evidence');
  const [statusFilter, setStatusFilter] = useState<'all' | CitationStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [copiedBibtexId, setCopiedBibtexId] = useState<string | null>(null);
  const [isReverifying, setIsReverifying] = useState(false);

  const filteredCitations = useMemo(() => {
    if (!document) return [];
    const q = searchQuery.trim().toLowerCase();
    return document.citations.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.raw_text.toLowerCase().includes(q) ||
        (c.extracted_title || '').toLowerCase().includes(q) ||
        (c.matched_title || '').toLowerCase().includes(q) ||
        (c.extracted_doi || '').toLowerCase().includes(q) ||
        (c.matched_doi || '').toLowerCase().includes(q)
      );
    });
  }, [document, statusFilter, searchQuery]);

  const activeCitation: CitationRecord | null = useMemo(() => {
    if (!filteredCitations.length) return null;
    const found = filteredCitations.find((c) => c.id === selectedCitationId);
    return found || filteredCitations[0];
  }, [filteredCitations, selectedCitationId]);

  const handleCopyBibtex = async (citation: CitationRecord) => {
    if (!citation.bibtex) return;
    await navigator.clipboard.writeText(citation.bibtex);
    setCopiedBibtexId(citation.id);
    setTimeout(() => setCopiedBibtexId(null), 1800);
  };

  const handleReverifyClick = async () => {
    if (!document) return;
    setIsReverifying(true);
    try {
      await onReverify(document.id);
    } finally {
      setIsReverifying(false);
    }
  };

  if (isLoading && !document) {
    return (
      <section className="bg-[#0E1219] border border-white/10 rounded-xl p-6 space-y-4">
        <div className="h-6 w-56 bg-white/[0.06] rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-20 bg-white/[0.04] rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="space-y-2 pt-2">
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-11 bg-white/[0.04] rounded animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (!document) {
    return (
      <section className="bg-[#0E1219] border border-white/10 rounded-xl p-10 text-center">
        <h2 className="font-display text-base font-semibold text-slate-100">
          No Active Verification Report
        </h2>
        <p className="mt-1.5 text-sm text-slate-400 max-w-lg mx-auto">
          Upload a research PDF or paste reference entries above to inspect verified citations, the interactive citation network, and scientific visual evidence.
        </p>
      </section>
    );
  }

  const isPending = document.status === 'queued' || document.status === 'processing';

  return (
    <section className="bg-[#0E1219] border border-white/10 rounded-xl overflow-hidden">
      {/* Header Row */}
      <div className="px-6 py-5 border-b border-white/10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-slate-100 truncate">
            {document.filename}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
            <span className="text-[#D4AF37]">
              {document.source_type === 'pdf' ? 'PDF Manuscript' : 'Text References'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{(document.file_size / 1024).toFixed(1)} KB</span>
            <span aria-hidden="true">·</span>
            <span>Status: {document.status}</span>
            {document.file_sha256 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">SHA256 {document.file_sha256.slice(0, 10)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {document.has_stored_file && document.source_type === 'pdf' && (
            <a
              href={getStoredPdfUrl(document.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#141A24] border border-white/15 rounded-lg hover:border-white/30 transition-colors whitespace-nowrap shrink-0"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>Stored PDF</span>
            </a>
          )}
          <a
            href={getExportUrl(document.id, 'csv')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#141A24] border border-white/15 rounded-lg hover:border-white/30 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </a>
          <a
            href={getExportUrl(document.id, 'json')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#141A24] border border-white/15 rounded-lg hover:border-white/30 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export JSON</span>
          </a>
          <button
            type="button"
            disabled={isPending || isReverifying}
            onClick={handleReverifyClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending || isReverifying ? 'animate-spin' : ''}`} />
            <span>Re-verify</span>
          </button>
        </div>
      </div>

      {/* Processing / Error Banner */}
      {isPending && (
        <div className="px-6 py-4 bg-emerald-500/10 border-b border-emerald-500/25 flex items-center gap-3 text-sm text-emerald-200">
          <Loader2 className="h-4 w-4 animate-spin shrink-0 text-emerald-400" />
          <span>
            Extracting citations, building citation relationships, and capturing visual figures/tables via PyMuPDF...
          </span>
        </div>
      )}

      {document.status === 'failed' && (
        <div role="alert" className="px-6 py-4 bg-red-500/10 border-b border-red-500/30 text-sm text-red-200">
          {document.error_message || 'Verification failed for this document.'}
        </div>
      )}

      {/* 4-Column Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-white/10 border-b border-white/10 bg-[#0B0E14]">
        <div className="px-6 py-4">
          <div className="text-xs font-medium text-slate-400">Total Citations</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {document.total_citations}
          </div>
        </div>
        <div className="px-6 py-4">
          <div className="text-xs font-medium text-slate-400">Supported</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
            {document.verified_count}
          </div>
        </div>
        <div className="px-6 py-4">
          <div className="text-xs font-medium text-slate-400">Partial / Contradictory</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-400 tabular-nums">
            {document.mismatch_count + document.contradictory_count}
          </div>
        </div>
        <div className="px-6 py-4">
          <div className="text-xs font-medium text-slate-400">Extracted Figures &amp; Tables</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#E5C158] tabular-nums">
            {document.figure_count}
          </div>
        </div>
      </div>

      {/* Separate Feature Mode Switcher inside Evidence Explorer */}
      <div className="px-6 py-3 bg-[#0B0E14] border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1.5 p-1 bg-[#141A24] border border-white/10 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('evidence')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'evidence'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-100 border border-transparent'
            }`}
          >
            <TableProperties className="h-3.5 w-3.5" />
            <span>Evidence Explorer ({document.citations.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('network')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'network'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-100 border border-transparent'
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            <span>Citation Network</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('figures')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'figures'
                ? 'bg-[#D4AF37]/20 text-[#F3E5AB] border border-[#D4AF37]/40'
                : 'text-slate-400 hover:text-slate-100 border border-transparent'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Visual Evidence &amp; Figures ({document.figures.length})</span>
          </button>
        </div>
      </div>

      {/* Feature 1: Existing Citation Evidence Explorer */}
      {activeTab === 'evidence' && (
        <>
          <div className="px-6 py-3.5 bg-[#0D1118] border-b border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#141A24] border border-white/10 rounded-lg self-start">
              {(
                [
                  { id: 'all', label: `All (${document.citations.length})` },
                  { id: 'verified', label: `Supported (${document.verified_count})` },
                  { id: 'mismatch', label: `Partial (${document.mismatch_count})` },
                  { id: 'contradictory', label: `Contradictory (${document.contradictory_count})` },
                  { id: 'unverified', label: `Unverified (${document.unverified_count})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    statusFilter === tab.id
                      ? 'bg-white/10 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-72">
              <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by title, author, or DOI..."
                aria-label="Filter citations"
                className="w-full pl-9 pr-3 py-1.5 text-sm text-slate-100 bg-[#090C12] border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {document.citations.length === 0 && !isPending ? (
            <div className="p-10 text-center text-sm text-slate-400">
              No bibliographic reference entries were detected in this document. Ensure the manuscript includes a References or Bibliography section with selectable text.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10">
              <div className="xl:col-span-7 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-xs font-medium text-slate-400 bg-[#0B0E14]">
                      <th className="py-2.5 pl-6 pr-3 w-12 font-mono">#</th>
                      <th className="py-2.5 px-3">Citation</th>
                      <th className="py-2.5 px-3 w-28">Registry</th>
                      <th className="py-2.5 px-3 w-32">Status</th>
                      <th className="py-2.5 pl-3 pr-6 w-20 text-right">Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm">
                    {filteredCitations.map((c) => {
                      const meta = STATUS_META[c.status] || STATUS_META.unverified;
                      const StatusIcon = meta.icon;
                      const isSelected = activeCitation?.id === c.id;
                      return (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCitationId(c.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <td className="py-3 pl-6 pr-3 align-top font-mono text-xs text-slate-400 tabular-nums">
                            {c.order_index}
                          </td>
                          <td className="py-3 px-3 align-top min-w-[220px]">
                            <div className="font-medium text-slate-100 line-clamp-2">
                              {c.extracted_title || c.raw_text.slice(0, 120)}
                            </div>
                            <div className="mt-1 text-xs text-slate-400 truncate max-w-md">
                              {[c.extracted_authors, c.extracted_year, c.extracted_doi]
                                .filter(Boolean)
                                .join(' · ') || 'Raw reference string'}
                            </div>
                          </td>
                          <td className="py-3 px-3 align-top text-xs text-slate-400 whitespace-nowrap">
                            {c.verification_source}
                          </td>
                          <td className="py-3 px-3 align-top whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.colorClass}`}>
                              <StatusIcon className="h-3.5 w-3.5 shrink-0" />
                              <span>{meta.label}</span>
                            </span>
                          </td>
                          <td className="py-3 pl-3 pr-6 align-top text-right font-mono text-xs text-[#E5C158] tabular-nums">
                            {c.confidence_score.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Detail Inspector */}
              <div className="xl:col-span-5 p-6 bg-[#0B0E14]">
                {activeCitation ? (
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-mono text-slate-400 tabular-nums">
                          Reference #{activeCitation.order_index} · {activeCitation.verification_source}
                          {activeCitation.in_text_mentions > 0
                            ? ` · ${activeCitation.in_text_mentions} in-text citation${activeCitation.in_text_mentions === 1 ? '' : 's'}`
                            : ''}
                        </div>
                        <h3 className="mt-1 font-display text-base font-semibold text-slate-100">
                          {activeCitation.matched_title || activeCitation.extracted_title || 'Unmatched Reference'}
                        </h3>
                      </div>

                      {activeCitation.matched_url && (
                        <a
                          href={activeCitation.matched_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0"
                        >
                          <span>Open Record</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    {activeCitation.discrepancies.length > 0 && (
                      <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1.5">
                        <div className="text-xs font-semibold text-amber-300">
                          Verification Notes
                        </div>
                        <ul className="space-y-1 text-xs text-amber-200/90 list-disc pl-4">
                          {activeCitation.discrepancies.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="space-y-3 text-xs">
                      <div>
                        <div className="font-medium text-slate-400 mb-1">Extracted from Manuscript</div>
                        <p className="p-3 bg-[#090C12] border border-white/10 rounded-lg text-slate-200 leading-relaxed">
                          {activeCitation.raw_text}
                        </p>
                      </div>

                      <div className="bg-[#090C12] border border-white/10 rounded-lg divide-y divide-white/10">
                        <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                          <span className="text-slate-400">Authors</span>
                          <span className="col-span-2 text-slate-200">
                            {activeCitation.matched_authors || activeCitation.extracted_authors || '—'}
                          </span>
                        </div>
                        <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                          <span className="text-slate-400">Year</span>
                          <span className="col-span-2 font-mono tabular-nums text-slate-200">
                            {activeCitation.matched_year || activeCitation.extracted_year || '—'}
                            {activeCitation.extracted_year &&
                            activeCitation.matched_year &&
                            activeCitation.extracted_year !== activeCitation.matched_year
                              ? ` (manuscript cited ${activeCitation.extracted_year})`
                              : ''}
                          </span>
                        </div>
                        <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                          <span className="text-slate-400">Venue</span>
                          <span className="col-span-2 text-slate-200">
                            {activeCitation.matched_venue || activeCitation.extracted_venue || '—'}
                          </span>
                        </div>
                        <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                          <span className="text-slate-400">DOI</span>
                          <span className="col-span-2 font-mono text-slate-200 break-all">
                            {activeCitation.matched_doi || activeCitation.extracted_doi || '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {activeCitation.bibtex && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-slate-400">Registry BibTeX</span>
                          <button
                            type="button"
                            onClick={() => handleCopyBibtex(activeCitation)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white"
                          >
                            {copiedBibtexId === activeCitation.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>Copy BibTeX</span>
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="p-3 bg-[#06080C] border border-white/10 text-emerald-200/90 rounded-lg font-mono text-[11px] leading-relaxed overflow-x-auto">
                          {activeCitation.bibtex}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Select a citation row to inspect registry details.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Feature 2: Interactive Citation Network */}
      {activeTab === 'network' && <CitationNetworkGraph document={document} />}

      {/* Feature 3: Scientific Image & Graph Verification */}
      {activeTab === 'figures' && (
        <VisualEvidencePanel document={document} onAnalyzeFigures={onAnalyzeFigures} />
      )}
    </section>
  );
}
