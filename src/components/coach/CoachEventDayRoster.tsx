'use client';

import { useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { CalendarIcon, SearchIcon, UsersIcon } from '@/components/ui/Icons';
import EventDayPlayerRosterCard from './EventDayPlayerRosterCard';
import { CoachGateCard, useCoachTeam } from './useCoachTeam';
import { EVENT_INFO } from '@/lib/seed';
import type { RosterEntry } from '@/lib/seed';

type StatusFilter = 'all' | 'checked_in' | 'pending';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All Players' },
  { key: 'checked_in', label: 'Checked In' },
  { key: 'pending', label: 'Pending Check-In' }
];

const NO_PLAYERS: RosterEntry[] = [];

/**
 * Coach event-day roster: who on my team has checked in, who hasn't, and a fast way to reach them.
 *
 *  - Only a coach whose own event-day access is Enabled sees the roster (same rule as the admin pages: approved, documents
 *    and flags cleared, not switched off). Anyone else sees why not. `useCoachTeam` applies the gate.
 *  - The roster is the players whose team id is the coach's team id (players only: no staff, no other coaches). Check-ins made at the scanner appear here on their own;
 *    the roster syncs between tabs in the same browser.
 *  - Each card (EventDayPlayerRosterCard) offers Call Player and Call Parent, which open the phone dialer.
 * Jersey number and position are shown when known; they aren't collected at registration yet, so only the sample players have them.
 */
export default function CoachEventDayRoster() {
  const state = useCoachTeam();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  const players = state.kind === 'ready' ? state.players : NO_PLAYERS;
  const checkedInCount = players.filter((p) => p.checkedInAt).length;
  const pendingCount = players.length - checkedInCount;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return players
      .filter((p) => (filter === 'all' ? true : filter === 'checked_in' ? !!p.checkedInAt : !p.checkedInAt))
      .filter((p) => !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || p.jerseyNumber === q || p.schoolId.toLowerCase().includes(q))
      // Pending first: those are the ones that need the coach's attention.
      .sort((a, b) => Number(!!a.checkedInAt) - Number(!!b.checkedInAt) || a.lastName.localeCompare(b.lastName));
  }, [players, filter, query]);

  if (state.kind === 'loading') return null;
  if (state.kind === 'gate') return <CoachGateCard gate={state} />;

  const teamName = state.team.teamName;

  return (
    <div>
      {/* Header + team summary */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-2xl">My Team — Event-Day Roster</h1>
            <p className="m-0 mt-1 text-[15px] font-semibold text-ink">{teamName}</p>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 text-sm text-ink-soft">
              <CalendarIcon size={14} /> {EVENT_INFO.name} · {EVENT_INFO.time}
            </p>
          </div>
          <Chip kind="success">Event-day access: Enabled</Chip>
        </div>

        <dl className="m-0 mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
          <div>
            <dd className="m-0 font-display text-3xl font-bold text-ink">{players.length}</dd>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">On roster</dt>
          </div>
          <div>
            <dd className="m-0">
              <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-full bg-success-soft px-3 py-0.5 font-display text-2xl font-bold text-success">{checkedInCount}</span>
            </dd>
            <dt className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Checked in</dt>
          </div>
          <div>
            <dd className="m-0">
              <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-full bg-warning-soft px-3 py-0.5 font-display text-2xl font-bold text-warning">{pendingCount}</span>
            </dd>
            <dt className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Pending</dt>
          </div>
        </dl>
      </Card>

      {/* Filters + search */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="radiogroup" aria-label="Filter players by check-in status" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface-2 p-1 no-scrollbar">
          {FILTERS.map((f) => {
            const count = f.key === 'all' ? players.length : f.key === 'checked_in' ? checkedInCount : pendingCount;
            const selected = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setFilter(f.key)}
                className={[
                  'touch-target whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  selected ? 'bg-primary text-primary-foreground' : 'text-ink-soft hover:text-ink'
                ].join(' ')}
              >
                {f.label} <span className={selected ? 'opacity-80' : 'text-ink-faint'}>({count})</span>
              </button>
            );
          })}
        </div>
        <div className="relative sm:w-72">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, jersey #, or ID"
            aria-label="Search players by name, jersey number, or registration ID"
            className="w-full rounded-s border border-line-strong bg-surface py-2.5 pl-9 pr-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Players */}
      {players.length === 0 ? (
        <Card className="py-10 text-center">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="m-0 text-sm text-ink-soft">No players are registered to {teamName} yet.</p>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="py-10 text-center text-sm text-ink-soft">No players match{query ? ` “${query}”` : ' this filter'}.</Card>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id}>
              <EventDayPlayerRosterCard player={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
