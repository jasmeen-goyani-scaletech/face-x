import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';
import { reasonsFor, type EligibilityFacts } from '../src/modules/eventday/eligibility';
import {
  DEFAULT_FACE_SCAN_POLICY,
  decideMatch,
  type FaceScanPolicy,
} from '../src/modules/eventday/matching';
import { classifySearch, checkInBodySchema } from '../src/modules/eventday/schema';

const ready: EligibilityFacts = {
  eventOpen: true,
  status: 'READY_FOR_EVENT',
  accessDisabled: false,
  paymentSatisfied: true,
  documentsApproved: true,
  consentSatisfied: true,
  faceProfileActive: true,
};

describe('eligibility rules (pure)', () => {
  it('a ready registration is eligible by FACE and by MANUAL', () => {
    expect(reasonsFor(ready, 'FACE')).toEqual([]);
    expect(reasonsFor(ready, 'MANUAL')).toEqual([]);
  });

  it.each([
    ['EVENT_NOT_OPEN', { eventOpen: false }],
    ['REGISTRATION_NOT_READY', { status: 'VERIFIED' as const }],
    ['REGISTRATION_NOT_READY', { status: 'CANCELLED' as const }],
    ['EVENT_ACCESS_DISABLED', { accessDisabled: true }],
    ['PAYMENT_NOT_COMPLETED', { paymentSatisfied: false }],
    ['DOCUMENTS_NOT_APPROVED', { documentsApproved: false }],
    ['CONSENT_NOT_ACCEPTED', { consentSatisfied: false }],
  ] as const)('%s blocks both methods', (reason, change) => {
    expect(reasonsFor({ ...ready, ...change }, 'FACE')).toContain(reason);
    expect(reasonsFor({ ...ready, ...change }, 'MANUAL')).toContain(reason);
  });

  it('READY_FOR_EVENT alone is not enough: every requirement is re-checked', () => {
    const all = reasonsFor(
      {
        ...ready,
        paymentSatisfied: false,
        documentsApproved: false,
        consentSatisfied: false,
        accessDisabled: true,
      },
      'MANUAL',
    );
    expect(all).toEqual([
      'EVENT_ACCESS_DISABLED',
      'PAYMENT_NOT_COMPLETED',
      'DOCUMENTS_NOT_APPROVED',
      'CONSENT_NOT_ACCEPTED',
    ]);
  });

  it('a face profile is required only for FACE', () => {
    const noProfile = { ...ready, faceProfileActive: false };
    expect(reasonsFor(noProfile, 'FACE')).toEqual(['FACE_PROFILE_NOT_ACTIVE']);
    expect(reasonsFor(noProfile, 'MANUAL')).toEqual([]);
  });
});

describe('match decision (pure)', () => {
  const policy: FaceScanPolicy = {
    matchThreshold: 0.9,
    reviewThreshold: 0.75,
    ambiguityMargin: 0.05,
    timeoutMs: 1000,
  };
  const c = (id: string, similarity: number) => ({ registrationId: id, similarity });

  it('no candidates, or only weak ones: NO_MATCH', () => {
    expect(decideMatch([], policy)).toEqual({ kind: 'NO_MATCH' });
    expect(decideMatch([c('a', 0.74), c('b', 0.2)], policy)).toEqual({ kind: 'NO_MATCH' });
  });

  it('one clear leader at or above the threshold is a candidate for MATCH', () => {
    expect(decideMatch([c('a', 0.95), c('b', 0.3)], policy)).toEqual({
      kind: 'CANDIDATE',
      top: c('a', 0.95),
    });
    expect(decideMatch([c('a', 0.9)], policy).kind).toBe('CANDIDATE'); // the threshold itself matches
  });

  it('the review band needs a person (never an automatic match)', () => {
    for (const s of [0.75, 0.8, 0.8999]) {
      const d = decideMatch([c('a', s)], policy);
      expect(d).toMatchObject({ kind: 'REVIEW_REQUIRED', reason: 'LOW_CONFIDENCE' });
    }
  });

  it('several strong candidates need a person', () => {
    expect(decideMatch([c('a', 0.99), c('b', 0.93)], policy)).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      reason: 'MULTIPLE_STRONG_CANDIDATES',
    });
  });

  it('a leader that does not stand out from the runner-up is ambiguous, even if the runner-up is weak', () => {
    expect(decideMatch([c('a', 0.92), c('b', 0.88)], policy)).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      reason: 'AMBIGUOUS_MATCH',
    });
    // The margin is exact at its boundary (0.95 - 0.90 is 0.0499999... in floating point).
    const tight: FaceScanPolicy = { ...policy, matchThreshold: 0.95, reviewThreshold: 0.9 };
    expect(decideMatch([c('a', 0.95), c('b', 0.9)], tight).kind).toBe('CANDIDATE');
    expect(decideMatch([c('a', 0.95), c('b', 0.91)], tight).kind).toBe('REVIEW_REQUIRED');
  });

  it('names at most three people for review', () => {
    const d = decideMatch([c('a', 0.8), c('b', 0.79), c('c', 0.78), c('d', 0.77)], policy);
    expect(d.kind === 'REVIEW_REQUIRED' && d.candidates).toHaveLength(3);
  });

  it('never trusts an impossible score, and counts a person once', () => {
    expect(decideMatch([c('a', 1.5), c('b', Number.NaN), c('c', -1)], policy).kind).toBe(
      'NO_MATCH',
    );
    expect(decideMatch([c('a', 0.96), c('a', 0.5)], policy)).toMatchObject({ kind: 'CANDIDATE' });
  });

  it('has a provisional default policy that is internally consistent', () => {
    expect(DEFAULT_FACE_SCAN_POLICY.reviewThreshold).toBeLessThan(
      DEFAULT_FACE_SCAN_POLICY.matchThreshold,
    );
  });
});

describe('check-in body and search term', () => {
  const id = '3f2b9c1e-6f0a-4c8e-9a53-2f1d0b6d7a11';
  it('FACE names only the scan; MANUAL only the registration; nothing else is accepted', () => {
    expect(
      checkInBodySchema.safeParse({ method: 'FACE', scanId: id, clientRequestId: id }).success,
    ).toBe(true);
    expect(
      checkInBodySchema.safeParse({ method: 'MANUAL', registrationId: id, clientRequestId: id })
        .success,
    ).toBe(true);
    for (const bad of [
      { method: 'FACE', scanId: id, clientRequestId: id, playerId: id },
      { method: 'FACE', registrationId: id, clientRequestId: id },
      { method: 'MANUAL', scanId: id, clientRequestId: id },
      { method: 'FACE', scanId: id },
      { method: 'OVERRIDE', registrationId: id, clientRequestId: id },
      { method: 'FACE', scanId: 'not-a-uuid', clientRequestId: id },
    ]) {
      expect(checkInBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('classifies identifiers as exact and everything else as a name/school-id prefix', () => {
    expect(classifySearch('2014-03-09')).toEqual({ kind: 'DATE_OF_BIRTH', value: '2014-03-09' });
    expect(classifySearch('fx-2026-00042')).toEqual({
      kind: 'REGISTRATION_NUMBER',
      value: 'FX-2026-00042',
    });
    expect(classifySearch('2014-13-45').kind).toBe('TEXT'); // not a real date: never reaches a date cast
    expect(classifySearch('mateo riv').kind).toBe('TEXT');
  });
});

describe('face scan environment settings', () => {
  const base = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/facex',
    JWT_SECRET: 'a'.repeat(40),
    REFRESH_TOKEN_SECRET: 'b'.repeat(40),
    FRONTEND_URL: 'http://localhost:3000',
  };

  it('has provisional defaults, and an empty value means "default"', () => {
    const env = parseEnv({ ...base, FACE_MATCH_THRESHOLD: '', FACE_SCAN_TIMEOUT_MS: '' });
    expect(env).toMatchObject({
      FACE_MATCH_THRESHOLD: 0.9,
      FACE_REVIEW_THRESHOLD: 0.75,
      FACE_AMBIGUITY_MARGIN: 0.05,
      FACE_SCAN_TIMEOUT_MS: 5000,
    });
  });

  it('accepts configured values', () => {
    expect(
      parseEnv({
        ...base,
        FACE_MATCH_THRESHOLD: '0.97',
        FACE_REVIEW_THRESHOLD: '0.85',
        FACE_AMBIGUITY_MARGIN: '0.1',
        FACE_SCAN_TIMEOUT_MS: '2500',
      }),
    ).toMatchObject({
      FACE_MATCH_THRESHOLD: 0.97,
      FACE_REVIEW_THRESHOLD: 0.85,
      FACE_AMBIGUITY_MARGIN: 0.1,
      FACE_SCAN_TIMEOUT_MS: 2500,
    });
  });

  it('rejects out-of-range values and a review threshold above the match threshold', () => {
    for (const bad of [
      { FACE_MATCH_THRESHOLD: '1.5' },
      { FACE_REVIEW_THRESHOLD: '-0.1' },
      { FACE_AMBIGUITY_MARGIN: 'lots' },
      { FACE_SCAN_TIMEOUT_MS: '10' },
      { FACE_MATCH_THRESHOLD: '0.7', FACE_REVIEW_THRESHOLD: '0.8' },
      { FACE_REVIEW_THRESHOLD: '0.95' }, // above the default match threshold
    ]) {
      expect(() => parseEnv({ ...base, ...bad })).toThrow();
    }
  });
});
