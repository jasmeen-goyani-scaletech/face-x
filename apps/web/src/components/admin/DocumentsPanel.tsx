import type { ReactNode } from 'react';
import Card from '@/components/ui/Card';
import { LockIcon } from '@/components/ui/Icons';

/** Card around the Photos & Documents review table, with a quiet notice in the header while the record is locked. */
export default function DocumentsPanel({ title, locked, children }: { title: string; locked: boolean; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="m-0 text-lg">{title}</h2>
        {locked && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft"
          >
            <LockIcon size={12} /> Record locked &amp; approved — documents are read-only
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}
