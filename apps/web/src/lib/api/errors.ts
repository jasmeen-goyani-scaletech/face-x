import type { ApiErrorDetail } from './types';

/** Anything the API (or the network on the way to it) answered with a failure. `status` 0 means no response at all. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** True for a specific API error code (or any of several). */
export function hasCode(e: unknown, ...codes: string[]): boolean {
  return isApiError(e) && codes.includes(e.code);
}

/** Wording for the codes a family can actually hit; the API's own message is used for the rest. */
const FRIENDLY: Record<string, string> = {
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  REQUEST_TIMEOUT: 'The server took too long to answer. Please try again.',
  NOT_AUTHENTICATED: 'Please sign in to continue.',
  UNAUTHORIZED: 'Your session has ended. Please sign in again.',
  AUTH_REFRESH_REUSED: 'Your session was ended for your security. Please sign in again.',
  INVALID_CREDENTIALS: 'That email and password don’t match. Check them and try again.',
  EMAIL_ALREADY_REGISTERED: 'An account with that email already exists. Try signing in instead.',
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
  EVENT_NOT_FOUND: 'That event isn’t available for registration.',
  EVENT_NOT_OPEN: 'This event isn’t open for registration.',
  INVITE_NOT_FOUND: 'This invite link isn’t valid any more.',
  TEAM_NOT_AVAILABLE: 'That team isn’t accepting players. Please choose another.',
  REGISTRATION_ALREADY_EXISTS: 'This player is already registered for this event.',
  REGISTRATION_NOT_EDITABLE: 'This registration has been submitted and can no longer be edited.',
  REGISTRATION_INCOMPLETE: 'Some required details are missing from this registration.',
  STORAGE_NOT_CONFIGURED: 'File uploads aren’t available right now. Please try again later.',
  STORAGE_UNAVAILABLE: 'File uploads aren’t available right now. Please try again later.',
  FILE_TYPE_NOT_ALLOWED: 'That file type isn’t accepted. Upload a JPG, PNG or PDF.',
  DOCUMENT_ALREADY_REVIEWED: 'Another admin has already decided on this document. Reload to see the result.',
  DOCUMENT_NOT_SUBMITTED: 'The family hasn’t sent this document for review yet.',
  INVALID_STATUS_TRANSITION: 'This registration is in a state where that can’t be done (for example it was already decided).',
  EVENT_ACCESS_DENIED: 'Your account isn’t an admin of this event.',
  REGISTRATION_NOT_FOUND: 'That registration wasn’t found.',
  DOCUMENT_ALREADY_APPROVED: 'That document has already been approved, so it can’t be replaced.',
  DOCUMENT_IN_REVIEW: 'That document is with staff for review, so it can’t be replaced right now.',
  TOO_MANY_ATTEMPTS: 'There have been too many rejected uploads for this document. Please contact the league.',
  UPLOAD_FAILED: 'The file couldn’t be uploaded. Check your connection and try again.',
  UPLOAD_LINK_EXPIRED: 'The upload took too long and timed out. Please try the file again.',
  UPLOAD_SUPERSEDED: 'A newer upload replaced this one. Please try again.',
  PLAYER_ALREADY_EXISTS: 'A player record already exists for this account.',
  CONSENT_NOT_FOUND: 'That consent is no longer current. Please review and accept the latest wording.',
  UPLOAD_NOT_COMPLETE: 'The file didn’t finish uploading. Please try again.',
  PAYMENT_NOT_CONFIGURED: 'Online payments aren’t available right now. Please try again later.',
  PAYMENT_NOT_REQUIRED: 'No payment is needed for this registration.',
  PAYMENT_ALREADY_COMPLETED: 'This registration has already been paid.',
  PAYMENT_IN_PROGRESS: 'A payment for this registration is already in progress.',
  REGISTRATION_NOT_PAYABLE: 'This registration can’t be paid yet. Finish and submit it first.',
  ACCOUNT_DISABLED: 'This account has been disabled. Contact the league for help.',
  INSUFFICIENT_ROLE: 'Your account isn’t set up for this action yet.'
};

/** A message safe to show a person for any thrown value. */
export function describeError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!isApiError(e)) return fallback;
  if (e.status >= 500 && e.code !== 'STORAGE_NOT_CONFIGURED' && e.code !== 'STORAGE_UNAVAILABLE' && !FRIENDLY[e.code]) return fallback;
  return FRIENDLY[e.code] ?? e.message ?? fallback;
}

/** Field-level problems from a 422, keyed by the API's field path (e.g. `dateOfBirth`, `guardian.phone`). */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isApiError(e)) for (const d of e.details) if (!(d.path in out)) out[d.path] = d.message;
  return out;
}
