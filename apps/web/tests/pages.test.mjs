import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAllPages } from '../src/lib/api/pages.ts';

/** A fake paged API over `n` rows with ids e1..en, newest first, recording which pages were asked for. */
function fakeApi(n, pageSize) {
  const asked = [];
  const rows = Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}` }));
  const fetchPage = async (page) => {
    asked.push(page);
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: n };
  };
  return { asked, fetchPage, rows };
}

describe('loadAllPages: rows with another key', () => {
  it('keeps one of each by the key given, in the order first seen', async () => {
    const pages = [
      { items: [{ registrationId: 'a' }, { registrationId: 'b' }], total: 3 },
      { items: [{ registrationId: 'b' }, { registrationId: 'c' }], total: 3 }
    ];
    const all = await loadAllPages(async (p) => pages[p - 1], 2, (r) => r.registrationId);
    assert.deepEqual(all.map((r) => r.registrationId), ['a', 'b', 'c']);
  });
});

describe('loadAllPages: a picker that needs every row, however many there are', () => {
  it('one request when everything fits on the first page', async () => {
    const api = fakeApi(40, 100);
    const all = await loadAllPages(api.fetchPage, 100);
    assert.equal(all.length, 40);
    assert.deepEqual(api.asked, [1]);
  });

  it('exactly the 100-row boundary is still one request, and 101 rows is two', async () => {
    const a = fakeApi(100, 100);
    assert.equal((await loadAllPages(a.fetchPage, 100)).length, 100);
    assert.deepEqual(a.asked, [1]);
    const b = fakeApi(101, 100);
    const all = await loadAllPages(b.fetchPage, 100);
    assert.equal(all.length, 101);
    assert.deepEqual(b.asked, [1, 2]);
  });

  it('reads past 100: 250 rows come back whole, once each, in order, in three requests', async () => {
    const api = fakeApi(250, 100);
    const all = await loadAllPages(api.fetchPage, 100);
    assert.deepEqual(all.map((r) => r.id), api.rows.map((r) => r.id));
    assert.deepEqual([...api.asked].sort(), [1, 2, 3]);
  });

  it('an empty list is one request and no rows', async () => {
    const api = fakeApi(0, 100);
    assert.deepEqual(await loadAllPages(api.fetchPage, 100), []);
    assert.deepEqual(api.asked, [1]);
  });

  it('keeps a row once when the list shifted while it was being read (no duplicate options)', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: `e${i + 1}` }));
    // A new event was added after page 1 was read, so row e100 now also appears at the top of page 2.
    const fetchPage = async (page) => (page === 1 ? { items: rows.slice(0, 100), total: 150 } : { items: rows.slice(99, 149), total: 150 });
    const all = await loadAllPages(fetchPage, 100);
    assert.equal(new Set(all.map((r) => r.id)).size, all.length);
    assert.equal(all.length, 149);
  });

  it('fails as a whole when a page fails: no half list is handed to a picker', async () => {
    const fetchPage = async (page) => {
      if (page === 2) throw new Error('boom');
      return { items: [{ id: 'e1' }], total: 250 };
    };
    await assert.rejects(() => loadAllPages(fetchPage, 100), /boom/);
  });
});
