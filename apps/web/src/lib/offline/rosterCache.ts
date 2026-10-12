import type { ApiAdminEvent } from '../api/types';
import type { RosterEntry } from '../seed';
import { getOfflineDb, tableForRole, type RosterRecord } from './db';
import { isUsableRosterMeta, type RosterMeta, type RosterScope } from './policy';

const META_KEY = 'roster';

/** What the device remembers about its roster copy: whose, for which event, when, and the events the admin could choose from. */
interface StoredRosterMeta extends RosterMeta {
  event: ApiAdminEvent;
  events: ApiAdminEvent[];
}

/**
 * Bumped every time the copy is wiped (sign-out, another admin signing in). A roster read that was already on its way when that
 * happened must not save itself afterwards, or the people's details would be back on the device right after being removed.
 */
let wipes = 0;
export const rosterCacheEpoch = (): number => wipes;

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

/**
 * Replaces the cached rosters with a complete copy of `roster`, split by role into players / coaches / staff, and stamps it with
 * whose it is (`scope`), when it was read, and the events the admin could choose from, in the same transaction: a copy is never
 * stored without its stamp, and never mixed with another event's.
 */
export function cacheRoster(roster: RosterEntry[], scope: RosterScope & { event: ApiAdminEvent; events: ApiAdminEvent[]; epoch: number }): Promise<void> {
  const db = getOfflineDb();
  if (!db) return Promise.resolve();
  return serial(async () => {
    if (scope.epoch !== wipes) return; // wiped since this read began: its details are not kept
    const records = roster.map(toRecord);
    const meta: StoredRosterMeta = { eventId: scope.eventId, ownerId: scope.ownerId, fetchedAt: Date.now(), count: records.length, event: scope.event, events: scope.events };
    await db.transaction('rw', db.players, db.coaches, db.staff, db.meta, async () => {
      await Promise.all([db.players.clear(), db.coaches.clear(), db.staff.clear(), db.meta.delete(META_KEY)]);
      await Promise.all([
        db.players.bulkPut(records.filter((r) => r.role === 'player')),
        db.coaches.bulkPut(records.filter((r) => r.role === 'coach')),
        db.staff.bulkPut(records.filter((r) => r.role === 'staff'))
      ]);
      await db.meta.put({ key: META_KEY, value: meta });
    });
  }).catch(() => undefined);
}

const byName = (a: RosterEntry, b: RosterEntry) =>
  a.lastName.toLowerCase().localeCompare(b.lastName.toLowerCase()) || a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase()) || a.schoolId.localeCompare(b.schoolId);

const isRecord = (r: unknown): r is RosterRecord =>
  !!r && typeof r === 'object' && typeof (r as RosterRecord).id === 'string' && typeof (r as RosterRecord).firstName === 'string' && typeof (r as RosterRecord).lastName === 'string' && typeof (r as RosterRecord).schoolId === 'string';

/**
 * The roster this device holds for exactly this admin and event, with when it was read; null when there is none, it belongs to
 * someone else or another event, it is too old, or what is stored is damaged (a roster is never half-trusted).
 */
export function readCachedRoster(scope: RosterScope, now: number = Date.now()): Promise<{ roster: RosterEntry[]; fetchedAt: number; event: ApiAdminEvent; events: ApiAdminEvent[] } | null> {
  const db = getOfflineDb();
  if (!db) return Promise.resolve(null);
  return serial(async () => {
    const stored = (await db.meta.get(META_KEY))?.value as StoredRosterMeta | undefined;
    if (!isUsableRosterMeta(stored, scope, now) || !stored.event) return null;
    const rows = (await Promise.all([db.players.toArray(), db.coaches.toArray(), db.staff.toArray()])).flat();
    if (rows.length !== stored.count || !rows.every(isRecord)) return null;
    const roster = rows.map(({ fullName: _fullName, ...entry }) => entry as RosterEntry).sort(byName);
    return { roster, fetchedAt: stored.fetchedAt, event: stored.event, events: Array.isArray(stored.events) ? stored.events : [stored.event] };
  }).catch(() => null);
}

/** The events this admin could choose between when the roster was last read, for opening the screen with no connection. */
export function readCachedEvents(ownerId: string, now: number = Date.now()): Promise<ApiAdminEvent[] | null> {
  const db = getOfflineDb();
  if (!db) return Promise.resolve(null);
  return serial(async () => {
    const stored = (await db.meta.get(META_KEY))?.value as StoredRosterMeta | undefined;
    if (!stored || typeof stored.eventId !== 'string' || !isUsableRosterMeta(stored, { eventId: stored.eventId, ownerId }, now)) return null;
    return Array.isArray(stored.events) && stored.events.length > 0 ? stored.events : null;
  }).catch(() => null);
}

/**
 * Forgets the roster copy (people's details) and its stamp. NOT the queue of check-ins still waiting to be sent: those are
 * never thrown away here. Called on sign-out and when a different admin signs in.
 */
export function clearRosterCache(): Promise<void> {
  wipes += 1;
  const db = getOfflineDb();
  if (!db) return Promise.resolve();
  return serial(() => db.transaction('rw', db.players, db.coaches, db.staff, db.meta, async () => {
    await Promise.all([db.players.clear(), db.coaches.clear(), db.staff.clear(), db.meta.delete(META_KEY)]);
  }))
    .then(() => undefined)
    .catch(() => undefined);
}

/** Optimistic local update: marks the cached record checked in right away, in step with the UI. */
export function markCachedCheckedIn(role: RosterEntry['role'], id: string, patch: Pick<RosterEntry, 'checkedInAt' | 'checkedInMethod' | 'checkedInOverride'>) {
  const db = getOfflineDb();
  if (!db) return Promise.resolve();
  return serial(() => tableForRole(db, role).update(id, patch)).then(() => undefined).catch(() => undefined);
}
