import type { AuditEvent, AuditTone } from '@/lib/adminAudit';
import { formatDateTime } from '@/lib/format';

const DOT: Record<AuditTone, string> = {
  neutral: 'bg-ink-faint',
  success: 'bg-success',
  danger: 'bg-danger'
};

/** Newest-first list of what happened and who did it, with a vertical rail through the dots. */
export default function ActivityTimeline({ events, emptyMessage }: { events: AuditEvent[]; emptyMessage: string }) {
  if (events.length === 0) return <p className="m-0 text-sm text-ink-soft">{emptyMessage}</p>;
  return (
    <ol className="m-0 list-none p-0">
      {events.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < events.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-4 h-[calc(100%-0.5rem)] w-px bg-line" />}
          <span aria-hidden="true" className={['relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-surface', DOT[e.tone]].join(' ')} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">{e.title}</div>
            {e.detail && <div className="break-words text-[13px] text-ink-soft">{e.detail}</div>}
            <div className="text-xs text-ink-faint">
              {e.actor} · {formatDateTime(e.at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
