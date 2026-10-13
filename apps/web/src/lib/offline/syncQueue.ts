import { checkInManually } from '../api/admin';
import { isApiError } from '../api/errors';
import { getSessionUser } from '../api/session';
import type { RosterEntry } from '../seed';
import { getOfflineDb, newUuid, type PendingCheckIn } from './db';
import { getDeviceId } from './deviceId';
import { describeRefusal, isTransientStatus, ownedBy, type LocalCheckIn } from './policy';
import { markCachedCheckedIn } from './rosterCache';
import { tallyOutcomes, type ItemOutcome } from './syncTally';

export const SYNC_TAG = 'facex-sync-checkins';
/** Fired after a sync pass that reached the server: screens showing the roster re-read it (it holds every device's check-ins). */
export const SERVER_CHECKINS_EVENT = 'facex:server-checkins';

/** What a pass tells the screens: whether it SENT any check-ins (so the server may have settled a conflict with another device). */
export interface ServerCheckInsDetail {
  sent: boolean;
}
/** Fired when the in-memory fallback queue changes (detail: how many items it holds), so the sync engine can react. */
export const MEMORY_QUEUE_EVENT = 'facex:memory-queue';

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
  /** People this device got recorded by the server in this pass (unique people, not queue items). */
  synced: number;
  /** People the server already had checked in, which this pass did not record itself. */
  alreadyRecorded: number;
  failed: number;
  remaining: number;
  /** True when we stopped early because the network or server wasn't reachable. */
  interrupted: boolean;
  /** True when the server said the session is over (the queue is kept; it is sent after signing in again). */
  authExpired: boolean;
  /** Check-ins waiting on this device that another admin account made: they wait for that admin, never sent under this login. */
  foreign: number;
}

/**
 * Where a check-in ended up:
 *  - `queued`: stored on this device, will be sent (now, or when the connection returns).
 *  - `already-queued`: this person already has a check-in waiting on this device; nothing was added.
 *  - `memory-only`: the device would not store it (storage full, blocked, or unavailable), so it is held in memory and sent
 *    while this page stays open. Closing the page before it syncs loses it, so the caller must tell the admin.
 */
export type EnqueueOutcome = 'queued' | 'already-queued' | 'memory-only';

/**
 * A fallback for when IndexedDB will not take a write (quota exceeded, private mode, blocked). It is lost if the page is closed,
 * which is why the caller is told via `memory-only` and shows an error, but it is far better than dropping the check-in silently.
 */
const memoryQueue: PendingCheckIn[] = [];
const announceMemoryQueue = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<number>(MEMORY_QUEUE_EVENT, { detail: memoryQueue.length }));
};
export const memoryQueueSize = () => memoryQueue.length;

/**
 * Records a check-in made on this device: updates the cached roster record immediately (the roster UI is updated by the
 * caller) and appends it to the pending queue. A person who already has a check-in waiting is not queued twice. Never throws:
 * if the device will not store it, it is kept in memory and `memory-only` is returned so the caller can warn.
 */
export async function enqueueCheckIn(
  entry: Pick<RosterEntry, 'id' | 'role' | 'schoolId' | 'firstName' | 'lastName'>,
  eventId: string,
  method: string,
  override: boolean,
  checkedInAt: number
): Promise<EnqueueOutcome> {
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
    createdAt: Date.now(),
    ownerId: getSessionUser()?.id,
    label: `${entry.firstName} ${entry.lastName}`.trim() || entry.schoolId
  };
  const db = getOfflineDb();
  if (db) {
    try {
      const waiting = await db.pendingCheckIns
        .where('personId')
        .equals(entry.id)
        .filter((i) => i.eventId === eventId && i.status !== 'FAILED')
        .first();
      if (waiting) return 'already-queued';
      await Promise.all([
        db.pendingCheckIns.add(item),
        markCachedCheckedIn(entry.role, entry.id, { checkedInAt, checkedInMethod: method, checkedInOverride: override })
      ]);
      requestBackgroundSync();
      return 'queued';
    } catch {
      // Storage full or blocked: fall through to the in-memory queue rather than dropping the check-in.
    }
  }
  if (memoryQueue.some((i) => i.personId === entry.id && i.eventId === eventId)) return 'already-queued';
  memoryQueue.push(item);
  announceMemoryQueue();
  return 'memory-only';
}

/**
 * The check-ins this device still holds for `eventId`, made by `ownerId`, that the server has not acknowledged (waiting or being
 * sent; one the server refused is not a check-in). Used to keep them on screen when the roster is read from the server or the cache.
 */
export async function listPending(eventId: string, ownerId: string): Promise<LocalCheckIn[]> {
  const found: PendingCheckIn[] = [];
  const db = getOfflineDb();
  if (db) {
    try {
      found.push(...(await db.pendingCheckIns.where('status').anyOf('PENDING', 'SYNCING').filter((i) => i.eventId === eventId && ownedBy(i, ownerId)).toArray()));
    } catch {
      // storage unavailable: the memory queue below is all there is
    }
  }
  found.push(...memoryQueue.filter((i) => i.eventId === eventId && ownedBy(i, ownerId) && i.status !== 'FAILED'));
  return found.map((i) => ({ personId: i.personId, checkedInAt: i.checkedInAt, method: i.method, override: i.override }));
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

/** One queued item, wherever it is kept: the IndexedDB table, or the in-memory fallback. */
interface Slot {
  item: PendingCheckIn;
  update(patch: Partial<PendingCheckIn>): Promise<void>;
  remove(): Promise<void>;
}

async function runQueue(): Promise<SyncResult> {
  const db = getOfflineDb();
  const result: SyncResult = { synced: 0, alreadyRecorded: 0, failed: 0, remaining: 0, interrupted: false, authExpired: false, foreign: 0 };

  // Who is signed in decides what may be sent: the server records who checked each person in. With no session nothing is sent
  // (and nothing is asked of the server); the queue just stays as it is.
  const me = getSessionUser()?.id;
  if (!me) {
    result.interrupted = true;
    result.authExpired = true;
    return result;
  }

  const slots: Slot[] = [];
  if (db) {
    // An item left SYNCING means a previous run died mid-request; the server dedupes by uuid, so it is safe to resend.
    await db.pendingCheckIns.where('status').equals('SYNCING').modify({ status: 'PENDING' });
    const queue = (await db.pendingCheckIns.where('status').equals('PENDING').sortBy('createdAt')) as PendingCheckIn[];
    for (const item of queue) {
      if (!ownedBy(item, me)) {
        result.foreign += 1;
        continue;
      }
      slots.push({
        item,
        update: async (patch) => void (await db.pendingCheckIns.update(item.uuid, patch)),
        remove: () => db.pendingCheckIns.delete(item.uuid)
      });
    }
  }
  for (const item of [...memoryQueue].filter((i) => ownedBy(i, me)))
    slots.push({
      item,
      update: async (patch) => void Object.assign(item, patch),
      remove: async () => {
        const at = memoryQueue.indexOf(item);
        if (at >= 0) memoryQueue.splice(at, 1);
      }
    });
  slots.sort((a, b) => a.item.createdAt - b.item.createdAt);

  const outcomes: ItemOutcome[] = [];
  for (const { item, update, remove } of slots) {
    if (!item.eventId) {
      // Queued by an older build that did not record the event: guessing one could check someone into the wrong event.
      await update({ status: 'FAILED', lastError: 'No event to check this person in to' });
      outcomes.push({ personId: item.personId, kind: 'failed' });
      continue;
    }
    await update({ status: 'SYNCING' });
    try {
      // The device id and the time THIS device recorded it ride along for the server's audit trail only: the check-in's own time is the
      // server's, and which device was first is decided by the server, never by these.
      await checkInManually(item.eventId, item.personId, item.uuid, { deviceId: getDeviceId(), deviceCheckedInAt: new Date(item.checkedInAt).toISOString() });
      await remove();
      outcomes.push({ personId: item.personId, kind: 'recorded' });
    } catch (err) {
      if (isApiError(err) && err.code === 'ALREADY_CHECKED_IN') {
        // Someone (another device, or this one on an earlier attempt) already checked them in: nothing is lost. The server says when
        // (its clock) and how, so the roster here shows that, not this device's own time.
        const when = Date.parse(err.details.find((d) => d.path === 'checkedInAt')?.message ?? '');
        const how = err.details.find((d) => d.path === 'method')?.message;
        if (Number.isFinite(when)) void markCachedCheckedIn(item.role, item.personId, { checkedInAt: when, checkedInMethod: how === 'FACE' ? 'Face Scan' : 'Manual', checkedInOverride: false });
        await remove();
        outcomes.push({ personId: item.personId, kind: 'already' });
      } else if (!isApiError(err) || isTransientStatus(err.status) || err.status === 401) {
        // No connection, a timeout, the server is struggling, or the session needs renewing: keep it and try again later. (A timeout
        // may even mean the server DID record it: the retry carries the same uuid, so it is answered, never counted twice.)
        await update({ status: 'PENDING', attempts: item.attempts + 1, lastError: isApiError(err) ? `Server responded ${err.status || 'no response'}` : 'Network error' });
        result.interrupted = true;
        if (isApiError(err) && err.status === 401) result.authExpired = true;
        break;
      } else {
        // The server refused it for good (no longer eligible, access switched off, ...). It is NOT counted as done: it stays,
        // marked FAILED with the server's reason, for the admin to see; and the person is no longer shown as checked in here.
        await update({ status: 'FAILED', attempts: item.attempts + 1, lastError: `Rejected: ${err.code}`, lastMessage: describeRefusal(err.message, err.details) });
        void markCachedCheckedIn(item.role, item.personId, { checkedInAt: null, checkedInMethod: null, checkedInOverride: false });
        outcomes.push({ personId: item.personId, kind: 'failed' });
      }
    }
  }

  Object.assign(result, tallyOutcomes(outcomes));
  result.remaining = (db ? await db.pendingCheckIns.where('status').equals('PENDING').count() : 0) + memoryQueue.filter((i) => i.status === 'PENDING').length;
  announceMemoryQueue();

  // Reconcile on every pass that reached the server, not just after a push: a device with nothing queued still learns
  // what other devices checked in.
  if (!result.interrupted && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ServerCheckInsDetail>(SERVER_CHECKINS_EVENT, { detail: { sent: outcomes.length > 0 } }));
  }
  return result;
}

/** Puts FAILED items back in the queue (e.g. an admin tapped "Retry"): every one, or just `uuid`. */
export async function retryFailed(uuid?: string): Promise<void> {
  const db = getOfflineDb();
  if (db) {
    const failed = db.pendingCheckIns.where('status').equals('FAILED');
    await (uuid ? failed.filter((i) => i.uuid === uuid) : failed).modify({ status: 'PENDING' });
  }
  for (const i of memoryQueue) if (i.status === 'FAILED' && (!uuid || i.uuid === uuid)) i.status = 'PENDING';
}

/** The admin's decision to stop retrying a check-in the server refused. Only a FAILED item can be dismissed; the person is simply not checked in. */
export async function dismissFailed(uuid: string): Promise<void> {
  const db = getOfflineDb();
  if (db) await db.pendingCheckIns.where('uuid').equals(uuid).filter((i) => i.status === 'FAILED').delete();
  for (let n = memoryQueue.length - 1; n >= 0; n -= 1) if (memoryQueue[n]!.uuid === uuid && memoryQueue[n]!.status === 'FAILED') memoryQueue.splice(n, 1);
}
