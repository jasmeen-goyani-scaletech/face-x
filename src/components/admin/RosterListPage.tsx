'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, UsersIcon } from '@/components/ui/Icons';
import { useEventRoster } from '@/lib/roster';
import { initialsOf } from '@/lib/format';
import type { RosterEntry } from '@/lib/seed';

const PAGE_SIZE = 8;

type StatusFilter = 'all' | 'pending' | 'approved' | 'flagged' | 'disabled';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'disabled', label: 'Disabled' }
];

export default function RosterListPage({
  role,
  title,
  description,
  basePath
}: {
  role: RosterEntry['role'];
  title: string;
  description: string;
  basePath: string;
}) {
  const { roster } = useEventRoster();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let list = roster.filter((r) => r.role === role);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) || r.teamName.toLowerCase().includes(q) || r.schoolId.toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'pending') list = list.filter((r) => !r.approved);
    if (statusFilter === 'approved') list = list.filter((r) => r.approved);
    if (statusFilter === 'flagged') list = list.filter((r) => r.flags.length > 0);
    if (statusFilter === 'disabled') list = list.filter((r) => r.disabled);
    return list;
  }, [roster, role, query, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      <h1 className="text-2xl mb-1">{title}</h1>
      <p className="text-ink-soft text-sm mb-5">{description}</p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, team, or ID…"
            className="w-full rounded-s border border-line-strong bg-surface pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div className="flex gap-1 rounded-full border border-line bg-surface-2 p-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={[
                'whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold',
                statusFilter === f.key ? 'bg-primary text-primary-foreground' : 'text-ink-soft'
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="text-center py-12">
          <UsersIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No one matches this search or filter yet.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {pageItems.map((r) => (
              <Link key={r.id} href={`${basePath}/${r.id}`} className="no-underline">
                <Card className="flex items-center gap-3.5 hover:border-line-strong py-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary-strong font-bold text-sm">
                    {initialsOf(r.firstName, r.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-ink truncate">
                      {r.firstName} {r.lastName}
                    </div>
                    <div className="text-[12.5px] text-ink-soft truncate">{r.teamName || '—'}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.disabled && <Chip kind="danger">Disabled</Chip>}
                    {r.flags.length > 0 && <Chip kind="warning">{r.flags.length} flag{r.flags.length > 1 ? 's' : ''}</Chip>}
                    <Chip kind={r.approved ? 'success' : 'neutral'}>{r.approved ? 'Approved' : 'Pending'}</Chip>
                  </div>
                  <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
                </Card>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 text-sm font-semibold text-ink-soft disabled:opacity-40"
              >
                <ChevronLeftIcon size={16} /> Prev
              </button>
              <span className="text-[12.5px] text-ink-faint">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 text-sm font-semibold text-ink-soft disabled:opacity-40"
              >
                Next <ChevronRightIcon size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
