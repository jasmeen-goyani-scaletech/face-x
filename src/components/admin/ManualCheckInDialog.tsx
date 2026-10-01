'use client';

import Dialog from '@/components/ui/Dialog';
import { XIcon } from '@/components/ui/Icons';
import ManualCheckInPanel from './ManualCheckInPanel';
import type { RosterEntry } from '@/lib/seed';

/** The manual search & approve panel in a modal, opened from the scanner. Scoped to whichever roster it is given. */
export default function ManualCheckInDialog({
  open,
  onClose,
  roster,
  scopeLabel,
  onConfirm
}: {
  open: boolean;
  onClose: () => void;
  roster: RosterEntry[];
  /** e.g. "Players" — shown when the scanner is scoped to one role. */
  scopeLabel?: string;
  onConfirm: (id: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="manual-checkin-title" size="xl" initialFocus="input[type='search']">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="manual-checkin-title" className="m-0 text-xl">
            Manual Search & Approve
          </h2>
          {scopeLabel && <p className="m-0 mt-0.5 text-[13px] text-ink-soft">Showing: {scopeLabel}</p>}
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="touch-target -mr-2 -mt-2 flex items-center justify-center rounded-s text-ink-soft hover:text-ink">
          <XIcon size={18} />
        </button>
      </div>
      <ManualCheckInPanel roster={roster} onConfirm={onConfirm} autoFocus />
    </Dialog>
  );
}
