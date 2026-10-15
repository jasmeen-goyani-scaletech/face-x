'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { useToast } from '@/components/ui/Toast';
import { addTeamAssignment, listAdminTeams, listTeamAssignments, removeTeamAssignment } from '@/lib/api/admin';
import { describeError } from '@/lib/api/errors';
import type { ApiAdminTeam, ApiTeamAssignment } from '@/lib/api/types';

/**
 * The teams a coach or staff member can work with: add as many as needed, remove any. They only see the players of these
 * teams (the API enforces it), and only once their own registration is approved.
 */
export default function TeamAssignmentsCard({ registrationId, eventId, label }: { registrationId: string; eventId: string; label: string }) {
  const { notify } = useToast();
  const [assigned, setAssigned] = useState<ApiTeamAssignment[] | null>(null);
  const [teams, setTeams] = useState<ApiAdminTeam[]>([]);
  const [choice, setChoice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [mine, all] = await Promise.all([listTeamAssignments(registrationId), listAdminTeams(eventId)]);
      setAssigned(mine);
      setTeams(all);
      setError(null);
    } catch (e) {
      setError(describeError(e, 'We couldn’t load the teams. Please try again.'));
    }
  }, [registrationId, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const available = teams.filter((t) => !assigned?.some((a) => a.teamId === t.id));

  async function run(key: string, action: () => Promise<ApiTeamAssignment[]>, done: string) {
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      setAssigned(await action());
      notify(done);
    } catch (e) {
      setError(describeError(e, 'We couldn’t update the teams. Please try again.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="mt-5">
      <h2 className="text-lg mb-1">Assigned Teams</h2>
      <p className="text-ink-soft text-sm mb-4">
        This {label.toLowerCase()} can see the players and details of the teams below, and no others. Access starts once their registration is approved.
      </p>
      {error && (
        <Alert level="danger" title="Something went wrong">
          {error}
        </Alert>
      )}
      {assigned === null ? (
        !error && <p role="status" className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <>
          {assigned.length === 0 ? (
            <p className="text-ink-soft text-sm mb-4">No teams assigned yet.</p>
          ) : (
            <ul className="m-0 mb-4 flex list-none flex-col gap-2 p-0">
              {assigned.map((t) => (
                <li key={t.teamId} className="flex items-center justify-between gap-3 rounded-s border border-line px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{t.name}</div>
                    <div className="text-[12.5px] text-ink-faint">
                      {[t.club, t.division].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {t.status === 'DISABLED' && <Chip kind="warning">Disabled</Chip>}
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={pending === t.teamId}
                      disabled={pending !== null}
                      aria-label={`Remove ${t.name}`}
                      onClick={() => void run(t.teamId, () => removeTeamAssignment(registrationId, t.teamId), `${t.name} removed.`)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="assign-team" className="block text-[13px] font-semibold text-ink mb-1">
                Add a team
              </label>
              <select
                id="assign-team"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                disabled={available.length === 0}
                className="w-full rounded-s border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="">{available.length === 0 ? 'No more teams in this tournament' : 'Select a team…'}</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.division ? ` (${t.division})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="primary"
              disabled={!choice || pending !== null}
              loading={pending === 'add'}
              onClick={() =>
                void run('add', () => addTeamAssignment(registrationId, choice), 'Team added.').then(() => setChoice(''))
              }
            >
              Add Team
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
