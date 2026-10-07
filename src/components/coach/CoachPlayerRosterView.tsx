'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import Dialog from '@/components/ui/Dialog';
import { ChevronLeftIcon, MessageIcon, PhoneIcon, SearchIcon, UsersIcon, XIcon } from '@/components/ui/Icons';
import { CoachGateCard, useCoachTeam } from './useCoachTeam';
import { calcAge } from '@/lib/age';
import { contactOptions } from '@/lib/contactOptions';
import { formatDate, initialsOf } from '@/lib/format';
import type { RosterEntry } from '@/lib/seed';

const NO_PLAYERS: RosterEntry[] = [];
const isMinor = (p: RosterEntry) => (calcAge(p.dob) ?? 99) < 18;

const actionBase =
  'touch-target inline-flex flex-1 items-center justify-center gap-2 rounded-s border px-3 py-2 text-[13px] font-bold no-underline transition-colors';

function Avatar({ player, size }: { player: RosterEntry; size: 'md' | 'lg' }) {
  return (
    <span
      className={[
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2 font-display font-bold text-ink-soft',
        size === 'lg' ? 'h-20 w-20 text-2xl' : 'h-14 w-14 text-lg'
      ].join(' ')}
    >
      {player.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={player.photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(player.firstName, player.lastName)
      )}
    </span>
  );
}

/**
 * Call Player / Call Parent, from the numbers on file. A button with no number says so instead of doing nothing.
 * Call Parent is for minors only; an adult has no parent to call, so Call Player takes the full width.
 */
function ContactActions({ player }: { player: RosterEntry }) {
  const options = contactOptions(player);
  const callClass = `${actionBase} border-line-strong bg-surface text-ink hover:bg-surface-2`;
  const disabledClass = `${actionBase} cursor-not-allowed border-line bg-surface-2 text-ink-faint`;
  return (
    <div className="flex gap-2">
      {options.playerPhone ? (
        <a href={`tel:${options.playerPhone}`} className={callClass}>
          <PhoneIcon size={15} /> Call Player
        </a>
      ) : (
        <span className={disabledClass} aria-disabled="true" title="No phone number on file for the player">
          <PhoneIcon size={15} /> Call Player
        </span>
      )}
      {options.minor &&
        (options.parentPhone ? (
          <a href={`tel:${options.parentPhone}`} className={callClass}>
            <PhoneIcon size={15} /> Call Parent
          </a>
        ) : (
          <span className={disabledClass} aria-disabled="true" title="No phone number on file for a parent or guardian">
            <PhoneIcon size={15} /> Call Parent
          </span>
        ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="m-0 mt-0.5 break-words text-sm font-medium text-ink">{children || '—'}</dd>
    </div>
  );
}

/** The few things a coach needs about one player. Deliberately no flags, notes, payment, documents or audit history. */
function PlayerDetailDialog({ player, onClose }: { player: RosterEntry | null; onClose: () => void }) {
  const minor = player ? isMinor(player) : true;
  const age = player ? calcAge(player.dob) : null;
  const options = player ? contactOptions(player) : null;
  const number = (minor ? options?.parentPhone : options?.playerPhone) ?? null;

  return (
    <Dialog open={!!player} onClose={onClose} labelledBy="player-detail-title" size="md" initialFocus="button[data-close]">
      {player && (
        <>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <Avatar player={player} size="lg" />
              <div className="min-w-0">
                <h2 id="player-detail-title" className="m-0 truncate text-xl">
                  {player.firstName} {player.lastName}
                </h2>
                <div className="mt-1.5">
                  <Chip compact kind={player.approved ? 'success' : 'warning'}>
                    {player.approved ? 'Approved' : 'Pending approval'}
                  </Chip>
                </div>
              </div>
            </div>
            <button type="button" data-close aria-label="Close" onClick={onClose} className="touch-target -mr-2 -mt-2 flex items-center justify-center rounded-s text-ink-soft hover:text-ink">
              <XIcon size={18} />
            </button>
          </div>

          <section aria-label="Basic info" className="mb-5">
            <h3 className="mb-2.5 mt-0 text-[12px] tracking-wider text-ink-soft">Basic info</h3>
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3.5">
              <Field label="Full name">{`${player.firstName} ${player.lastName}`}</Field>
              <Field label="Date of birth">{formatDate(player.dob)}</Field>
              <Field label="Age · Division">{`${age ?? '—'} · ${player.division || '—'}`}</Field>
              <Field label="Jersey number">{player.jerseyNumber ? `#${player.jerseyNumber}` : ''}</Field>
              <Field label="Position">{player.position}</Field>
            </dl>
          </section>

          <section aria-label="Registration" className="mb-5">
            <h3 className="mb-2.5 mt-0 text-[12px] tracking-wider text-ink-soft">Registration</h3>
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3.5">
              <Field label="Registration ID">{player.schoolId}</Field>
              <Field label="Status">{player.approved ? 'Approved' : 'Pending approval'}</Field>
            </dl>
          </section>

          <section aria-label={minor ? 'Guardian contact' : 'Player contact'} className="mb-6">
            <h3 className="mb-2.5 mt-0 text-[12px] tracking-wider text-ink-soft">{minor ? 'Guardian contact' : 'Player contact'}</h3>
            <dl className="m-0 mb-3 grid grid-cols-2 gap-x-6 gap-y-3.5">
              {minor && <Field label="Parent / guardian">{player.guardianName}</Field>}
              <Field label="Phone">{minor ? player.parentPhone : player.phone}</Field>
            </dl>
            {number && (
              <div className="flex gap-2">
                <a href={`tel:${number}`} className={`${actionBase} border-line-strong bg-surface text-ink hover:bg-surface-2`}>
                  <PhoneIcon size={15} /> Call
                </a>
                <a href={`sms:${number}`} className={`${actionBase} border-line-strong bg-surface text-ink hover:bg-surface-2`}>
                  <MessageIcon size={15} /> SMS
                </a>
              </div>
            )}
          </section>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/**
 * The coach's team: players only.
 *
 * The list comes from `useCoachTeam`, which hands over only roster entries with role "player" and the coach's exact team id.
 * Staff, other coaches and other teams' players never reach this component. Each card shows who the player is and how to
 * reach their parent; clicking the card opens a short summary.
 *
 * Jersey number and position aren't collected at registration yet, so real registrants show "—"; the sample players carry
 * demo values. Emergency contact was removed from registration, so it isn't shown. Only the guardian is.
 */
export default function CoachPlayerRosterView() {
  const state = useCoachTeam();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const players = state.kind === 'ready' ? state.players : NO_PLAYERS;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return players
      .filter((p) => !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || p.jerseyNumber === q || p.schoolId.toLowerCase().includes(q))
      .sort((a, b) => (Number(a.jerseyNumber) || 999) - (Number(b.jerseyNumber) || 999) || a.lastName.localeCompare(b.lastName));
  }, [players, query]);

  if (state.kind === 'loading') return null;
  if (state.kind === 'gate') return <CoachGateCard gate={state} />;

  const open = players.find((p) => p.id === openId) ?? null;

  return (
    <div>
      <Link href="/register/coach" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink">
        <ChevronLeftIcon size={16} /> Back to my status
      </Link>

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-2xl">My Team — Roster</h1>
            <p className="m-0 mt-1 text-[15px] font-semibold text-ink">{state.team.teamName}</p>
          </div>
          <div className="text-right">
            <div className="font-display text-3xl font-bold text-ink">{players.length}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Players</div>
          </div>
        </div>
      </Card>

      <div className="relative mb-4 sm:max-w-sm">
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

      {players.length === 0 ? (
        <Card className="py-10 text-center">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="m-0 text-sm text-ink-soft">No players have joined {state.team.teamName} yet.</p>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="py-10 text-center text-sm text-ink-soft">No players match “{query}”.</Card>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id}>
              <Card className="flex h-full flex-col gap-3 !p-4">
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  aria-label={`View details for ${p.firstName} ${p.lastName}`}
                  className="-m-1 flex items-center gap-3 rounded-s p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="relative shrink-0">
                    <Avatar player={p} size="md" />
                    {p.jerseyNumber && (
                      <span className="absolute -bottom-1 -right-1 min-w-[1.6rem] rounded-full border-2 border-surface bg-primary px-1.5 text-center text-[11px] font-bold leading-5 text-primary-foreground">
                        #{p.jerseyNumber}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-bold text-ink">
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="block truncate text-[13px] text-ink-soft">{p.position || 'Position not set'}</span>
                  </span>
                </button>
                <div className="mt-auto">
                  <ContactActions player={p} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <PlayerDetailDialog player={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
