import { ApiError } from '@/lib/api/errors';
import { completeUpload, putToStorage, requestUpload } from '@/lib/api/documents';
import type { ApiDocument, ApiDocumentType } from '@/lib/api/types';
import { DOCUMENT_TYPE_BY_KEY, type PlayerDocumentKey } from './documentMap';

/**
 * Size limits, mirroring the API (infrastructure/storage/file-storage.ts), so a file that would be refused is caught before
 * any bytes are sent. The API remains the authority.
 */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Photos of documents are squeezed only until they are about this size. Smaller is not worth any loss of detail. */
const TARGET_IMAGE_BYTES = 800 * 1024;
/**
 * Compression steps, gentlest first. The last one is the floor: a 1200px-long-edge JPEG at 0.7 still keeps ID numbers and small
 * print legible. If the file is still over the limit the person is asked for a better photo; quality is never cut further.
 */
const COMPRESSION_STEPS = [
  { edge: 1600, quality: 0.85 },
  { edge: 1600, quality: 0.75 },
  { edge: 1400, quality: 0.72 },
  { edge: 1200, quality: 0.7 }
];
/** The API accepts these for the player photo (images only) and for documents (PDF, JPEG, PNG). */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const tooLarge = (limit: number) =>
  new ApiError(400, 'FILE_TOO_LARGE', `This file is too large (the limit is ${Math.round(limit / (1024 * 1024))} MB).`);

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
 * Gets a picked or captured file ready to send. Photos are re-encoded as JPEG (long edge capped, quality stepped down only until
 * the file is small enough), which keeps uploads fast and also drops metadata such as GPS location. PDFs are never re-rendered,
 * so they stay valid and sharp; they are only checked against the size limit. If a photo can't be decoded by the browser it is
 * sent unchanged when its type is one the API accepts and it fits the limit; otherwise it is refused.
 */
export async function prepareFile(file: File | Blob, fileName: string, isProfilePhoto = false): Promise<PreparedFile> {
  const type = file.type || 'application/octet-stream';
  if (type === 'application/pdf' && !isProfilePhoto) {
    if (file.size > MAX_PDF_BYTES) throw tooLarge(MAX_PDF_BYTES);
    return { blob: file, fileName, mimeType: 'application/pdf' };
  }
  const limit = isProfilePhoto ? MAX_PHOTO_BYTES : MAX_DOCUMENT_IMAGE_BYTES;

  if (type.startsWith('image/')) {
    try {
      const img = await loadImage(file);
      let best: Blob | null = null;
      for (const step of COMPRESSION_STEPS) {
        const scale = Math.min(1, step.edge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) break;
        ctx.fillStyle = '#fff'; // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', step.quality));
        if (!blob || blob.size === 0) break;
        best = blob;
        if (blob.size <= TARGET_IMAGE_BYTES) break;
      }
      if (best) {
        // Re-encoding an already small JPEG can make it bigger: keep the original then.
        if (type === 'image/jpeg' && file.size <= best.size && file.size <= limit) return { blob: file, fileName, mimeType: type };
        if (best.size > limit) throw tooLarge(limit);
        return { blob: best, fileName: swapExtension(fileName, 'jpg'), mimeType: 'image/jpeg' };
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // fall through to the unchanged-file check below
    }
    if (ACCEPTED_IMAGE_TYPES.includes(type) && (isProfilePhoto || type !== 'image/webp')) {
      if (file.size > limit) throw tooLarge(limit);
      return { blob: file, fileName, mimeType: type };
    }
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
  const prepared = await prepareFile(file, fileName, documentType === 'PROFILE_PHOTO');
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
