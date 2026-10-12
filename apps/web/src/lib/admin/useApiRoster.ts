'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEventRoster } from '@/lib/api/admin';
import { getDownloadUrl } from '@/lib/api/documents';
import { checkInByFace } from '@/lib/api/eventday';
import { describeError, isApiError } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiRosterEntry } from '@/lib/api/types';
import { liveQuery } from 'dexie';
import { getSessionUser } from '@/lib/api/session';
import { getOfflineDb, newUuid } from '@/lib/offline/db';
import { getDeviceId } from '@/lib/offline/deviceId';
import { describeRefusal, isTransientStatus, mergePending } from '@/lib/offline/policy';
import { cacheRoster, markCachedCheckedIn, readCachedRoster, rosterCacheEpoch } from '@/lib/offline/rosterCache';
import { useToast } from '@/components/ui/Toast';
import { enqueueCheckIn, listPending, MEMORY_QUEUE_EVENT, SERVER_CHECKINS_EVENT, type ServerCheckInsDetail } from '@/lib/offline/syncQueue';
import type { RosterEntry } from '@/lib/seed';
import { useAdminEvent, type AdminEventState } from './useAdminEvent';

const ROLE: Record<ApiRosterEntry['registrantType'], RosterEntry['role']> = { PLAYER: 'player', COACH: 'coach', STAFF: 'staff' };

/** What the door screens call a person, from what the API knows (see ApiRosterEntry). */
export function toRosterEntry(r: ApiRosterEntry): RosterEntry {
  const isPlayer = r.registrantType === 'PLAYER';
  return {
    // A roster row's id is the registration's own id: the same on every device, and what a check-in is recorded against.
    id: r.registrationId,
    firstName: r.firstName,
    lastName: r.lastName,
    dob: r.dateOfBirth ?? '',
    schoolId: r.registrationNumber,
    role: ROLE[r.registrantType],
    teamName: r.team?.name ?? '',
    division: r.team?.division ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    parentPhone: isPlayer ? (r.guardianPhone ?? '') : '',
    teamId: r.team?.id ?? '',
    jerseyNumber: '',
    position: '',
    guardianName: isPlayer ? (r.guardianName ?? '') : '',
    photoUrl: '',
    photoDocumentId: r.photoDocumentId ?? undefined,
    approved: r.approved,
    paymentComplete: r.paymentComplete,
    flags: r.flags,
    pendingReason: r.approved ? '' : r.flags.length > 0 ? `Still to clear: ${r.flags.join(', ').toLowerCase()}.` : 'Registration is still being reviewed.',
    disabled: r.eventAccessDisabled,
    checkedInAt: r.checkedInAt ? Date.parse(r.checkedInAt) : null,
    checkedInMethod: r.checkedInMethod === 'FACE' ? 'Face Scan' : r.checkedInMethod === 'MANUAL' ? 'Manual' : null,
    checkedInOverride: false
  };
}

export type ApiRosterState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'empty' }
  | {
      status: 'ready';
      event: ApiAdminEvent;
      events: ApiAdminEvent[];
      setEventId: (id: string) => void;
      /** True while the roster is being re-read (the list stays on screen). */
      refreshing: boolean;
      roster: RosterEntry[];
      /** Records a check-in at once on screen; it is sent to the server by the offline queue (now, or when the connection returns). */
      markPresent: (id: string, method: string, override: boolean) => void;
      /**
       * Checks in the person a face scan clearly matched. Shown at once; sent to the server right away with the scan as proof.
       * 'done': the server recorded it (or someone else had just checked them in). 'queued': the server could not be reached, so it was
       * saved on this device as a manual check-in and will be sent when it can be. 'refused': the server would not (the scan expired,
       * they are no longer cleared...): nothing was checked in, and `message` says why.
       */
      checkInWithFace: (id: string, scanId: string) => Promise<{ result: 'done' | 'queued' | 'refused'; message?: string }>;
      /** Where the roster on screen came from: the server just now (or earlier this visit), or this device's saved copy. */
      source: 'server' | 'device';
      /** When the server last gave this roster (ms epoch), or null while that is not known yet. */
      syncedAt: number | null;
      /** False when the browser is offline or the last attempt to reach the server failed: check-ins are saved on the device. */
      online: boolean;
    };

/** A roster read this recent is not read again just because the sync engine ran. */
const FRESH_MS = 5_000;
/** On a slow connection, the device's own copy is shown after this long rather than leaving the door waiting for the server. */
const SLOW_MS = 4_000;

/**
 * The event-day roster for the admin's current event, read from the API. It keeps an IndexedDB copy so search and check-in keep
 * working with no connection, shows a check-in immediately, and re-reads after the offline queue syncs (so check-ins made on
 * other devices appear too).
 *
 *  - No connection, a timeout or a struggling server on the first read: the device's copy for THIS admin and THIS event is used,
 *    and the screen says so (`source: 'device'`, `online: false`). Another admin's or another event's copy is never used.
 *  - A slow server: after SLOW_MS the device's copy is shown meanwhile, and replaced when the server answers.
 *  - A refusal (signed out, no permission, unknown event) is shown as an error, never answered from the device.
 *  - A roster read from the server never undoes a check-in this device has made and not yet sent (see `mergePending`).
 */
export function useApiEventRoster(): ApiRosterState {
  const ev: AdminEventState = useAdminEvent({ offlineFallback: true });
  const eventId = ev.status === 'ready' ? ev.event.id : null;
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<'server' | 'device'>('server');
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [reachable, setReachable] = useState(true);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const { notify } = useToast();
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const evRef = useRef(ev);
  evRef.current = ev;
  /** People being checked in right now: a second tap on the same person before the first has finished is ignored. */
  const markingRef = useRef(new Set<string>());
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  /** When the roster was last read (or 'loading'), so a sync pass right behind a read does not ask the server again. */
  const readRef = useRef<{ inFlight: boolean; at: number }>({ inFlight: false, at: 0 });

  const load = useCallback(async (id: string, quiet: boolean) => {
    const me = getSessionUser()?.id ?? '';
    const epoch = rosterCacheEpoch();
    if (!quiet) setRoster(null);
    setRefreshing(true);
    setError(null);
    readRef.current.inFlight = true;
    let settled = false;

    /** Shows this device's copy (if it is this admin's, for this event, and sound) instead of waiting. True when it did. */
    const showDeviceCopy = async (): Promise<boolean> => {
      if (!me) return false;
      const saved = await readCachedRoster({ eventId: id, ownerId: me });
      if (!saved || eventIdRef.current !== id) return false;
      const merged = mergePending(saved.roster, await listPending(id, me));
      setRoster(merged);
      setSource('device');
      setSyncedAt(saved.fetchedAt);
      return true;
    };

    // A slow server: after a few seconds, the door works from the device's copy while the server's answer is still on its way.
    const slow = quiet ? null : setTimeout(() => void (async () => !settled && !rosterRef.current && (await showDeviceCopy()))(), SLOW_MS);
    try {
      const rows = await getEventRoster(id);
      settled = true;
      if (eventIdRef.current !== id) return; // the admin switched events meanwhile
      const entries = mergePending(rows.map(toRosterEntry), me ? await listPending(id, me) : []);
      setRoster(entries);
      setSource('server');
      setSyncedAt(Date.now());
      setReachable(true);
      const current = evRef.current;
      if (me && current.status === 'ready') void cacheRoster(rows.map(toRosterEntry), { eventId: id, ownerId: me, event: current.event, events: current.events, epoch });
    } catch (e) {
      settled = true;
      if (isApiError(e) && isTransientStatus(e.status)) {
        setReachable(false);
        // The server can't be reached: carry on from the device's copy. A failed quiet refresh keeps what is on screen.
        if (!rosterRef.current && (await showDeviceCopy())) return;
        if (rosterRef.current) return;
      }
      // Anything else (signed out, no permission, unknown event), or nothing saved on this device: say so.
      if (!quiet || !rosterRef.current) setError(describeError(e));
    } finally {
      if (slow) clearTimeout(slow);
      readRef.current = { inFlight: false, at: Date.now() };
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (eventId) void load(eventId, false);
  }, [eventId, attempt, load]);

  // The browser's own idea of "online" is only a hint (it says nothing about the server), but a drop in it is shown at once and its
  // return is a reason to try the server again right away.
  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    const on = () => {
      setBrowserOnline(true);
      if (eventIdRef.current && !readRef.current.inFlight) void load(eventIdRef.current, true);
    };
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [load]);

  // After the offline queue has talked to the server, read the roster again.
  useEffect(() => {
    const onSynced = (e: Event) => {
      // A pass that sent check-ins always re-reads: the server may have settled a conflict with another device, and the screen
      // must show its answer. A pass that sent nothing (the sync engine runs once when the page opens) has nothing to add right
      // after the roster was read; anything checked in elsewhere shows on the next pass.
      const sent = (e as CustomEvent<ServerCheckInsDetail>).detail?.sent !== false;
      const { inFlight, at } = readRef.current;
      if (!sent && (inFlight || Date.now() - at < FRESH_MS)) return;
      if (eventIdRef.current) void load(eventIdRef.current, true);
    };
    window.addEventListener(SERVER_CHECKINS_EVENT, onSynced);
    return () => window.removeEventListener(SERVER_CHECKINS_EVENT, onSynced);
  }, [load]);

  // Who is still waiting to be sent from this device (live, so it also follows other tabs): shown as "saved on this device".
  useEffect(() => {
    const me = getSessionUser()?.id;
    const db = getOfflineDb();
    if (!eventId || !me) return;
    let alive = true;
    const refresh = () => void listPending(eventId, me).then((p) => alive && setPendingIds(new Set(p.map((i) => i.personId))));
    refresh();
    window.addEventListener(MEMORY_QUEUE_EVENT, refresh);
    const sub = db
      ? liveQuery(() => db.pendingCheckIns.where('status').anyOf('PENDING', 'SYNCING', 'FAILED').count()).subscribe({ next: refresh, error: () => undefined })
      : null;
    return () => {
      alive = false;
      window.removeEventListener(MEMORY_QUEUE_EVENT, refresh);
      sub?.unsubscribe();
    };
  }, [eventId]);

  const markPresent = useCallback((id: string, method: string, override: boolean) => {
    const eventNow = eventIdRef.current;
    const person = rosterRef.current?.find((r) => r.id === id);
    if (!eventNow || !person) return;
    // Already checked in (here or on the server), or a tap is already being handled: nothing to do, and nothing to queue twice.
    if (person.checkedInAt || markingRef.current.has(id)) return;
    markingRef.current.add(id);
    const at = Date.now();
    // Optimistic: the roster (and so the screen) updates immediately; the queue is what carries it to the server.
    setRoster((prev) => prev?.map((r) => (r.id === id ? { ...r, checkedInAt: at, checkedInMethod: method, checkedInOverride: override } : r)) ?? prev);
    void markCachedCheckedIn(person.role, id, { checkedInAt: at, checkedInMethod: method, checkedInOverride: override });
    void enqueueCheckIn(person, eventNow, method, override, at)
      .then((outcome) => {
        if (outcome === 'memory-only')
          notify(
            'This device couldn’t save the check-in (its storage is full or blocked). It is held in memory and will be sent while this page stays open: don’t close or reload it until it syncs.',
            'danger'
          );
      })
      .finally(() => markingRef.current.delete(id));
  }, [notify]);

  const checkInWithFace = useCallback(
    async (id: string, scanId: string): Promise<{ result: 'done' | 'queued' | 'refused'; message?: string }> => {
      const eventNow = eventIdRef.current;
      const person = rosterRef.current?.find((r) => r.id === id);
      if (!eventNow || !person) return { result: 'refused', message: 'That person isn’t on this roster.' };
      if (person.checkedInAt || markingRef.current.has(id)) return { result: 'done' };
      markingRef.current.add(id);
      const at = Date.now();
      const show = (checkedInAt: number | null, method: string | null) =>
        setRoster((prev) => prev?.map((r) => (r.id === id ? { ...r, checkedInAt, checkedInMethod: method, checkedInOverride: false } : r)) ?? prev);
      show(at, 'Face Scan');
      try {
        await checkInByFace(eventNow, scanId, newUuid(), { deviceId: getDeviceId(), deviceCheckedInAt: new Date(at).toISOString() });
        void markCachedCheckedIn(person.role, id, { checkedInAt: at, checkedInMethod: 'Face Scan', checkedInOverride: false });
        return { result: 'done' };
      } catch (e) {
        if (isApiError(e) && e.code === 'ALREADY_CHECKED_IN') {
          // Another device got there first: the server's time and method are the truth, read again.
          window.dispatchEvent(new CustomEvent<ServerCheckInsDetail>(SERVER_CHECKINS_EVENT, { detail: { sent: true } }));
          return { result: 'done' };
        }
        if (!isApiError(e) || isTransientStatus(e.status)) {
          // The server could not be reached after the face WAS matched: keep the check-in as a manual one, which the offline queue can
          // carry (a face check-in needs the live scan). Nothing is claimed that did not happen.
          show(at, 'Manual');
          void markCachedCheckedIn(person.role, id, { checkedInAt: at, checkedInMethod: 'Manual', checkedInOverride: false });
          await enqueueCheckIn(person, eventNow, 'Manual', false, at);
          return { result: 'queued' };
        }
        show(null, null);
        return { result: 'refused', message: describeRefusal(e.message, e.details) };
      } finally {
        markingRef.current.delete(id);
      }
    },
    []
  );

  // Someone this device has checked in but the server has not acknowledged is marked, so "saved here" is never mistaken for "confirmed".
  const shown = useMemo(() => (roster && pendingIds.size > 0 ? roster.map((r) => (r.checkedInAt && pendingIds.has(r.id) ? { ...r, pendingSync: true } : r)) : roster), [roster, pendingIds]);

  return useMemo<ApiRosterState>(() => {
    if (ev.status === 'loading') return { status: 'loading' };
    if (ev.status === 'error') return { status: 'error', message: ev.message, retry: ev.retry };
    if (ev.status === 'empty') return { status: 'empty' };
    if (error && !shown) return { status: 'error', message: error, retry: () => setAttempt((n) => n + 1) };
    if (!shown) return { status: 'loading' };
    return { status: 'ready', event: ev.event, events: ev.events, setEventId: ev.setEventId, refreshing, roster: shown, markPresent, checkInWithFace, source, syncedAt, online: browserOnline && reachable };
  }, [ev, error, shown, refreshing, markPresent, checkInWithFace, source, syncedAt, browserOnline, reachable]);
}

/**
 * A viewing link for a person's on-file photo, asked for only when the screen is about to show it (each link is issued, and
 * audited, per request, so the whole roster's photos are never fetched up front). Resolves to '' when there is no photo.
 */
export function useEntryPhoto(entry: Pick<RosterEntry, 'id' | 'photoUrl'> & { photoDocumentId?: string }): string {
  const [url, setUrl] = useState('');
  const documentId = entry.photoDocumentId;
  useEffect(() => {
    setUrl('');
    if (entry.photoUrl || !documentId) return;
    let cancelled = false;
    getDownloadUrl(documentId, { inline: true })
      .then((r) => !cancelled && setUrl(r.url))
      .catch(() => undefined); // no photo to compare is shown as "No photo on file": the person can still be identified by hand
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.photoUrl, documentId]);
  return entry.photoUrl || url;
}
