import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeScanProblem, resolveScan } from '../src/lib/faceScan.ts';

const person = (id, over = {}) => ({ id, firstName: id.toUpperCase(), lastName: 'Player', role: 'player', checkedInAt: null, approved: true, flags: [], ...over });
const roster = [person('a'), person('b'), person('blocked', { approved: false }), person('in', { checkedInAt: 1 })];
const clear = (e) => e.approved && !e.checkedInAt && e.flags.length === 0;

const match = (id, over = {}) => ({
  scanId: 's1',
  result: 'MATCH',
  expiresAt: '2026-11-14T10:00:00.000Z',
  registration: { registrationId: id, registrationNumber: 'FX-1', firstName: id, lastName: 'x' },
  alreadyCheckedIn: false,
  ...over
});
const review = (ids, over = {}) => ({
  scanId: 's2',
  result: 'REVIEW_REQUIRED',
  reason: 'AMBIGUOUS',
  candidates: ids.map((i) => ({ registrationId: i, registrationNumber: 'FX', displayName: `${i} P.` })),
  ...over
});

describe('resolveScan: only a clear match of someone cleared to enter is checked in without a person deciding', () => {
  it('a clear match of a cleared person is checked in, with the scan as proof', () => {
    const o = resolveScan(match('a'), roster, clear);
    assert.equal(o.kind, 'checkin');
    assert.equal(o.entry.id, 'a');
    assert.equal(o.scanId, 's1');
  });

  it('a clear match of someone who is blocked goes to staff, not to check-in', () => {
    const o = resolveScan(match('blocked'), roster, clear);
    assert.equal(o.kind, 'review');
    assert.equal(o.entry.id, 'blocked');
  });

  it('a match of someone already in goes to staff (the server may say so too)', () => {
    assert.equal(resolveScan(match('in'), roster, clear).kind, 'review');
    assert.equal(resolveScan(match('a', { alreadyCheckedIn: true }), roster, clear).kind, 'review');
  });

  it('a doubtful scan with one candidate is shown to staff; with several, their names are listed', () => {
    const one = resolveScan(review(['b']), roster, clear);
    assert.equal(one.kind, 'review');
    assert.equal(one.entry.id, 'b');
    const many = resolveScan(review(['a', 'b']), roster, clear);
    assert.equal(many.kind, 'several');
    assert.deepEqual(many.names, ['A Player', 'B Player']);
  });

  it('candidates this device does not have are still reported, by the names the server gave', () => {
    const o = resolveScan(review(['x', 'y']), roster, clear);
    assert.equal(o.kind, 'several');
    assert.deepEqual(o.names, ['x P.', 'y P.']);
    assert.equal(resolveScan(review(['x']), roster, clear).kind, 'unknown');
    assert.equal(resolveScan(review([]), roster, clear).kind, 'nomatch');
  });

  it('no match is no match; a match this device has no one for says the list is out of date', () => {
    assert.equal(resolveScan({ scanId: 's3', result: 'NO_MATCH' }, roster, clear).kind, 'nomatch');
    assert.equal(resolveScan(match('zzz'), roster, clear).kind, 'unknown');
  });

  it('never checks in without asking the rule: a person the rule refuses is reviewed even on a clear match', () => {
    assert.equal(resolveScan(match('a'), roster, () => false).kind, 'review');
  });
});

describe('describeScanProblem: what the door is told when a scan could not be made', () => {
  const apiError = (code, status) => Object.assign(new Error(code), { name: 'ApiError', code, status });

  it('face matching not set up on the server is its own state', () => {
    assert.equal(describeScanProblem(apiError('FACE_NOT_CONFIGURED', 503)).kind, 'unavailable');
  });

  it('a photo problem asks for another photo, and says what to fix', () => {
    for (const [code, word] of [
      ['FACE_NOT_DETECTED', /No face/],
      ['FACE_MULTIPLE', /one person/i],
      ['FACE_LOW_QUALITY', /closer/]
    ]) {
      const p = describeScanProblem(apiError(code, 422));
      assert.equal(p.kind, 'retry');
      assert.match(p.text, word);
    }
  });

  it('no connection, a timeout or a struggling server says the server cannot be reached, and points to Manual Search', () => {
    for (const status of [0, 408, 500, 503]) {
      const p = describeScanProblem(apiError('SOMETHING', status));
      assert.equal(p.kind, 'offline');
      assert.match(p.text, /Manual Search/);
    }
    assert.equal(describeScanProblem(apiError('FACE_PROVIDER_TIMEOUT', 503)).kind, 'offline');
  });

  it('rate limiting asks to wait; anything else is a plain failure that never claims a result', () => {
    assert.equal(describeScanProblem(apiError('RATE_LIMITED', 429)).kind, 'busy');
    assert.equal(describeScanProblem(apiError('FORBIDDEN', 403)).kind, 'other');
    assert.equal(describeScanProblem(new Error('boom')).kind, 'other');
    assert.equal(describeScanProblem(null).kind, 'other');
  });
});
