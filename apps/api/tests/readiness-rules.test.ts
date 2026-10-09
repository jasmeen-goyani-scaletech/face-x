import { describe, expect, it } from 'vitest';
import { completenessOf } from '../src/modules/documents/completeness';
import {
  consentRequirement,
  consentsSatisfied,
  isConsentRequired,
} from '../src/modules/consents/requirements';
import { blockersFor, documentsSubmitted, nextStep } from '../src/modules/readiness/rules';
import type { ReadinessFacts } from '../src/modules/readiness/types';
import {
  REGISTRATION_STATUSES,
  canTransition,
  type RegistrationStatus,
} from '../src/modules/registrations/transitions';
import { REQUIRED_DOCUMENT_TYPES, type DocumentState } from '../src/modules/documents/types';

/** The readiness rules are pure, so they are tested as a complete matrix over every status and fact combination. */
const docs = (state: DocumentState | DocumentState[] | 'MISSING') =>
  completenessOf(
    REQUIRED_DOCUMENT_TYPES.PLAYER.flatMap((documentType, i) => {
      const s = Array.isArray(state) ? state[i]! : state;
      return s === 'MISSING'
        ? []
        : [{ documentType, state: s as DocumentState, createdAt: '2026-01-01T00:00:00Z' }];
    }),
  );

const facts = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  paymentRequired: true,
  paymentSatisfied: true,
  documents: docs('APPROVED'),
  consentSatisfied: true,
  ...over,
});

describe('nextStep: one forward step at a time, only along the existing workflow', () => {
  it('never moves DRAFT, CANCELLED, REJECTED or READY_FOR_EVENT, however good the facts are', () => {
    for (const status of ['DRAFT', 'CANCELLED', 'REJECTED', 'READY_FOR_EVENT'] as const) {
      expect(nextStep(status, facts()), status).toBeNull();
    }
  });

  it('SUBMITTED / PAYMENT_PENDING advance only when payment is satisfied, with the right reason', () => {
    for (const from of ['SUBMITTED', 'PAYMENT_PENDING'] as const) {
      expect(nextStep(from, facts({ paymentSatisfied: false }))).toBeNull();
      const paid = nextStep(from, facts());
      expect(paid).toMatchObject({ from, reason: 'System: payment already confirmed' });
      const free = nextStep(from, facts({ paymentRequired: false }));
      expect(free).toMatchObject({ from, reason: 'System: no payment required (fee is zero)' });
    }
    expect(nextStep('SUBMITTED', facts())!.to).toBe('PAYMENT_PENDING');
    expect(nextStep('PAYMENT_PENDING', facts())!.to).toBe('PAYMENT_COMPLETED');
  });

  it('PAYMENT_COMPLETED -> DOCUMENT_REVIEW only when every required document is submitted (in review or approved)', () => {
    const blocked: (DocumentState | 'MISSING')[] = [
      'MISSING',
      'AWAITING_UPLOAD',
      'UPLOADED',
      'REJECTED',
    ];
    for (const bad of blocked) {
      const states = ['IN_REVIEW', 'APPROVED', 'IN_REVIEW', bad] as DocumentState[];
      expect(
        nextStep(
          'PAYMENT_COMPLETED',
          facts({ documents: docs(states.map((s, i) => (i === 3 ? bad : s)) as DocumentState[]) }),
        ),
        bad,
      ).toBeNull();
    }
    expect(nextStep('PAYMENT_COMPLETED', facts({ documents: docs('IN_REVIEW') }))).toMatchObject({
      to: 'DOCUMENT_REVIEW',
    });
    expect(
      nextStep(
        'PAYMENT_COMPLETED',
        facts({ documents: docs(['IN_REVIEW', 'APPROVED', 'IN_REVIEW', 'APPROVED']) }),
      ),
    ).toMatchObject({ to: 'DOCUMENT_REVIEW' });
    // an optional document (not in the required list) can never matter: only the four required types are looked at
    expect(documentsSubmitted(facts({ documents: docs('APPROVED') }))).toBe(true);
  });

  it('DOCUMENT_REVIEW -> VERIFIED only when every required document is approved', () => {
    expect(
      nextStep(
        'DOCUMENT_REVIEW',
        facts({ documents: docs(['APPROVED', 'APPROVED', 'APPROVED', 'IN_REVIEW']) }),
      ),
    ).toBeNull();
    expect(
      nextStep(
        'DOCUMENT_REVIEW',
        facts({ documents: docs(['APPROVED', 'APPROVED', 'APPROVED', 'REJECTED']) }),
      ),
    ).toBeNull();
    expect(nextStep('DOCUMENT_REVIEW', facts())).toMatchObject({ to: 'VERIFIED' });
  });

  it('VERIFIED -> READY_FOR_EVENT needs payment AND documents AND consent, each re-checked', () => {
    expect(nextStep('VERIFIED', facts())).toMatchObject({ to: 'READY_FOR_EVENT' });
    expect(nextStep('VERIFIED', facts({ paymentSatisfied: false }))).toBeNull();
    expect(nextStep('VERIFIED', facts({ consentSatisfied: false }))).toBeNull();
    expect(
      nextStep(
        'VERIFIED',
        facts({ documents: docs(['APPROVED', 'APPROVED', 'APPROVED', 'IN_REVIEW']) }),
      ),
    ).toBeNull();
  });

  it('only ever produces the immediate next legal transition (never skips, never goes back, never rejects or cancels)', () => {
    const paymentOptions = [
      { paymentRequired: true, paymentSatisfied: true },
      { paymentRequired: true, paymentSatisfied: false },
      { paymentRequired: false, paymentSatisfied: true },
    ];
    const docOptions = [
      docs('MISSING'),
      docs('UPLOADED'),
      docs('IN_REVIEW'),
      docs('APPROVED'),
      docs(['APPROVED', 'APPROVED', 'APPROVED', 'REJECTED']),
    ];
    const successor: Partial<Record<RegistrationStatus, RegistrationStatus>> = {
      SUBMITTED: 'PAYMENT_PENDING',
      PAYMENT_PENDING: 'PAYMENT_COMPLETED',
      PAYMENT_COMPLETED: 'DOCUMENT_REVIEW',
      DOCUMENT_REVIEW: 'VERIFIED',
      VERIFIED: 'READY_FOR_EVENT',
    };
    let produced = 0;
    for (const status of REGISTRATION_STATUSES) {
      for (const p of paymentOptions)
        for (const documents of docOptions)
          for (const consentSatisfied of [true, false]) {
            const step = nextStep(status, { ...p, documents, consentSatisfied });
            if (!step) continue;
            produced++;
            expect(step.from).toBe(status);
            expect(step.to).toBe(successor[status]);
            expect(canTransition(step.from, step.to), `${step.from} -> ${step.to}`).toBe(true);
            expect(step.reason.startsWith('System: ')).toBe(true);
          }
    }
    expect(produced).toBeGreaterThan(0);
  });

  it('does not depend on a face profile: facts have no such field', () => {
    expect(Object.keys(facts()).sort()).toEqual([
      'consentSatisfied',
      'documents',
      'paymentRequired',
      'paymentSatisfied',
    ]);
  });
});

describe('blockersFor', () => {
  it('lists nothing for a ready registration (unless a requirement regressed) and one terminal reason for cancelled / rejected', () => {
    expect(blockersFor('READY_FOR_EVENT', facts())).toEqual([]);
    // never moved backward, but a requirement that later stops being met is reported as a warning
    expect(blockersFor('READY_FOR_EVENT', facts({ paymentSatisfied: false }))).toEqual([
      'PAYMENT_NOT_COMPLETED',
    ]);
    expect(blockersFor('CANCELLED', facts())).toEqual(['REGISTRATION_CANCELLED']);
    expect(blockersFor('REJECTED', facts())).toEqual(['REGISTRATION_REJECTED']);
  });

  it('lists what is missing, in the order a family would fix it', () => {
    expect(
      blockersFor(
        'DRAFT',
        facts({ paymentSatisfied: false, documents: docs('MISSING'), consentSatisfied: false }),
      ),
    ).toEqual([
      'REGISTRATION_NOT_SUBMITTED',
      'PAYMENT_NOT_COMPLETED',
      'DOCUMENTS_NOT_SUBMITTED',
      'CONSENT_NOT_ACCEPTED',
    ]);
    expect(blockersFor('DOCUMENT_REVIEW', facts({ documents: docs('IN_REVIEW') }))).toEqual([
      'DOCUMENTS_NOT_APPROVED',
    ]);
    expect(
      blockersFor(
        'DOCUMENT_REVIEW',
        facts({ documents: docs(['APPROVED', 'APPROVED', 'APPROVED', 'REJECTED']) }),
      ),
    ).toEqual(['DOCUMENTS_NOT_SUBMITTED']);
    expect(blockersFor('VERIFIED', facts({ consentSatisfied: false }))).toEqual([
      'CONSENT_NOT_ACCEPTED',
    ]);
    expect(blockersFor('VERIFIED', facts())).toEqual([]);
  });
});

describe('consent rule shared with the consent API', () => {
  const v2 = { id: 'consent-v2' };
  it('guardian consent is required for a minor and never for an adult; nothing else is required', () => {
    expect(isConsentRequired('GUARDIAN_CONSENT', true)).toBe(true);
    expect(isConsentRequired('GUARDIAN_CONSENT', false)).toBe(false);
    expect(isConsentRequired('BIOMETRIC_CONSENT', true)).toBe(false); // biometric consent belongs to face enrollment
  });

  it('is accepted only at the CURRENT version, and cannot be met when no wording is published', () => {
    expect(
      consentRequirement('GUARDIAN_CONSENT', true, v2, [{ consentId: 'consent-v2' }]).accepted,
    ).toBe(true);
    expect(
      consentRequirement('GUARDIAN_CONSENT', true, v2, [{ consentId: 'consent-v1' }]).accepted,
    ).toBe(false); // an older version
    expect(
      consentRequirement('GUARDIAN_CONSENT', true, null, [{ consentId: 'consent-v1' }]).accepted,
    ).toBe(false); // nothing published
    expect(consentsSatisfied([consentRequirement('GUARDIAN_CONSENT', true, null, [])])).toBe(false);
    expect(consentsSatisfied([consentRequirement('GUARDIAN_CONSENT', false, null, [])])).toBe(true); // adult: nothing required
    expect(
      consentsSatisfied([
        consentRequirement('GUARDIAN_CONSENT', true, v2, [{ consentId: 'consent-v2' }]),
      ]),
    ).toBe(true);
  });
});
