'use client';

import { MailIcon, XIcon } from '@/components/ui/Icons';
import type { DocumentNotification } from '@/lib/documentVerification';

/**
 * Demo-only: shows what the user's phone would display for a document decision — the exact title and body
 * the notification service produced. Nothing has actually been delivered.
 */
export default function PushNotificationPreview({ notification, onDismiss }: { notification: DocumentNotification; onDismiss: () => void }) {
  const approved = notification.title === 'Document Approved';
  return (
    <div className="mt-3 rounded-m border border-dashed border-line-strong bg-surface-2 p-3.5" role="status">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-display font-bold uppercase tracking-wide text-ink-faint">
          Demo preview · what {notification.subjectType === 'player' ? 'the player' : `the ${notification.subjectType}`} receives
        </span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss notification preview" className="text-ink-faint hover:text-ink">
          <XIcon size={14} />
        </button>
      </div>

      {/* Lock-screen style push notification */}
      <div className="flex gap-3 rounded-2xl bg-surface p-3.5 shadow-md ring-1 ring-black/5">
        <span
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] font-display text-sm font-bold',
            approved ? 'bg-primary text-primary-foreground' : 'bg-danger text-white'
          ].join(' ')}
        >
          FX
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-ink-faint">
            <span className="font-semibold uppercase tracking-wide">Face-X</span>
            <span>now</span>
          </div>
          <div className="text-[13.5px] font-bold text-ink">{notification.title}</div>
          <div className="text-[13px] leading-snug text-ink-soft">{notification.body}</div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
        <MailIcon size={13} /> Also sent by email to the same address
      </div>
    </div>
  );
}
