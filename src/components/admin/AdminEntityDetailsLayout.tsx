'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Card from '@/components/ui/Card';
import { ChevronLeftIcon } from '@/components/ui/Icons';
import ActivityTimeline from './ActivityTimeline';
import AdminOverviewTab, { type DetailSection } from './AdminOverviewTab';
import AdminUserHeader, { type AdminUserHeaderProps } from './AdminUserHeader';
import type { AuditEvent } from '@/lib/adminAudit';

type TabKey = 'overview' | 'documents' | 'activity';

/**
 * One layout for the Player, Coach and Staff admin pages:
 *  - the header (AdminUserHeader): photo or initials, name, role tag, account status, and the compliance-locked access control;
 *  - three tabs: Overview (one dense card of grids for the person's details; account standing is in the header, document statuses on the Documents tab), Photos & Documents (the review
 *    table and any decision controls), and Activity (submission, upload, consent, payment and admin events).
 * It only lays things out. Each role's page decides which sections and actions to pass.
 */
export default function AdminEntityDetailsLayout({
  backLabel,
  onBack,
  header,
  sections,
  documents,
  activity,
  activityEmptyMessage = 'No activity recorded yet.'
}: {
  backLabel: string;
  onBack: () => void;
  header: AdminUserHeaderProps;
  sections: DetailSection[];
  documents: ReactNode;
  activity: AuditEvent[];
  activityEmptyMessage?: string;
}) {
  const baseId = useId();
  const [tab, setTab] = useState<TabKey>('overview');
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ overview: null, documents: null, activity: null });

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'documents', label: 'Photos & Documents' },
    { key: 'activity', label: 'Activity', count: activity.length }
  ];

  // Arrow keys / Home / End move between tabs, as in the WAI-ARIA tabs pattern.
  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    setTab(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
        <ChevronLeftIcon size={16} /> {backLabel}
      </button>

      <AdminUserHeader {...header} />

      <div role="tablist" aria-label="Profile sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-line no-scrollbar">
        {tabs.map((t, i) => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              role="tab"
              id={`${baseId}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={[
                '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-bold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                selected ? 'border-primary text-ink' : 'border-transparent text-ink-soft hover:text-ink'
              ].join(' ')}
            >
              {t.label}
              {t.count ? <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-soft">{t.count}</span> : null}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`${baseId}-panel-${t.key}`}
          aria-labelledby={`${baseId}-tab-${t.key}`}
          hidden={tab !== t.key}
          className="flex flex-col gap-5"
        >
          {t.key === 'overview' && <AdminOverviewTab sections={sections} />}
          {t.key === 'documents' && documents}
          {t.key === 'activity' && (
            <Card>
              <h2 className="mb-4 mt-0 text-[13px] text-ink-soft">Audit trail & activity</h2>
              <ActivityTimeline events={activity} emptyMessage={activityEmptyMessage} />
            </Card>
          )}
        </div>
      ))}
    </div>
  );
}
