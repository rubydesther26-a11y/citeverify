import type {
  DocumentDetail,
  DocumentSummary,
  HealthResponse,
} from '../types/citation';

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

async function parseErrorResponse(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.error === 'string') return data.error;
    if (Array.isArray(data?.detail) && data.detail[0]?.msg) {
      return String(data.detail[0].msg);
    }
  } catch {
    // Non-JSON error body
  }
  return `Request failed with status ${res.status} (${res.statusText || 'Error'})`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = buildApiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(
      `Cannot reach CiteVerify backend at ${url || '/api'}. Verify the FastAPI server is running.`
    );
  }

  if (!res.ok) {
    if (res.status === 404 && import.meta.env.PROD && !getApiBaseUrl()) {
      throw new Error(
        'Backend API URL is not configured for this production build (VITE_API_BASE_URL is empty). Set VITE_API_BASE_URL to your FastAPI server URL and redeploy.'
      );
    }
    throw new Error(await parseErrorResponse(res));
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    if (import.meta.env.PROD && !getApiBaseUrl()) {
      throw new Error(
        'Backend API URL is not configured for this production build (VITE_API_BASE_URL is empty). Set VITE_API_BASE_URL to your FastAPI server URL and redeploy.'
      );
    }
    throw new Error(
      'Received a non-JSON response from the API server. Please click Retry in a moment.'
    );
  }

  return (await res.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health');
}

export function fetchDocuments(): Promise<DocumentSummary[]> {
  return requestJson<DocumentSummary[]>('/api/documents');
}

export function fetchDocumentDetail(documentId: string): Promise<DocumentDetail> {
  return requestJson<DocumentDetail>(`/api/documents/${encodeURIComponent(documentId)}`);
}

export async function uploadPdfDocument(file: File): Promise<DocumentSummary> {
  const formData = new FormData();
  formData.append('file', file);
  return requestJson<DocumentSummary>('/api/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

export function verifyReferencesText(title: string, referencesText: string): Promise<DocumentDetail> {
  return requestJson<DocumentDetail>('/api/documents/verify-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      references_text: referencesText,
    }),
  });
}

export function reverifyDocument(documentId: string): Promise<DocumentSummary> {
  return requestJson<DocumentSummary>(`/api/documents/${encodeURIComponent(documentId)}/reverify`, {
    method: 'POST',
  });
}

export function analyzeDocumentFigures(documentId: string): Promise<DocumentDetail> {
  return requestJson<DocumentDetail>(
    `/api/documents/${encodeURIComponent(documentId)}/analyze-figures`,
    { method: 'POST' }
  );
}

export async function deleteDocument(documentId: string): Promise<void> {
  const url = buildApiUrl(`/api/documents/${encodeURIComponent(documentId)}`);
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }
}

export function getExportUrl(documentId: string, format: 'csv' | 'json'): string {
  return buildApiUrl(`/api/documents/${encodeURIComponent(documentId)}/export?format=${format}`);
}

export function getStoredPdfUrl(documentId: string): string {
  return buildApiUrl(`/api/documents/${encodeURIComponent(documentId)}/file`);
}

export function getFigureImageUrl(documentId: string, figureId: string): string {
  return buildApiUrl(
    `/api/documents/${encodeURIComponent(documentId)}/figures/${encodeURIComponent(figureId)}/image`
  );
}

