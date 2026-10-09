import { ApiError } from './errors';
import { apiRequest } from './http';
import type { ApiDocument, ApiDocumentList, ApiRejectionReasonCode, ApiUploadInstructions, RequestUploadInput } from './types';

export const listDocuments = (registrationId: string) => apiRequest<ApiDocumentList>(`/registrations/${registrationId}/documents`);

/** Step 1 of an upload: the API creates the document record and returns a short-lived signed PUT URL. */
export const requestUpload = (registrationId: string, input: RequestUploadInput) =>
  apiRequest<{ document: ApiDocument; upload: ApiUploadInstructions }>(`/registrations/${registrationId}/documents/upload-url`, {
    method: 'POST',
    body: input
  });

/** Step 3: the API checks the stored file's size and real file type. Only then is the document UPLOADED. */
export const completeUpload = (documentId: string) => apiRequest<ApiDocument>(`/documents/${documentId}/complete`, { method: 'POST', body: {} });

/** Sends an uploaded document to staff review. */
export const submitDocument = (documentId: string) => apiRequest<ApiDocument>(`/documents/${documentId}/submit`, { method: 'POST', body: {} });

/** A transfer that makes no progress for this long (the whole request, for a 10 MB file on a poor connection) is given up on and retried. */
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Step 2: PUT the file straight to storage using the signed URL (it never passes through this app or the API). The
 * headers must be sent exactly as given or the signature fails. Uses XHR because fetch can't report upload progress.
 * This request carries NO Authorization header: the signature in the URL is the credential.
 */
export function putToStorage(upload: ApiUploadInstructions, file: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // 403 from a signed URL almost always means it expired (or the file didn't match what was signed).
      reject(new ApiError(xhr.status, xhr.status === 403 ? 'UPLOAD_LINK_EXPIRED' : 'UPLOAD_FAILED', 'The file could not be stored'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'UPLOAD_FAILED', 'The file could not be sent'));
    xhr.onabort = () => reject(new ApiError(0, 'UPLOAD_FAILED', 'The upload was cancelled'));
    xhr.ontimeout = () => reject(new ApiError(0, 'UPLOAD_FAILED', 'The upload took too long'));
    xhr.send(file);
  });
}

// ---- admin review ----

/** An admin's decision on a submitted document. A rejection needs a reason code and the text the family will read. */
export const reviewDocument = (
  documentId: string,
  decision: { decision: 'APPROVED' } | { decision: 'REJECTED'; reasonCode: ApiRejectionReasonCode; reason: string }
) => apiRequest<ApiDocument>(`/documents/${documentId}/review`, { method: 'PATCH', body: decision });

/**
 * A short-lived signed link to open the stored file (issued, and audited, per request). `inline` asks for a link that shows
 * the file in the browser (the admin preview) rather than downloading it.
 */
export const getDownloadUrl = (documentId: string, options: { inline?: boolean } = {}) =>
  apiRequest<{ url: string; expiresAt: string }>(`/documents/${documentId}/download-url`, {
    query: options.inline ? { inline: 'true' } : undefined
  });
