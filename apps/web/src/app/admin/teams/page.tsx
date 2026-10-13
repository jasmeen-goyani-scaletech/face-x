'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { TextField, SelectField } from '@/components/ui/Field';
import AdminPagination from '@/components/admin/AdminPagination';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import { useToast } from '@/components/ui/Toast';
import { useServerPaging } from '@/lib/usePagination';
import { useRevalidateOnFocus } from '@/lib/useRevalidateOnFocus';
import { PlusIcon, UsersIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { createAdminTeam, listAdminEvents, listAdminTeamsPage } from '@/lib/api/admin';
import { describeError, fieldErrorsOf } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiAdminTeam, ApiPage } from '@/lib/api/types';
import { compact } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';

const NO_EVENTS: ApiAdminEvent[] = [];

export default function TeamsPage() {
  const { notify } = useToast();
  const [data, setData] = useState<ApiPage<ApiAdminTeam> | null>(null);
  // Every event, for the names on the rows and the tournament picker; null until it has loaded.
  const [events, setEvents] = useState<ApiAdminEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ eventId: '', name: '', club: '', division: '' });
  const [saving, setSaving] = useState(false);
  // Set synchronously: a fast double-click would otherwise start twice before `saving` shows up in the next render.
  const flight = useRef(false);
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

  const { page, pageSize, setPage, setPageSize } = useServerPaging();
  const eventList = events ?? NO_EVENTS;
  const eventName = useMemo(() => new Map(eventList.map((e) => [e.id, e.name])), [eventList]);
  // Only the newest answer is shown, so paging quickly can't leave an older page on screen.
  const latest = useRef(0);

  // `quiet` is a refresh the admin did not ask for: it never shows an error or a spinner, and a failure keeps what is on screen.
  const loadEvents = useCallback(async (quiet = false) => {
    try {
      setEvents(await listAdminEvents());
    } catch (e) {
      if (!quiet) setLoadError(describeError(e));
    }
  }, []);

  const loadTeams = useCallback(async (quiet = false) => {
    const mine = ++latest.current;
    if (!quiet) {
      setLoadError(null);
      setLoading(true);
    }
    try {
      const res = await listAdminTeamsPage(page, pageSize);
      if (mine !== latest.current) return;
      // The page no longer exists (the last team of it was removed elsewhere): go to the last one that does.
      if (res.items.length === 0 && res.total > 0 && page > 1) setPage(Math.ceil(res.total / pageSize));
      else setData(res);
    } catch (e) {
      if (mine === latest.current && !quiet) setLoadError(describeError(e));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, setPage]);

  const load = useCallback(async () => {
    setLoadError(null);
    await Promise.all([loadEvents(), loadTeams()]);
  }, [loadEvents, loadTeams]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  // Back after a while away: catch up with changes other admins made.
  useRevalidateOnFocus(() => {
    void loadEvents(true);
    void loadTeams(true);
  });

  useEffect(() => {
    if (!form.eventId && eventList.length > 0) setForm((f) => ({ ...f, eventId: eventList.find((e) => e.status === 'PUBLISHED')?.id ?? eventList[0].id }));
  }, [eventList, form.eventId]);

  async function create() {
    if (!submit() || saving || flight.current) return;
    flight.current = true;
    setSaving(true);
    setSaveError(null);
    setApiErrors({});
    try {
      const created = await createAdminTeam(form.eventId, { name: form.name.trim(), club: form.club.trim() || undefined, division: form.division.trim() });
      notify(`${created.name} created.`);
      setForm({ eventId: form.eventId, name: '', club: '', division: '' });
      reset();
      setShowCreate(false);
      await loadTeams();
    } catch (e) {
      setSaveError(describeError(e, 'We couldn’t create the team. Please try again.'));
      setApiErrors(fieldErrorsOf(e));
    } finally {
      flight.current = false;
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
        <Button variant="primary" onClick={() => setShowCreate((v) => !v)} disabled={eventList.length === 0}>
          <PlusIcon size={16} /> Create Team
        </Button>
      </div>

      {events !== null && events.length === 0 && (
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
            {eventList.map((t) => (
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

      {!loadError && data === null && (
        <p role="status" className="text-ink-soft text-sm">
          Loading…
        </p>
      )}

      {data?.total === 0 && eventList.length > 0 && (
        <Card className="text-center py-10">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No teams yet.</p>
        </Card>
      )}

      <div className={['flex flex-col gap-2.5 transition-opacity', loading && data ? 'opacity-60' : ''].join(' ')} aria-busy={loading}>
        {(data?.items ?? []).map((t) => (
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
      {data && <AdminPagination total={data.total} page={data.page} pageSize={data.pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />}
    </div>
  );
}
