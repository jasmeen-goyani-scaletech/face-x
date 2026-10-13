'use client';

import { liveQuery } from 'dexie';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getOfflineDb, type PendingCheckIn } from '@/lib/offline/db';
import { ownedBy, retryDelayMs } from '@/lib/offline/policy';
import { MEMORY_QUEUE_EVENT, SYNC_TAG, dismissFailed, memoryQueueSize, processQueue, retryFailed } from '@/lib/offline/syncQueue';
import { syncNotices } from '@/lib/offline/syncTally';

/** What is in the queue, as far as this admin account is concerned. */
interface QueueView {
  /** Waiting to be sent, or being sent, made by this account. */
  pending: number;
  /** Refused by the server for good, made by this account: shown to the admin to retry or dismiss. */
  failed: PendingCheckIn[];
  /** Waiting on this device but made by ANOTHER admin account: never sent under this login. */
  foreign: number;
}

const EMPTY: QueueView = { pending: 0, failed: [], foreign: 0 };

/**
 * Mount once inside the admin layout (it needs <ToastProvider>). It:
 *  - watches the offline queue (`pendingCheckIns`) live,
 *  - sends the queue when connectivity returns (`online` event), when the app opens with items waiting, when the service
 *    worker's Background Sync fires, when the admin taps "Sync now", and again after a failed attempt, with growing waits
 *    (2 s, 4 s ... a minute, spread out a little): it learns that the server cannot be reached from the requests that fail, not
 *    only from the browser's online flag,
 *  - toasts the outcome ("3 offline check-ins successfully synced to Admin"), but says "couldn't reach" once, not on every retry,
 *  - shows a small status pill whenever there is something the admin should know (offline, server unreachable, waiting, syncing,
 *    signed out, refused), and for refused check-ins a short list with the reason and Retry / Dismiss.
 *
 * A check-in is never removed from the queue until the server has acknowledged it, or the admin dismisses a refused one.
 * Roster caching and queueing itself happen in `useApiRoster` / `lib/offline`; this component is the engine's driver and UI.
 */
export default function OfflineRosterSyncEngine() {
  const { notify } = useToast();
  const { user } = useAuth();
  const me = user?.id;
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueueView>(EMPTY);
  /** Check-ins this device would not store; held in memory only, so the page must stay open until they sync. */
  const [inMemory, setInMemory] = useState(0);
  const [syncing, setSyncing] = useState(false);
  /** Set while the server cannot be reached even though the browser says it is online: when the next automatic try is. */
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRetryAt(null);
  }, []);

  const sync = useCallback(
    async (manual = false) => {
      if (busy.current || !navigator.onLine) return;
      busy.current = true;
      clearTimer();
      setSyncing(true);
      const before = failures.current;
      try {
        const r = await processQueue();
        setAuthExpired(r.authExpired);
        if (r.interrupted && !r.authExpired) {
          failures.current += 1;
          const wait = retryDelayMs(failures.current);
          timer.current = setTimeout(() => void sync(), wait);
          setRetryAt(Date.now() + wait);
        } else if (!r.interrupted) {
          failures.current = 0;
        }
        // The first failure is worth a message; the quiet retries that follow are not.
        const repeat = r.interrupted && before > 0 && !manual && r.synced + r.alreadyRecorded + r.failed === 0;
        if (!repeat) for (const n of syncNotices(r)) notify(n.text, n.tone === 'danger' ? 'danger' : undefined);
      } catch {
        failures.current += 1;
        const wait = retryDelayMs(failures.current);
        timer.current = setTimeout(() => void sync(), wait);
        setRetryAt(Date.now() + wait);
        if (before === 0 || manual) notify('Sync failed. Check-ins are saved and will retry.', 'danger');
      } finally {
        busy.current = false;
        setSyncing(false);
      }
    },
    [notify, clearTimer]
  );

  // Live view of the queue from IndexedDB (it also follows other tabs).
  useEffect(() => {
    const db = getOfflineDb();
    if (!db) return;
    const sub = liveQuery(async () => {
      const all = await db.pendingCheckIns.toArray();
      const mine = all.filter((i) => !me || ownedBy(i, me));
      return {
        pending: mine.filter((i) => i.status === 'PENDING' || i.status === 'SYNCING').length,
        failed: mine.filter((i) => i.status === 'FAILED').sort((a, b) => a.createdAt - b.createdAt),
        foreign: all.length - mine.length
      } satisfies QueueView;
    }).subscribe({ next: setQueue, error: () => undefined });
    return () => sub.unsubscribe();
  }, [me]);

  // Connectivity + triggers.
  useEffect(() => {
    setOnline(navigator.onLine);
    setInMemory(memoryQueueSize());
    const onMemoryQueue = (e: Event) => {
      setInMemory((e as CustomEvent<number>).detail ?? 0);
      if ((e as CustomEvent<number>).detail > 0 && navigator.onLine) void sync();
    };
    window.addEventListener(MEMORY_QUEUE_EVENT, onMemoryQueue);
    const goOnline = () => {
      setOnline(true);
      failures.current = 0; // a fresh start: the connection just came back
      void sync();
    };
    const goOffline = () => {
      setOnline(false);
      clearTimer();
    };
    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === SYNC_TAG) void sync();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    if (navigator.onLine) void sync(); // anything left over from a previous session
    return () => {
      window.removeEventListener(MEMORY_QUEUE_EVENT, onMemoryQueue);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sync, clearTimer]);

  // A new item queued while online (e.g. a check-in made with a flaky connection) shouldn't wait for the next event.
  useEffect(() => {
    if (online && queue.pending > 0 && !syncing && !authExpired) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.pending, online]);

  // Counts down to the next automatic try, while there is one.
  useEffect(() => {
    if (!retryAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  const waiting = queue.pending + inMemory;
  const failed = queue.failed;
  if (online && waiting === 0 && failed.length === 0 && queue.foreign === 0 && !syncing && !authExpired) return null;

  const unreachable = online && retryAt !== null && waiting > 0;
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const n = (count: number) => `${count} check-in${count === 1 ? '' : 's'}`;
  const tone = !online || unreachable ? 'border-warning bg-warning-soft text-warning' : (failed.length > 0 || authExpired) && waiting === 0 ? 'border-danger bg-danger-soft text-danger' : 'border-line-strong bg-surface text-ink';
  const text = !online
    ? `Offline${waiting ? ` · ${n(waiting)} saved on this device${inMemory > 0 ? ' · keep this page open' : ''}` : ' · changes are saved on this device'}`
    : authExpired
      ? `Signed out · sign in again to send ${n(waiting)}`
      : syncing
        ? `Syncing ${n(waiting)}…`
        : unreachable
          ? `Can’t reach the server · ${n(waiting)} saved on this device · retrying in ${seconds}s`
          : waiting > 0
            ? `${n(waiting)} waiting to sync${inMemory > 0 ? ' · keep this page open' : ''}`
            : failed.length > 0
              ? `${n(failed.length)} need attention`
              : `${n(queue.foreign)} waiting for another account`;

  return (
    <div className="fixed bottom-3 right-3 z-30 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {reviewing && failed.length > 0 && (
        <div role="dialog" aria-label="Check-ins the server did not accept" className="w-[min(26rem,calc(100vw-1.5rem))] rounded-m border border-danger bg-surface p-3 text-[12.5px] shadow-lg">
          <p className="m-0 mb-2 font-bold text-ink">The server did not accept {failed.length === 1 ? 'this check-in' : 'these check-ins'}</p>
          <ul className="m-0 flex max-h-64 list-none flex-col gap-2 overflow-y-auto p-0">
            {failed.map((i) => (
              <li key={i.uuid} className="rounded-s border border-line p-2">
                <div className="font-semibold text-ink">{i.label || i.schoolId || i.personId}</div>
                <div className="text-ink-soft">{i.lastMessage || i.lastError || 'Not accepted'}</div>
                <div className="mt-1.5 flex gap-2">
                  <button type="button" onClick={() => void retryFailed(i.uuid).then(() => sync(true))} className="rounded-full border border-current px-2.5 py-1 text-[11.5px] font-bold text-ink hover:bg-surface-2">
                    Retry
                  </button>
                  <button type="button" onClick={() => void dismissFailed(i.uuid)} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-bold text-ink-soft hover:bg-surface-2">
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[11.5px] text-ink-faint">Dismissing leaves the person not checked in. They can still be checked in again by hand.</p>
        </div>
      )}
      <div
        role="status"
        aria-live="polite"
        data-testid="sync-status"
        className={['flex max-w-full items-center gap-2.5 rounded-full border px-4 py-2 text-[12.5px] font-semibold shadow-md', tone].join(' ')}
      >
        <span aria-hidden="true" className={['h-2 w-2 shrink-0 rounded-full', !online || unreachable ? 'bg-warning' : syncing ? 'animate-pulse bg-primary' : 'bg-current'].join(' ')} />
        <span className="min-w-0 truncate">{text}</span>
        {online && !syncing && waiting > 0 && !authExpired && (
          <button type="button" onClick={() => void sync(true)} className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-bold text-primary-foreground hover:bg-primary-hover">
            Sync now
          </button>
        )}
        {failed.length > 0 && (
          <button type="button" onClick={() => setReviewing((v) => !v)} aria-expanded={reviewing} className="shrink-0 rounded-full border border-current px-2.5 py-1 text-[11.5px] font-bold hover:bg-surface-2">
            {reviewing ? 'Hide' : 'Review'}
          </button>
        )}
      </div>
    </div>
  );
}
