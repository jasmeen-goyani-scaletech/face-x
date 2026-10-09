'use client';

import { useCallback, useEffect, useState } from 'react';
import { listAdminEvents } from '@/lib/api/admin';
import { describeError } from '@/lib/api/errors';
import type { ApiAdminEvent } from '@/lib/api/types';

const KEY = 'facex-admin-event';

export type AdminEventState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'empty' }
  | { status: 'ready'; events: ApiAdminEvent[]; event: ApiAdminEvent; setEventId: (id: string) => void };

/** The event the admin is working on. Defaults to the first published event, and the choice is remembered for this tab. */
export function useAdminEvent(): AdminEventState {
  const [events, setEvents] = useState<ApiAdminEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventIdState] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listAdminEvents()
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
  }, [attempt]);

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
