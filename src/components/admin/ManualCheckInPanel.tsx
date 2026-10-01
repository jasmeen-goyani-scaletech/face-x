'use client';

import { useState } from 'react';
import { useOfflineRosterSearch } from '@/lib/offline/useOfflineRosterSearch';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { AlertTriangleIcon, ChevronLeftIcon, SearchIcon, UsersIcon } from '@/components/ui/Icons';
import { checkInStatus } from '@/lib/faceMatcher';
import { calcAge } from '@/lib/age';
import { formatDate, formatTime, initialsOf } from '@/lib/format';
import type { RosterEntry } from '@/lib/seed';

const ROLE_LABEL: Record<RosterEntry['role'], string> = { player: 'Player', coach: 'Coach', staff: 'Staff' };

/** Whether this person can be checked in, as a compact status pill. */
function StatusPill({ entry }: { entry: RosterEntry }) {
  const s = checkInStatus(entry);
  if (s.kind === 'already') return <Chip compact kind="warning">Checked in</Chip>;
  if (s.kind === 'blocked') return <Chip compact kind={entry.approved && !entry.disabled ? 'warning' : 'danger'}>{entry.approved && !entry.disabled ? 'Blocked' : entry.disabled ? 'Disabled' : 'Not cleared'}</Chip>;
  return <Chip compact kind="success">Ready</Chip>;
}

function Avatar({ entry, size }: { entry: RosterEntry; size: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'h-full w-full text-5xl' : 'h-10 w-10 text-sm';
  return (
    <div className={['flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 font-display font-bold text-ink-soft', size === 'lg' ? 'h-full w-full' : 'h-10 w-10 rounded-full border border-line', box].join(' ')}>
      {entry.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.photoUrl} alt={size === 'lg' ? `On-file photo of ${entry.firstName} ${entry.lastName}` : ''} className="h-full w-full object-cover" />
      ) : (
        initialsOf(entry.firstName, entry.lastName)
      )}
    </div>
  );
}

/**
 * Find someone, compare their on-file photo with the person standing there, and approve them.
 *  1. Search by name, team, or registration ID (live as you type).
 *  2. Pick a result: the on-file photo sits beside their details, with their standing spelled out.
 *  3. "Confirm Photo & Grant Access" checks them in. Anyone blocked (not approved, an open compliance flag, access
 *     disabled) or already checked in cannot be checked in here, and there is no override.
 */
export default function ManualCheckInPanel({
  roster,
  onConfirm,
  autoFocus
}: {
  roster: RosterEntry[];
  onConfirm: (id: string) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Searches the IndexedDB roster cache (name, email, id, team), so it works with no connection.
  const results = useOfflineRosterSearch(query, roster);

  const selected = roster.find((r) => r.id === selectedId) ?? null;

  if (selected) {
    const status = checkInStatus(selected);
    const age = selected.role === 'player' ? calcAge(selected.dob) : null;
    const facts: { label: string; value: string }[] = [
      { label: 'Role', value: ROLE_LABEL[selected.role] },
      { label: 'Team', value: selected.teamName || 'No team assigned' },
      { label: 'Registration ID', value: selected.schoolId || '—' },
      ...(selected.role === 'player'
        ? [
            { label: 'Date of birth', value: formatDate(selected.dob) },
            { label: 'Age · Division', value: `${age ?? '—'} · ${selected.division || '—'}` }
          ]
        : [])
    ];

    return (
      <div>
        <button type="button" onClick={() => setSelectedId(null)} className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
          <ChevronLeftIcon size={16} /> Back to results
        </button>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_1fr]">
          <figure className="m-0">
            <div className="aspect-square w-full overflow-hidden rounded-m border border-line">
              <Avatar entry={selected} size="lg" />
            </div>
            <figcaption className="mt-2 text-center text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
              {selected.photoUrl ? 'On-file registration photo' : 'No photo on file'}
            </figcaption>
          </figure>

          <div className="min-w-0">
            <h3 className="m-0 truncate text-xl">
              {selected.firstName} {selected.lastName}
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusPill entry={selected} />
              {selected.role === 'player' && (
                <Chip compact kind={selected.paymentComplete ? 'success' : 'danger'}>
                  Payment {selected.paymentComplete ? 'complete' : 'incomplete'}
                </Chip>
              )}
            </div>
            <dl className="m-0 mt-4 grid grid-cols-2 gap-x-6 gap-y-3.5">
              {facts.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{f.label}</dt>
                  <dd className="m-0 mt-0.5 break-words text-sm font-medium text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-5">
          {status.kind === 'blocked' && (
            <div className="flex gap-3 rounded-s border border-danger bg-danger-tint px-4 py-3.5">
              <AlertTriangleIcon size={18} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <div className="text-sm font-bold text-danger">Can’t be checked in</div>
                <p className="m-0 mt-0.5 text-[13px] text-ink-soft">{status.reason}</p>
              </div>
            </div>
          )}
          {status.kind === 'already' && (
            <div className="flex gap-3 rounded-s border border-warning bg-warning-soft px-4 py-3.5">
              <AlertTriangleIcon size={18} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <div className="text-sm font-bold text-warning">Already checked in</div>
                <p className="m-0 mt-0.5 text-[13px] text-ink-soft">
                  At {formatTime(selected.checkedInAt)} via {selected.checkedInMethod}. Duplicate check-in is blocked.
                </p>
              </div>
            </div>
          )}
          {status.kind === 'ready' && (
            <>
              <p className="m-0 mb-3 text-[13px] text-ink-soft">Compare this photo with the person at the scanner before confirming.</p>
              <div className="flex justify-end">
                <Button variant="primary" className="w-full sm:w-auto" onClick={() => onConfirm(selected.id)}>
                  Confirm Photo & Grant Access
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative mb-3">
        <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          autoFocus={autoFocus}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, team, or registration ID"
          aria-label="Search by name, team, or registration ID"
          className="w-full rounded-s border border-line-strong bg-surface py-3 pl-10 pr-4 text-[15px] text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {results.length === 0 ? (
        <div className="rounded-m border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-soft">
          <SearchIcon size={28} className="mx-auto mb-2 text-ink-faint" />
          No one matches &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <ul className="m-0 flex max-h-[46vh] list-none flex-col gap-1.5 overflow-y-auto p-0">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="flex w-full items-center gap-3 rounded-s border border-line bg-surface p-2.5 text-left transition-colors hover:border-primary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Avatar entry={r} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">
                    {r.firstName} {r.lastName}
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-soft">
                    {ROLE_LABEL[r.role]} · {r.teamName || 'No team'} · {r.schoolId}
                  </span>
                </span>
                <StatusPill entry={r} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!query && roster.length > 0 && (
        <p className="m-0 mt-3 flex items-center gap-2 text-[12.5px] text-ink-faint">
          <UsersIcon size={14} /> {roster.length} on the roster. Start typing to narrow the list.
        </p>
      )}
    </div>
  );
}
