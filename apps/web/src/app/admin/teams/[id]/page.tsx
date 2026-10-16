'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { TextField } from '@/components/ui/Field';
import { ChevronLeftIcon, CopyIcon } from '@/components/ui/Icons';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import TeamLimitsCard from '@/components/admin/TeamLimitsCard';
import { getAdminEvent, getAdminTeam, updateAdminTeam } from '@/lib/api/admin';
import { describeError, fieldErrorsOf, hasCode } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiAdminTeam, ApiTeamStatus } from '@/lib/api/types';
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

type State = { kind: 'loading' } | { kind: 'notfound' } | { kind: 'error'; message: string } | { kind: 'ready'; team: ApiAdminTeam; event: ApiAdminEvent | null };

export default function TeamDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { notify } = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [form, setForm] = useState({ name: '', club: '', division: '' });
  const [saving, setSaving] = useState(false);
  // Set synchronously: a fast double-click would otherwise start twice before `saving` shows up in the next render.
  const flight = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  const { error, blur, submit } = useFieldErrors(
    compact({
      name: form.name.trim() ? null : 'Please enter a team name.',
      division: form.division.trim() ? null : 'Please enter the division, e.g. U14.'
    }),
    ['name', 'division'] as const
  );
  // The team awaiting confirmation to be disabled; non-null means the modal is open.
  const [teamToDisable, setTeamToDisable] = useState<ApiAdminTeam | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const team = await getAdminTeam(id);
      // The tournament's name is a nicety: the team page still works without it.
      const event = await getAdminEvent(team.eventId).catch(() => null);
      setState({ kind: 'ready', team, event });
      setForm({ name: team.name, club: team.club, division: team.division });
    } catch (e) {
      if (hasCode(e, 'TEAM_NOT_FOUND', 'VALIDATION_ERROR')) setState({ kind: 'notfound' });
      else setState({ kind: 'error', message: describeError(e) });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!submit() || saving || flight.current) return;
    flight.current = true;
    setSaving(true);
    setSaveError(null);
    setApiErrors({});
    try {
      const team = await updateAdminTeam(id, { name: form.name.trim(), club: form.club.trim(), division: form.division.trim() });
      setState((s) => (s.kind === 'ready' ? { ...s, team } : s));
      notify('Team saved.');
    } catch (e) {
      setSaveError(describeError(e, 'We couldn’t save the team. Please try again.'));
      setApiErrors(fieldErrorsOf(e));
    } finally {
      flight.current = false;
      setSaving(false);
    }
  }

  function closeDisableModal() {
    if (statusPending) return;
    setTeamToDisable(null);
    setDisableError(null);
  }

  async function applyStatus(target: ApiAdminTeam, next: ApiTeamStatus) {
    setStatusPending(true);
    try {
      const team = await updateAdminTeam(target.id, { status: next });
      setState((s) => (s.kind === 'ready' ? { ...s, team } : s));
      setTeamToDisable(null);
      setDisableError(null);
      notify(next === 'DISABLED' ? `${target.name} has been disabled.` : `${target.name} has been enabled.`);
    } catch (e) {
      if (next === 'DISABLED') {
        setDisableError(describeError(e, 'We couldn’t disable this team. Please try again.')); // modal stays open so they can retry
      } else {
        notify(describeError(e, 'We couldn’t enable this team. Please try again.'), 'danger');
      }
    } finally {
      setStatusPending(false);
    }
  }

  if (state.kind === 'loading') return <p role="status" className="text-ink-soft text-sm">Loading…</p>;
  if (state.kind === 'notfound') {
    return (
      <Card>
        <p className="text-ink-soft">Team not found.</p>
        <Link href="/admin/teams" className="text-primary-strong text-sm font-semibold no-underline">
          ← Back to Teams
        </Link>
      </Card>
    );
  }
  if (state.kind === 'error') {
    return (
      <Card>
        <Alert level="danger" title="We couldn’t load this team">
          {state.message}
        </Alert>
        <Button variant="primary" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    );
  }

  const { team, event } = state;
  const counts = team.registrations;

  // Disabling asks first; re-enabling is safe and undoes it, so it goes straight through.
  function onStatusButton() {
    if (team.status === 'ACTIVE') setTeamToDisable(team);
    else void applyStatus(team, 'ACTIVE');
  }

  return (
    <div>
      <button onClick={() => router.push('/admin/teams')} className="flex items-center gap-1.5 text-ink-soft text-sm font-semibold mb-4">
        <ChevronLeftIcon size={16} /> Teams
      </button>

      <Card className="mb-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl">{team.name}</h1>
          <Chip kind={team.status === 'ACTIVE' ? 'success' : 'warning'}>{team.status.toLowerCase()}</Chip>
        </div>
        {event && <p className="text-ink-soft text-sm mb-1">Tournament: {event.name}</p>}
        <p className="text-ink-soft text-sm mb-4">
          {counts.players} player{counts.players === 1 ? '' : 's'} · {counts.coaches} coach{counts.coaches === 1 ? '' : 'es'} · {counts.staff} staff
        </p>
        <SaveErrorAlert error={saveError} fieldErrors={apiErrors} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <TextField id="name" label="Team Name" value={form.name} error={error('name')} onBlur={blur('name')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField id="club" label="Club" optional value={form.club} onChange={(e) => setForm({ ...form, club: e.target.value })} />
          <TextField id="division" label="Division" value={form.division} error={error('division')} onBlur={blur('division')} onChange={(e) => setForm({ ...form, division: e.target.value })} />
        </div>
        <div className="flex justify-between gap-2 mt-2">
          <Button variant="secondary" onClick={onStatusButton} loading={statusPending && !teamToDisable}>
            {team.status === 'ACTIVE' ? 'Disable Team' : 'Enable Team'}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save Changes
          </Button>
        </div>
      </Card>

      <TeamLimitsCard key={JSON.stringify(team.limits)} team={team} onSaved={(saved) => setState((s) => (s.kind === 'ready' ? { ...s, team: saved } : s))} />

      <Card className="mt-5">
        <h2 className="text-lg mb-1">Registration Links</h2>
        <p className="text-ink-soft text-sm mb-4">Team and role are pre-filled — the registrant skips straight to the form.</p>
        {team.status === 'DISABLED' ? (
          <p className="text-warning text-sm">This team is disabled — its links won&rsquo;t resolve until it&rsquo;s enabled again.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {ROLES.map((r) => (
              <CopyRow key={r.key} label={r.label} link={generateTournamentLink({ tournamentId: team.eventId, teamId: team.id, inviteCode: team.inviteCode, role: r.key })} />
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={teamToDisable !== null}
        title="Disable Team?"
        description={
          <>
            Are you sure you want to disable <strong className="text-ink">{teamToDisable?.name}</strong>? Its registration links will stop working, so no one new can register under this team.
          </>
        }
        note="You can re-enable this team at any time from the team settings."
        confirmLabel="Yes, Disable Team"
        pending={statusPending}
        error={disableError}
        onConfirm={() => teamToDisable && void applyStatus(teamToDisable, 'DISABLED')}
        onCancel={closeDisableModal}
      />
    </div>
  );
}
