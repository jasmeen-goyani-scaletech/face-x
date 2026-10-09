'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { SelectField } from '@/components/ui/Field';
import { ChevronLeftIcon, CopyIcon, UsersIcon } from '@/components/ui/Icons';
import { useToast } from '@/components/ui/Toast';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import TournamentFields, { API_FIELD_TO_FORM, formFromEvent, inputFromForm, tournamentErrors, type TournamentForm } from '@/components/admin/TournamentFields';
import { getAdminEvent, listAdminTeams, updateAdminEvent } from '@/lib/api/admin';
import { describeError, fieldErrorsOf, hasCode } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiAdminTeam, ApiEventStatus } from '@/lib/api/types';
import { generateTournamentLink } from '@/lib/teams';
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

const STATUS_KIND: Record<ApiEventStatus, 'neutral' | 'success' | 'warning'> = { DRAFT: 'neutral', PUBLISHED: 'success', CLOSED: 'warning' };

type State = { kind: 'loading' } | { kind: 'notfound' } | { kind: 'error'; message: string } | { kind: 'ready'; event: ApiAdminEvent; teams: ApiAdminTeam[] };

export default function TournamentDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { notify } = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [form, setForm] = useState<TournamentForm | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  const errors = form ? tournamentErrors(form) : {};
  const { error, blur, submit } = useFieldErrors(errors, ['name', 'date', 'startTime', 'endTime', 'location', 'fee'] as const);

  const load = useCallback(async () => {
    try {
      const [event, teams] = await Promise.all([getAdminEvent(id), listAdminTeams(id)]);
      setState({ kind: 'ready', event, teams });
      setForm(formFromEvent(event));
    } catch (e) {
      // 403 is another organization's event: to this admin it simply doesn't exist.
      if (hasCode(e, 'EVENT_NOT_FOUND', 'EVENT_ACCESS_DENIED', 'VALIDATION_ERROR')) setState({ kind: 'notfound' });
      else setState({ kind: 'error', message: describeError(e) });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(patch: Parameters<typeof updateAdminEvent>[1], success: string) {
    setSaving(true);
    setSaveError(null);
    setApiErrors({});
    try {
      const event = await updateAdminEvent(id, patch);
      setState((s) => (s.kind === 'ready' ? { ...s, event } : s));
      setForm(formFromEvent(event));
      notify(success);
    } catch (e) {
      setSaveError(describeError(e, 'We couldn’t save the tournament. Please try again.'));
      const labelled: Record<string, string> = {};
      for (const [path, message] of Object.entries(fieldErrorsOf(e))) labelled[API_FIELD_TO_FORM[path] ?? path] = message;
      setApiErrors(labelled);
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === 'loading') return <p role="status" className="text-ink-soft text-sm">Loading…</p>;
  if (state.kind === 'notfound') {
    return (
      <Card>
        <p className="text-ink-soft">Tournament not found.</p>
        <Link href="/admin/tournaments" className="text-primary-strong text-sm font-semibold no-underline">
          ← Back to Tournaments
        </Link>
      </Card>
    );
  }
  if (state.kind === 'error' || !form) {
    return (
      <Card>
        <Alert level="danger" title="We couldn’t load this tournament">
          {state.kind === 'error' ? state.message : 'Please try again.'}
        </Alert>
        <Button variant="primary" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    );
  }

  const { event, teams } = state;
  const activeTeams = teams.filter((t) => t.status === 'ACTIVE');
  const selectedTeam = activeTeams.find((t) => t.id === selectedTeamId);

  async function save() {
    if (!form || !submit()) return;
    await apply(inputFromForm(form), 'Tournament saved.');
  }

  return (
    <div>
      <button onClick={() => router.push('/admin/tournaments')} className="flex items-center gap-1.5 text-ink-soft text-sm font-semibold mb-4">
        <ChevronLeftIcon size={16} /> Tournaments
      </button>

      <Card className="mb-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl">{event.name}</h1>
          <Chip kind={STATUS_KIND[event.status]}>{event.status.toLowerCase()}</Chip>
        </div>
        <SaveErrorAlert error={saveError} fieldErrors={apiErrors} />
        <TournamentFields form={form} onChange={setForm} error={error} blur={blur} />
        <div className="flex flex-wrap justify-between gap-2 mt-2">
          <div className="flex gap-2">
            {event.status !== 'PUBLISHED' && (
              <Button variant="secondary" disabled={saving} onClick={() => void apply({ status: 'PUBLISHED' }, 'Tournament published: families can now register.')}>
                Publish
              </Button>
            )}
            {event.status !== 'CLOSED' && (
              <Button variant="secondary" disabled={saving} onClick={() => void apply({ status: 'CLOSED' }, 'Tournament closed: no new registrations.')}>
                Close
              </Button>
            )}
          </div>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save Changes
          </Button>
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="text-lg mb-1">Teams</h2>
        <p className="text-ink-soft text-sm mb-3">
          {activeTeams.length} active team{activeTeams.length === 1 ? '' : 's'} in this tournament.
        </p>
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
                {t.name} <span className="font-normal text-ink-soft">— {t.club || '—'}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg mb-1">Registration Links</h2>
        <p className="text-ink-soft text-sm mb-4">Share the common link, or generate a team-specific link that skips selection.</p>
        {event.status !== 'PUBLISHED' && (
          <Alert level="warning" title="Not open for registration">
            These links only work while the tournament is published.
          </Alert>
        )}

        <CopyRow label="Common link — Team & role selected by the registrant" link={generateTournamentLink({ tournamentId: id })} />

        {activeTeams.length > 0 && (
          <div className="mt-4">
            <SelectField id="team-pick" label="Generate a team-specific link" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
              <option value="">Select a team…</option>
              {activeTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            {selectedTeam && (
              <div className="flex flex-col gap-2 mt-1">
                {ROLES.map((r) => (
                  <CopyRow
                    key={r.key}
                    label={`${r.label} — ${selectedTeam.name}`}
                    link={generateTournamentLink({ tournamentId: id, teamId: selectedTeam.id, inviteCode: selectedTeam.inviteCode, role: r.key })}
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
