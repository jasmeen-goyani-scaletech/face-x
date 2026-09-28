'use client';

import { ClockIcon } from '@/components/ui/Icons';
import { formatTime } from '@/lib/format';
import { useEventRoster } from '@/lib/roster';

export default function AdminLogPage() {
  const roster = useEventRoster();
  const checkedIn = roster.roster.filter((r) => r.checkedInAt).sort((a, b) => (b.checkedInAt || 0) - (a.checkedInAt || 0));
  const approvedCount = roster.roster.filter((r) => r.approved).length;
  const overrideCount = checkedIn.filter((r) => r.checkedInOverride).length;

  return (
    <div>
      <h1 className="font-display text-2xl uppercase tracking-wide mb-1">Attendance Log</h1>
      <p className="text-[#9fb0a6] text-sm mb-5">
        <strong className="text-white">{checkedIn.length}</strong> of <strong className="text-white">{approvedCount}</strong> checked in
        {overrideCount > 0 && (
          <>
            {' · '}
            <span className="text-[#e3ac4a]">{overrideCount} via override</span>
          </>
        )}
      </p>

      {checkedIn.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#2d3a33] p-10 text-center text-[#6b7a71]">
          <ClockIcon size={32} className="mx-auto mb-3" />
          No one has checked in yet.
        </div>
      ) : (
        <div className="grid gap-2">
          {checkedIn.map((r) => (
            <div key={r.id} className="rounded-xl border border-[#253029] bg-[#12181f] p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold">{r.firstName} {r.lastName}</div>
                <div className="text-[#6b7a71] text-[12.5px] capitalize">{r.role} · {r.schoolId}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-[#22c55e] text-sm">{formatTime(r.checkedInAt)}</div>
                <div className="text-[#6b7a71] text-[11.5px]">
                  {r.checkedInMethod}
                  {r.checkedInOverride && <span className="text-[#e3ac4a]"> · Override</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
