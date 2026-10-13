import { AppError } from '../../shared/errors/app-error';

export const REGISTRATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PAYMENT_PENDING',
  'PAYMENT_COMPLETED',
  'DOCUMENT_REVIEW',
  'VERIFIED',
  'REJECTED',
  'READY_FOR_EVENT',
  'CANCELLED',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRANT_TYPES = ['PLAYER', 'COACH', 'STAFF'] as const;
export type RegistrantType = (typeof REGISTRANT_TYPES)[number];

/**
 * The legal status moves for a PLAYER registration. This table is the single definition of the workflow;
 * every status change must go through it (the database only checks that a status VALUE is valid).
 *
 * Who moves a registration along it today: DRAFT -> SUBMITTED (registrations); SUBMITTED -> PAYMENT_PENDING ->
 * PAYMENT_COMPLETED (payments, via checkout creation and the verified payment webhook, or the readiness evaluator
 * for a zero fee); PAYMENT_COMPLETED -> DOCUMENT_REVIEW -> VERIFIED -> READY_FOR_EVENT (only the readiness
 * evaluator, modules/readiness, as the system). Not callable yet: REJECTED and CANCELLED (admin / user decisions). Registration status is the workflow position only; payment,
 * document, consent and check-in state live in their own tables and are never folded into it.
 *
 * Conservative choices (open product decisions): REJECTED can only be cancelled (no resubmission yet). Payment
 * retries (a failed, cancelled or expired checkout) do NOT move the registration back: it stays PAYMENT_PENDING while
 * the payments table records each attempt, so no backward edge is needed (Phase 4C).
 * Coach and staff registrations skip payment (PERSONNEL_TRANSITIONS below): once submitted they go straight to document review.
 */
const PLAYER_TRANSITIONS: Readonly<Record<RegistrationStatus, readonly RegistrationStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PAYMENT_PENDING', 'REJECTED', 'CANCELLED'],
  PAYMENT_PENDING: ['PAYMENT_COMPLETED', 'CANCELLED'],
  PAYMENT_COMPLETED: ['DOCUMENT_REVIEW', 'CANCELLED'],
  DOCUMENT_REVIEW: ['VERIFIED', 'REJECTED', 'CANCELLED'],
  VERIFIED: ['READY_FOR_EVENT', 'REJECTED', 'CANCELLED'],
  READY_FOR_EVENT: ['CANCELLED'],
  REJECTED: ['CANCELLED'],
  CANCELLED: [],
};

/**
 * Coach and staff: no payment step (payment is players-only). SUBMITTED moves to DOCUMENT_REVIEW once every required
 * document is submitted; the rest is the player path. VERIFIED (all documents approved by an admin) is the approved state
 * that grants event access; READY_FOR_EVENT additionally needs the coach's AB 506 acknowledgement (modules/readiness).
 */
const PERSONNEL_TRANSITIONS: Readonly<Record<RegistrationStatus, readonly RegistrationStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['DOCUMENT_REVIEW', 'REJECTED', 'CANCELLED'],
  PAYMENT_PENDING: ['CANCELLED'], // never entered by personnel
  PAYMENT_COMPLETED: ['CANCELLED'], // never entered by personnel
  DOCUMENT_REVIEW: ['VERIFIED', 'REJECTED', 'CANCELLED'],
  VERIFIED: ['READY_FOR_EVENT', 'REJECTED', 'CANCELLED'],
  READY_FOR_EVENT: ['CANCELLED'],
  REJECTED: ['CANCELLED'],
  CANCELLED: [],
};

const tableFor = (type: RegistrantType) =>
  type === 'PLAYER' ? PLAYER_TRANSITIONS : PERSONNEL_TRANSITIONS;

export function canTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
  type: RegistrantType = 'PLAYER',
): boolean {
  return tableFor(type)[from].includes(to);
}

/** Throws 409 INVALID_STATUS_TRANSITION. Never silently changes (or ignores) a status. */
export function assertTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
  type: RegistrantType = 'PLAYER',
): void {
  if (!canTransition(from, to, type)) {
    throw AppError.conflict(
      'INVALID_STATUS_TRANSITION',
      `A registration cannot move from ${from} to ${to}`,
    );
  }
}

export function allowedTransitions(
  from: RegistrationStatus,
  type: RegistrantType = 'PLAYER',
): readonly RegistrationStatus[] {
  return tableFor(type)[from];
}
