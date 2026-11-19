import { ExternalLink, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { getStoredPdfUrl } from '../lib/api';
import type { DocumentSummary } from '../types/citation';

interface ManuscriptHistoryProps {
  documents: DocumentSummary[];
  isLoading: boolean;
  onOpenDocument: (id: string) => void;
  onReverifyDocument: (id: string) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
}

export function ManuscriptHistory({
  documents,
  isLoading,
  onOpenDocument,
  onReverifyDocument,
  onDeleteDocument,
}: ManuscriptHistoryProps) {
  return (
    <section className="bg-[#0E1219] border border-white/10 rounded-xl overflow-hidden">
      <div className="px-6 py-5 border-b border-white/10">
        <h1 className="font-display text-xl font-semibold text-slate-100">
          Persisted Manuscript History
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Uploaded PDFs, citation networks, and extracted scientific figure audits stored in PostgreSQL.
        </p>
      </div>

      {isLoading ? (
        <div className="p-6 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-white/[0.04] rounded animate-pulse" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-400">
          No manuscripts have been verified yet. Upload a PDF or verify references from the Workbench.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-xs font-medium text-slate-400 bg-[#0B0E14]">
                <th className="py-3 pl-6 pr-3">Manuscript</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Refs</th>
                <th className="py-3 px-3 text-right">Supported</th>
                <th className="py-3 px-3 text-right">Flagged</th>
                <th className="py-3 px-3 text-right">Figures</th>
                <th className="py-3 pl-3 pr-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-white/[0.03] transition-colors">
                  <td className="py-3.5 pl-6 pr-3">
                    <button
                      type="button"
                      onClick={() => onOpenDocument(doc.id)}
                      className="flex items-center gap-2 font-medium text-slate-100 hover:text-emerald-300 text-left"
                    >
                      <FileText className="h-4 w-4 text-[#D4AF37] shrink-0" />
                      <span className="truncate max-w-xs">{doc.filename}</span>
                    </button>
                    <div className="pl-6 text-xs text-slate-500 tabular-nums">
                      {new Date(doc.created_at).toLocaleString()} · {(doc.file_size / 1024).toFixed(1)} KB
                    </div>
                  </td>
                  <td className="py-3.5 px-3 text-xs text-slate-400 uppercase font-mono">
                    {doc.source_type}
                  </td>
                  <td className="py-3.5 px-3 text-xs font-medium text-slate-300 capitalize">
                    {doc.status}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-200">
                    {doc.total_citations}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums text-emerald-400">
                    {doc.verified_count}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums text-amber-400">
                    {doc.mismatch_count + doc.contradictory_count}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#E5C158]">
                    {doc.figure_count}
                  </td>
                  <td className="py-3.5 pl-3 pr-6">
                    <div className="flex items-center justify-end gap-2">
                      {doc.has_stored_file && doc.source_type === 'pdf' && (
                        <a
                          href={getStoredPdfUrl(doc.id)}
                          target="_blank"
                          rel="noreferrer"
                          title="Open stored PDF"
                          className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/10"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onReverifyDocument(doc.id)}
                        title="Re-verify manuscript"
                        className="p-1.5 text-slate-400 hover:text-emerald-300 rounded-md hover:bg-white/10"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteDocument(doc.id)}
                        title="Delete record"
                        className="p-1.5 text-slate-400 hover:text-red-400 rounded-md hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
