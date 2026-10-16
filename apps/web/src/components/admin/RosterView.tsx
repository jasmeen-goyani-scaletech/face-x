'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { SelectField } from '@/components/ui/Field';
import { UsersIcon } from '@/components/ui/Icons';
import { describeError } from '@/lib/api/errors';
import { getAccessibleTeamRoster, getMyTeams } from '@/lib/api/teamAccess';
import type { ApiTeamMember } from '@/lib/api/types';
import { initialsOf } from '@/lib/format';

interface RosterTeam {
  id: string;
  name: string;
  detail: string;
}

/** The teams a coach or staff member was assigned to; the API returns nothing else. */
async function listMyTeams(): Promise<RosterTeam[]> {
  const teams = await getMyTeams();
  return teams.map((t) => ({ id: t.id, name: t.name, detail: [t.club, t.division].filter(Boolean).join(' · ') }));
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; teams: RosterTeam[] };
type Players = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; players: ApiTeamMember[] };

/**
 * The roster, for coaches and staff only (admins have no roster screen). A coach or staff member picks from the teams they were
 * assigned to. Choosing a team lists the players on that team only. Scope is enforced by the API
 * (`/team-access/teams/:id/roster` answers 404 for a team the caller may not reach), this only chooses what to ask for.
 */
export default function RosterView() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [teamId, setTeamId] = useState('');
  const [players, setPlayers] = useState<Players>({ kind: 'idle' });
  // Only the newest answer is shown, so switching teams quickly can't leave another team's players on screen.
  const latest = useRef(0);

  const loadTeams = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const teams = await listMyTeams();
      setState({ kind: 'ready', teams });
      setTeamId((current) => (teams.some((t) => t.id === current) ? current : (teams[0]?.id ?? '')));
    } catch (e) {
      setState({ kind: 'error', message: describeError(e, 'We couldn’t load the teams. Please try again.') });
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const loadPlayers = useCallback(async (id: string) => {
    const mine = ++latest.current;
    if (!id) return setPlayers({ kind: 'idle' });
    setPlayers({ kind: 'loading' });
    try {
      const roster = await getAccessibleTeamRoster(id);
      if (mine === latest.current) setPlayers({ kind: 'ready', players: roster.filter((m) => m.registrantType === 'PLAYER') });
    } catch (e) {
      if (mine === latest.current) setPlayers({ kind: 'error', message: describeError(e, 'We couldn’t load this team’s players. Please try again.') });
    }
  }, []);

  useEffect(() => {
    void loadPlayers(teamId);
  }, [teamId, loadPlayers]);

  const heading = (
    <>
      <h1 className="text-2xl mb-1">Roster</h1>
      <p className="text-ink-soft text-sm mb-5">
        Pick one of your teams to see its players. You can see the teams you have been assigned to, and no others.
      </p>
    </>
  );

  if (state.kind === 'loading') return <p role="status" className="text-ink-soft text-sm">Loading…</p>;
  if (state.kind === 'error') {
    return (
      <div>
        {heading}
        <Card>
          <Alert level="danger" title="We couldn’t load the teams">
            {state.message}
          </Alert>
          <Button variant="primary" onClick={() => void loadTeams()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }
  if (state.teams.length === 0) {
    return (
      <div>
        {heading}
        <Card className="text-center py-10">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="m-0 text-sm text-ink-soft">
            You have no teams yet. Teams appear here once the league has assigned them to you and your registration is approved.
          </p>
        </Card>
      </div>
    );
  }

  const team = state.teams.find((t) => t.id === teamId);

  return (
    <div>
      {heading}
      <Card className="mb-5">
        <SelectField id="roster-team" label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} hint={team?.detail || undefined}>
          {state.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
      </Card>

      {players.kind === 'loading' && <p role="status" className="text-ink-soft text-sm">Loading players…</p>}
      {players.kind === 'error' && (
        <Card>
          <Alert level="danger" title="We couldn’t load the players">
            {players.message}
          </Alert>
          <Button variant="primary" onClick={() => void loadPlayers(teamId)}>
            Try again
          </Button>
        </Card>
      )}
      {players.kind === 'ready' && (
        <section aria-label={`${team?.name ?? 'Team'} players`}>
          <h2 className="mb-3 text-[13px] tracking-wide uppercase">
            {team?.name} roster ({players.players.length})
          </h2>
          {players.players.length === 0 ? (
            <Card className="text-center py-10">
              <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
              <p className="m-0 text-sm text-ink-soft">No players have joined this team yet.</p>
            </Card>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {players.players.map((m) => (
                <li key={m.registrationId} className="flex items-center gap-3 rounded-s border border-line bg-surface px-3.5 py-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-display text-sm font-bold text-ink-soft">
                    {initialsOf(m.firstName, m.lastName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-ink">
                      {m.firstName} {m.lastName}
                    </div>
                    <div className="text-[12.5px] text-ink-soft">Player</div>
                  </div>
                  <Chip compact kind={m.eventAccessDisabled ? 'danger' : m.approved ? 'success' : 'warning'}>
                    {m.eventAccessDisabled ? 'Access off' : m.approved ? 'Approved' : 'Pending'}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
