'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import Alert from '@/components/ui/Alert';
import { CalendarIcon, ChevronRightIcon, ShieldIcon, TrophyIcon, UsersIcon } from '@/components/ui/Icons';
import { getDataClient } from '@/lib/data/client';
import type { Team, Tournament } from '@/lib/data/types';
import { resolveTeamById } from '@/lib/teams';
import { formatDate } from '@/lib/format';

const ROLE_CARDS: { key: 'player' | 'coach' | 'staff'; title: string; desc: string; icon: typeof TrophyIcon }[] = [
  { key: 'player', title: 'Player', desc: 'Register an athlete for this team.', icon: TrophyIcon },
  { key: 'coach', title: 'Coach', desc: 'Register as a coach for this team.', icon: UsersIcon },
  { key: 'staff', title: 'Staff', desc: 'Register as team/event staff.', icon: ShieldIcon }
];

function TournamentRegisterFlow({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const teamIdParam = params.get('teamId');
  const roleParam = params.get('role') as 'player' | 'coach' | 'staff' | null;

  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState(teamIdParam ?? '');

  useEffect(() => {
    const client = getDataClient();
    client.tournaments.get(tournamentId).then(setTournament);
    client.teams.listByTournament(tournamentId).then((list) => setTeams(list.filter((t) => t.status === 'active')));
  }, [tournamentId]);

  // Team + role both known up front → skip straight into the existing wizard, no selection needed.
  useEffect(() => {
    if (!teamIdParam || !roleParam) return;
    const invite = resolveTeamById(teamIdParam);
    if (!invite) return;
    router.replace(`/register/${roleParam}?teamId=${invite.teamId}&inviteCode=${invite.inviteCode}`);
  }, [teamIdParam, roleParam, router]);

  if (tournament === undefined) return <p className="text-ink-soft text-sm px-5 pt-8">Loading…</p>;

  if (tournament === null || tournament.status !== 'published') {
    return (
      <div className="mx-auto max-w-[560px] px-5 pt-10">
        <Alert level="warning" title="Registration not available">
          This tournament isn&rsquo;t currently open for registration. Please check the link or contact the organizer.
        </Alert>
      </div>
    );
  }

  if (teamIdParam && roleParam) {
    // Waiting on the redirect effect above (or the link was invalid).
    const invite = resolveTeamById(teamIdParam);
    if (!invite) {
      return (
        <div className="mx-auto max-w-[560px] px-5 pt-10">
          <Alert level="danger" title="Link not valid">
            This registration link&rsquo;s team could not be found or is no longer active.
          </Alert>
        </div>
      );
    }
    return <p className="text-ink-soft text-sm px-5 pt-8">Redirecting…</p>;
  }

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  return (
    <div className="mx-auto max-w-[560px] px-5 pt-8 pb-16">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-ink-soft text-sm mb-1">
          <CalendarIcon size={14} /> {formatDate(tournament.date)}
        </div>
        <h1 className="text-2xl">{tournament.name}</h1>
        {tournament.location && <p className="text-ink-soft text-sm mt-1">{tournament.location}</p>}
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
                    <div className="font-bold text-ink">{t.teamName}</div>
                    <div className="text-[13px] text-ink-soft">{t.club}</div>
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
          <h2 className="text-lg mb-1">Register for {selectedTeam.teamName}</h2>
          <p className="text-ink-soft text-sm mb-4">Choose your role to continue.</p>
          <div className="flex flex-col gap-2.5">
            {ROLE_CARDS.map((r) => {
              const Icon = r.icon;
              const invite = resolveTeamById(selectedTeam.id);
              const href = invite ? `/register/${r.key}?teamId=${invite.teamId}&inviteCode=${invite.inviteCode}` : '#';
              return (
                <a
                  key={r.key}
                  href={href}
                  className="flex items-center justify-between rounded-l border border-line bg-surface px-5 py-4 no-underline hover:border-primary"
                >
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
        <TournamentRegisterFlow tournamentId={params.tournamentId} />
      </Suspense>
    </main>
  );
}
