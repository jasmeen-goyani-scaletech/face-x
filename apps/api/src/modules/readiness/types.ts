import type { DocumentCompleteness } from '../documents/types';
import type { RegistrationStatus } from '../registrations/transitions';

/** One thing standing between a registration and READY_FOR_EVENT. */
export type Blocker =
  | 'REGISTRATION_NOT_SUBMITTED'
  | 'REGISTRATION_CANCELLED'
  | 'REGISTRATION_REJECTED'
  | 'PAYMENT_NOT_COMPLETED'
  | 'DOCUMENTS_NOT_SUBMITTED'
  | 'DOCUMENTS_NOT_APPROVED'
  | 'CONSENT_NOT_ACCEPTED';

/** A move along the existing registration workflow made by the evaluator. */
export interface ReadinessStep {
  from: RegistrationStatus;
  to: RegistrationStatus;
  /** Why, written into the status history. */
  reason: string;
}

/** The facts readiness is decided from. Each is computed from the payment, document and consent state, never from the status. */
export interface ReadinessFacts {
  /** The registration's fee (fixed at submission) is above zero. */
  paymentRequired: boolean;
  /** A PAID payment exists, or no payment is required. */
  paymentSatisfied: boolean;
  /** Required documents and their state, from the single definition in documents/completeness.ts. */
  documents: DocumentCompleteness;
  /** Every required consent was accepted at its current version. */
  consentSatisfied: boolean;
}

/**
 * Where a registration stands against the readiness requirements. Separate from `status`: it describes
 * payment, documents and consent, none of which is folded into the registration status or changed by reading this.
 */
export interface ReadinessReport {
  registrationId: string;
  status: RegistrationStatus;
  /** status is READY_FOR_EVENT. Does not depend on a face profile: manual check-in must stay possible. */
  ready: boolean;
  blockers: Blocker[];
  payment: { required: boolean; satisfied: boolean };
  documents: DocumentCompleteness & { submitted: boolean };
  consent: {
    satisfied: boolean;
    requirements: { code: string; required: boolean; accepted: boolean }[];
  };
}

export interface EvaluationResult {
  previousStatus: RegistrationStatus;
  steps: ReadinessStep[];
  report: ReadinessReport;
}

/** What documents and consents call after their own change has committed. Never throws. */
export interface ReadinessTrigger {
  afterChange(registrationId: string): Promise<void>;
}
