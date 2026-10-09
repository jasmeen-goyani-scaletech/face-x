'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import AdminPagination from '@/components/admin/AdminPagination';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import TournamentFields, { API_FIELD_TO_FORM, emptyTournamentForm, inputFromForm, tournamentErrors, type TournamentForm } from '@/components/admin/TournamentFields';
import { useToast } from '@/components/ui/Toast';
import { usePagination } from '@/lib/usePagination';
import { PlusIcon, TrophyIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { createAdminEvent, listAdminEvents } from '@/lib/api/admin';
import { describeError, fieldErrorsOf } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiEventStatus } from '@/lib/api/types';
import { formatEventStart } from '@/lib/format';
import { useFieldErrors } from '@/lib/useFieldErrors';

const STATUS_KIND: Record<ApiEventStatus, 'neutral' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  CLOSED: 'warning'
};

const NO_EVENTS: ApiAdminEvent[] = [];

export default function TournamentsPage() {
  const { notify } = useToast();
  const [events, setEvents] = useState<ApiAdminEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TournamentForm>(emptyTournamentForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  // Keys equal the input ids, so Create focuses the first invalid field.
  const { error, blur, submit, reset } = useFieldErrors(tournamentErrors(form), ['name', 'date', 'startTime', 'endTime', 'location', 'fee'] as const);

  const pager = usePagination(events ?? NO_EVENTS);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setEvents(await listAdminEvents());
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!submit() || saving) return;
    setSaving(true);
    setSaveError(null);
    setApiErrors({});
    try {
      const created = await createAdminEvent(inputFromForm(form));
      notify(`${created.name} created as a draft.`);
      setForm(emptyTournamentForm());
      reset();
      setShowCreate(false);
      await load();
    } catch (e) {
      setSaveError(describeError(e, 'We couldn’t create the tournament. Please try again.'));
      const labelled: Record<string, string> = {};
      for (const [path, message] of Object.entries(fieldErrorsOf(e))) labelled[API_FIELD_TO_FORM[path] ?? path] = message;
      setApiErrors(labelled);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl mb-1">Tournaments</h1>
          <p className="text-ink-soft text-sm">Create a tournament, then generate registration links for it.</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate((v) => !v)}>
          <PlusIcon size={16} /> Create Tournament
        </Button>
      </div>

      {showCreate && (
        <Card className="mb-5">
          <h2 className="text-lg mb-4">New Tournament</h2>
          <SaveErrorAlert error={saveError} fieldErrors={apiErrors} />
          <TournamentFields form={form} onChange={setForm} error={error} blur={blur} />
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                setSaveError(null);
                setShowCreate(false);
              }}
              disabled={saving}
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
          <Alert level="danger" title="We couldn’t load your tournaments">
            {loadError}
          </Alert>
          <Button variant="primary" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      )}

      {!loadError && events === null && (
        <p role="status" className="text-ink-soft text-sm">
          Loading…
        </p>
      )}

      {events?.length === 0 && (
        <Card className="text-center py-10">
          <TrophyIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No tournaments yet. Create one to generate registration links.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {pager.pageItems.map((t) => (
          <Link key={t.id} href={`/admin/tournaments/${t.id}`} className="no-underline">
            <Card className="flex items-center justify-between gap-3 hover:border-line-strong">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-ink">{t.name}</span>
                  <Chip kind={STATUS_KIND[t.status]}>{t.status.toLowerCase()}</Chip>
                </div>
                <div className="text-[12.5px] text-ink-soft">
                  {formatEventStart(t.startsAt, t.timezone)}
                  {t.location ? ` · ${t.location}` : ''}
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
