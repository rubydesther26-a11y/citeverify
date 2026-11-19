import { BookOpenCheck, FileText, FolderClock, X } from 'lucide-react';
import type { DocumentSummary } from '../types/citation';

export type WorkspaceView = 'workbench' | 'history';

interface SidebarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  documents: DocumentSummary[];
  activeDocumentId: string | null;
  onSelectDocument: (id: string) => void;
  isLoadingDocs: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function formatCompactDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function Sidebar({
  activeView,
  onSelectView,
  documents,
  activeDocumentId,
  onSelectDocument,
  isLoadingDocs,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navItems: Array<{ id: WorkspaceView; label: string; icon: typeof BookOpenCheck }> = [
    { id: 'workbench', label: 'Verification Workbench', icon: BookOpenCheck },
    { id: 'history', label: 'Manuscript History', icon: FolderClock },
  ];

  const content = (
    <div className="flex h-full flex-col bg-[#0B0E14] border-r border-white/10">
      <div className="flex h-16 items-center justify-between px-5 border-b border-white/10">
        <button
          type="button"
          onClick={() => {
            onSelectView('workbench');
            onCloseMobile();
          }}
          className="font-display text-lg font-bold tracking-tight text-[#F3E5AB] whitespace-nowrap shrink-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
        >
          CiteVerify
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="px-3 py-4 space-y-1 border-b border-white/10" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                active
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 border border-transparent'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="px-3 mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-400">Recent Manuscripts</h2>
          <span className="text-xs font-mono tabular-nums text-slate-500">{documents.length}</span>
        </div>

        {isLoadingDocs ? (
          <div className="space-y-2 px-3 pt-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 rounded-lg bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500 leading-relaxed">
            Uploaded PDFs and reference runs saved to PostgreSQL will appear here.
          </p>
        ) : (
          <ul className="space-y-1">
            {documents.slice(0, 14).map((doc) => {
              const selected = activeDocumentId === doc.id && activeView === 'workbench';
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectDocument(doc.id);
                      onSelectView('workbench');
                      onCloseMobile();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      selected
                        ? 'bg-[#141B26] text-slate-100 border border-[#D4AF37]/40'
                        : 'text-slate-300 hover:bg-white/[0.04] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-[#D4AF37] shrink-0" />
                      <span className="text-sm font-medium truncate">{doc.filename}</span>
                    </div>
                    <div className="mt-0.5 pl-5.5 flex items-center gap-1.5 text-xs text-slate-400 tabular-nums">
                      <span>{doc.total_citations} refs</span>
                      <span aria-hidden="true">·</span>
                      <span>{doc.figure_count} figs</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatCompactDate(doc.created_at)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="p-4 border-t border-white/10 text-xs text-slate-500 leading-relaxed">
        Crossref · OpenAlex · arXiv · PyMuPDF
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[268px] shrink-0 h-screen sticky top-0">
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{content}</div>
        </div>
      )}
    </>
  );
}
