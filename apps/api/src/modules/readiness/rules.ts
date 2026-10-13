import type { RegistrantType, RegistrationStatus } from '../registrations/transitions';
import type { Blocker, ReadinessFacts, ReadinessStep } from './types';

/**
 * Pure readiness rules: no database, no clock. They say which existing workflow step comes next given the facts;
 * the evaluator applies it through the transition table. Everything here is unit-tested as a matrix.
 *
 * Meaning of the workflow positions (the registration status only ever moves forward):
 *   SUBMITTED          submitted; payment not yet satisfied
 *   PAYMENT_PENDING    a checkout was started (or the evaluator is passing through for a free registration)
 *   PAYMENT_COMPLETED  payment satisfied (paid, or no payment required)
 *   DOCUMENT_REVIEW    every required document has been submitted (in review or approved)
 *   VERIFIED           every required document is approved
 *   READY_FOR_EVENT    verified AND payment satisfied AND required consent accepted
 * A face profile is never required: players can be checked in manually.
 *
 * Coaches and staff have no payment: from SUBMITTED they go straight to DOCUMENT_REVIEW once every required document is
 * submitted (their payment is always "satisfied"; their fee is fixed at zero), then follow the same steps.
 */
export const documentsSubmitted = (facts: ReadinessFacts): boolean =>
  facts.documents.required.every((d) => d.state === 'IN_REVIEW' || d.state === 'APPROVED');

const paymentReason = (facts: ReadinessFacts) =>
  facts.paymentRequired
    ? 'System: payment already confirmed'
    : 'System: no payment required (fee is zero)';

/** The next workflow step the facts justify from `status`, or null when the registration cannot advance (yet). */
export function nextStep(
  status: RegistrationStatus,
  facts: ReadinessFacts,
  registrantType: RegistrantType = 'PLAYER',
): ReadinessStep | null {
  switch (status) {
    case 'SUBMITTED':
      if (registrantType !== 'PLAYER') {
        return documentsSubmitted(facts)
          ? {
              from: 'SUBMITTED',
              to: 'DOCUMENT_REVIEW',
              reason: 'System: all required documents submitted for review',
            }
          : null;
      }
      return facts.paymentSatisfied
        ? { from: 'SUBMITTED', to: 'PAYMENT_PENDING', reason: paymentReason(facts) }
        : null;
    case 'PAYMENT_PENDING':
      return facts.paymentSatisfied
        ? { from: 'PAYMENT_PENDING', to: 'PAYMENT_COMPLETED', reason: paymentReason(facts) }
        : null;
    case 'PAYMENT_COMPLETED':
      return documentsSubmitted(facts)
        ? {
            from: 'PAYMENT_COMPLETED',
            to: 'DOCUMENT_REVIEW',
            reason: 'System: all required documents submitted for review',
          }
        : null;
    case 'DOCUMENT_REVIEW':
      return facts.documents.allRequiredApproved
        ? {
            from: 'DOCUMENT_REVIEW',
            to: 'VERIFIED',
            reason: 'System: all required documents approved',
          }
        : null;
    case 'VERIFIED':
      // Payment and documents are re-checked here: READY_FOR_EVENT is the one status the event day trusts.
      return facts.paymentSatisfied && facts.documents.allRequiredApproved && facts.consentSatisfied
        ? {
            from: 'VERIFIED',
            to: 'READY_FOR_EVENT',
            reason: 'System: payment, documents and consent complete',
          }
        : null;
    // DRAFT is not submitted; READY_FOR_EVENT is final for the evaluator (it never moves backward);
    // CANCELLED and REJECTED are decisions the evaluator never reverses or makes.
    default:
      return null;
  }
}

/**
 * What still stands between this registration and READY_FOR_EVENT, in the order a family would fix them. For a
 * registration that is already READY_FOR_EVENT this is normally empty; if a requirement later stops being met (say a
 * payment is refunded) it is listed here as a warning, because the evaluator never moves a registration backward.
 */
export function blockersFor(status: RegistrationStatus, facts: ReadinessFacts): Blocker[] {
  if (status === 'CANCELLED') return ['REGISTRATION_CANCELLED'];
  if (status === 'REJECTED') return ['REGISTRATION_REJECTED'];
  const blockers: Blocker[] = [];
  if (status === 'DRAFT') blockers.push('REGISTRATION_NOT_SUBMITTED');
  if (!facts.paymentSatisfied) blockers.push('PAYMENT_NOT_COMPLETED');
  if (!facts.documents.allRequiredApproved) {
    blockers.push(documentsSubmitted(facts) ? 'DOCUMENTS_NOT_APPROVED' : 'DOCUMENTS_NOT_SUBMITTED');
  }
  if (!facts.consentSatisfied) blockers.push('CONSENT_NOT_ACCEPTED');
  return blockers;
}
