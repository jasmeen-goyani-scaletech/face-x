import { describe, expect, it } from 'vitest';
import {
  ADULT_AGE,
  ageOn,
  isMinorForEvent,
  localDateInTimeZone,
} from '../src/modules/registrations/rules';
import {
  REGISTRATION_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
} from '../src/modules/registrations/transitions';

describe('registration status transitions', () => {
  it('knows all nine statuses', () => {
    expect([...REGISTRATION_STATUSES]).toEqual([
      'DRAFT',
      'SUBMITTED',
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
      'DOCUMENT_REVIEW',
      'VERIFIED',
      'REJECTED',
      'READY_FOR_EVENT',
      'CANCELLED',
    ]);
  });

  it('allows the planned forward path for a player, step by step', () => {
    const path = [
      'DRAFT',
      'SUBMITTED',
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
      'DOCUMENT_REVIEW',
      'VERIFIED',
      'READY_FOR_EVENT',
    ] as const;
    for (let i = 0; i < path.length - 1; i++)
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('refuses skipping steps, going backwards, and staying put', () => {
    const bad: [string, string][] = [
      ['DRAFT', 'VERIFIED'],
      ['DRAFT', 'READY_FOR_EVENT'],
      ['DRAFT', 'PAYMENT_COMPLETED'],
      ['DRAFT', 'DRAFT'],
      ['SUBMITTED', 'DRAFT'],
      ['SUBMITTED', 'VERIFIED'],
      ['SUBMITTED', 'SUBMITTED'],
      ['PAYMENT_COMPLETED', 'SUBMITTED'],
      ['VERIFIED', 'DOCUMENT_REVIEW'],
      ['READY_FOR_EVENT', 'VERIFIED'],
      ['REJECTED', 'SUBMITTED'],
      ['REJECTED', 'DRAFT'],
    ];
    for (const [from, to] of bad) {
      expect(canTransition(from as never, to as never), `${from} -> ${to}`).toBe(false);
    }
  });

  it('treats CANCELLED as final and lets every other open status be cancelled', () => {
    expect(allowedTransitions('CANCELLED')).toEqual([]);
    for (const s of REGISTRATION_STATUSES) {
      if (s !== 'CANCELLED') expect(canTransition(s, 'CANCELLED')).toBe(true);
      expect(canTransition('CANCELLED', s)).toBe(false);
    }
  });

  it('throws a 409 INVALID_STATUS_TRANSITION instead of silently changing status', () => {
    expect(() => assertTransition('DRAFT', 'VERIFIED')).toThrowError(
      expect.objectContaining({ status: 409, code: 'INVALID_STATUS_TRANSITION' }),
    );
    expect(() => assertTransition('DRAFT', 'SUBMITTED')).not.toThrow();
  });

  it('only DRAFT can be submitted', () => {
    for (const s of REGISTRATION_STATUSES)
      expect(canTransition(s, 'SUBMITTED')).toBe(s === 'DRAFT');
  });
});

describe('age and minor rules', () => {
  it('computes whole years, counting the birthday itself', () => {
    expect(ageOn('2008-11-14', '2026-11-13')).toBe(17);
    expect(ageOn('2008-11-14', '2026-11-14')).toBe(18);
    expect(ageOn('2008-11-14', '2026-12-01')).toBe(18);
    expect(ageOn('2014-03-09', '2026-03-08')).toBe(11);
    expect(ADULT_AGE).toBe(18);
  });

  it("uses the event's own time zone for the local calendar day, not the server's", () => {
    // 03:00 UTC on Nov 15 is still the evening of Nov 14 in Los Angeles.
    const startsAt = new Date('2026-11-15T03:00:00Z');
    expect(localDateInTimeZone(startsAt, 'America/Los_Angeles')).toBe('2026-11-14');
    expect(localDateInTimeZone(startsAt, 'UTC')).toBe('2026-11-15');
    expect(localDateInTimeZone(startsAt, 'Asia/Kolkata')).toBe('2026-11-15');
  });

  it('decides "minor" on the event-local date (a player turning 18 that evening)', () => {
    const startsAt = new Date('2026-11-15T03:00:00Z'); // Nov 14 local in Los Angeles
    expect(isMinorForEvent('2008-11-15', startsAt, 'America/Los_Angeles')).toBe(true); // 17 locally on Nov 14
    expect(isMinorForEvent('2008-11-15', startsAt, 'UTC')).toBe(false); // already 18 on Nov 15 UTC
    expect(isMinorForEvent('2008-11-14', startsAt, 'America/Los_Angeles')).toBe(false); // exactly 18 locally
  });

  it('falls back to UTC for an unknown time zone instead of throwing', () => {
    expect(localDateInTimeZone(new Date('2026-01-01T12:00:00Z'), 'Not/AZone')).toBe('2026-01-01');
  });
});
