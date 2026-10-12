import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { syncNotices, tallyOutcomes } from '../src/lib/offline/syncTally.ts';

const rec = (personId) => ({ personId, kind: 'recorded' });
const already = (personId) => ({ personId, kind: 'already' });
const failed = (personId) => ({ personId, kind: 'failed' });

describe('tallyOutcomes: counts people, not queue items', () => {
  it('a double tap (one recorded, one "already checked in") is ONE synced check-in', () => {
    assert.deepEqual(tallyOutcomes([rec('a'), already('a')]), { synced: 1, alreadyRecorded: 0, failed: 0 });
  });

  it('two different people are two', () => {
    assert.deepEqual(tallyOutcomes([rec('a'), rec('b')]), { synced: 2, alreadyRecorded: 0, failed: 0 });
  });

  it('someone another device already checked in is reported as already recorded, not as synced', () => {
    assert.deepEqual(tallyOutcomes([already('a')]), { synced: 0, alreadyRecorded: 1, failed: 0 });
  });

  it('the same item replayed after a lost response counts once', () => {
    assert.deepEqual(tallyOutcomes([rec('a'), rec('a')]), { synced: 1, alreadyRecorded: 0, failed: 0 });
  });

  it('a person recorded in this pass is not also counted as failed or already recorded', () => {
    assert.deepEqual(tallyOutcomes([failed('a'), already('a'), rec('a')]), { synced: 1, alreadyRecorded: 0, failed: 0 });
  });

  it('a refused person is a failure; an empty pass is all zeros', () => {
    assert.deepEqual(tallyOutcomes([failed('a'), rec('b')]), { synced: 1, alreadyRecorded: 0, failed: 1 });
    assert.deepEqual(tallyOutcomes([]), { synced: 0, alreadyRecorded: 0, failed: 0 });
  });
});

describe('syncNotices: what the admin is told', () => {
  const none = { synced: 0, alreadyRecorded: 0, failed: 0, interrupted: false };

  it('says nothing about a pass that did nothing', () => {
    assert.deepEqual(syncNotices(none), []);
  });

  it('reports the real number, with the right singular and plural', () => {
    assert.equal(syncNotices({ ...none, synced: 1 })[0].text, '1 offline check-in successfully synced to Admin');
    assert.equal(syncNotices({ ...none, synced: 3 })[0].text, '3 offline check-ins successfully synced to Admin');
  });

  it('does not claim a check-in was synced when the server already had it', () => {
    const notices = syncNotices({ ...none, alreadyRecorded: 1 });
    assert.equal(notices.length, 1);
    assert.match(notices[0].text, /already checked in/);
    assert.doesNotMatch(notices[0].text, /successfully synced/);
  });

  it('refusals and an unreachable server are errors', () => {
    const notices = syncNotices({ synced: 0, alreadyRecorded: 0, failed: 2, interrupted: true });
    assert.deepEqual(notices.map((n) => n.tone), ['danger', 'danger']);
    assert.match(notices[0].text, /2 check-ins were rejected/);
    assert.match(notices[1].text, /Couldn’t reach Admin/);
  });
});
