'use client';

import type { ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { CalendarIcon } from '@/components/ui/Icons';
import { formatEventStart } from '@/lib/format';
import { formatEventTimes } from '@/lib/admin/eventTime';
import { useApiEventRoster, type ApiRosterState } from '@/lib/admin/useApiRoster';

export type ReadyRoster = Extract<ApiRosterState, { status: 'ready' }>;

/** "Fall Kickoff · November 14, 2026, 5:30 PM" and, when the admin runs several events, the picker for them. */
export function EventLine({ roster, className = '' }: { roster: ReadyRoster; className?: string }) {
  const { event, events, setEventId } = roster;
  if (events.length > 1) {
    return (
      <label className={['flex items-center gap-2 text-sm text-ink-soft', className].join(' ')}>
        <CalendarIcon size={14} /> Event
        <select
          value={event.id}
          onChange={(e) => setEventId(e.target.value)}
          className="rounded-s border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.status !== 'PUBLISHED' ? ` (${e.status.toLowerCase()})` : ''}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <p className={['m-0 flex items-center gap-1.5 text-sm text-ink-soft', className].join(' ')}>
      <CalendarIcon size={14} /> {event.name} · {formatEventStart(event.startsAt, event.timezone)} ({formatEventTimes(event.startsAt, event.endsAt, event.timezone)})
    </p>
  );
}

/**
 * Loads the event-day roster for the admin's current event and handles every state around it (loading, a failed load with a
 * retry, an organization with no events), so each event-day screen only draws its own content once the roster is there.
 */
export default function EventDayGate({ children }: { children: (roster: ReadyRoster) => ReactNode }) {
  const roster = useApiEventRoster();
  if (roster.status === 'loading') {
    return (
      <p role="status" className="text-ink-soft">
        Loading the roster…
      </p>
    );
  }
  if (roster.status === 'error') {
    return (
      <Card>
        <Alert level="danger" title="We couldn’t load the roster">
          {roster.message}
        </Alert>
        <Button variant="primary" onClick={roster.retry}>
          Try again
        </Button>
      </Card>
    );
  }
  if (roster.status === 'empty') {
    return (
      <Card className="text-center py-12">
        <CalendarIcon size={32} className="mx-auto mb-3 text-ink-faint" />
        <p className="text-ink-soft text-sm">Your organization has no events yet.</p>
      </Card>
    );
  }
  return <>{children(roster)}</>;
}
