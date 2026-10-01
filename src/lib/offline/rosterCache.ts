import type { RosterEntry } from '../seed';
import { getOfflineDb, tableForRole, type RosterRecord } from './db';

export const ROSTER_CACHED_EVENT = 'facex:roster-cached';

/** Reads and writes are queued so a search never observes a half-written cache. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}

function toRecord(r: RosterEntry): RosterRecord {
  return { ...r, email: r.email ?? '', fullName: `${r.firstName} ${r.lastName}`.trim() };
}

/** Replaces the cached rosters with a complete copy of `roster`, split by role into players / coaches / staff. */
export function cacheRoster(roster: RosterEntry[]): Promise<void> {
  const db = getOfflineDb();
  if (!db) return Promise.resolve();
  return serial(async () => {
    const records = roster.map(toRecord);
    await db.transaction('rw', db.players, db.coaches, db.staff, async () => {
      await Promise.all([db.players.clear(), db.coaches.clear(), db.staff.clear()]);
      await Promise.all([
        db.players.bulkPut(records.filter((r) => r.role === 'player')),
        db.coaches.bulkPut(records.filter((r) => r.role === 'coach')),
        db.staff.bulkPut(records.filter((r) => r.role === 'staff'))
      ]);
    });
    window.dispatchEvent(new Event(ROSTER_CACHED_EVENT));
  }).catch(() => undefined);
}

/** Optimistic local update: marks the cached record checked in right away, in step with the UI. */
export function markCachedCheckedIn(role: RosterEntry['role'], id: string, patch: Pick<RosterEntry, 'checkedInAt' | 'checkedInMethod' | 'checkedInOverride'>) {
  const db = getOfflineDb();
  if (!db) return Promise.resolve();
  return serial(() => tableForRole(db, role).update(id, patch)).then(() => undefined).catch(() => undefined);
}

const norm = (s: string | undefined) => (s ?? '').toLowerCase();

/**
 * Ids of cached people matching `query` on name, email, id, registration id or team. Empty query matches everyone.
 * Returns null when the cache is empty or unavailable, so callers fall back to the in-memory roster instead of showing "no results".
 *
 * Matching is a substring test (so "smith" finds "John Smith"), which scans the local table rather than using an index;
 * that's still in-memory-fast at roster scale. The indexes serve the exact lookups: role, team and id.
 */
export function searchRosterIds(query: string, role?: RosterEntry['role']): Promise<Set<string> | null> {
  const db = getOfflineDb();
  if (!db) return Promise.resolve(null);
  return serial(async () => {
    const q = norm(query).trim();
    const tables = role ? [tableForRole(db, role)] : [db.players, db.coaches, db.staff];
    const total = (await Promise.all(tables.map((t) => t.count()))).reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const ids = new Set<string>();
    await Promise.all(
      tables.map((t) =>
        t
          .filter((r) => !q || [r.fullName, r.email, r.id, r.schoolId, r.teamName].some((f) => norm(f).includes(q)))
          .each((r) => void ids.add(r.id))
      )
    );
    return ids;
  }).catch(() => null);
}
