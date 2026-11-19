import { type PointerEvent, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { CitationRecord, CitationStatus, DocumentDetail } from '../types/citation';

interface CitationNetworkGraphProps {
  document: DocumentDetail;
}

const NODE_STYLE: Record<
  CitationStatus,
  {
    label: string;
    fill: string;
    stroke: string;
    edge: string;
    textClass: string;
    icon: typeof CheckCircle2;
  }
> = {
  verified: {
    label: 'Supported',
    fill: '#064E3B',
    stroke: '#10B981',
    edge: 'rgba(16, 185, 129, 0.48)',
    textClass: 'text-emerald-400',
    icon: CheckCircle2,
  },
  mismatch: {
    label: 'Partially Supported',
    fill: '#451A03',
    stroke: '#F59E0B',
    edge: 'rgba(245, 158, 11, 0.5)',
    textClass: 'text-amber-400',
    icon: AlertTriangle,
  },
  contradictory: {
    label: 'Contradictory / Unsupported',
    fill: '#450A0A',
    stroke: '#EF4444',
    edge: 'rgba(239, 68, 68, 0.55)',
    textClass: 'text-red-400',
    icon: XCircle,
  },
  unverified: {
    label: 'Unverified',
    fill: '#1E293B',
    stroke: '#64748B',
    edge: 'rgba(100, 116, 139, 0.42)',
    textClass: 'text-slate-400',
    icon: HelpCircle,
  },
};

function shortNodeTitle(c: CitationRecord): string {
  const title = c.matched_title || c.extracted_title || c.raw_text;
  const cleaned = title.replace(/\s+/g, ' ').trim();
  return cleaned.length > 26 ? `${cleaned.slice(0, 24)}…` : cleaned;
}

export function CitationNetworkGraph({ document }: CitationNetworkGraphProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | CitationStatus>('all');
  const [selectedId, setSelectedId] = useState<string | 'center'>(
    document.citations[0]?.id ?? 'center'
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);

  const visibleCitations = useMemo(() => {
    if (statusFilter === 'all') return document.citations;
    return document.citations.filter((c) => c.status === statusFilter);
  }, [document.citations, statusFilter]);

  const layoutNodes = useMemo(() => {
    const count = visibleCitations.length;
    const cx = 400;
    const cy = 280;

    return visibleCitations.map((citation, idx) => {
      // Multi-ring radial placement so large bibliographies stay legible without overlaps
      const innerCapacity = 10;
      const isOuter = count > innerCapacity && idx >= innerCapacity;
      const ringIndex = isOuter ? idx - innerCapacity : idx;
      const ringTotal = isOuter ? count - innerCapacity : Math.min(count, innerCapacity);
      const radius = isOuter ? 225 : count <= 6 ? 165 : 152;
      const angleOffset = isOuter ? Math.PI / Math.max(ringTotal, 1) : -Math.PI / 2;
      const angle = angleOffset + (2 * Math.PI * ringIndex) / Math.max(ringTotal, 1);

      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      return { citation, x, y };
    });
  }, [visibleCitations]);

  const selectedCitation = useMemo(() => {
    if (selectedId === 'center') return null;
    return document.citations.find((c) => c.id === selectedId) || visibleCitations[0] || null;
  }, [document.citations, visibleCitations, selectedId]);

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest('[data-network-node="true"]')) return;
    setDragOrigin({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragOrigin) return;
    setPan({ x: e.clientX - dragOrigin.x, y: e.clientY - dragOrigin.y });
  };

  const handlePointerUp = () => {
    setDragOrigin(null);
  };

  if (document.citations.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-slate-400">
        No citations were extracted for this document, so no citation network edges can be constructed.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10">
      {/* Interactive SVG Network Viewport */}
      <div className="xl:col-span-8 flex flex-col bg-[#090C12]">
        {/* Network Toolbar */}
        <div className="px-5 py-3.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 bg-[#0D1118]">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#141A24] rounded-lg border border-white/10">
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
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  statusFilter === tab.id
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.65, Number((z - 0.15).toFixed(2))))}
              aria-label="Zoom out network"
              className="p-1.5 text-slate-300 bg-[#141A24] border border-white/10 rounded-md hover:border-white/25"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 font-mono text-xs text-slate-400 tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))))}
              aria-label="Zoom in network"
              className="p-1.5 text-slate-300 bg-[#141A24] border border-white/10 rounded-md hover:border-white/25"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              aria-label="Reset network view"
              className="p-1.5 text-slate-300 bg-[#141A24] border border-white/10 rounded-md hover:border-white/25"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* SVG Graph */}
        <div className="relative h-[520px] overflow-hidden select-none">
          <svg
            viewBox="0 0 800 560"
            className={`w-full h-full ${dragOrigin ? 'cursor-grabbing' : 'cursor-grab'}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <defs>
              <radialGradient id="obsidianGridGlow" cx="50%" cy="50%" r="55%">
                <stop offset="0%" stopColor="rgba(212, 175, 55, 0.08)" />
                <stop offset="55%" stopColor="rgba(16, 185, 129, 0.04)" />
                <stop offset="100%" stopColor="rgba(8, 10, 15, 0)" />
              </radialGradient>
            </defs>

            <rect width="800" height="560" fill="url(#obsidianGridGlow)" />

            <g transform={`translate(${400 + pan.x}, ${280 + pan.y}) scale(${zoom}) translate(-400, -280)`}>
              {/* Concentric orbital guide rings */}
              <circle cx="400" cy="280" r="158" fill="none" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 5" />
              {visibleCitations.length > 10 && (
                <circle cx="400" cy="280" r="225" fill="none" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 5" />
              )}

              {/* Edges: Uploaded Paper -> Referenced Publications */}
              {layoutNodes.map(({ citation, x, y }) => {
                const style = NODE_STYLE[citation.status] || NODE_STYLE.unverified;
                const active = selectedCitation?.id === citation.id || hoveredId === citation.id;
                const strokeWidth = active ? 2.5 : Math.min(2.2, 1.1 + citation.in_text_mentions * 0.25);

                // Subtle quadratic curve from center (400,280) to target (x,y)
                const mx = (400 + x) / 2 + (y - 280) * 0.08;
                const my = (280 + y) / 2 - (x - 400) * 0.08;

                return (
                  <path
                    key={`edge-${citation.id}`}
                    d={`M 400 280 Q ${mx} ${my} ${x} ${y}`}
                    fill="none"
                    stroke={active ? style.stroke : style.edge}
                    strokeWidth={strokeWidth}
                    strokeDasharray={citation.status === 'unverified' ? '4 4' : undefined}
                    className="transition-colors duration-150"
                  />
                );
              })}

              {/* Central Node: Uploaded Research Paper */}
              <g
                data-network-node="true"
                onClick={() => setSelectedId('center')}
                className="cursor-pointer"
              >
                <circle
                  cx="400"
                  cy="280"
                  r="42"
                  fill="#0E131D"
                  stroke="#D4AF37"
                  strokeWidth={selectedId === 'center' ? 3 : 2}
                />
                <circle
                  cx="400"
                  cy="280"
                  r="36"
                  fill="none"
                  stroke="rgba(212, 175, 55, 0.3)"
                  strokeWidth="1"
                />
                <text
                  x="400"
                  y="276"
                  textAnchor="middle"
                  fill="#F3E5AB"
                  fontSize="10"
                  fontWeight="600"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                >
                  Source Paper
                </text>
                <text
                  x="400"
                  y="291"
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {document.total_citations} refs
                </text>
              </g>

              {/* Connected Publication Nodes */}
              {layoutNodes.map(({ citation, x, y }) => {
                const style = NODE_STYLE[citation.status] || NODE_STYLE.unverified;
                const isSelected = selectedCitation?.id === citation.id;
                const isHovered = hoveredId === citation.id;
                const r = isSelected ? 22 : isHovered ? 20 : 18;

                return (
                  <g
                    key={citation.id}
                    data-network-node="true"
                    transform={`translate(${x}, ${y})`}
                    onClick={() => setSelectedId(citation.id)}
                    onMouseEnter={() => setHoveredId(citation.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className="cursor-pointer"
                  >
                    {isSelected && (
                      <circle
                        r={r + 6}
                        fill="none"
                        stroke="#D4AF37"
                        strokeWidth="1.5"
                        strokeOpacity="0.85"
                      />
                    )}
                    <circle
                      r={r}
                      fill={style.fill}
                      stroke={style.stroke}
                      strokeWidth={isSelected ? 2.5 : 1.75}
                    />
                    <text
                      y="3.5"
                      textAnchor="middle"
                      fill="#F8FAFC"
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      [{citation.order_index}]
                    </text>
                    <text
                      y={r + 13}
                      textAnchor="middle"
                      fill={isSelected ? '#F3E5AB' : '#CBD5E1'}
                      fontSize="9.5"
                      fontFamily="DM Sans, sans-serif"
                    >
                      {shortNodeTitle(citation)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Accessible Color + Text Legend */}
          <div className="px-4 py-2.5 bg-[#0D1118]/95 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full border border-[#D4AF37] bg-[#0E131D]" />
                <span>Uploaded Paper</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span>Supported</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span>Partially Supported</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span>Contradictory / Unsupported</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
                <span>Unverified</span>
              </span>
            </div>
            <span className="text-slate-500 hidden sm:inline">
              Drag canvas to pan · Click any node to inspect
            </span>
          </div>
        </div>
      </div>

      {/* Right Node Evidence Inspector */}
      <div className="xl:col-span-4 p-6 bg-[#0E1219] flex flex-col justify-between">
        {selectedId === 'center' || !selectedCitation ? (
          <div className="space-y-4">
            <div className="text-xs font-mono text-[#D4AF37]">Central Node · Uploaded Manuscript</div>
            <h3 className="font-display text-base font-semibold text-slate-100 break-words">
              {document.filename}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This central node represents the uploaded manuscript and its extracted outbound citation relationships verified against Crossref, OpenAlex, and arXiv.
            </p>
            <div className="rounded-lg border border-white/10 bg-[#0A0D13] divide-y divide-white/10 text-xs">
              <div className="px-3.5 py-2.5 flex justify-between">
                <span className="text-slate-400">Total Cited References</span>
                <span className="font-mono tabular-nums text-slate-100">{document.total_citations}</span>
              </div>
              <div className="px-3.5 py-2.5 flex justify-between">
                <span className="text-slate-400">Supported</span>
                <span className="font-mono tabular-nums text-emerald-400">{document.verified_count}</span>
              </div>
              <div className="px-3.5 py-2.5 flex justify-between">
                <span className="text-slate-400">Partially Supported</span>
                <span className="font-mono tabular-nums text-amber-400">{document.mismatch_count}</span>
              </div>
              <div className="px-3.5 py-2.5 flex justify-between">
                <span className="text-slate-400">Contradictory</span>
                <span className="font-mono tabular-nums text-red-400">{document.contradictory_count}</span>
              </div>
              <div className="px-3.5 py-2.5 flex justify-between">
                <span className="text-slate-400">Unverified</span>
                <span className="font-mono tabular-nums text-slate-400">{document.unverified_count}</span>
              </div>
            </div>
          </div>
        ) : (
          (() => {
            const meta = NODE_STYLE[selectedCitation.status] || NODE_STYLE.unverified;
            const StatusIcon = meta.icon;
            const displayTitle =
              selectedCitation.matched_title ||
              selectedCitation.extracted_title ||
              selectedCitation.raw_text;
            const displayAuthors =
              selectedCitation.matched_authors || selectedCitation.extracted_authors || 'Not extracted';
            const displayYear =
              selectedCitation.matched_year || selectedCitation.extracted_year || '—';
            const displayDoi =
              selectedCitation.matched_doi || selectedCitation.extracted_doi;

            return (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-mono text-slate-400 tabular-nums">
                      Node [{selectedCitation.order_index}] · {selectedCitation.verification_source}
                    </div>
                    <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.textClass}`}>
                      <StatusIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>{meta.label}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId('center')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 bg-[#141A24] border border-white/10 rounded-md hover:border-white/25 whitespace-nowrap shrink-0"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span>Center</span>
                  </button>
                </div>

                <h3 className="font-display text-base font-semibold text-slate-100 leading-snug">
                  {displayTitle}
                </h3>

                <div className="rounded-lg border border-white/10 bg-[#0A0D13] divide-y divide-white/10 text-xs">
                  <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                    <span className="text-slate-400">Authors</span>
                    <span className="col-span-2 text-slate-200">{displayAuthors}</span>
                  </div>
                  <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                    <span className="text-slate-400">Year</span>
                    <span className="col-span-2 font-mono tabular-nums text-slate-200">{displayYear}</span>
                  </div>
                  <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                    <span className="text-slate-400">DOI</span>
                    <span className="col-span-2 font-mono text-slate-200 break-all">
                      {displayDoi ? (
                        <a
                          href={`https://doi.org/${displayDoi}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                        >
                          <span>{displayDoi}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </span>
                  </div>
                  <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                    <span className="text-slate-400">Venue</span>
                    <span className="col-span-2 text-slate-200">
                      {selectedCitation.matched_venue || selectedCitation.extracted_venue || '—'}
                    </span>
                  </div>
                  <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
                    <span className="text-slate-400">Confidence</span>
                    <span className="col-span-2 font-mono tabular-nums text-[#E5C158]">
                      {selectedCitation.confidence_score.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {selectedCitation.discrepancies.length > 0 && (
                  <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 space-y-1.5">
                    <div className="text-xs font-semibold text-amber-300">Discrepancies</div>
                    <ul className="space-y-1 text-xs text-amber-200/90 list-disc pl-4">
                      {selectedCitation.discrepancies.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedCitation.matched_url && (
                  <a
                    href={selectedCitation.matched_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 w-full px-3.5 py-2 text-xs font-medium text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors"
                  >
                    <span>View Registry Record</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
