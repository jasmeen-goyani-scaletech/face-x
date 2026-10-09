import type { PlayerDocumentId } from '@/lib/playerDocuments';
import { emptyFile, type UploadedFile } from '@/lib/types';
import type { ApiDocument, ApiDocumentType, ApiPlayerDocumentType } from '@/lib/api/types';

/** The id a document has in the player UI (`playerDocuments.ts`, plus the photo step), as a single union. */
export type PlayerDocumentKey = 'profilePhoto' | PlayerDocumentId;

/** Frontend id -> API document type. This is the one place the two vocabularies meet. */
export const DOCUMENT_TYPE_BY_KEY: Record<PlayerDocumentKey, ApiPlayerDocumentType> = {
  profilePhoto: 'PROFILE_PHOTO',
  birthCertificate: 'BIRTH_CERTIFICATE',
  schoolId: 'SCHOOL_ID',
  schoolTranscript: 'SCHOOL_TRANSCRIPT',
  californiaKidId: 'CALIFORNIA_KID_ID'
};

/**
 * API document type -> the id the document has in the UI (the ids in `documentKinds.ts`), for every kind of registration: the
 * player's documents, and the coach's and staff member's certificates. Used for labels and icons.
 */
export const KEY_BY_DOCUMENT_TYPE: Record<ApiDocumentType, string> = {
  PROFILE_PHOTO: 'profilePhoto',
  BIRTH_CERTIFICATE: 'birthCertificate',
  SCHOOL_ID: 'schoolId',
  SCHOOL_TRANSCRIPT: 'schoolTranscript',
  CALIFORNIA_KID_ID: 'californiaKidId',
  FIRST_AID_CPR: 'firstAidCpr',
  YALF_TACKLE: 'yalfTackle',
  BACKGROUND_CHECK: 'backgroundCheckRef',
  SAFESPORT: 'safeSportUpload'
};

export const DOCUMENT_KEYS = Object.keys(DOCUMENT_TYPE_BY_KEY) as PlayerDocumentKey[];

const REASON_LABEL: Record<NonNullable<NonNullable<ApiDocument['review']>['reasonCode']>, string> = {
  UNREADABLE: 'the file was unreadable',
  WRONG_TYPE: 'this isn’t the document we asked for',
  NAME_MISMATCH: 'the name doesn’t match the player',
  EXPIRED: 'the document has expired',
  CUSTOM: ''
};

/**
 * What the API knows about a document, in the shape the existing upload rows render.
 *   AWAITING_UPLOAD  a record exists but no file was stored yet      -> not uploaded
 *   UPLOADED         stored and checked, not yet sent to review      -> uploaded, "not_submitted"
 *   IN_REVIEW        staff has it                                    -> "pending"
 *   APPROVED / REJECTED                                              -> the decision (+ reason)
 * `previewUrl` is a browser-local object URL for a file uploaded in this session (the API never returns file URLs here).
 */
export function toUploadedFile(doc: ApiDocument | undefined, previewUrl?: string): UploadedFile {
  if (!doc || doc.state === 'AWAITING_UPLOAD') return emptyFile();
  const base: UploadedFile = {
    uploaded: true,
    fileName: doc.fileName,
    dataUrl: previewUrl,
    size: doc.sizeBytes ?? undefined,
    uploadedAt: doc.uploadedAt ? Date.parse(doc.uploadedAt) : undefined,
    review: 'not_submitted'
  };
  switch (doc.state) {
    case 'IN_REVIEW':
      return { ...base, review: 'pending' };
    case 'APPROVED':
      return { ...base, review: 'approved' };
    case 'REJECTED': {
      const code = doc.review?.reasonCode;
      const reason = doc.review?.reason ?? (code ? REASON_LABEL[code] : '');
      return { ...base, review: 'rejected', reason };
    }
    default:
      return base;
  }
}

/**
 * The current version of each document type. A rejected document stays on record when the family replaces it (the new
 * file is a new record), so a list can hold several per type; only the newest is what the family has on file now.
 */
export function newestPerType(documents: ApiDocument[]): ApiDocument[] {
  const byType = new Map<ApiDocumentType, ApiDocument>();
  for (const d of documents) {
    const seen = byType.get(d.documentType);
    if (!seen || d.createdAt > seen.createdAt) byType.set(d.documentType, d);
  }
  return [...byType.values()];
}

/** True when a family has at least one document that was rejected and not yet replaced. */
export const hasRejectedDocument = (documents: ApiDocument[]): boolean => newestPerType(documents).some((d) => d.state === 'REJECTED');

/**
 * Whether the family may upload a file here. The server only accepts a new file for a document that was never sent for
 * review or was rejected: an approved or in-review document can't be replaced, so the screen doesn't offer it.
 */
export const canReplace = (file: UploadedFile): boolean => !file.uploaded || file.review === 'rejected' || file.review === 'not_submitted';

/** True when the document needs (re)uploading before the registration can go for review. */
export function needsUpload(file: UploadedFile): boolean {
  return !file.uploaded || file.review === 'rejected';
}
