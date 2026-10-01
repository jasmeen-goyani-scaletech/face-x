'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { TextField, SelectField } from '@/components/ui/Field';
import { PlusIcon, UsersIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { getDataClient } from '@/lib/data/client';
import type { Team, Tournament } from '@/lib/data/types';
import { genId } from '@/lib/format';
import { compact } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ tournamentId: '', teamName: '', club: '', division: '' });
  const { error, blur, submit, reset } = useFieldErrors(
    compact({
      tournamentId: form.tournamentId ? null : 'Please select a tournament.',
      teamName: form.teamName.trim() ? null : 'Please enter a team name.'
    }),
    ['tournamentId', 'teamName'] as const
  );

  async function reload() {
    const client = getDataClient();
    setTeams(await client.teams.list());
    setTournaments(await client.tournaments.list());
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!form.tournamentId && tournaments.length > 0) {
      setForm((f) => ({ ...f, tournamentId: tournaments[0].id }));
    }
  }, [tournaments, form.tournamentId]);

  async function create() {
    if (!submit()) return;
    const client = getDataClient();
    await client.teams.create({
      tournamentId: form.tournamentId,
      teamName: form.teamName.trim(),
      club: form.club.trim(),
      division: form.division.trim(),
      inviteCode: genId('INVITE'),
      status: 'active'
    });
    await reload();
    setForm({ tournamentId: form.tournamentId, teamName: '', club: '', division: '' });
    reset();
    setShowCreate(false);
  }

  function tournamentName(tournamentId: string) {
    return tournaments.find((t) => t.id === tournamentId)?.name || '—';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl mb-1">Teams</h1>
          <p className="text-ink-soft text-sm">Teams registrants pick from — the same source registration links use.</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate((v) => !v)} disabled={tournaments.length === 0}>
          <PlusIcon size={16} /> Create Team
        </Button>
      </div>

      {tournaments.length === 0 && (
        <Card className="mb-5">
          <p className="text-ink-soft text-sm">
            Create a{' '}
            <Link href="/admin/tournaments" className="text-primary-strong font-semibold no-underline">
              tournament
            </Link>{' '}
            first — teams belong to a tournament.
          </p>
        </Card>
      )}

      {showCreate && (
        <Card className="mb-5">
          <h2 className="text-lg mb-4">New Team</h2>
          <SelectField id="tournamentId" label="Tournament" value={form.tournamentId} error={error('tournamentId')} onBlur={blur('tournamentId')} onChange={(e) => setForm({ ...form, tournamentId: e.target.value })}>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField id="teamName" label="Team Name" value={form.teamName} error={error('teamName')} onBlur={blur('teamName')} onChange={(e) => setForm({ ...form, teamName: e.target.value })} />
            <TextField id="club" label="Club" optional value={form.club} onChange={(e) => setForm({ ...form, club: e.target.value })} />
            <TextField id="division" label="Division" optional placeholder="U14" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                setShowCreate(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={create}>
              Create
            </Button>
          </div>
        </Card>
      )}

      {teams === null && <p className="text-ink-soft text-sm">Loading…</p>}

      {teams?.length === 0 && (
        <Card className="text-center py-10">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No teams yet.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {teams?.map((t) => (
          <Link key={t.id} href={`/admin/teams/${t.id}`} className="no-underline">
            <Card className="flex items-center justify-between gap-3 hover:border-line-strong">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-ink">{t.teamName}</span>
                  {t.status === 'disabled' && <Chip kind="warning">Disabled</Chip>}
                </div>
                <div className="text-[12.5px] text-ink-soft">
                  {t.club || '—'} · {tournamentName(t.tournamentId)}
                </div>
              </div>
              <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
