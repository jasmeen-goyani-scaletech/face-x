import { AlertTriangleIcon, CheckIcon } from '@/components/ui/Icons';
import { formatDate, formatTime, initialsOf } from '@/lib/format';
import type { RosterEntry } from '@/lib/seed';

const ROLE_LABEL: Record<RosterEntry['role'], string> = { player: 'Player', coach: 'Coach', staff: 'Staff' };

export default function VerificationHud({
  entry,
  method,
  onConfirm
}: {
  entry: RosterEntry;
  method: string;
  onConfirm: (id: string, method: string, override: boolean) => void;
}) {
  const already = !!entry.checkedInAt;
  const hasFlags = entry.flags.length > 0;

  return (
    <div className="rounded-2xl border border-[#253029] bg-[#12181f] p-5">
      <div className="flex items-center gap-4 mb-5">
        <div className="h-20 w-20 shrink-0 rounded-full overflow-hidden bg-[#1c2620] border-2 border-[#2d3a33] flex items-center justify-center">
          {entry.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.photoUrl} alt={`${entry.firstName} ${entry.lastName}`} className="h-full w-full object-cover" />
          ) : (
            <span className="font-display font-bold text-2xl text-[#9fb0a6]">{initialsOf(entry.firstName, entry.lastName)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-2xl leading-tight truncate">{entry.firstName} {entry.lastName}</div>
          <div className="text-[#9fb0a6] text-[13px] mt-0.5">
            {formatDate(entry.dob)}{entry.division ? ` · ${entry.division}` : ''} · {ROLE_LABEL[entry.role]}
          </div>
          {entry.teamName && <div className="text-[#9fb0a6] text-[13px]">{entry.teamName}</div>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {entry.approved ? <Badge tone="success">Verified</Badge> : <Badge tone="danger">Not Cleared</Badge>}
        <Badge tone={entry.paymentComplete ? 'success' : 'danger'}>{entry.paymentComplete ? 'Payment: Complete' : 'Payment: Incomplete'}</Badge>
        {already && <Badge tone="warning">Checked In{entry.checkedInOverride ? ' (Override)' : ''}</Badge>}
      </div>

      {!entry.approved && (
        <div className="rounded-xl bg-[#2a1414] border border-[#5c2323] px-4 py-3.5 flex gap-3">
          <AlertTriangleIcon size={18} className="text-[#f87171] shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[#f87171] text-sm">Not cleared for event day</div>
            <p className="text-[#e0a8a8] text-[13px] m-0 mt-0.5">{entry.pendingReason || 'This registrant is not on the approved list.'}</p>
          </div>
        </div>
      )}

      {entry.approved && already && (
        <div className="rounded-xl bg-[#241d0d] border border-[#4d3c14] px-4 py-3.5 flex gap-3">
          <CheckIcon size={18} className="text-[#e3ac4a] shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[#e3ac4a] text-sm">Already checked in</div>
            <p className="text-[#c9b184] text-[13px] m-0 mt-0.5">
              At {formatTime(entry.checkedInAt)} via {entry.checkedInMethod}
              {entry.checkedInOverride ? ' (admin override)' : ''}. Duplicate check-in is blocked.
            </p>
          </div>
        </div>
      )}

      {entry.approved && !already && hasFlags && (
        <>
          <div className="rounded-xl bg-[#241d0d] border border-[#4d3c14] px-4 py-3.5 flex gap-3 mb-3.5">
            <AlertTriangleIcon size={18} className="text-[#e3ac4a] shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-[#e3ac4a] text-sm">Flagged — review before check-in</div>
              <ul className="text-[#c9b184] text-[13px] m-0 mt-1 pl-4 list-disc">
                {entry.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
          <button
            onClick={() => onConfirm(entry.id, method, true)}
            className="w-full rounded-xl bg-[#e3ac4a] text-[#241d0d] font-bold uppercase tracking-wide py-4 text-[15px] active:translate-y-px"
          >
            Check In Anyway (Override)
          </button>
        </>
      )}

      {entry.approved && !already && !hasFlags && (
        <button
          onClick={() => onConfirm(entry.id, method, false)}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#22c55e] text-[#06130d] font-bold uppercase tracking-wide py-4 text-[15px] active:translate-y-px"
        >
          <CheckIcon size={18} /> Confirm Check-In
        </button>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'success' | 'warning' | 'danger'; children: React.ReactNode }) {
  const classes = {
    success: 'bg-[#0f2a1a] text-[#4ade80] border-[#1f5c38]',
    warning: 'bg-[#241d0d] text-[#e3ac4a] border-[#4d3c14]',
    danger: 'bg-[#2a1414] text-[#f87171] border-[#5c2323]'
  }[tone];
  return (
    <span className={['inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide', classes].join(' ')}>
      {children}
    </span>
  );
}
