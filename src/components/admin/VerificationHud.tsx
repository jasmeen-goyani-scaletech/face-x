import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import { AlertTriangleIcon, CheckIcon } from '@/components/ui/Icons';
import { formatDate, formatTime, initialsOf } from '@/lib/format';
import { checkInStatus } from '@/lib/faceMatcher';
import type { RosterEntry } from '@/lib/seed';

const ROLE_LABEL: Record<RosterEntry['role'], string> = { player: 'Player', coach: 'Coach', staff: 'Staff' };

/** Who this is, their standing, and what the admin can do about it. Used after a scan and by manual search. */
export default function VerificationHud({
  entry,
  method,
  onConfirm
}: {
  entry: RosterEntry;
  method: string;
  onConfirm: (id: string, method: string) => void;
}) {
  const status = checkInStatus(entry);

  return (
    <Card>
      <div className="mb-4 flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2">
          {entry.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.photoUrl} alt={`${entry.firstName} ${entry.lastName}`} className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-2xl font-bold text-ink-soft">{initialsOf(entry.firstName, entry.lastName)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-2xl font-bold leading-tight text-ink">
            {entry.firstName} {entry.lastName}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-soft">
            {entry.role === 'player' ? `${formatDate(entry.dob)}${entry.division ? ` · ${entry.division}` : ''} · ` : ''}
            {ROLE_LABEL[entry.role]}
          </div>
          {entry.teamName && <div className="text-[13px] text-ink-soft">{entry.teamName}</div>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {entry.approved ? <Chip kind="success">Verified</Chip> : <Chip kind="danger">Not cleared</Chip>}
        {entry.role === 'player' && <Chip kind={entry.paymentComplete ? 'success' : 'danger'}>Payment: {entry.paymentComplete ? 'Complete' : 'Incomplete'}</Chip>}
        {entry.disabled && <Chip kind="danger">Access disabled</Chip>}
        {entry.checkedInAt && <Chip kind="warning">Checked in{entry.checkedInOverride ? ' (override)' : ''}</Chip>}
      </div>

      {status.kind === 'blocked' && (
        <div className="flex gap-3 rounded-s border border-danger bg-danger-tint px-4 py-3.5">
          <AlertTriangleIcon size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <div className="text-sm font-bold text-danger">Not cleared for event day</div>
            <p className="m-0 mt-0.5 text-[13px] text-ink-soft">{status.reason}</p>
          </div>
        </div>
      )}

      {status.kind === 'already' && (
        <div className="flex gap-3 rounded-s border border-warning bg-warning-soft px-4 py-3.5">
          <CheckIcon size={18} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <div className="text-sm font-bold text-warning">Already checked in</div>
            <p className="m-0 mt-0.5 text-[13px] text-ink-soft">
              At {formatTime(entry.checkedInAt)} via {entry.checkedInMethod}
              {entry.checkedInOverride ? ' (admin override)' : ''}. Duplicate check-in is blocked.
            </p>
          </div>
        </div>
      )}

      {status.kind === 'ready' && (
        <Button variant="primary" block onClick={() => onConfirm(entry.id, method)}>
          <CheckIcon size={18} /> Confirm Check-In
        </Button>
      )}
    </Card>
  );
}
