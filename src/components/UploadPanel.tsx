import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';
import { FileUp, Loader2, ScrollText, UploadCloud } from 'lucide-react';

interface UploadPanelProps {
  onUploadPdf: (file: File) => Promise<void>;
  onVerifyText: (title: string, text: string) => Promise<void>;
  isSubmitting: boolean;
}

const SAMPLE_REFERENCES = `[1] Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems. arXiv:1706.03762
[2] Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding. Proceedings of NAACL-HLT.
[3] Brown, T. B., Mann, B., Ryder, N., Subbiah, M., Kaplan, J., Dhariwal, P., et al. (2022). Language Models are Few-Shot Learners. Advances in Neural Information Processing Systems.
[4] He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning for Image Recognition. IEEE Conference on Computer Vision and Pattern Recognition (CVPR), doi:10.1109/CVPR.2016.90
[5] Smith, J. Q., & Doe, A. R. (2024). Quantum Hyper-Contextual Neural Synthesis for Automated Theorem Verification. Journal of Synthetic Citations, 14(2), 102-119.`;

export function UploadPanel({ onUploadPdf, onVerifyText, isSubmitting }: UploadPanelProps) {
  const [mode, setMode] = useState<'pdf' | 'text'>('pdf');
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState('Manuscript Bibliography Check');
  const [referencesText, setReferencesText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndSetFile = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setLocalError('Please choose a PDF manuscript (.pdf).');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setLocalError('PDF exceeds the 25 MB upload limit.');
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    validateAndSetFile(e.dataTransfer.files?.[0]);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    validateAndSetFile(e.target.files?.[0]);
  };

  const handlePdfSubmit = async () => {
    if (!selectedFile) {
      setLocalError('Select a PDF manuscript before running verification.');
      return;
    }
    setLocalError(null);
    await onUploadPdf(selectedFile);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTextSubmit = async () => {
    if (referencesText.trim().length < 15) {
      setLocalError('Paste at least one complete bibliographic reference to verify.');
      return;
    }
    setLocalError(null);
    await onVerifyText(docTitle.trim() || 'Pasted References', referencesText);
  };

  return (
    <section className="bg-[#0E1219] border border-white/10 rounded-xl p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-white/10">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Verify Manuscript Citations &amp; Visual Evidence
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Cross-check citations against Crossref, OpenAlex, and arXiv, inspect citation networks, and compare extracted PDF figures, graphs, and tables against manuscript claims.
          </p>
        </div>

        <div className="inline-flex items-center p-1 bg-[#141A24] border border-white/10 rounded-lg self-start shrink-0">
          <button
            type="button"
            onClick={() => {
              setMode('pdf');
              setLocalError(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'pdf'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            PDF Upload
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('text');
              setLocalError(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'text'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            Paste References
          </button>
        </div>
      </div>

      {localError && (
        <div
          role="alert"
          className="mt-4 px-4 py-3 text-sm text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg"
        >
          {localError}
        </div>
      )}

      {mode === 'pdf' ? (
        <div className="mt-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`rounded-xl border border-dashed p-8 text-center transition-colors ${
              dragActive
                ? 'border-emerald-400 bg-emerald-500/10'
                : 'border-white/15 bg-[#090C12] hover:border-[#D4AF37]/45'
            }`}
          >
            <UploadCloud className="mx-auto h-9 w-9 text-[#D4AF37]" />
            <p className="mt-3 text-sm font-medium text-slate-100">
              {selectedFile
                ? selectedFile.name
                : 'Drop a research manuscript PDF here, or browse from disk'}
            </p>
            <p className="mt-1 text-xs text-slate-400 tabular-nums">
              {selectedFile
                ? `${(selectedFile.size / 1024).toFixed(1)} KB · Extracts citations, citation network, figures, graphs & tables and compares against PDF claims`
                : 'Selectable-text PDF up to 25 MB · Analyzes & compares figures, graphs, tables, and citations inside the manuscript'}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="sr-only"
              id="pdf-upload-input"
            />

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <label
                htmlFor="pdf-upload-input"
                className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-200 bg-[#141A24] border border-white/15 rounded-lg hover:border-white/30 transition-colors whitespace-nowrap shrink-0"
              >
                <FileUp className="h-4 w-4" />
                <span>{selectedFile ? 'Choose Different PDF' : 'Select PDF File'}</span>
              </label>

              {selectedFile && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handlePdfSubmit}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <span>Upload &amp; Verify PDF</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="sm:col-span-2">
              <label htmlFor="ref-run-title" className="block text-xs font-medium text-slate-300 mb-1.5">
                Verification Run Title
              </label>
              <input
                id="ref-run-title"
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="e.g., Literature Review Section 2"
                className="w-full px-3.5 py-2 text-sm text-slate-100 bg-[#090C12] border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex sm:justify-end">
              <button
                type="button"
                onClick={() => setReferencesText(SAMPLE_REFERENCES)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#E5C158] bg-[#D4AF37]/10 border border-[#D4AF37]/30 hover:bg-[#D4AF37]/20 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <ScrollText className="h-3.5 w-3.5" />
                <span>Load Sample References</span>
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="references-textarea" className="block text-xs font-medium text-slate-300 mb-1.5">
              Bibliography / Reference Entries (numbered or blank-line separated)
            </label>
            <textarea
              id="references-textarea"
              rows={6}
              value={referencesText}
              onChange={(e) => setReferencesText(e.target.value)}
              placeholder="[1] Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS. arXiv:1706.03762"
              className="w-full px-3.5 py-2.5 font-mono text-xs leading-relaxed text-slate-100 bg-[#090C12] border border-white/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-xs text-slate-400">
              Verifies citations against Crossref, OpenAlex, and arXiv and populates the interactive Citation Network.
            </p>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleTextSubmit}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Verify References</span>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
