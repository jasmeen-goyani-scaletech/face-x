import type { RosterEntry } from '../seed';
import { getOfflineDb, newUuid, tableForRole, type PendingCheckIn } from './db';
import { markCachedCheckedIn } from './rosterCache';

export const SYNC_ENDPOINT = '/api/admin/sync-checkins';
export const SYNC_TAG = 'facex-sync-checkins';
export const SERVER_CHECKINS_EVENT = 'facex:server-checkins';

/** What the server knows about a check-in, as returned by GET. */
export interface ServerCheckIn {
  uuid: string;
  /** Registration ID, stable across devices (a roster row's own id is random per browser). */
  schoolId: string;
  role: RosterEntry['role'];
  method: string;
  override: boolean;
  checkedInAt: number;
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
  /** True when we stopped early because the network or server wasn't reachable. */
  interrupted: boolean;
}

/**
 * Records a check-in made on this device: updates the cached roster record immediately (the roster UI is updated by the
 * caller) and appends it to the pending queue. Resolves once both are stored; never throws.
 */
export async function enqueueCheckIn(entry: Pick<RosterEntry, 'id' | 'role' | 'schoolId'>, method: string, override: boolean, checkedInAt: number): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  const item: PendingCheckIn = {
    uuid: newUuid(),
    personId: entry.id,
    schoolId: entry.schoolId,
    role: entry.role,
    method,
    override,
    checkedInAt,
    status: 'PENDING',
    attempts: 0,
    createdAt: Date.now()
  };
  try {
    await Promise.all([
      db.pendingCheckIns.add(item),
      markCachedCheckedIn(entry.role, entry.id, { checkedInAt, checkedInMethod: method, checkedInOverride: override })
    ]);
    requestBackgroundSync();
  } catch {
    // Storage full or blocked: the check-in is still in the roster UI; it just won't be queued for the server.
  }
}

/** Asks the browser to wake the service worker when connectivity returns. A no-op where Background Sync isn't supported. */
export function requestBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register(SYNC_TAG))
    .catch(() => undefined);
}

let running: Promise<SyncResult> | null = null;

/**
 * Sends every queued check-in to the Admin API, oldest first, one request at a time.
 *  - 200: the item leaves the queue.
 *  - Network error / 5xx: stop here and leave it (and everything after it) PENDING for the next attempt, so order is kept.
 *  - Other 4xx: the server rejected it for good; mark it FAILED and move on instead of retrying forever.
 * Afterwards, unless the server was unreachable, re-fetches its check-ins and broadcasts them so the roster can reconcile.
 * Concurrent calls (and other tabs, via Web Locks) share one run.
 */
export function processQueue(): Promise<SyncResult> {
  if (running) return running;
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  const run = (async (): Promise<SyncResult> => (locks ? await locks.request('facex-sync-queue', () => runQueue()) : await runQueue()))();
  running = run.finally(() => {
    running = null;
  });
  return running;
}

async function runQueue(): Promise<SyncResult> {
  const db = getOfflineDb();
  const result: SyncResult = { synced: 0, failed: 0, remaining: 0, interrupted: false };
  if (!db) return result;

  // An item left SYNCING means a previous run died mid-request; the server dedupes by uuid, so it is safe to resend.
  await db.pendingCheckIns.where('status').equals('SYNCING').modify({ status: 'PENDING' });

  const queue = (await db.pendingCheckIns.where('status').equals('PENDING').sortBy('createdAt')) as PendingCheckIn[];

  for (const item of queue) {
    // Items queued before schoolId existed: recover it from the cached roster row, or give up on them rather than guess.
    const schoolId = item.schoolId || (await tableForRole(db, item.role).get(item.personId))?.schoolId;
    if (!schoolId) {
      await db.pendingCheckIns.update(item.uuid, { status: 'FAILED', lastError: 'No registration ID to identify this person' });
      result.failed += 1;
      continue;
    }
    await db.pendingCheckIns.update(item.uuid, { status: 'SYNCING', schoolId });
    let res: Response;
    try {
      res = await fetch(SYNC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: item.uuid, schoolId, role: item.role, method: item.method, override: item.override, checkedInAt: item.checkedInAt })
      });
    } catch (err) {
      await db.pendingCheckIns.update(item.uuid, { status: 'PENDING', attempts: item.attempts + 1, lastError: err instanceof Error ? err.message : 'Network error' });
      result.interrupted = true;
      break;
    }

    if (res.ok) {
      await db.pendingCheckIns.delete(item.uuid);
      result.synced += 1;
    } else if (res.status >= 500 || res.status === 408 || res.status === 429) {
      await db.pendingCheckIns.update(item.uuid, { status: 'PENDING', attempts: item.attempts + 1, lastError: `Server responded ${res.status}` });
      result.interrupted = true;
      break;
    } else {
      await db.pendingCheckIns.update(item.uuid, { status: 'FAILED', attempts: item.attempts + 1, lastError: `Rejected (${res.status})` });
      result.failed += 1;
    }
  }

  result.remaining = await db.pendingCheckIns.where('status').equals('PENDING').count();

  // Reconcile on every pass that reached the server, not just after a push: a device with nothing queued still learns
  // what other devices checked in.
  if (!result.interrupted) {
    try {
      const res = await fetch(SYNC_ENDPOINT, { cache: 'no-store' });
      if (res.ok) {
        const { checkIns } = (await res.json()) as { checkIns: ServerCheckIn[] };
        window.dispatchEvent(new CustomEvent<ServerCheckIn[]>(SERVER_CHECKINS_EVENT, { detail: checkIns }));
      }
    } catch {
      // The sync itself succeeded; reconciling with the server's view can wait for the next one.
    }
  }
  return result;
}

/** Puts FAILED items back in the queue (e.g. an admin tapped "Retry"). */
export async function retryFailed(): Promise<void> {
  const db = getOfflineDb();
  if (db) await db.pendingCheckIns.where('status').equals('FAILED').modify({ status: 'PENDING' });
}
