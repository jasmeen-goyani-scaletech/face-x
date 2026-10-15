import type { ExtractionFailureReason } from '../../infrastructure/extraction/document-extractor';
import type { DocumentType } from '../documents/types';

/**
 * MATCH / MISMATCH against the profile on record; NOT_FOUND when the document gave no usable value. CLOSE (names only):
 * off by about a letter, most likely a misread of small print, so it is neither confirmed nor flagged; a person looks.
 */
export type FieldMatch = 'MATCH' | 'CLOSE' | 'MISMATCH' | 'NOT_FOUND';

export interface ExtractedFieldDto {
  /** As read (trimmed); dates as YYYY-MM-DD when they parse. Null when absent or illegible. */
  value: string | null;
  /** Null for a field that is reported but not compared with anything (e.g. the issuer). */
  match: FieldMatch | null;
}

/**
 * The result of one extraction. Nothing of it is stored: every call reads the document again. A provider failure is
 * still a result (status FAILED), since a document that cannot be read is something the reviewer checks by eye.
 */
export interface ExtractionVerdictDto {
  /** False only when the document could not be read or contradicts the profile on record (see verdictOf). */
  accepted: boolean;
  /** Fit to show the person who uploaded the document; null when accepted. */
  message: string | null;
}

export interface ExtractionResultDto {
  documentId: string;
  documentType: DocumentType;
  status: 'SUCCEEDED' | 'FAILED';
  failureReason?: ExtractionFailureReason;
  fields: Record<string, ExtractedFieldDto>;
  /** Computed here, not read off the document: age at the event date, from the extracted date of birth. */
  derived: { age?: number };
  /** The model that answered; null when no model was reached. */
  model: string | null;
  verdict: ExtractionVerdictDto;
}
