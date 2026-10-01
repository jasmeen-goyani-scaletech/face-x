'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { TextField } from '@/components/ui/Field';
import { ChevronLeftIcon, CopyIcon } from '@/components/ui/Icons';
import { getDataClient } from '@/lib/data/client';
import type { Team, Tournament } from '@/lib/data/types';
import { generateTournamentLink } from '@/lib/teams';
import { compact } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';

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

export default function TeamDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [form, setForm] = useState<Partial<Team>>({});
  const { notify } = useToast();
  const { error, blur, submit } = useFieldErrors(
    compact({ teamName: form.teamName?.trim() ? null : 'Please enter a team name.' }),
    ['teamName'] as const
  );
  // The team awaiting confirmation to be disabled; non-null means the modal is open.
  const [teamToDisable, setTeamToDisable] = useState<Team | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  useEffect(() => {
    const client = getDataClient();
    client.teams.get(id).then(async (t) => {
      setTeam(t);
      if (t) {
        setForm(t);
        setTournament(await client.tournaments.get(t.tournamentId));
      }
    });
  }, [id]);

  async function save() {
    if (!submit()) return;
    const client = getDataClient();
    const updated = await client.teams.update(id, form);
    setTeam(updated);
  }

  function closeDisableModal() {
    if (statusPending) return;
    setTeamToDisable(null);
    setDisableError(null);
  }

  async function applyStatus(target: Team, next: Team['status']) {
    setStatusPending(true);
    try {
      const updated = await getDataClient().teams.update(target.id, {
        status: next
      });
      if (!updated) throw new Error('Team not found');
      setTeam(updated);
      setForm((f) => ({ ...f, status: next }));
      setTeamToDisable(null);
      setDisableError(null);
      notify(next === 'disabled' ? `${target.teamName} has been disabled.` : `${target.teamName} has been enabled.`);
    } catch {
      if (next === 'disabled') {
        setDisableError('We couldn’t disable this team. Please try again.'); // modal stays open so they can retry
      } else {
        notify('We couldn’t enable this team. Please try again.', 'danger');
      }
    } finally {
      setStatusPending(false);
    }
  }

  // Disabling asks first; re-enabling is safe and undoes it, so it goes straight through.
  function onStatusButton() {
    if (!team) return;
    if (team.status === 'active') setTeamToDisable(team);
    else applyStatus(team, 'active');
  }

  if (team === undefined) return <p className="text-ink-soft text-sm">Loading…</p>;
  if (team === null) {
    return (
      <Card>
        <p className="text-ink-soft">Team not found.</p>
        <Link href="/admin/teams" className="text-primary-strong text-sm font-semibold no-underline">
          ← Back to Teams
        </Link>
      </Card>
    );
  }

  return (
    <div>
      <button onClick={() => router.push('/admin/teams')} className="flex items-center gap-1.5 text-ink-soft text-sm font-semibold mb-4">
        <ChevronLeftIcon size={16} /> Teams
      </button>

      <Card className="mb-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl">{team.teamName}</h1>
          <Chip kind={team.status === 'active' ? 'success' : 'warning'}>{team.status}</Chip>
        </div>
        {tournament && <p className="text-ink-soft text-sm mb-4">Tournament: {tournament.name}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <TextField
            id="teamName"
            label="Team Name"
            value={form.teamName ?? ''}
            error={error('teamName')}
            onBlur={blur('teamName')}
            onChange={(e) => setForm({ ...form, teamName: e.target.value })}
          />
          <TextField id="club" label="Club" optional value={form.club ?? ''} onChange={(e) => setForm({ ...form, club: e.target.value })} />
          <TextField
            id="division"
            label="Division"
            optional
            value={form.division ?? ''}
            onChange={(e) => setForm({ ...form, division: e.target.value })}
          />
        </div>
        <div className="flex justify-between gap-2 mt-2">
          <Button variant="secondary" onClick={onStatusButton} loading={statusPending && !teamToDisable}>
            {team.status === 'active' ? 'Disable Team' : 'Enable Team'}
          </Button>
          <Button variant="primary" onClick={save}>
            Save Changes
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg mb-1">Registration Links</h2>
        <p className="text-ink-soft text-sm mb-4">Team and role are pre-filled — the registrant skips straight to the form.</p>
        {team.status === 'disabled' ? (
          <p className="text-warning text-sm">This team is disabled — its links won&rsquo;t resolve until it&rsquo;s enabled again.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {ROLES.map((r) => (
              <CopyRow
                key={r.key}
                label={r.label}
                link={generateTournamentLink({
                  tournamentId: team.tournamentId,
                  teamId: team.id,
                  role: r.key
                })}
              />
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={teamToDisable !== null}
        title="Disable Team?"
        description={
          <>
            Are you sure you want to disable <strong className="text-ink">{teamToDisable?.teamName}</strong>? Its registration links will
            stop working, so no one new can register under this team.
          </>
        }
        note="You can re-enable this team at any time from the team settings."
        confirmLabel="Yes, Disable Team"
        pending={statusPending}
        error={disableError}
        onConfirm={() => teamToDisable && applyStatus(teamToDisable, 'disabled')}
        onCancel={closeDisableModal}
      />
    </div>
  );
}
