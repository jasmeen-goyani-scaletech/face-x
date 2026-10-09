import { ApiError } from '@/lib/api/errors';
import { completeUpload, putToStorage, requestUpload } from '@/lib/api/documents';
import type { ApiDocument, ApiDocumentType } from '@/lib/api/types';
import { DOCUMENT_TYPE_BY_KEY, type PlayerDocumentKey } from './documentMap';

const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.85;
/** The API accepts these for the player photo (images only) and for documents (PDF, JPEG, PNG). */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface PreparedFile {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

const swapExtension = (name: string, ext: string) => `${name.replace(/\.[^./\\]+$/, '') || 'photo'}.${ext}`;

/**
 * Gets a picked or captured file ready to send. Photos are re-encoded as JPEG with the long edge capped at 1600px: that
 * keeps uploads fast and well under the API's size limit, and it also drops metadata such as GPS location. PDFs go as they are.
 * If a photo can't be decoded by the browser it is sent unchanged when its type is one the API accepts; otherwise it is refused.
 */
export async function prepareFile(file: File | Blob, fileName: string): Promise<PreparedFile> {
  const type = file.type || 'application/octet-stream';
  if (type === 'application/pdf') return { blob: file, fileName, mimeType: 'application/pdf' };

  if (type.startsWith('image/')) {
    try {
      const img = await loadImage(file);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#fff'; // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
        if (blob && blob.size > 0) return { blob, fileName: swapExtension(fileName, 'jpg'), mimeType: 'image/jpeg' };
      }
    } catch {
      // fall through to the unchanged-file check below
    }
    if (ACCEPTED_IMAGE_TYPES.includes(type)) return { blob: file, fileName, mimeType: type };
  }
  throw new ApiError(400, 'FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed');
}

/** How many times one file is tried before the person is asked to retry by hand. */
const MAX_PUT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;

/**
 * Worth trying again with a fresh link: the connection dropped (no response), the storage service had a hiccup (5xx), or
 * the signed link expired (403). Anything else (a refused file type or size) would fail the same way every time.
 */
function isRetryable(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'UPLOAD_LINK_EXPIRED' || (e.code === 'UPLOAD_FAILED' && (e.status === 0 || e.status >= 500)));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The whole upload for one document, whoever it belongs to (player, coach or staff): ask the API for a signed URL, PUT the
 * file to storage, then have the API verify what landed there. Resolves with the document in the UPLOADED state.
 * `onProgress` is 0-100.
 *
 * A failed transfer is retried (up to 3 attempts in all) with a new signed URL each time (the API re-issues the same document
 * record until it has been confirmed). If every attempt fails the last error is thrown and the person can pick the file again.
 */
export async function uploadRegistrationDocument(
  registrationId: string,
  documentType: ApiDocumentType,
  file: File | Blob,
  fileName: string,
  onProgress: (percent: number) => void
): Promise<ApiDocument> {
  onProgress(1);
  const prepared = await prepareFile(file, fileName);
  let pending: ApiDocument | null = null;
  for (let attempt = 1; pending === null; attempt++) {
    const issued = await requestUpload(registrationId, {
      documentType,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      sizeBytes: prepared.blob.size
    });
    try {
      await putToStorage(issued.upload, prepared.blob, (fraction) => onProgress(Math.min(95, Math.max(2, Math.round(fraction * 95)))));
      pending = issued.document;
    } catch (e) {
      if (attempt >= MAX_PUT_ATTEMPTS || !isRetryable(e)) throw e;
      onProgress(1);
      await wait(RETRY_DELAY_MS * attempt);
    }
  }
  const document = await completeUpload(pending.id);
  onProgress(100);
  return document;
}

/** A player's document or photo, by the id the player screens use for it. */
export function uploadPlayerDocument(
  registrationId: string,
  key: PlayerDocumentKey,
  file: File | Blob,
  fileName: string,
  onProgress: (percent: number) => void
): Promise<ApiDocument> {
  return uploadRegistrationDocument(registrationId, DOCUMENT_TYPE_BY_KEY[key], file, fileName, onProgress);
}
