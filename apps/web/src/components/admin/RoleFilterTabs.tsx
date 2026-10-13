'use client';

import type { RosterEntry } from '@/lib/seed';

export type RoleFilter = 'all' | RosterEntry['role'];

export const ROLE_FILTER_LABEL: Record<RoleFilter, string> = {
  all: 'All Roles',
  player: 'Players',
  coach: 'Coaches',
  staff: 'Staff'
};

const ORDER: RoleFilter[] = ['all', 'player', 'coach', 'staff'];

/** Segmented control that scopes the Event Day screens to everyone, or just players, coaches or staff. */
export default function RoleFilterTabs({ value, onChange }: { value: RoleFilter; onChange: (next: RoleFilter) => void }) {
  return (
    <div role="radiogroup" aria-label="Filter by role" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface-2 p-1 no-scrollbar">
      {ORDER.map((key) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(key)}
            className={[
              'whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              selected ? 'bg-primary text-primary-foreground' : 'text-ink-soft hover:text-ink'
            ].join(' ')}
          >
            {ROLE_FILTER_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}
