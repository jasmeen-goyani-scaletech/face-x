import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROSTER_MAX_AGE_MS, isTransientStatus, isUsableRosterMeta, ownedBy, retryDelayMs } from '../src/lib/offline/policy.ts';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const meta = (over = {}) => ({ eventId: 'e1', ownerId: 'u1', fetchedAt: NOW - 60_000, count: 120, ...over });
const want = { eventId: 'e1', ownerId: 'u1' };

describe('isUsableRosterMeta: a cached roster is used only for the same admin, the same event, and while recent', () => {
  it('accepts a recent roster of this admin and event', () => {
    assert.equal(isUsableRosterMeta(meta(), want, NOW), true);
  });
  it("refuses another event's roster (stale data from one event is never used for another)", () => {
    assert.equal(isUsableRosterMeta(meta({ eventId: 'e2' }), want, NOW), false);
  });
  it("refuses another admin account's roster (account switching)", () => {
    assert.equal(isUsableRosterMeta(meta({ ownerId: 'u2' }), want, NOW), false);
  });
  it('refuses a roster older than the retention limit, accepts one just inside it', () => {
    assert.equal(isUsableRosterMeta(meta({ fetchedAt: NOW - ROSTER_MAX_AGE_MS - 1 }), want, NOW), false);
    assert.equal(isUsableRosterMeta(meta({ fetchedAt: NOW - ROSTER_MAX_AGE_MS + 1000 }), want, NOW), true);
  });
  it('refuses a stamp from the future (a clock set wrong must not make an old copy look fresh)', () => {
    assert.equal(isUsableRosterMeta(meta({ fetchedAt: NOW + 3_600_000 }), want, NOW), false);
  });
  it('refuses missing or malformed stamps instead of throwing', () => {
    for (const bad of [undefined, null, 5, 'x', {}, meta({ fetchedAt: 'yesterday' }), meta({ count: undefined }), meta({ eventId: 7 }), meta({ fetchedAt: NaN })]) {
      assert.equal(isUsableRosterMeta(bad, want, NOW), false);
    }
  });
});

describe('retryDelayMs: controlled retries with backoff', () => {
  const mid = () => 0.5; // no jitter
  it('doubles from 2 s and stops growing at a minute', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map((n) => retryDelayMs(n, mid)), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });
  it('spreads devices out: stays within 20% of the base either way', () => {
    assert.equal(retryDelayMs(3, () => 0), 6400);
    assert.equal(retryDelayMs(3, () => 0.999999), 9600);
    for (let i = 0; i < 200; i++) {
      const d = retryDelayMs(4);
      assert.ok(d >= 12800 && d <= 19200, String(d));
    }
  });
  it('treats 0 or a bad count as the first failure', () => {
    assert.equal(retryDelayMs(0, mid), 2000);
    assert.equal(retryDelayMs(-3, mid), 2000);
  });
});

describe('ownedBy: a check-in is sent only by the admin who made it', () => {
  it('own items are sent, another admin\'s are not', () => {
    assert.equal(ownedBy({ ownerId: 'u1' }, 'u1'), true);
    assert.equal(ownedBy({ ownerId: 'u1' }, 'u2'), false);
  });
  it('an item from an older build (no owner) is not stranded', () => {
    assert.equal(ownedBy({}, 'u2'), true);
  });
});

describe('isTransientStatus: which failures are retried and which are final', () => {
  it('no connection, timeouts, rate limits and server errors are retried', () => {
    for (const s of [0, 408, 429, 500, 502, 503, 504]) assert.equal(isTransientStatus(s), true, String(s));
  });
  it('a refusal (not eligible, unknown registration, forbidden, conflict) is final', () => {
    for (const s of [400, 403, 404, 409, 422]) assert.equal(isTransientStatus(s), false, String(s));
  });
});

import { mergePending } from '../src/lib/offline/policy.ts';

describe('mergePending: the server is the truth, but an unsent check-in is not silently undone', () => {
  const person = (id, over = {}) => ({ id, checkedInAt: null, checkedInMethod: null, checkedInOverride: false, ...over });
  const local = (personId, at = 5000) => ({ personId, checkedInAt: at, method: 'Manual', override: false });

  it('a person this device checked in, not yet on the server, stays checked in on screen', () => {
    const out = mergePending([person('a'), person('b')], [local('a')]);
    assert.equal(out[0].checkedInAt, 5000);
    assert.equal(out[0].checkedInMethod, 'Manual');
    assert.equal(out[1].checkedInAt, null);
  });
  it("someone the server already shows as checked in keeps the SERVER's time and method (another device won)", () => {
    const server = person('a', { checkedInAt: 1000, checkedInMethod: 'Face Scan' });
    const out = mergePending([server], [local('a', 9000)]);
    assert.equal(out[0].checkedInAt, 1000);
    assert.equal(out[0].checkedInMethod, 'Face Scan');
  });
  it('does not touch anyone else, does not mutate its input, and returns the same list when nothing is pending', () => {
    const roster = [person('a'), person('b')];
    assert.equal(mergePending(roster, []), roster);
    const out = mergePending(roster, [local('b')]);
    assert.equal(roster[1].checkedInAt, null);
    assert.equal(out[0], roster[0]);
  });
  it('ignores pending items for people who are not on the roster', () => {
    assert.deepEqual(mergePending([person('a')], [local('zzz')]), [person('a')]);
  });
});

import { describeRefusal } from '../src/lib/offline/policy.ts';

describe('describeRefusal: the admin is told what to put right', () => {
  it('turns the server\'s reason codes into sentences', () => {
    assert.equal(describeRefusal('This player cannot be checked in', [{ path: 'reason', message: 'EVENT_ACCESS_DISABLED' }]), 'Event-day access was switched off for this person.');
  });
  it('lists several reasons together', () => {
    const text = describeRefusal('x', [{ path: 'reason', message: 'PAYMENT_NOT_COMPLETED' }, { path: 'reason', message: 'DOCUMENTS_NOT_APPROVED' }]);
    assert.match(text, /Payment is not complete\./);
    assert.match(text, /Documents are not all approved\./);
  });
  it('keeps an unknown reason code rather than hiding it, and falls back to the server\'s message when there are none', () => {
    assert.equal(describeRefusal('m', [{ path: 'reason', message: 'SOMETHING_NEW' }]), 'SOMETHING_NEW');
    assert.equal(describeRefusal('This player cannot be checked in'), 'This player cannot be checked in');
    assert.equal(describeRefusal('m', [{ path: 'name', message: 'is required' }]), 'm');
  });
});
