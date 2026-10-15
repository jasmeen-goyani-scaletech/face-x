'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { ChevronLeftIcon } from '@/components/ui/Icons';
import { describeError, hasCode } from '@/lib/api/errors';
import { getAccessibleTeam, getAccessibleTeamRoster } from '@/lib/api/teamAccess';
import type { ApiAccessibleTeam, ApiTeamLimit, ApiTeamMember } from '@/lib/api/types';
import { formatDate } from '@/lib/format';

type State =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; team: ApiAccessibleTeam; roster: ApiTeamMember[] };

const limitText = (label: string, l: ApiTeamLimit) => `${label}: ${l.used}${l.max !== null ? ` of ${l.max}` : ''}`;

/** One assigned team and the people on it. A team outside the caller's scope is "not found" (the API answers 404). */
export default function MyTeamDetail({ teamId }: { teamId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [team, roster] = await Promise.all([getAccessibleTeam(teamId), getAccessibleTeamRoster(teamId)]);
      setState({ kind: 'ready', team, roster });
    } catch (e) {
      if (hasCode(e, 'TEAM_NOT_FOUND', 'VALIDATION_ERROR')) setState({ kind: 'notfound' });
      else setState({ kind: 'error', message: describeError(e, 'We couldn’t load this team. Please try again.') });
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = (
    <Link href="/admin/my-teams" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink">
      <ChevronLeftIcon size={16} /> My Teams
    </Link>
  );

  if (state.kind === 'loading') return <p role="status" className="text-ink-soft text-sm">Loading…</p>;
  if (state.kind === 'notfound') {
    return (
      <div>
        {back}
        <Card>
          <p className="m-0 text-ink-soft">Team not found, or it isn’t one of your teams.</p>
        </Card>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div>
        {back}
        <Card>
          <Alert level="danger" title="We couldn’t load this team">
            {state.message}
          </Alert>
          <Button variant="primary" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  const { team, roster } = state;
  // Staff details are for admins; a coach or staff member sees the players only.
  const seesStaff = team.via === 'ADMIN';
  const groups = [
    { title: 'Players', rows: roster.filter((m) => m.registrantType === 'PLAYER') },
    ...(seesStaff ? [{ title: 'Staff', rows: roster.filter((m) => m.registrantType === 'STAFF') }] : [])
  ];

  return (
    <div>
      {back}
      <Card className="mb-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="m-0 text-xl">{team.name}</h1>
          {team.status === 'DISABLED' && <Chip kind="warning">Disabled</Chip>}
        </div>
        <p className="m-0 mt-1 text-sm text-ink-soft">{[team.club, team.division].filter(Boolean).join(' · ')}</p>
        <p className="m-0 mt-1 text-sm text-ink-soft">Tournament: {team.event.name}</p>
        <p className="m-0 mt-3 text-sm text-ink-soft">
          {limitText('Players', team.limits.players)} · {limitText('Coaches', team.limits.coaches)}
          {seesStaff && <> · {limitText('Staff', team.limits.staff)}</>}
        </p>
        {team.inviteCode && (
          <p className="m-0 mt-1 text-sm text-ink-soft">
            Invite code: <strong className="text-ink">{team.inviteCode}</strong>
          </p>
        )}
      </Card>

      {groups.map((group) => (
        <Card key={group.title} className="mb-5">
          <h2 className="mb-3 text-lg">
            {group.title} ({group.rows.length})
          </h2>
          {group.rows.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft">No {group.title.toLowerCase()} registered yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {group.rows.map((m) => (
                <li key={m.registrationId} className="flex flex-wrap items-center justify-between gap-2 rounded-s border border-line px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">
                      {m.firstName} {m.lastName}
                    </div>
                    <div className="text-[12.5px] text-ink-faint">
                      {m.registrationNumber}
                      {m.dateOfBirth ? ` · ${formatDate(m.dateOfBirth)}` : ''}
                      {m.guardianName ? ` · Guardian: ${m.guardianName}${m.guardianPhone ? ` (${m.guardianPhone})` : ''}` : m.phone ? ` · ${m.phone}` : ''}
                    </div>
                  </div>
                  <Chip compact kind={m.eventAccessDisabled ? 'danger' : m.approved ? 'success' : 'warning'}>
                    {m.eventAccessDisabled ? 'Access off' : m.approved ? 'Approved' : 'Pending'}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
