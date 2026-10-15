import type { ExtractionFailureReason } from '../../infrastructure/extraction/document-extractor';
import type { ExtractedFieldDto, ExtractionVerdictDto } from './types';

const ACCEPTED: ExtractionVerdictDto = { accepted: true, message: null };

/** What a MISMATCH on each compared field means to the person who uploaded the document. */
const MISMATCH_TEXT: Record<string, string> = {
  firstName: 'the name on it does not match the registration',
  lastName: 'the name on it does not match the registration',
  fullName: 'the name on it does not match the registration',
  dateOfBirth: 'the date of birth on it does not match the registration',
  expiryDate: 'it has expired',
};

/**
 * Whether the AI check accepts the document, with the message to show when it does not. Only two things are a rejection: the
 * document could not be read at all (UNREADABLE), or a value on it contradicts the profile on record (MISMATCH, including an
 * expiry date before the event). CLOSE and NOT_FOUND are for a reviewer to look at, and so are checks that could not run
 * (an unsupported file type, a timeout, a provider failure): none of those is the family's mistake, so none blocks them.
 */
export function verdictOf(
  failureReason: ExtractionFailureReason | undefined,
  fields: Record<string, ExtractedFieldDto>,
): ExtractionVerdictDto {
  if (failureReason === 'UNREADABLE') {
    return {
      accepted: false,
      message:
        'We could not read this document. Please upload a clear, complete copy with all four corners visible.',
    };
  }
  if (failureReason) return ACCEPTED;

  const problems = new Set<string>();
  for (const [key, field] of Object.entries(fields)) {
    if (field.match === 'MISMATCH') problems.add(MISMATCH_TEXT[key] ?? `${key} does not match`);
  }
  if (problems.size === 0) return ACCEPTED;
  const list = [...problems];
  return {
    accepted: false,
    message: `This document was not accepted: ${list.join(' and ')}. Please upload the correct document.`,
  };
}
