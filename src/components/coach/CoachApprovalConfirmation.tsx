'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { CheckIcon, CopyIcon, LinkIcon, UsersIcon } from '@/components/ui/Icons';
import { initialsOf } from '@/lib/format';
import { useEventRoster } from '@/lib/roster';
import { generateInviteLink } from '@/lib/teams';
import type { CoachRegistration } from '@/lib/types';

const ROLE_LABEL = { player: 'Player', coach: 'Coach', staff: 'Staff' } as const;

/** Read-only link with a one-click copy. If the browser refuses clipboard access the link is selected, ready to copy by hand. */
function InviteLinkBox({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(input: HTMLInputElement | null) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      input?.select();
    }
  }

  let inputEl: HTMLInputElement | null = null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Player invite link</span>
        <LinkIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          ref={(el) => {
            inputEl = el;
          }}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-s border border-line-strong bg-surface-2 py-2.5 pl-8 pr-3 text-[13px] text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </label>
      <Button variant="secondary" className="sm:shrink-0" onClick={() => copy(inputEl)}>
        {copied ? <CheckIcon size={15} strokeWidth={3} /> : <CopyIcon size={15} />} {copied ? 'Copied' : 'Copy Invite Link'}
      </Button>
    </div>
  );
}

/**
 * What an approved coach sees on their registration page.
 *
 * Which team is theirs decides everything:
 *   - Assigned (they registered through a team's link, or already created a team): no "Create a Team" form at all. They get
 *     the team's name and ID, a copyable player invite link, and the list of players and staff registered to that team.
 *   - Not assigned: the "Create a Team" form, which makes the team and its invite link.
 * Either way the Event-Day Roster button is on top.
 *
 * Roster members are matched to the coach's team by team id, so teams that share a name never mix. Each member shows their
 * role (Player / Staff) and registration status.
 */
export default function CoachApprovalConfirmation({
  reg,
  onCreateTeam
}: {
  reg: CoachRegistration;
  /** Creates the coach's team. Never called for a coach who already has one. */
  onCreateTeam: (teamName: string) => void;
}) {
  const { roster } = useEventRoster();
  const [newTeamName, setNewTeamName] = useState('');

  const team = reg.invite ?? reg.team;
  const members = team
    ? roster
        .filter((r) => (r.role === 'player' || r.role === 'staff') && r.teamId === team.teamId)
        .sort((a, b) => a.role.localeCompare(b.role) || a.lastName.localeCompare(b.lastName))
    : [];

  return (
    <>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-success bg-success-soft text-success">
        <CheckIcon size={26} />
      </div>
      <h2 className="mb-1 text-center text-xl">Coach Approved</h2>
      <p className="mb-4 text-center text-ink-soft">
        <Chip kind="success">Event-day access granted</Chip>
      </p>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row">
        <Link href="/coach/my-team/event-day" className="flex-1 no-underline">
          <Button variant="primary" block>
            Open Event-Day Roster
          </Button>
        </Link>
        <Link href="/coach/my-team/roster" className="flex-1 no-underline">
          <Button variant="secondary" block>
            View Team Roster
          </Button>
        </Link>
      </div>

      {team ? (
        <>
          <section aria-label="Your team" className="mb-6">
            <h3 className="mb-2 text-[13px] tracking-wide">Your Team</h3>
            <div className="mb-3 rounded-m bg-primary-light p-3.5">
              <div className="text-base font-bold text-primary-strong">{team.teamName}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-soft">
                Team ID: <span className="font-mono">{team.teamId}</span>
              </div>
            </div>
            <p className="mb-2 text-[13px] text-ink-soft">Share this link so players can register straight onto your roster.</p>
            <InviteLinkBox link={generateInviteLink(team.teamId, team.inviteCode)} />
          </section>

          <section aria-label="Your team roster">
            <h3 className="mb-2 text-[13px] tracking-wide">Your Team Roster ({members.length})</h3>
            {members.length === 0 ? (
              <div className="rounded-m border border-dashed border-line-strong px-4 py-8 text-center">
                <UsersIcon size={28} className="mx-auto mb-2 text-ink-faint" />
                <p className="m-0 text-sm text-ink-soft">No players have joined this team yet. Share your invite link above.</p>
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-m border border-line bg-surface p-2.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2 text-sm font-bold text-ink-soft">
                      {m.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.photoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialsOf(m.firstName, m.lastName)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">
                        {m.firstName} {m.lastName}
                      </span>
                      <span className="block truncate text-[12.5px] text-ink-soft">{ROLE_LABEL[m.role]}</span>
                    </span>
                    <Chip compact kind={m.approved ? 'success' : 'warning'}>
                      {m.approved ? 'Approved' : 'Pending'}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section aria-label="Create a team">
          <h3 className="mb-2 mt-2 text-[13px] tracking-wide">Create a Team</h3>
          <p className="mb-3 text-[13px] text-ink-soft">Generate a shareable invite link players can use to register directly onto your roster.</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onCreateTeam(newTeamName);
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-s border border-line-strong px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Team name (e.g. Sacramento U14 Hawks)"
              aria-label="Team name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
            />
            <Button type="submit" variant="primary">
              Create
            </Button>
          </form>
        </section>
      )}
    </>
  );
}
