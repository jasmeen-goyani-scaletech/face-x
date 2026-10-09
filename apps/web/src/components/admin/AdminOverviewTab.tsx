import type { ReactNode } from 'react';
import Card from '@/components/ui/Card';
import { InfoIcon } from '@/components/ui/Icons';

export interface DetailItem {
  label: string;
  value: ReactNode;
  /** Long values (a list of flags, a reason) take two columns so they don't wrap awkwardly. */
  wide?: boolean;
}

export interface DetailSection {
  title: string;
  items: DetailItem[];
  /** A short remark about this section (e.g. what isn't stored). Collected into the Notes strip at the bottom. */
  note?: ReactNode;
}

/**
 * The Overview tab for every admin profile: ONE bordered card, sections separated by hairlines, each section a dense
 * grid (1 column on phones, 2 from 768px, 4 from 1024px) instead of a stack of mostly-empty full-width cards.
 * Labels are 11px uppercase; values are 14px with compact status pills inline. Section remarks gather in a Notes strip
 * under the grid rather than interrupting it.
 */
export default function AdminOverviewTab({ sections }: { sections: DetailSection[] }) {
  const notes = sections.flatMap((s) => (s.note ? [s.note] : []));

  return (
    <Card className="divide-y divide-line">
      {sections.map((section) => (
        <section key={section.title} aria-label={section.title} className="py-5 first:pt-0 last:pb-0">
          <h2 className="m-0 mb-3.5 text-[12px] font-bold tracking-wider text-ink-soft">{section.title}</h2>
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 lg:grid-cols-4">
            {section.items.map((item) => (
              <div key={item.label} className={['min-w-0', item.wide ? 'md:col-span-2' : ''].join(' ')}>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{item.label}</dt>
                <dd className="m-0 mt-1 flex min-h-[20px] flex-wrap items-center gap-1.5 break-words text-sm font-medium text-ink">
                  {item.value || '—'}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {notes.length > 0 && (
        <div className="pt-5">
          <div className="flex flex-col gap-1.5 rounded-s bg-surface-2 px-3.5 py-3 text-[12.5px] text-ink-soft">
            {notes.map((n, i) => (
              <p key={i} className="m-0 flex items-start gap-2">
                <InfoIcon size={14} className="mt-0.5 shrink-0 text-ink-faint" />
                <span>{n}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
