import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatFullDateTime, formatWhen } from '../src/lib/format.ts';

// Built from local components so the tests hold in any time zone.
const at = (y, m, d, h, min, s = 0) => new Date(y, m - 1, d, h, min, s).getTime();

describe('formatWhen: the time alone is only for today', () => {
  const now = at(2026, 10, 9, 15, 30);

  it('today shows just the time', () => {
    assert.equal(formatWhen(at(2026, 10, 9, 15, 3), now), '3:03 PM');
  });

  it('an earlier day this year adds the date, so yesterday cannot pass for today', () => {
    assert.equal(formatWhen(at(2026, 10, 8, 16, 41), now), 'Oct 8, 4:41 PM');
  });

  it('another year adds the year too', () => {
    assert.equal(formatWhen(at(2025, 12, 31, 23, 59), now), 'Dec 31, 2025, 11:59 PM');
  });

  it('just after midnight is a new day', () => {
    assert.equal(formatWhen(at(2026, 10, 8, 23, 59), at(2026, 10, 9, 0, 1)), 'Oct 8, 11:59 PM');
  });

  it('no timestamp is a dash', () => {
    assert.equal(formatWhen(null, now), '—');
  });
});

describe('formatFullDateTime', () => {
  it('has the weekday, full date and seconds', () => {
    assert.equal(formatFullDateTime(at(2026, 10, 8, 16, 41, 5)), 'Thu, Oct 8, 2026, 4:41:05 PM');
    assert.equal(formatFullDateTime(null), '—');
  });
});
