'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { describeError } from '@/lib/api/errors';
import { getMyTeams } from '@/lib/api/teamAccess';
import type { ApiAccessibleTeam } from '@/lib/api/types';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; teams: ApiAccessibleTeam[] };

/** The teams a coach or staff member was assigned to. Nothing else of the league is listed. */
export default function MyTeamsList() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  async function load() {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', teams: await getMyTeams() });
    } catch (e) {
      setState({ kind: 'error', message: describeError(e, 'We couldn’t load your teams. Please try again.') });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (state.kind === 'loading') return <p role="status" className="text-ink-soft text-sm">Loading…</p>;
  if (state.kind === 'error') {
    return (
      <Card>
        <Alert level="danger" title="We couldn’t load your teams">
          {state.message}
        </Alert>
        <Button variant="primary" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    );
  }

  return (
    <div>
      <h1 className="text-2xl mb-1">My Teams</h1>
      <p className="text-ink-soft text-sm mb-5">The teams you have been assigned to. You can see the players and details of these teams only.</p>
      {state.teams.length === 0 ? (
        <Card>
          <p className="m-0 text-ink-soft">
            You have no teams yet. Teams appear here once the league has assigned them to you and your registration is approved.
          </p>
        </Card>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
          {state.teams.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/my-teams/${t.id}`} className="block no-underline">
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="m-0 truncate text-lg">{t.name}</h2>
                      <p className="m-0 mt-1 text-sm text-ink-soft">{[t.club, t.division].filter(Boolean).join(' · ')}</p>
                      <p className="m-0 mt-1 text-[12.5px] text-ink-faint">{t.event.name}</p>
                    </div>
                    {t.status === 'DISABLED' && <Chip kind="warning">Disabled</Chip>}
                  </div>
                  <p className="m-0 mt-3 text-sm text-ink-soft">
                    {t.limits.players.used} player{t.limits.players.used === 1 ? '' : 's'}
                    {t.limits.players.max !== null ? ` of ${t.limits.players.max}` : ''}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
