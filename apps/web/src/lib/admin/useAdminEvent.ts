'use client';

import { useCallback, useEffect, useState } from 'react';
import { listAdminEvents } from '@/lib/api/admin';
import { useRevalidateOnFocus } from '@/lib/useRevalidateOnFocus';
import { describeError, isApiError } from '@/lib/api/errors';
import { getSessionUser } from '@/lib/api/session';
import { readCachedEvents } from '@/lib/offline/rosterCache';
import { isTransientStatus } from '@/lib/offline/policy';
import type { ApiAdminEvent } from '@/lib/api/types';

const KEY = 'facex-admin-event';

export type AdminEventState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'empty' }
  | { status: 'ready'; events: ApiAdminEvent[]; event: ApiAdminEvent; setEventId: (id: string) => void };

/**
 * The event the admin is working on. Defaults to the first published event, and the choice is remembered for this tab.
 *
 * `offlineFallback` (the event-day screens): when the events can't be read because the server can't be reached, use the list this
 * device saved with its roster, so the screen still opens; it is read again by itself once the connection is back. A refusal
 * (signed out, no permission) is never papered over this way.
 */
export function useAdminEvent({ offlineFallback = false }: { offlineFallback?: boolean } = {}): AdminEventState {
  const [events, setEvents] = useState<ApiAdminEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventIdState] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fromDevice, setFromDevice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listAdminEvents()
      .catch(async (e: unknown) => {
        const me = getSessionUser()?.id;
        const saved = offlineFallback && me && isApiError(e) && isTransientStatus(e.status) ? await readCachedEvents(me) : null;
        if (!saved) throw e;
        if (!cancelled) setFromDevice(true);
        return saved;
      })
      .then((list) => {
        if (cancelled) return;
        setEvents(list);
        let saved: string | null = null;
        try {
          saved = window.sessionStorage.getItem(KEY);
        } catch {
          // storage blocked: fall back to the default
        }
        const pick = list.find((e) => e.id === saved) ?? list.find((e) => e.status === 'PUBLISHED') ?? list[0];
        setEventIdState(pick?.id ?? null);
      })
      .catch((e) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt, offlineFallback]);

  // The list came from this device: read it from the server as soon as the connection is back.
  useEffect(() => {
    if (!fromDevice) return;
    const refresh = () => {
      listAdminEvents()
        .then((list) => {
          setEvents(list);
          setFromDevice(false);
        })
        .catch(() => undefined);
    };
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [fromDevice]);

  // Back after a while away: pick up events other admins added. The choice stays; a failed refresh changes nothing.
  useRevalidateOnFocus(() => {
    listAdminEvents()
      .then(setEvents)
      .catch(() => undefined);
  });

  const setEventId = useCallback((id: string) => {
    setEventIdState(id);
    try {
      window.sessionStorage.setItem(KEY, id);
    } catch {
      // ignore
    }
  }, []);

  if (error) return { status: 'error', message: error, retry: () => setAttempt((n) => n + 1) };
  if (!events) return { status: 'loading' };
  const event = events.find((e) => e.id === eventId);
  if (!event) return { status: 'empty' };
  return { status: 'ready', events, event, setEventId };
}
