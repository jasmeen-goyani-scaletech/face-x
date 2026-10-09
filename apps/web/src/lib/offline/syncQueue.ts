import { checkInManually } from '../api/admin';
import { isApiError } from '../api/errors';
import type { RosterEntry } from '../seed';
import { getOfflineDb, newUuid, type PendingCheckIn } from './db';
import { markCachedCheckedIn } from './rosterCache';

export const SYNC_TAG = 'facex-sync-checkins';
/** Fired after a sync pass that reached the server: screens showing the roster re-read it (it holds every device's check-ins). */
export const SERVER_CHECKINS_EVENT = 'facex:server-checkins';

/** What the server knows about a check-in (kept for the coach-side roster, which still listens for this event). */
export interface ServerCheckIn {
  uuid: string;
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
export async function enqueueCheckIn(
  entry: Pick<RosterEntry, 'id' | 'role' | 'schoolId'>,
  eventId: string,
  method: string,
  override: boolean,
  checkedInAt: number
): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  const item: PendingCheckIn = {
    uuid: newUuid(),
    personId: entry.id,
    eventId,
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
 * Sends every queued check-in to the API, oldest first, one request at a time (each with its own uuid as the request id).
 *  - Accepted (or "already checked in", which means another device or an earlier attempt got there first): the item leaves the queue.
 *  - No connection / 5xx / signed out: stop here and leave it (and everything after it) PENDING for the next attempt, so order is kept.
 *  - Any other refusal (not eligible any more, unknown registration): the server rejected it for good; mark it FAILED and move on.
 * Afterwards, unless the server was unreachable, tells the roster screens to re-read it so every device's check-ins show.
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
    if (!item.eventId) {
      // Queued by an older build that did not record the event: guessing one could check someone into the wrong event.
      await db.pendingCheckIns.update(item.uuid, { status: 'FAILED', lastError: 'No event to check this person in to' });
      result.failed += 1;
      continue;
    }
    await db.pendingCheckIns.update(item.uuid, { status: 'SYNCING' });
    try {
      await checkInManually(item.eventId, item.personId, item.uuid);
      await db.pendingCheckIns.delete(item.uuid);
      result.synced += 1;
    } catch (err) {
      if (isApiError(err) && err.code === 'ALREADY_CHECKED_IN') {
        // Someone (another device, or this one on an earlier attempt) already checked them in: nothing is lost.
        await db.pendingCheckIns.delete(item.uuid);
        result.synced += 1;
      } else if (!isApiError(err) || err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429 || err.status === 401) {
        // No connection, the server is struggling, or the session needs renewing: keep it and try again later.
        await db.pendingCheckIns.update(item.uuid, { status: 'PENDING', attempts: item.attempts + 1, lastError: isApiError(err) ? `Server responded ${err.status || 'no response'}` : 'Network error' });
        result.interrupted = true;
        break;
      } else {
        await db.pendingCheckIns.update(item.uuid, { status: 'FAILED', attempts: item.attempts + 1, lastError: `Rejected: ${err.code}` });
        result.failed += 1;
      }
    }
  }

  result.remaining = await db.pendingCheckIns.where('status').equals('PENDING').count();

  // Reconcile on every pass that reached the server, not just after a push: a device with nothing queued still learns
  // what other devices checked in.
  if (!result.interrupted && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ServerCheckIn[]>(SERVER_CHECKINS_EVENT, { detail: [] }));
  }
  return result;
}

/** Puts FAILED items back in the queue (e.g. an admin tapped "Retry"). */
export async function retryFailed(): Promise<void> {
  const db = getOfflineDb();
  if (db) await db.pendingCheckIns.where('status').equals('FAILED').modify({ status: 'PENDING' });
}
