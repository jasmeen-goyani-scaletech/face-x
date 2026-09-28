'use client';

import { useState } from 'react';
import VerificationHud from '@/components/admin/VerificationHud';
import { SearchIcon, UsersIcon } from '@/components/ui/Icons';
import { formatDate, initialsOf } from '@/lib/format';
import { useEventRoster } from '@/lib/roster';

export default function AdminSearchPage() {
  const roster = useEventRoster();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = query.toLowerCase().trim();
  const results = q
    ? roster.roster.filter((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) || r.dob.includes(q) || r.schoolId.toLowerCase().includes(q))
    : roster.roster;

  const selected = roster.roster.find((r) => r.id === selectedId);

  return (
    <div>
      <h1 className="font-display text-2xl uppercase tracking-wide mb-1">Manual Search</h1>
      <p className="text-[#9fb0a6] text-sm mb-5">Find a registrant by name, date of birth, or school ID.</p>

      <div className="relative mb-4">
        <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6b7a71]" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId(null);
          }}
          placeholder="Search…"
          className="w-full rounded-xl border border-[#253029] bg-[#12181f] text-white pl-11 pr-4 py-4 text-base focus:outline-none focus:border-[#22c55e]"
        />
      </div>

      {!selected && (
        <>
          {results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#2d3a33] p-10 text-center text-[#6b7a71]">
              <SearchIcon size={32} className="mx-auto mb-3" />
              No registrants match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="grid gap-2">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className="flex items-center gap-3 rounded-xl border border-[#253029] bg-[#12181f] p-3.5 text-left"
                >
                  <div className="h-11 w-11 shrink-0 rounded-full bg-[#1c2620] border border-[#2d3a33] flex items-center justify-center font-display font-bold text-[#9fb0a6]">
                    {initialsOf(r.firstName, r.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold">{r.firstName} {r.lastName}</div>
                    <div className="text-[#6b7a71] text-[12.5px]">{formatDate(r.dob)} · {r.schoolId}</div>
                  </div>
                  {!r.approved ? (
                    <Pill tone="danger">Not Cleared</Pill>
                  ) : r.checkedInAt ? (
                    <Pill tone="warning">Checked In</Pill>
                  ) : r.flags.length ? (
                    <Pill tone="warning">Flagged</Pill>
                  ) : (
                    <Pill tone="success">Verified</Pill>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <div>
          <button onClick={() => setSelectedId(null)} className="text-[#9fb0a6] text-sm font-semibold mb-4">
            ← Back to results
          </button>
          <VerificationHud entry={selected} method="Manual" onConfirm={roster.markPresent} />
        </div>
      )}

      {!selected && results.length === 0 && !query && (
        <div className="mt-4 flex items-center gap-2 text-[#6b7a71] text-[12.5px]">
          <UsersIcon size={14} /> Start typing to search the event roster.
        </div>
      )}
    </div>
  );
}

function Pill({ tone, children }: { tone: 'success' | 'warning' | 'danger'; children: React.ReactNode }) {
  const classes = {
    success: 'bg-[#0f2a1a] text-[#4ade80] border-[#1f5c38]',
    warning: 'bg-[#241d0d] text-[#e3ac4a] border-[#4d3c14]',
    danger: 'bg-[#2a1414] text-[#f87171] border-[#5c2323]'
  }[tone];
  return <span className={['shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide', classes].join(' ')}>{children}</span>;
}
