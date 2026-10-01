'use client';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import AccountStatusBar, { type PaymentState } from './AccountStatusBar';
import { accessState, blockedSummary, type AccessCompliance, type RegistrationState } from '@/lib/accessCompliance';

export interface AdminUserHeaderProps {
  name: string;
  subtitle?: string;
  initials: string;
  photoUrl?: string;
  roleLabel: string;
  registration: RegistrationState;
  /** Players only. */
  payment?: PaymentState;
  /** Open compliance flags. */
  flags: string[];
  /** From `accessCompliance(...)`: whether anything unresolved is holding access back, and what. */
  compliance: AccessCompliance;
  /** The admin's own on/off switch. It only matters once compliance is clear. */
  accessDisabled: boolean;
  onToggleAccess: () => void;
}

/**
 * Header for the Player, Coach and Staff admin pages, with event-day access locked by compliance.
 *
 * Access is never trusted from a stored flag; it is derived (see lib/accessCompliance.ts):
 *   - anything unresolved (registration not approved, documents missing / pending / rejected, open flags) → the pill reads
 *     "Disabled · Blocked by compliance" and the Enable button is disabled. There is no override: the way forward is
 *     clearing the items under Photos & Documents;
 *   - all clear → "Enabled", with a Disable button;
 *   - all clear but switched off by an admin → "Disabled", with an Enable button.
 *
 * The header is just the pills and the button. There is no warning box: the pills already say what is wrong. The full
 * list of what is blocking access (e.g. "2 documents pending review") is on the disabled button as a hover tooltip and as
 * text for screen readers, so it is available without taking up space.
 */
export default function AdminUserHeader({
  name,
  subtitle,
  initials,
  photoUrl,
  roleLabel,
  registration,
  payment,
  flags,
  compliance,
  accessDisabled,
  onToggleAccess
}: AdminUserHeaderProps) {
  const access = accessState(compliance, accessDisabled);
  const blocked = access === 'blocked';
  const enabled = access === 'enabled';
  const reason = blocked ? `${blockedSummary(compliance)} Resolve these under Photos & Documents first.` : undefined;

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-full border border-line object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-light text-lg font-bold text-primary-strong">{initials}</div>
        )}

        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="m-0 truncate text-xl">{name}</h1>
            <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{roleLabel}</span>
          </div>
          {subtitle && <p className="m-0 mt-0.5 truncate text-sm text-ink-soft">{subtitle}</p>}
          <div className="mt-2.5">
            <AccountStatusBar registration={registration} access={access} payment={payment} flags={flags} />
          </div>
        </div>

        {/* The wrapper carries the tooltip: browsers don't reliably show one on a disabled button itself. */}
        <span title={reason} className="shrink-0">
          <Button variant="secondary" onClick={() => !blocked && onToggleAccess()} disabled={blocked} aria-describedby={blocked ? 'access-blocked-reason' : undefined}>
            {enabled ? 'Disable' : 'Enable'} Event-Day Access
          </Button>
          {blocked && (
            <span id="access-blocked-reason" className="sr-only">
              {reason}
            </span>
          )}
        </span>
      </div>
    </Card>
  );
}
