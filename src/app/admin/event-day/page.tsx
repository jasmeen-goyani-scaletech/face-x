'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { CalendarIcon, CameraIcon, ClockIcon, SearchIcon } from '@/components/ui/Icons';
import { useEventRoster } from '@/lib/roster';
import { formatTime, initialsOf } from '@/lib/format';
import { EVENT_INFO } from '@/lib/seed';
import { entryAccessState } from '@/lib/accessCompliance';
import AdminPagination from '@/components/admin/AdminPagination';
import { usePagination } from '@/lib/usePagination';
import RoleFilterTabs, { type RoleFilter } from '@/components/admin/RoleFilterTabs';

export default function EventDayPage() {
  const { roster } = useEventRoster();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  const filtered = useMemo(
    () => (roleFilter === 'all' ? roster : roster.filter((r) => r.role === roleFilter)),
    [roster, roleFilter]
  );

  const eligible = filtered.filter((r) => entryAccessState(r) === 'enabled');
  const checkedIn = eligible.filter((r) => r.checkedInAt).sort((a, b) => (b.checkedInAt ?? 0) - (a.checkedInAt ?? 0));
  const notCheckedIn = eligible.filter((r) => !r.checkedInAt);

  const checkedInPager = usePagination(checkedIn, roleFilter);
  const notCheckedInPager = usePagination(notCheckedIn, roleFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl">Event Day</h1>
        <div className="flex gap-2">
          <Link href="/admin/scan" className="flex items-center gap-1.5 rounded-s border border-line-strong px-3 py-2 text-[12.5px] font-bold text-ink-soft hover:text-ink no-underline">
            <CameraIcon size={14} /> Scanner
          </Link>
          <Link href="/admin/search" className="flex items-center gap-1.5 rounded-s border border-line-strong px-3 py-2 text-[12.5px] font-bold text-ink-soft hover:text-ink no-underline">
            <SearchIcon size={14} /> Manual Search
          </Link>
        </div>
      </div>
      <p className="text-ink-soft text-sm flex items-center gap-1.5 mb-5">
        <CalendarIcon size={14} /> {EVENT_INFO.name} · {EVENT_INFO.time}
      </p>

      <div className="mb-5">
        <RoleFilterTabs value={roleFilter} onChange={setRoleFilter} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <Card className="text-center">
          <div className="text-3xl font-display font-bold text-success">{checkedIn.length}</div>
          <div className="text-[11px] text-ink-faint uppercase tracking-wide font-semibold">Checked In</div>
        </Card>
        <Card className="text-center">
          <div className="text-3xl font-display font-bold text-ink-soft">{notCheckedIn.length}</div>
          <div className="text-[11px] text-ink-faint uppercase tracking-wide font-semibold">Not Checked In</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <h2 className="text-[12px] text-ink-faint uppercase tracking-wide font-bold mb-2.5">Checked In</h2>
          {checkedIn.length === 0 ? (
            <Card className="text-center py-8 text-ink-faint text-sm">No one checked in yet.</Card>
          ) : (
            <div className="flex flex-col gap-2">
              {checkedInPager.pageItems.map((r) => (
                <Card key={r.id} className="flex items-center gap-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-soft text-success font-bold text-[12.5px]">
                    {initialsOf(r.firstName, r.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">
                      {r.firstName} {r.lastName}
                    </div>
                    <div className="text-[12px] text-ink-soft truncate">{r.teamName || '—'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12.5px] font-semibold text-success flex items-center gap-1 justify-end">
                      <ClockIcon size={12} /> {formatTime(r.checkedInAt)}
                    </div>
                    <div className="text-[11px] text-ink-faint">{r.checkedInMethod}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <AdminPagination total={checkedInPager.total} page={checkedInPager.page} pageSize={checkedInPager.pageSize} onPageChange={checkedInPager.setPage} onPageSizeChange={checkedInPager.setPageSize} noun="people" />
        </div>

        <div>
          <h2 className="text-[12px] text-ink-faint uppercase tracking-wide font-bold mb-2.5">Not Checked In</h2>
          {notCheckedIn.length === 0 ? (
            <Card className="text-center py-8 text-ink-faint text-sm">Everyone eligible has checked in.</Card>
          ) : (
            <div className="flex flex-col gap-2">
              {notCheckedInPager.pageItems.map((r) => (
                <Card key={r.id} className="flex items-center gap-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-soft font-bold text-[12.5px]">
                    {initialsOf(r.firstName, r.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">
                      {r.firstName} {r.lastName}
                    </div>
                    <div className="text-[12px] text-ink-soft truncate">{r.teamName || '—'}</div>
                  </div>
                  <Chip kind="neutral">Not Arrived</Chip>
                </Card>
              ))}
            </div>
          )}
          <AdminPagination total={notCheckedInPager.total} page={notCheckedInPager.page} pageSize={notCheckedInPager.pageSize} onPageChange={notCheckedInPager.setPage} onPageSizeChange={notCheckedInPager.setPageSize} noun="people" />
        </div>
      </div>
    </div>
  );
}
