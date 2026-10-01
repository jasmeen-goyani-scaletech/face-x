'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { TextField, SelectField } from '@/components/ui/Field';
import { ChevronLeftIcon, CopyIcon, UsersIcon } from '@/components/ui/Icons';
import { getDataClient } from '@/lib/data/client';
import type { Team, Tournament } from '@/lib/data/types';
import { generateTournamentLink } from '@/lib/teams';
import { compact } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import Link from 'next/link';

const ROLES: { key: 'player' | 'coach' | 'staff'; label: string }[] = [
  { key: 'player', label: 'Player' },
  { key: 'coach', label: 'Coach' },
  { key: 'staff', label: 'Staff' }
];

function CopyRow({ label, link }: { label: string; link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-s border border-line px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        <div className="text-[12px] text-ink-faint truncate">{link}</div>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard unavailable — link text is still visible to copy manually
          }
        }}
        className="shrink-0 flex items-center gap-1.5 rounded-s border border-line-strong px-3 py-1.5 text-[12.5px] font-bold text-ink-soft hover:text-ink"
      >
        <CopyIcon size={14} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function TournamentDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [teams, setTeams] = useState<Team[]>([]);
  const [form, setForm] = useState<Partial<Tournament>>({});
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const { error, blur, submit } = useFieldErrors(
    compact({
      name: form.name?.trim() ? null : 'Please enter a tournament name.',
      date: form.date ? null : 'Please choose the tournament date.'
    }),
    ['name', 'date'] as const
  );

  useEffect(() => {
    const client = getDataClient();
    client.tournaments.get(id).then((t) => {
      setTournament(t);
      if (t) setForm(t);
    });
    client.teams.listByTournament(id).then(setTeams);
  }, [id]);

  async function save() {
    if (!submit()) return;
    const client = getDataClient();
    const updated = await client.tournaments.update(id, form);
    setTournament(updated);
  }

  async function setStatus(status: Tournament['status']) {
    const client = getDataClient();
    const updated = await client.tournaments.update(id, { status });
    setTournament(updated);
    setForm((f) => ({ ...f, status }));
  }

  if (tournament === undefined) return <p className="text-ink-soft text-sm">Loading…</p>;
  if (tournament === null) {
    return (
      <Card>
        <p className="text-ink-soft">Tournament not found.</p>
        <Link href="/admin/tournaments" className="text-primary-strong text-sm font-semibold no-underline">
          ← Back to Tournaments
        </Link>
      </Card>
    );
  }

  const activeTeams = teams.filter((t) => t.status === 'active');

  return (
    <div>
      <button onClick={() => router.push('/admin/tournaments')} className="flex items-center gap-1.5 text-ink-soft text-sm font-semibold mb-4">
        <ChevronLeftIcon size={16} /> Tournaments
      </button>

      <Card className="mb-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl">{tournament.name}</h1>
          <Chip kind={tournament.status === 'published' ? 'success' : tournament.status === 'closed' ? 'warning' : 'neutral'}>
            {tournament.status}
          </Chip>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <TextField id="name" label="Tournament Name" value={form.name ?? ''} error={error('name')} onBlur={blur('name')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField id="date" label="Date" type="date" value={form.date ?? ''} error={error('date')} onBlur={blur('date')} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <TextField id="time" label="Time" optional value={form.time ?? ''} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          <TextField id="location" label="Location" optional value={form.location ?? ''} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <div className="flex flex-wrap justify-between gap-2 mt-2">
          <div className="flex gap-2">
            {tournament.status !== 'published' && (
              <Button variant="secondary" onClick={() => setStatus('published')}>
                Publish
              </Button>
            )}
            {tournament.status !== 'closed' && (
              <Button variant="secondary" onClick={() => setStatus('closed')}>
                Close
              </Button>
            )}
          </div>
          <Button variant="primary" onClick={save}>
            Save Changes
          </Button>
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="text-lg mb-1">Teams</h2>
        <p className="text-ink-soft text-sm mb-3">{activeTeams.length} active team{activeTeams.length === 1 ? '' : 's'} in this tournament.</p>
        {activeTeams.length === 0 ? (
          <div className="text-center py-6 text-ink-faint">
            <UsersIcon size={26} className="mx-auto mb-2" />
            <p className="text-sm">
              No teams yet.{' '}
              <Link href="/admin/teams" className="text-primary-strong font-semibold no-underline">
                Create one
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {activeTeams.map((t) => (
              <Link key={t.id} href={`/admin/teams/${t.id}`} className="rounded-s border border-line px-3.5 py-2.5 text-sm font-semibold text-ink no-underline hover:border-line-strong">
                {t.teamName} <span className="font-normal text-ink-soft">— {t.club}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg mb-1">Registration Links</h2>
        <p className="text-ink-soft text-sm mb-4">Share the common link, or generate a team-specific link that skips selection.</p>

        <CopyRow label="Common link — Team & role selected by the registrant" link={generateTournamentLink({ tournamentId: id })} />

        {activeTeams.length > 0 && (
          <div className="mt-4">
            <SelectField id="team-pick" label="Generate a team-specific link" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
              <option value="">Select a team…</option>
              {activeTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.teamName}
                </option>
              ))}
            </SelectField>
            {selectedTeamId && (
              <div className="flex flex-col gap-2 mt-1">
                {ROLES.map((r) => (
                  <CopyRow
                    key={r.key}
                    label={`${r.label} — ${activeTeams.find((t) => t.id === selectedTeamId)?.teamName}`}
                    link={generateTournamentLink({ tournamentId: id, teamId: selectedTeamId, role: r.key })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
