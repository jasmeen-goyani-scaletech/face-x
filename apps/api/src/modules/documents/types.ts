/**
 * Document types per kind of registration, as defined by the frontend (the player's documents and photo step, the
 * coach's certificates, the staff member's proof). PROFILE_PHOTO is shared by all three.
 */
export const PLAYER_DOCUMENT_TYPES = [
  'PROFILE_PHOTO',
  'BIRTH_CERTIFICATE',
  'SCHOOL_ID',
  'SCHOOL_TRANSCRIPT',
  'CALIFORNIA_KID_ID',
] as const;
export const COACH_DOCUMENT_TYPES = [
  'PROFILE_PHOTO',
  'FIRST_AID_CPR',
  'YALF_TACKLE',
  'BACKGROUND_CHECK',
] as const;
export const STAFF_DOCUMENT_TYPES = ['PROFILE_PHOTO', 'BACKGROUND_CHECK', 'SAFESPORT'] as const;

export const DOCUMENT_TYPES = [
  'PROFILE_PHOTO',
  'BIRTH_CERTIFICATE',
  'SCHOOL_ID',
  'SCHOOL_TRANSCRIPT',
  'CALIFORNIA_KID_ID',
  'FIRST_AID_CPR',
  'YALF_TACKLE',
  'BACKGROUND_CHECK',
  'SAFESPORT',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Which kinds of registration (registrations.registrant_type) may hold each document type. */
export type DocumentRegistrantType = 'PLAYER' | 'COACH' | 'STAFF';
export const ALLOWED_DOCUMENT_TYPES: Record<DocumentRegistrantType, readonly DocumentType[]> = {
  PLAYER: PLAYER_DOCUMENT_TYPES,
  COACH: COACH_DOCUMENT_TYPES,
  STAFF: STAFF_DOCUMENT_TYPES,
};

/**
 * Required by the frontend. Optional there: the player's SCHOOL_ID and the staff member's SAFESPORT upload.
 * The coach's AB 506 acknowledgement is a consent, not a document.
 */
export const REQUIRED_DOCUMENT_TYPES: Record<DocumentRegistrantType, readonly DocumentType[]> = {
  PLAYER: ['PROFILE_PHOTO', 'BIRTH_CERTIFICATE', 'SCHOOL_TRANSCRIPT', 'CALIFORNIA_KID_ID'],
  COACH: ['PROFILE_PHOTO', 'FIRST_AID_CPR', 'YALF_TACKLE', 'BACKGROUND_CHECK'],
  STAFF: ['PROFILE_PHOTO', 'BACKGROUND_CHECK'],
};

export const REJECTION_REASON_CODES = [
  'UNREADABLE',
  'WRONG_TYPE',
  'NAME_MISMATCH',
  'EXPIRED',
  'CUSTOM',
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

/**
 * Where a document is in its life. Derived from uploaded_at / submitted_at / status; it is NOT the registration
 * status. An approved document does not edit the registration; the readiness evaluator reacts to it.
 */
export type DocumentState = 'AWAITING_UPLOAD' | 'UPLOADED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

/** What the API returns. Never includes the storage key, bucket or any URL. */
/** What happened to a profile photo's face enrollment right after it was uploaded (only on the answer to confirming an upload). */
export interface FaceEnrollmentResult {
  outcome: 'ENROLLED' | 'SKIPPED' | 'FAILED';
  /** A photo problem the person can fix by retaking it: NO_FACE_DETECTED, MULTIPLE_FACES, LOW_QUALITY or IMAGE_REJECTED. */
  problem?: string;
}

export interface DocumentDto {
  id: string;
  registrationId: string;
  documentType: DocumentType;
  /** Present only when a profile photo's upload was just confirmed. */
  faceEnrollment?: FaceEnrollmentResult;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  state: DocumentState;
  uploadedAt: string | null;
  submittedAt: string | null;
  /** The AI check turned this document down twice and the family sent it on anyway. Only the reviewer needs to know. */
  aiRejected: boolean;
  review: {
    decision: 'APPROVED' | 'REJECTED';
    reasonCode: RejectionReasonCode | null;
    reason: string | null;
    reviewedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export type CompletenessState = 'MISSING' | DocumentState;

/** Separate from the registration status: where the required documents stand. */
export interface DocumentCompleteness {
  required: { documentType: DocumentType; state: CompletenessState }[];
  allRequiredApproved: boolean;
}

export interface DocumentListDto {
  documents: DocumentDto[];
  completeness: DocumentCompleteness;
}

export interface UploadInstructions {
  url: string;
  method: 'PUT';
  /** Headers the browser must send unchanged. */
  headers: Record<string, string>;
  expiresAt: string;
}
