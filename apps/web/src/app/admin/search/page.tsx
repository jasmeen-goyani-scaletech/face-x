'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import { ChevronLeftIcon } from '@/components/ui/Icons';
import ManualCheckInPanel from '@/components/admin/ManualCheckInPanel';
import RoleFilterTabs, { type RoleFilter } from '@/components/admin/RoleFilterTabs';
import EventDayGate, { EventLine, type ReadyRoster } from '@/components/admin/EventDayGate';

/** Manual check-in without the camera: the same search, photo comparison and approval as the scanner's dialog. */
export default function AdminSearchPage() {
  return <EventDayGate>{(r) => <ManualSearch data={r} />}</EventDayGate>;
}

function ManualSearch({ data }: { data: ReadyRoster }) {
  const { roster, markPresent } = data;
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const scoped = useMemo(() => (roleFilter === 'all' ? roster : roster.filter((r) => r.role === roleFilter)), [roster, roleFilter]);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/event-day" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink">
        <ChevronLeftIcon size={16} /> Back to Event Day
      </Link>
      <h1 className="m-0 text-2xl">Manual Search</h1>
      <p className="m-0 mb-2 mt-1 text-sm text-ink-soft">Find someone by name, team, or registration ID, compare their on-file photo, and check them in.</p>
      <EventLine roster={data} className="mb-4" />

      <div className="mb-4">
        <RoleFilterTabs value={roleFilter} onChange={setRoleFilter} />
      </div>

      {notice && (
        <div role="status" className="mb-4 rounded-s bg-success px-4 py-3 text-sm font-bold text-white">
          {notice}
        </div>
      )}

      <Card>
        <ManualCheckInPanel
          roster={scoped}
          onConfirm={(id) => {
            const entry = roster.find((r) => r.id === id);
            markPresent(id, 'Manual', false);
            if (entry) setNotice(`Access Granted: ${entry.firstName} ${entry.lastName}`);
            setTimeout(() => setNotice(null), 2500);
          }}
        />
      </Card>
    </div>
  );
}
