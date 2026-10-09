'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEventRoster } from '@/lib/api/admin';
import { getDownloadUrl } from '@/lib/api/documents';
import { describeError } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiRosterEntry } from '@/lib/api/types';
import { cacheRoster, markCachedCheckedIn } from '@/lib/offline/rosterCache';
import { enqueueCheckIn, SERVER_CHECKINS_EVENT } from '@/lib/offline/syncQueue';
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
    };

/**
 * The event-day roster for the admin's current event, read from the API. It keeps an IndexedDB copy so search and check-in keep
 * working with no connection, shows a check-in immediately, and re-reads after the offline queue syncs (so check-ins made on
 * other devices appear too).
 */
export function useApiEventRoster(): ApiRosterState {
  const ev: AdminEventState = useAdminEvent();
  const eventId = ev.status === 'ready' ? ev.event.id : null;
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  const load = useCallback(async (id: string, quiet: boolean) => {
    if (!quiet) setRoster(null);
    setRefreshing(true);
    setError(null);
    try {
      const rows = await getEventRoster(id);
      if (eventIdRef.current !== id) return; // the admin switched events meanwhile
      const entries = rows.map(toRosterEntry);
      setRoster(entries);
      void cacheRoster(entries);
    } catch (e) {
      // A failed quiet refresh keeps what is on screen (and in the offline copy) rather than blanking the door.
      if (!quiet || !rosterRef.current) setError(describeError(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (eventId) void load(eventId, false);
  }, [eventId, attempt, load]);

  // After the offline queue has talked to the server, read the roster again.
  useEffect(() => {
    const onSynced = () => {
      if (eventIdRef.current) void load(eventIdRef.current, true);
    };
    window.addEventListener(SERVER_CHECKINS_EVENT, onSynced);
    return () => window.removeEventListener(SERVER_CHECKINS_EVENT, onSynced);
  }, [load]);

  const markPresent = useCallback((id: string, method: string, override: boolean) => {
    const eventNow = eventIdRef.current;
    const person = rosterRef.current?.find((r) => r.id === id);
    if (!eventNow || !person) return;
    const at = Date.now();
    // Optimistic: the roster (and so the screen) updates immediately; the queue is what carries it to the server.
    setRoster((prev) => prev?.map((r) => (r.id === id ? { ...r, checkedInAt: at, checkedInMethod: method, checkedInOverride: override } : r)) ?? prev);
    void markCachedCheckedIn(person.role, id, { checkedInAt: at, checkedInMethod: method, checkedInOverride: override });
    void enqueueCheckIn(person, eventNow, method, override, at);
  }, []);

  return useMemo<ApiRosterState>(() => {
    if (ev.status === 'loading') return { status: 'loading' };
    if (ev.status === 'error') return { status: 'error', message: ev.message, retry: ev.retry };
    if (ev.status === 'empty') return { status: 'empty' };
    if (error && !roster) return { status: 'error', message: error, retry: () => setAttempt((n) => n + 1) };
    if (!roster) return { status: 'loading' };
    return { status: 'ready', event: ev.event, events: ev.events, setEventId: ev.setEventId, refreshing, roster, markPresent };
  }, [ev, error, roster, refreshing, markPresent]);
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
