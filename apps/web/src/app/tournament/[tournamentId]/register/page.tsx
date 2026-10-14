'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import RequireAuth from '@/components/auth/RequireAuth';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { CalendarIcon, ChevronRightIcon, ShieldIcon, TrophyIcon, UsersIcon } from '@/components/ui/Icons';
import { getEvent, listTeams } from '@/lib/api/catalog';
import { describeError, hasCode } from '@/lib/api/errors';
import type { ApiEvent, ApiTeam } from '@/lib/api/types';
import { formatEventStart } from '@/lib/format';

const ROLE_CARDS: { key: 'player' | 'coach' | 'staff'; title: string; desc: string; icon: typeof TrophyIcon }[] = [
  { key: 'player', title: 'Player', desc: 'Register an athlete for this team.', icon: TrophyIcon },
  { key: 'coach', title: 'Coach', desc: 'Register as a coach for this team.', icon: UsersIcon },
  { key: 'staff', title: 'Staff', desc: 'Register as team/event staff.', icon: ShieldIcon }
];

type Loaded = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'error'; message: string } | { kind: 'ready'; event: ApiEvent; teams: ApiTeam[] };

function TournamentRegisterFlow({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const teamIdParam = params.get('teamId');
  const inviteCodeParam = params.get('inviteCode');
  const roleParam = params.get('role');
  const role = ROLE_CARDS.find((r) => r.key === roleParam)?.key ?? null;

  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [selectedTeamId, setSelectedTeamId] = useState(teamIdParam ?? '');
  const [attempt, setAttempt] = useState(0);

  // A team-specific link (team, invite code and role all known) goes straight into the registration form, which checks the invite.
  const direct = !!(teamIdParam && inviteCodeParam && role);
  useEffect(() => {
    if (direct) router.replace(`/register/${role}?teamId=${encodeURIComponent(teamIdParam)}&inviteCode=${encodeURIComponent(inviteCodeParam)}`);
  }, [direct, role, teamIdParam, inviteCodeParam, router]);

  useEffect(() => {
    if (direct) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    Promise.all([getEvent(tournamentId), listTeams(tournamentId)])
      .then(([event, teams]) => !cancelled && setState(event.registrationOpen ? { kind: 'ready', event, teams } : { kind: 'unavailable' }))
      .catch((e) => {
        if (cancelled) return;
        // An unknown, unpublished or malformed id is simply not a tournament that takes registrations.
        setState(hasCode(e, 'EVENT_NOT_FOUND', 'VALIDATION_ERROR') ? { kind: 'unavailable' } : { kind: 'error', message: describeError(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, direct, attempt]);

  if (direct) return <p role="status" className="text-ink-soft text-sm px-5 pt-8">Redirecting…</p>;
  if (state.kind === 'loading') return <p role="status" className="text-ink-soft text-sm px-5 pt-8">Loading…</p>;

  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-[560px] px-5 pt-10">
        <Alert level="danger" title="We couldn’t load this tournament">
          {state.message}
        </Alert>
        <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <div className="mx-auto max-w-[560px] px-5 pt-10">
        <Alert level="warning" title="Registration not available">
          This tournament isn&rsquo;t currently open for registration. Please check the link or contact the organizer.
        </Alert>
      </div>
    );
  }

  // A team-specific link without a valid invite code can't be trusted to name a team: fall back to choosing one.
  const { event, teams } = state;
  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  return (
    <div className="mx-auto max-w-[560px] px-5 pt-8 pb-16">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-ink-soft text-sm mb-1">
          <CalendarIcon size={14} /> {formatEventStart(event.startsAt, event.timezone)}
        </div>
        <h1 className="text-2xl">{event.name}</h1>
        {event.location && <p className="text-ink-soft text-sm mt-1">{event.location}</p>}
      </div>

      {!selectedTeam ? (
        <>
          <h2 className="text-lg mb-3">Select your team</h2>
          {teams.length === 0 ? (
            <Alert level="info" title="No teams yet">
              This tournament doesn&rsquo;t have any teams open for registration yet.
            </Alert>
          ) : (
            <div className="flex flex-col gap-2.5">
              {teams.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTeamId(t.id)}
                  className="flex items-center justify-between rounded-l border border-line bg-surface px-5 py-4 text-left hover:border-primary"
                >
                  <div>
                    <div className="font-bold text-ink">{t.name}</div>
                    <div className="text-[13px] text-ink-soft">
                      {t.club || '—'} · {t.division}
                    </div>
                  </div>
                  <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button onClick={() => setSelectedTeamId('')} className="text-primary-strong text-sm font-semibold mb-4">
            ← Change team
          </button>
          <h2 className="text-lg mb-1">Register for {selectedTeam.name}</h2>
          <p className="text-ink-soft text-sm mb-4">Choose your role to continue.</p>
          <div className="flex flex-col gap-2.5">
            {ROLE_CARDS.map((r) => {
              const Icon = r.icon;
              const href = `/register/${r.key}?eventId=${encodeURIComponent(event.id)}&teamId=${encodeURIComponent(selectedTeam.id)}`;
              return (
                <a key={r.key} href={href} className="flex items-center justify-between rounded-l border border-line bg-surface px-5 py-4 no-underline hover:border-primary">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-s bg-primary-light text-primary-strong">
                      <Icon size={20} />
                    </span>
                    <div>
                      <div className="font-bold text-ink">{r.title}</div>
                      <div className="text-[13px] text-ink-soft">{r.desc}</div>
                    </div>
                  </div>
                  <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function TournamentRegisterPage({ params }: { params: { tournamentId: string } }) {
  return (
    <main>
      <Topbar eyebrow="New registration" />
      <Suspense fallback={<p className="text-ink-soft text-sm px-5 pt-8">Loading…</p>}>
        <RequireAuth allowGuest>
          <TournamentRegisterFlow tournamentId={params.tournamentId} />
        </RequireAuth>
      </Suspense>
    </main>
  );
}
