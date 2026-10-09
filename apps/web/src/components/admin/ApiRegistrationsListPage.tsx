'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import AdminPagination from '@/components/admin/AdminPagination';
import { ChevronRightIcon, SearchIcon, UsersIcon } from '@/components/ui/Icons';
import { getEventSummary, listAdminRegistrations } from '@/lib/api/admin';
import { describeError } from '@/lib/api/errors';
import type { ApiAdminRegistrationRow, ApiEventSummary, ApiPage, ApiRegistrationStatus, ApiStaffRole, ListAdminRegistrationsQuery } from '@/lib/api/types';
import { STAFF_ROLE_FROM_API } from '@/lib/registration/personnel';
import { STATUS_LABEL } from '@/lib/admin/apiPlayerView';
import { useAdminEvent } from '@/lib/admin/useAdminEvent';
import { formatEventStart, initialsOf } from '@/lib/format';
import { PAGE_SIZES } from '@/lib/usePagination';

type Filter = 'all' | 'review' | 'ready' | 'rejected';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Needs review' },
  { key: 'ready', label: 'Ready' },
  { key: 'rejected', label: 'Rejected' }
];

const FILTER_QUERY: Record<Filter, Pick<ListAdminRegistrationsQuery, 'status' | 'documentsPending'>> = {
  all: {},
  review: { documentsPending: true },
  ready: { status: 'READY_FOR_EVENT' },
  rejected: { status: 'REJECTED' }
};

const STATUS_KIND: Record<ApiRegistrationStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  PAYMENT_PENDING: 'warning',
  PAYMENT_COMPLETED: 'info',
  DOCUMENT_REVIEW: 'warning',
  VERIFIED: 'success',
  READY_FOR_EVENT: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral'
};

export type RegistrantKind = 'PLAYER' | 'COACH' | 'STAFF';

const KIND: Record<RegistrantKind, { title: string; description: string; noun: string; path: string }> = {
  PLAYER: { title: 'Players', description: 'Search, review documents, and track registration status.', noun: 'players', path: '/admin/players' },
  COACH: { title: 'Coaches', description: 'Search, review certificates, and track coach registrations.', noun: 'coaches', path: '/admin/coaches' },
  STAFF: { title: 'Staff Members', description: 'Search, review documents, and track staff registrations.', noun: 'staff members', path: '/admin/staff' }
};

/** Who a list row is about, whichever kind of registration it is. */
function personOf(r: ApiAdminRegistrationRow): { firstName: string; lastName: string; role: string | null } {
  if (r.registrantType === 'PLAYER') return { ...r.player, role: null };
  const p = r.staffProfile;
  return { firstName: p.firstName, lastName: p.lastName, role: p.staffRole ? STAFF_ROLE_FROM_API[p.staffRole as ApiStaffRole] : null };
}

/** The admin list of one kind of registration (players, coaches or staff), read from the API: searched, filtered and paged on the server. */
export default function ApiRegistrationsListPage({ kind = 'PLAYER' }: { kind?: RegistrantKind }) {
  const copy = KIND[kind];
  const ev = useAdminEvent();
  const eventId = ev.status === 'ready' ? ev.event.id : null;

  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  const [data, setData] = useState<ApiPage<ApiAdminRegistrationRow> | null>(null);
  const [summary, setSummary] = useState<ApiEventSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The search box waits for a pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  // A new search, filter or event starts again at page 1.
  useEffect(() => {
    setPage(1);
  }, [search, filter, eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAdminRegistrations(eventId, { ...FILTER_QUERY[filter], registrantType: kind, search, page, pageSize })
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && setError(describeError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [eventId, kind, search, filter, page, pageSize, attempt]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    getEventSummary(eventId, kind)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => !cancelled && setSummary(null)); // the counts are a nicety: the list still works without them
    return () => {
      cancelled = true;
    };
  }, [eventId, kind, attempt]);

  if (ev.status === 'loading') return <p role="status" className="text-ink-soft">Loading events…</p>;
  if (ev.status === 'error') {
    return (
      <Card>
        <Alert level="danger" title="We couldn’t load your events">
          {ev.message}
        </Alert>
        <Button variant="primary" onClick={ev.retry}>
          Try again
        </Button>
      </Card>
    );
  }
  if (ev.status === 'empty') {
    return (
      <Card className="text-center py-12">
        <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
        <p className="text-ink-soft text-sm">Your organization has no events yet.</p>
      </Card>
    );
  }

  const items = data?.items ?? [];

  return (
    <div>
      <h1 className="text-2xl mb-1">{copy.title}</h1>
      <p className="text-ink-soft text-sm mb-5">{copy.description}</p>

      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        {ev.events.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            Event
            <select
              value={ev.event.id}
              onChange={(e) => ev.setEventId(e.target.value)}
              className="rounded-s border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {ev.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.status !== 'PUBLISHED' ? ` (${e.status.toLowerCase()})` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="m-0 text-sm text-ink-soft">
            <strong className="text-ink">{ev.event.name}</strong> · {formatEventStart(ev.event.startsAt, ev.event.timezone)}
          </p>
        )}
        {summary && (
          <div className="flex flex-wrap gap-1.5">
            <Chip compact kind={summary.documentsAwaitingReview > 0 ? 'warning' : 'neutral'}>
              {summary.documentsAwaitingReview} document{summary.documentsAwaitingReview === 1 ? '' : 's'} to review
            </Chip>
            <Chip compact kind="success">
              {summary.registrationsByStatus.READY_FOR_EVENT} ready
            </Chip>
            {kind === 'PLAYER' && (
              <Chip compact kind="neutral">
                {summary.payments.paidCount} paid
              </Chip>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search by name or registration number…"
            aria-label={`Search ${copy.noun}`}
            className="w-full rounded-s border border-line-strong bg-surface pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div className="flex gap-1 rounded-full border border-line bg-surface-2 p-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={[
                'whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold',
                filter === f.key ? 'bg-primary text-primary-foreground' : 'text-ink-soft'
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card className="mb-4">
          <Alert level="danger" title="We couldn’t load the {copy.noun}">
            {error}
          </Alert>
          <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </Card>
      )}

      {!error && !data && loading && <p role="status" className="text-ink-soft">Loading {copy.noun}…</p>}

      {!error && data && items.length === 0 && (
        <Card className="text-center py-12">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No one matches this search or filter yet.</p>
        </Card>
      )}

      {!error && data && items.length > 0 && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={loading}>
          <div className="flex flex-col gap-2">
            {items.map((r) => {
              const person = personOf(r);
              return (
              <Link key={r.id} href={`${copy.path}/${r.id}`} className="no-underline">
                <Card className="flex items-center gap-3.5 hover:border-line-strong py-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary-strong font-bold text-sm">
                    {initialsOf(person.firstName, person.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-ink truncate">
                      {person.firstName} {person.lastName}
                    </div>
                    <div className="text-[12.5px] text-ink-soft truncate">
                      {person.role ? `${person.role} · ` : ''}
                      {r.team?.name ?? '—'} · {r.registrationNumber}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                    {r.eventAccessDisabled && <Chip kind="danger">Disabled</Chip>}
                    {r.documents.inReview > 0 && <Chip kind="warning">{r.documents.inReview} to review</Chip>}
                    {r.documents.rejected > 0 && <Chip kind="danger">{r.documents.rejected} rejected</Chip>}
                    <Chip kind={STATUS_KIND[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                  </div>
                  <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
                </Card>
              </Link>
              );
            })}
          </div>

          <AdminPagination
            total={data.total}
            page={data.page}
            pageSize={data.pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}
