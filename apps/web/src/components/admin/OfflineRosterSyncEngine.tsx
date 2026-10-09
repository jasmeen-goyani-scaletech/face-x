'use client';

import { liveQuery } from 'dexie';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { getOfflineDb } from '@/lib/offline/db';
import { SYNC_TAG, processQueue, retryFailed } from '@/lib/offline/syncQueue';

/**
 * Mount once inside the admin layout (it needs <ToastProvider>). It:
 *  - watches the offline queue (`pendingCheckIns`) live,
 *  - runs a sync when connectivity returns (`online` event), when the app opens with items waiting, when the service
 *    worker's Background Sync fires, or when the admin taps "Sync now",
 *  - toasts the outcome ("3 offline check-ins successfully synced to Admin"),
 *  - shows a small status pill whenever there is something the admin should know (offline, waiting, syncing, failed).
 *
 * Roster caching and queueing itself happen in `useEventRoster` / `lib/offline`; this component is the engine's driver and UI.
 */
export default function OfflineRosterSyncEngine() {
  const { notify } = useToast();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (busy.current || !navigator.onLine) return;
    busy.current = true;
    setSyncing(true);
    try {
      const r = await processQueue();
      if (r.synced > 0) notify(`${r.synced} offline check-in${r.synced === 1 ? '' : 's'} successfully synced to Admin`);
      if (r.failed > 0) notify(`${r.failed} check-in${r.failed === 1 ? ' was' : 's were'} rejected by Admin and need review`, 'danger');
      if (r.interrupted) notify('Couldn’t reach Admin. Check-ins are saved and will retry.', 'danger');
    } catch {
      notify('Sync failed. Check-ins are saved and will retry.', 'danger');
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [notify]);

  // Live counts from IndexedDB (also reflects other tabs).
  useEffect(() => {
    const db = getOfflineDb();
    if (!db) return;
    const sub = liveQuery(async () => ({
      pending: await db.pendingCheckIns.where('status').anyOf('PENDING', 'SYNCING').count(),
      failed: await db.pendingCheckIns.where('status').equals('FAILED').count()
    })).subscribe({
      next: (v) => {
        setPending(v.pending);
        setFailed(v.failed);
      },
      error: () => undefined
    });
    return () => sub.unsubscribe();
  }, []);

  // Connectivity + triggers.
  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === SYNC_TAG) void sync();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    if (navigator.onLine) void sync(); // anything left over from a previous session
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [sync]);

  // A new item queued while online (e.g. a check-in made with a flaky connection) shouldn't wait for the next event.
  useEffect(() => {
    if (online && pending > 0 && !syncing) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, online]);

  if (online && pending === 0 && failed === 0 && !syncing) return null;

  const tone = !online ? 'border-warning bg-warning-soft text-warning' : failed > 0 && pending === 0 ? 'border-danger bg-danger-soft text-danger' : 'border-line-strong bg-surface text-ink';
  const text = !online
    ? `Offline${pending ? ` · ${pending} check-in${pending === 1 ? '' : 's'} saved on this device` : ' · changes are saved on this device'}`
    : syncing
      ? `Syncing ${pending} check-in${pending === 1 ? '' : 's'}…`
      : pending > 0
        ? `${pending} check-in${pending === 1 ? '' : 's'} waiting to sync`
        : `${failed} check-in${failed === 1 ? '' : 's'} need review`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={['fixed bottom-3 right-3 z-30 flex max-w-[calc(100vw-1.5rem)] items-center gap-2.5 rounded-full border px-4 py-2 text-[12.5px] font-semibold shadow-md', tone].join(' ')}
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <span aria-hidden="true" className={['h-2 w-2 shrink-0 rounded-full', !online ? 'bg-warning' : syncing ? 'animate-pulse bg-primary' : 'bg-current'].join(' ')} />
      <span className="min-w-0 truncate">{text}</span>
      {online && !syncing && pending > 0 && (
        <button type="button" onClick={() => void sync()} className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-bold text-primary-foreground hover:bg-primary-hover">
          Sync now
        </button>
      )}
      {online && !syncing && failed > 0 && (
        <button
          type="button"
          onClick={() => void retryFailed().then(() => sync())}
          className="shrink-0 rounded-full border border-current px-2.5 py-1 text-[11.5px] font-bold hover:bg-surface-2"
        >
          Retry failed
        </button>
      )}
    </div>
  );
}
