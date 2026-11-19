import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, Plus } from 'lucide-react';
import { ManuscriptHistory } from './components/ManuscriptHistory';
import { Sidebar, type WorkspaceView } from './components/Sidebar';
import { UploadPanel } from './components/UploadPanel';
import { VerificationResults } from './components/VerificationResults';
import {
  analyzeDocumentFigures,
  deleteDocument,
  fetchDocumentDetail,
  fetchDocuments,
  reverifyDocument,
  uploadPdfDocument,
  verifyReferencesText,
} from './lib/api';
import type { DocumentDetail, DocumentSummary } from './types/citation';

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('workbench');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);

  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeDocument, setActiveDocument] = useState<DocumentDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const uploadSectionRef = useRef<HTMLDivElement>(null);

  const loadDocuments = useCallback(async () => {
    setIsLoadingDocs(true);
    try {
      const list = await fetchDocuments();
      setDocuments(list);
      setErrorMessage(null);
      setActiveDocumentId((prev) => prev || (list[0]?.id ?? null));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load documents.');
    } finally {
      setIsLoadingDocs(false);
    }
  }, []);

  const loadDocumentDetail = useCallback(async (docId: string, silent = false) => {
    if (!silent) setIsLoadingDetail(true);
    try {
      const detail = await fetchDocumentDetail(docId);
      setActiveDocument(detail);
      setDocuments((prev) => {
        const exists = prev.some((d) => d.id === detail.id);
        if (!exists) return [detail, ...prev];
        return prev.map((d) => (d.id === detail.id ? { ...d, ...detail } : d));
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load verification report.');
    } finally {
      if (!silent) setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!activeDocumentId) {
      setActiveDocument(null);
      return;
    }
    void loadDocumentDetail(activeDocumentId);
  }, [activeDocumentId, loadDocumentDetail]);

  useEffect(() => {
    if (!activeDocument) return;
    if (activeDocument.status !== 'queued' && activeDocument.status !== 'processing') return;

    const timer = window.setInterval(() => {
      void loadDocumentDetail(activeDocument.id, true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeDocument, loadDocumentDetail]);

  const handleUploadPdf = async (file: File) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const created = await uploadPdfDocument(file);
      setDocuments((prev) => [created, ...prev]);
      setActiveDocumentId(created.id);
      await loadDocumentDetail(created.id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'PDF upload failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyText = async (title: string, text: string) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const detail = await verifyReferencesText(title, text);
      setDocuments((prev) => [detail, ...prev.filter((d) => d.id !== detail.id)]);
      setActiveDocumentId(detail.id);
      setActiveDocument(detail);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Reference verification failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAnalyzeFigures = async (docId: string) => {
    setErrorMessage(null);
    try {
      const detail = await analyzeDocumentFigures(docId);
      setActiveDocument(detail);
      setDocuments((prev) => prev.map((d) => (d.id === detail.id ? { ...d, ...detail } : d)));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Figure and graph analysis failed.');
    }
  };

  const handleReverify = async (docId: string) => {
    setErrorMessage(null);
    try {
      await reverifyDocument(docId);
      await loadDocumentDetail(docId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Re-verification failed.');
    }
  };

  const handleDelete = async (docId: string) => {
    setErrorMessage(null);
    try {
      await deleteDocument(docId);
      setDocuments((prev) => {
        const next = prev.filter((d) => d.id !== docId);
        if (activeDocumentId === docId) {
          setActiveDocumentId(next[0]?.id ?? null);
        }
        return next;
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const viewTitle =
    activeView === 'workbench' ? 'Verification Workbench' : 'Manuscript History';

  return (
    <div className="min-h-screen flex bg-[#080A0F] text-slate-100">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        documents={documents}
        activeDocumentId={activeDocumentId}
        onSelectDocument={(id) => setActiveDocumentId(id)}
        isLoadingDocs={isLoadingDocs}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 px-4 sm:px-8 bg-[#0B0E14] border-b border-white/10 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-md"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0 truncate">
              <span className="text-[#D4AF37] font-medium">CiteVerify</span>
              <span className="text-slate-600" aria-hidden="true">/</span>
              <span className="font-medium text-slate-100 truncate">{viewTitle}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setActiveView('workbench');
              window.requestAnimationFrame(() => {
                uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              });
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Verification</span>
          </button>
        </header>

        <main className="flex-1 px-4 sm:px-8 py-6 max-w-[1360px] w-full mx-auto space-y-6">
          {errorMessage && (
            <div
              role="alert"
              className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-red-200"
            >
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => {
                  void loadDocuments();
                }}
                className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-500 whitespace-nowrap self-start sm:self-auto"
              >
                Retry
              </button>
            </div>
          )}

          {activeView === 'workbench' && (
            <>
              <div ref={uploadSectionRef}>
                <UploadPanel
                  onUploadPdf={handleUploadPdf}
                  onVerifyText={handleVerifyText}
                  isSubmitting={isSubmitting}
                />
              </div>

              <VerificationResults
                document={activeDocument}
                isLoading={isLoadingDetail}
                onReverify={handleReverify}
                onAnalyzeFigures={handleAnalyzeFigures}
              />
            </>
          )}

          {activeView === 'history' && (
            <ManuscriptHistory
              documents={documents}
              isLoading={isLoadingDocs}
              onOpenDocument={(id) => {
                setActiveDocumentId(id);
                setActiveView('workbench');
              }}
              onReverifyDocument={handleReverify}
              onDeleteDocument={handleDelete}
            />
          )}
        </main>
      </div>
    </div>
  );
}
