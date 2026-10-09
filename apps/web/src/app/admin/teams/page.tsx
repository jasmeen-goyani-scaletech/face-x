'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { TextField, SelectField } from '@/components/ui/Field';
import AdminPagination from '@/components/admin/AdminPagination';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import { useToast } from '@/components/ui/Toast';
import { usePagination } from '@/lib/usePagination';
import { PlusIcon, UsersIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { createAdminTeam, listAdminEvents, listAdminTeams } from '@/lib/api/admin';
import { describeError, fieldErrorsOf } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiAdminTeam } from '@/lib/api/types';
import { compact } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';

const NO_TEAMS: ApiAdminTeam[] = [];

export default function TeamsPage() {
  const { notify } = useToast();
  const [teams, setTeams] = useState<ApiAdminTeam[] | null>(null);
  const [events, setEvents] = useState<ApiAdminEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ eventId: '', name: '', club: '', division: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  const { error, blur, submit, reset } = useFieldErrors(
    compact({
      eventId: form.eventId ? null : 'Please select a tournament.',
      name: form.name.trim() ? null : 'Please enter a team name.',
      division: form.division.trim() ? null : 'Please enter the division, e.g. U14.'
    }),
    ['eventId', 'name', 'division'] as const
  );

  const pager = usePagination(teams ?? NO_TEAMS);
  const eventName = useMemo(() => new Map(events.map((e) => [e.id, e.name])), [events]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await listAdminEvents();
      const perEvent = await Promise.all(list.map((e) => listAdminTeams(e.id)));
      setEvents(list);
      setTeams(perEvent.flat());
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!form.eventId && events.length > 0) setForm((f) => ({ ...f, eventId: events.find((e) => e.status === 'PUBLISHED')?.id ?? events[0].id }));
  }, [events, form.eventId]);

  async function create() {
    if (!submit() || saving) return;
    setSaving(true);
    setSaveError(null);
    setApiErrors({});
    try {
      const created = await createAdminTeam(form.eventId, { name: form.name.trim(), club: form.club.trim() || undefined, division: form.division.trim() });
      notify(`${created.name} created.`);
      setForm({ eventId: form.eventId, name: '', club: '', division: '' });
      reset();
      setShowCreate(false);
      await load();
    } catch (e) {
      setSaveError(describeError(e, 'We couldn’t create the team. Please try again.'));
      setApiErrors(fieldErrorsOf(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl mb-1">Teams</h1>
          <p className="text-ink-soft text-sm">Teams registrants pick from — the same source registration links use.</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate((v) => !v)} disabled={events.length === 0}>
          <PlusIcon size={16} /> Create Team
        </Button>
      </div>

      {teams !== null && events.length === 0 && (
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
          <SaveErrorAlert error={saveError} fieldErrors={apiErrors} />
          <SelectField id="eventId" label="Tournament" value={form.eventId} error={error('eventId')} onBlur={blur('eventId')} onChange={(e) => setForm({ ...form, eventId: e.target.value })}>
            {events.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField id="name" label="Team Name" value={form.name} error={error('name')} onBlur={blur('name')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField id="club" label="Club" optional value={form.club} onChange={(e) => setForm({ ...form, club: e.target.value })} />
            <TextField id="division" label="Division" placeholder="U14" value={form.division} error={error('division')} onBlur={blur('division')} onChange={(e) => setForm({ ...form, division: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                reset();
                setSaveError(null);
                setShowCreate(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()} loading={saving}>
              Create
            </Button>
          </div>
        </Card>
      )}

      {loadError && (
        <Card className="mb-4">
          <Alert level="danger" title="We couldn’t load your teams">
            {loadError}
          </Alert>
          <Button variant="primary" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      )}

      {!loadError && teams === null && (
        <p role="status" className="text-ink-soft text-sm">
          Loading…
        </p>
      )}

      {teams?.length === 0 && events.length > 0 && (
        <Card className="text-center py-10">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No teams yet.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {pager.pageItems.map((t) => (
          <Link key={t.id} href={`/admin/teams/${t.id}`} className="no-underline">
            <Card className="flex items-center justify-between gap-3 hover:border-line-strong">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-ink">{t.name}</span>
                  {t.status === 'DISABLED' && <Chip kind="warning">Disabled</Chip>}
                </div>
                <div className="text-[12.5px] text-ink-soft">
                  {t.club || '—'} · {t.division} · {eventName.get(t.eventId) ?? '—'}
                </div>
              </div>
              <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
            </Card>
          </Link>
        ))}
      </div>
      <AdminPagination total={pager.total} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </div>
  );
}
