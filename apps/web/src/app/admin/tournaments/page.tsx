'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import AdminPagination from '@/components/admin/AdminPagination';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import TournamentFields, { API_FIELD_TO_FORM, emptyTournamentForm, inputFromForm, tournamentErrors, type TournamentForm } from '@/components/admin/TournamentFields';
import { useToast } from '@/components/ui/Toast';
import { useServerPaging } from '@/lib/usePagination';
import { useRevalidateOnFocus } from '@/lib/useRevalidateOnFocus';
import { PlusIcon, TrophyIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { createAdminEvent, listAdminEventsPage } from '@/lib/api/admin';
import { describeError, fieldErrorsOf } from '@/lib/api/errors';
import type { ApiAdminEvent, ApiEventStatus, ApiPage } from '@/lib/api/types';
import { formatEventStart } from '@/lib/format';
import { useFieldErrors } from '@/lib/useFieldErrors';

const STATUS_KIND: Record<ApiEventStatus, 'neutral' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  CLOSED: 'warning'
};

export default function TournamentsPage() {
  const { notify } = useToast();
  const [data, setData] = useState<ApiPage<ApiAdminEvent> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TournamentForm>(emptyTournamentForm);
  const [saving, setSaving] = useState(false);
  // Set synchronously: a fast double-click would otherwise start twice before `saving` shows up in the next render.
  const flight = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  // Keys equal the input ids, so Create focuses the first invalid field.
  const { error, blur, submit, reset } = useFieldErrors(tournamentErrors(form), ['name', 'date', 'startTime', 'endTime', 'location', 'fee'] as const);

  const { page, pageSize, setPage, setPageSize } = useServerPaging();
  // Only the newest answer is shown, so paging quickly can't leave an older page on screen.
  const latest = useRef(0);

  // `quiet` is a refresh the admin did not ask for: it never shows an error or a spinner, and a failure keeps what is on screen.
  const load = useCallback(async (quiet = false) => {
    const mine = ++latest.current;
    if (!quiet) {
      setLoadError(null);
      setLoading(true);
    }
    try {
      const res = await listAdminEventsPage(page, pageSize);
      if (mine !== latest.current) return;
      // The page no longer exists (tournaments were removed elsewhere): go to the last one that does.
      if (res.items.length === 0 && res.total > 0 && page > 1) setPage(Math.ceil(res.total / pageSize));
      else setData(res);
    } catch (e) {
      if (mine === latest.current && !quiet) setLoadError(describeError(e));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, setPage]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back after a while away: catch up with changes other admins made.
  useRevalidateOnFocus(() => void load(true));

  async function create() {
    if (!submit() || saving || flight.current) return;
    flight.current = true;
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
      flight.current = false;
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

      {!loadError && data === null && (
        <p role="status" className="text-ink-soft text-sm">
          Loading…
        </p>
      )}

      {data?.total === 0 && (
        <Card className="text-center py-10">
          <TrophyIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No tournaments yet. Create one to generate registration links.</p>
        </Card>
      )}

      <div className={['flex flex-col gap-2.5 transition-opacity', loading && data ? 'opacity-60' : ''].join(' ')} aria-busy={loading}>
        {(data?.items ?? []).map((t) => (
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
      {data && <AdminPagination total={data.total} page={data.page} pageSize={data.pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />}
    </div>
  );
}
