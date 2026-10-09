import type { DocumentState } from './types';

/**
 * Where a document is in its life, derived from the review status and the upload/submit timestamps. A leaf module
 * (no database, no other module) so both the documents module and registration readiness use the one definition.
 */
export function documentState(r: {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  uploadedAt: Date | null;
  submittedAt: Date | null;
}): DocumentState {
  if (!r.uploadedAt) return 'AWAITING_UPLOAD';
  if (r.status === 'APPROVED') return 'APPROVED';
  if (r.status === 'REJECTED') return 'REJECTED';
  return r.submittedAt ? 'IN_REVIEW' : 'UPLOADED';
}
