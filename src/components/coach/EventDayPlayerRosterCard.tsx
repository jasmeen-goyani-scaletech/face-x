import Card from '@/components/ui/Card';
import { AlertTriangleIcon, CheckIcon, PhoneIcon } from '@/components/ui/Icons';
import { contactOptions } from '@/lib/contactOptions';
import { formatTime, initialsOf } from '@/lib/format';
import type { RosterEntry } from '@/lib/seed';

/** Shared by every action so they line up and meet the 44px touch size. */
const BASE = 'touch-target inline-flex items-center justify-center gap-2 rounded-s border px-3 py-2 text-[13px] font-bold no-underline transition-colors';
const PRIMARY = `${BASE} border-primary bg-primary text-primary-foreground hover:bg-primary-hover`;
const SECONDARY = `${BASE} border-line-strong bg-surface text-ink hover:bg-surface-2`;
const DISABLED = `${BASE} cursor-not-allowed border-line bg-surface-2 text-ink-faint`;

/** One line on why a pending player can't be checked in yet, or null if they can. */
function holdReason(player: RosterEntry): string | null {
  if (player.disabled) return 'Event-day access was turned off by an organizer';
  if (!player.approved) return player.pendingReason || 'Registration not approved yet';
  if (player.flags.length > 0) return player.flags.join(', ');
  return null;
}

/**
 * One player on the coach's event-day roster.
 *
 * Contact actions:
 *   1. Call Player (primary): the player's own number.
 *   2. Call Parent (secondary): the guardian's number. Shown for minors only; an adult has no parent to call.
 * Missing numbers are handled in place. A button with no number is disabled and says why, and when the player has no number
 * of their own the Parent button takes over the primary styling, so the action that works is the one that stands out.
 * A pending player who can't be checked in yet (not approved, flagged, access off) shows why, under their status.
 */
export default function EventDayPlayerRosterCard({ player }: { player: RosterEntry }) {
  const contact = contactOptions(player);
  const hold = player.checkedInAt ? null : holdReason(player);

  return (
    <Card className="flex h-full flex-col gap-3 !p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2 font-display text-lg font-bold text-ink-soft">
          {player.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initialsOf(player.firstName, player.lastName)
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-ink">
            {player.firstName} {player.lastName}
          </div>
          <div className="truncate text-[12.5px] text-ink-soft">
            {player.jerseyNumber ? `#${player.jerseyNumber} · ` : ''}
            {player.position ? `${player.position} · ` : ''}
            {player.schoolId}
            {player.division ? ` · ${player.division}` : ''}
          </div>
        </div>
      </div>

      {player.checkedInAt ? (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[12px] font-bold text-success">
          <CheckIcon size={14} strokeWidth={3} /> Checked in at {formatTime(player.checkedInAt)}
        </span>
      ) : (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-bold text-warning">
          <AlertTriangleIcon size={14} /> Pending check-in
        </span>
      )}
      {hold && <p className="m-0 text-[12.5px] text-ink-soft">Not cleared yet: {hold}</p>}

      <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
        {/* 1 · Call Player */}
        {contact.playerPhone ? (
          <a href={`tel:${contact.playerPhone}`} className={`${contact.primary === 'player' ? PRIMARY : SECONDARY} ${contact.minor ? '' : 'col-span-2'}`}>
            <PhoneIcon size={15} /> Call Player
          </a>
        ) : (
          <span className={`${DISABLED} ${contact.minor ? '' : 'col-span-2'}`} aria-disabled="true" title="No phone number on file for the player">
            <PhoneIcon size={15} /> No player phone
          </span>
        )}

        {/* 2 · Call Parent (minors only) */}
        {contact.minor &&
          (contact.parentPhone ? (
            <a href={`tel:${contact.parentPhone}`} className={contact.primary === 'parent' ? PRIMARY : SECONDARY}>
              <PhoneIcon size={15} /> Call Parent
            </a>
          ) : (
            <span className={DISABLED} aria-disabled="true" title="No phone number on file for a parent or guardian">
              <PhoneIcon size={15} /> No parent phone
            </span>
          ))}

      </div>
    </Card>
  );
}
