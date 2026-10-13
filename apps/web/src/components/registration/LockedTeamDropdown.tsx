'use client';

import { useEffect } from 'react';
import FormFieldWrapper, { fieldAria, fieldControlClass, fieldStateClass } from '@/components/ui/FormFieldWrapper';
import { LockIcon } from '@/components/ui/Icons';
import type { TeamRecord } from '@/lib/teams';

/**
 * "Team & Club" picker.
 *
 *  - `lockedTeam` set (a validated invite / team link): the value is forced to that team, the control is disabled and
 *    read-only, and a lock icon plus a "Pre-assigned via Invite" badge explain why.
 *  - `lockedTeam` null: a normal, selectable dropdown over `teams`.
 *
 * Payload is identical in both modes: the parent's `teamId` string is always the single source of truth. When locked, the
 * component re-asserts the invite's team id through `onChange` if the parent's value ever differs (e.g. a stale draft), and
 * renders a hidden `<input name="teamId">` because browsers omit disabled controls from native form submission.
 */
export default function LockedTeamDropdown({
  id = 'team',
  label = 'Team & Club',
  value,
  onChange,
  onBlur,
  teams,
  lockedTeam,
  error
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (teamId: string) => void;
  onBlur?: () => void;
  teams: TeamRecord[];
  /** The team the invite assigned, or null/undefined when the visitor is choosing for themselves. */
  lockedTeam?: { teamId: string; teamName: string; club: string } | null;
  error?: string | null;
}) {
  const isPreSelected = !!lockedTeam;
  const lockedId = lockedTeam?.teamId;

  useEffect(() => {
    if (lockedId && value !== lockedId) onChange(lockedId);
    // onChange is a fresh closure each render; only the values matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedId, value]);

  if (!lockedTeam) {
    return (
      <FormFieldWrapper id={id} label={label} error={error}>
        <select
          id={id}
          name="teamId"
          value={value}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          className={[fieldControlClass, fieldStateClass(!!error)].join(' ')}
          {...fieldAria(id, error)}
        >
          <option value="">Select a team...</option>
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.teamName} — {t.club}
            </option>
          ))}
        </select>
      </FormFieldWrapper>
    );
  }

  return (
    <FormFieldWrapper
      id={id}
      label={label}
      marker="none"
      hint="Your coach's invite assigned this team. It can't be changed here — contact your coach if it's wrong."
    >
      <div className="relative">
        <LockIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <select
          id={id}
          value={lockedTeam.teamId}
          disabled={isPreSelected}
          aria-readonly="true"
          // `readOnly` isn't a valid <select> attribute; aria-readonly + disabled + the single option below enforce it.
          onChange={() => undefined}
          className={[
            fieldControlClass,
            'cursor-not-allowed appearance-none border-line bg-surface-2 pl-9 pr-44 text-ink-soft opacity-100 hover:border-line'
          ].join(' ')}
          {...fieldAria(id, null, true)}
        >
          {/* Only the assigned team is offered, so it displays even if it isn't in the active directory. */}
          <option value={lockedTeam.teamId}>
            {lockedTeam.teamName} — {lockedTeam.club}
          </option>
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full border border-primary/25 bg-primary-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-strong">
          <LockIcon size={11} />
          Pre-assigned via Invite
        </span>
      </div>
      <input type="hidden" name="teamId" value={lockedTeam.teamId} />
    </FormFieldWrapper>
  );
}
