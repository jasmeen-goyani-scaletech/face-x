/** The preset reasons an admin can pick when rejecting a document (the API stores the code and the text the registrant reads). */
export const REJECTION_REASONS = [
  { code: 'UNREADABLE', label: 'Unreadable / Blurry Image', template: 'The file is too blurry or dark to read.' },
  { code: 'WRONG_TYPE', label: 'Incorrect Document Type', template: 'This isn’t the document type we asked for.' },
  { code: 'NAME_MISMATCH', label: 'Name Mismatch', template: 'The name on the document doesn’t match the registration.' },
  { code: 'EXPIRED', label: 'Expired Document', template: 'This document has expired.' },
  { code: 'CUSTOM', label: 'Custom Reason', template: '' }
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASONS)[number]['code'];
