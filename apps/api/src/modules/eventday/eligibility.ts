import type { Queryable } from '../../infrastructure/database/database';
import { inspectReadinessIn } from '../readiness/repository';
import type { RegistrationStatus } from '../registrations/transitions';

/**
 * Event-day eligibility: may this registration be checked in to this event RIGHT NOW?
 *
 * It re-derives every fact from the current database state and never trusts READY_FOR_EVENT alone: a payment can
 * be refunded, a consent superseded or access switched off after a registration became ready (the readiness
 * evaluator never moves a registration backward). Payment, document and consent facts come from the readiness
 * module's own fact gathering, so there is one definition of each.
 *
 * Provider-independent: a face provider is never consulted here. The face profile only matters for the FACE method.
 *
 * Event window: the data model has no door-open / check-in window (events only have starts_at/ends_at and a
 * DRAFT/PUBLISHED/CLOSED status), and inventing one is a product decision. The only event rule applied is the one
 * registration already uses: the event must be PUBLISHED. See docs/architecture.md ("Event-day check-in").
 *
 * Reason codes are stable, structured and carry no personal information.
 */
export type EligibilityReason =
  | 'REGISTRATION_NOT_FOUND'
  | 'EVENT_NOT_OPEN'
  | 'REGISTRATION_NOT_READY'
  | 'EVENT_ACCESS_DISABLED'
  | 'PAYMENT_NOT_COMPLETED'
  | 'DOCUMENTS_NOT_APPROVED'
  | 'CONSENT_NOT_ACCEPTED'
  | 'FACE_PROFILE_NOT_ACTIVE';

export type CheckInMethod = 'FACE' | 'MANUAL';

export interface EligibilityFacts {
  eventOpen: boolean;
  status: RegistrationStatus;
  accessDisabled: boolean;
  paymentSatisfied: boolean;
  documentsApproved: boolean;
  consentSatisfied: boolean;
  /** Whether the face profile the scan matched is still ACTIVE. Only consulted for FACE. */
  faceProfileActive: boolean;
}

/** Pure rules (unit-tested as a matrix). Lists every failing requirement, in a stable order. */
export function reasonsFor(facts: EligibilityFacts, method: CheckInMethod): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  if (!facts.eventOpen) reasons.push('EVENT_NOT_OPEN');
  if (facts.status !== 'READY_FOR_EVENT') reasons.push('REGISTRATION_NOT_READY');
  if (facts.accessDisabled) reasons.push('EVENT_ACCESS_DISABLED');
  if (!facts.paymentSatisfied) reasons.push('PAYMENT_NOT_COMPLETED');
  if (!facts.documentsApproved) reasons.push('DOCUMENTS_NOT_APPROVED');
  if (!facts.consentSatisfied) reasons.push('CONSENT_NOT_ACCEPTED');
  // A player without a face profile can always be checked in manually.
  if (method === 'FACE' && !facts.faceProfileActive) reasons.push('FACE_PROFILE_NOT_ACTIVE');
  return reasons;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  /** Present when the registration exists for this event (even if not eligible). */
  registration: { id: string; playerId: string | null; staffProfileId: string | null } | null;
}

const NOT_FOUND: EligibilityResult = {
  eligible: false,
  reasons: ['REGISTRATION_NOT_FOUND'],
  registration: null,
};

export interface EligibilityInput {
  eventId: string;
  registrationId: string;
  method: CheckInMethod;
  /** FACE: the profile the scan matched. It must still be ACTIVE and still belong to the player. */
  faceProfileId?: string | null;
}

/**
 * Live eligibility check. With `lock`, the registration row is held FOR SHARE until the caller's transaction ends,
 * so an admin cannot disable access (or anything else that updates the row) between this check and the insert.
 */
export async function checkEligibility(
  q: Queryable,
  input: EligibilityInput,
  options: { lock?: boolean } = {},
): Promise<EligibilityResult> {
  const { rows } = await q.query<{
    id: string;
    player_id: string | null;
    staff_profile_id: string | null;
    registrant_type: string;
    event_access_disabled: boolean;
    event_status: string;
  }>(
    `select r.id, r.player_id, r.staff_profile_id, r.registrant_type, r.event_access_disabled, e.status as event_status
       from public.registrations r
       join public.events e on e.id = r.event_id
      where r.id = $1 and r.event_id = $2 ${options.lock ? 'for share of r' : ''}`,
    [input.registrationId, input.eventId],
  );
  const row = rows[0];
  if (!row) return NOT_FOUND;

  const report = await inspectReadinessIn(q, row.id);
  if (!report) return NOT_FOUND;

  let faceProfileActive = false;
  // A face profile belongs to a player or to a coach/staff member. Without one, a person can still be checked in by hand.
  const personColumn = row.player_id ? 'player_id' : row.staff_profile_id ? 'staff_profile_id' : null;
  if (input.method === 'FACE' && personColumn) {
    // `personColumn` is one of two constants chosen just above, never input.
    const { rows: profile } = await q.query(
      `select 1 from public.face_profiles
        where ${personColumn} = $1 and status = 'ACTIVE' and ($2::uuid is null or id = $2::uuid)
        limit 1`,
      [row.player_id ?? row.staff_profile_id, input.faceProfileId ?? null],
    );
    faceProfileActive = profile.length > 0;
  }

  const reasons = reasonsFor(
    {
      eventOpen: row.event_status === 'PUBLISHED',
      status: report.status,
      accessDisabled: row.event_access_disabled,
      paymentSatisfied: report.payment.satisfied,
      documentsApproved: report.documents.allRequiredApproved,
      consentSatisfied: report.consent.satisfied,
      faceProfileActive,
    },
    input.method,
  );
  return {
    eligible: reasons.length === 0,
    reasons,
    registration: { id: row.id, playerId: row.player_id, staffProfileId: row.staff_profile_id },
  };
}
