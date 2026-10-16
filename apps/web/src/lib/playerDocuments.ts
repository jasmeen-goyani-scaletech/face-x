import { emptyFile, type PlayerRegistration, type UploadedFile } from './types';

/** The player's supporting documents, in display order. The Face-X photo is separate (camera capture only). */
export const PLAYER_DOCUMENTS = [
  {
    id: 'birthCertificate',
    label: 'Birth Certificate',
    required: true,
    hint: 'A clear copy of the full certificate, showing the player’s name and date of birth.'
  },
  { id: 'schoolId', label: 'School ID', required: false, hint: 'The front of the current student ID card.' },
  { id: 'schoolTranscript', label: 'School Transcript', required: true, hint: 'The most recent official or unofficial transcript.' },
  { id: 'californiaKidId', label: 'California Kid ID / Government Photo ID', required: true, hint: 'A California Kid ID or other government-issued photo ID.' }
] as const;

export type PlayerDocumentId = (typeof PLAYER_DOCUMENTS)[number]['id'];

/** Safe read: registrations saved before a document type existed simply don't have it yet. */
export function playerDocument(reg: PlayerRegistration, id: PlayerDocumentId): UploadedFile {
  return reg.documents[id] ?? emptyFile();
}

/** Required documents the player hasn't uploaded yet — the single source of truth for gating the Documents step. */
export function missingRequiredDocuments(reg: PlayerRegistration): (typeof PLAYER_DOCUMENTS)[number][] {
  return PLAYER_DOCUMENTS.filter((d) => d.required && !playerDocument(reg, d.id).uploaded);
}

// ---- file rules (shared by the upload UI) ----

export * from './documentFileRules';

const MAX_IMAGE_EDGE = 1600;

/** Shrinks large photos (long edge 1600px, JPEG) so several documents fit in browser storage. Falls back to the original. */
function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 400_000) return resolve(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Reads a validated file, reporting real read progress (0–100), and returns the record to store. */
export function readDocumentFile(file: File, onProgress: (percent: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    reader.onerror = () => reject(new Error(`We couldn’t read “${file.name}”. Try again or choose a different file.`));
    reader.onload = async () => {
      onProgress(100);
      const raw = String(reader.result);
      const dataUrl = file.type.startsWith('image/') ? await compressImage(raw) : raw;
      resolve({ uploaded: true, fileName: file.name, dataUrl, size: file.size, uploadedAt: Date.now(), review: 'not_submitted', reason: '' });
    };
    reader.readAsDataURL(file);
  });
}
