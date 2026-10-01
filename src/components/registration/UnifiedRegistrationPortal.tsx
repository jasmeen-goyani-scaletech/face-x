'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import RoleBadge, { ROLE_TONE } from '@/components/ui/RoleBadge';
import { TrophyIcon, ShieldIcon, UsersIcon, ChevronRightIcon, CheckIcon } from '@/components/ui/Icons';
import type { RegistrationRole } from '@/lib/activeRole';
import type { InviteResolution } from '@/lib/teams';

export interface PortalDraft {
  key: string;
  href: string;
  role: string;
  name: string;
  status: string;
}

const ROLES: RegistrationRole[] = ['player', 'coach', 'staff'];

const ROLE_INFO: Record<RegistrationRole, { icon: ReactNode; desc: string; steps: string[]; time: string }> = {
  player: {
    icon: <TrophyIcon size={22} />,
    desc: 'Register an athlete for the season — info, documents, selfie, consent, and payment.',
    steps: ['Basic info', 'Photo & documents', 'Guardian & consent', 'Payment'],
    time: '≈ 10 min'
  },
  coach: {
    icon: <UsersIcon size={22} />,
    desc: 'Personal details and certification uploads. No payment required.',
    steps: ['Personal details', 'Photo & certificates', 'Review status'],
    time: '≈ 6 min'
  },
  staff: {
    icon: <ShieldIcon size={22} />,
    desc: 'Team managers, athletic trainers, equipment managers, and safety officers.',
    steps: ['Personal details', 'Photo & proof', 'Review status'],
    time: '≈ 6 min'
  }
};

/**
 * Role-selection portal for /register. Presentation only: the drafts list, invite resolution, query string and the three
 * destination routes are computed by the page and passed in unchanged.
 */
export default function UnifiedRegistrationPortal({
  drafts,
  resolution,
  qs
}: {
  drafts: PortalDraft[];
  resolution: InviteResolution;
  /** `?teamId=…&inviteCode=…` carried onto every role link, or ''. */
  qs: string;
}) {
  // An invite is a Player-pathway feature, so start there; the selection itself is only a preview of the destination.
  const [selected, setSelected] = useState<RegistrationRole>('player');
  const idx = ROLES.indexOf(selected);
  const info = ROLE_INFO[selected];
  const tone = ROLE_TONE[selected];

  return (
    <div className="mx-auto max-w-[640px] page-gutter pt-8 pb-16">
      <h1 className="mb-1 text-2xl">Who&rsquo;s registering?</h1>
      <p className="mb-6 text-ink-soft">Choose a pathway to get started. Each takes about 10 minutes.</p>

      {drafts.length > 0 && (
        <div className="mb-5 rounded-l border border-line bg-surface p-4 shadow-sm">
          <div className="mb-2 font-display text-[11px] font-bold uppercase tracking-wide text-ink-faint">Continue where you left off</div>
          <div className="grid gap-2">
            {drafts.map((d) => (
              <Link
                key={d.key}
                href={d.href}
                className="flex items-center justify-between rounded-s border border-line px-3.5 py-2.5 text-ink no-underline transition-colors hover:border-primary hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="text-sm">
                  <strong>{d.role}</strong> · {d.name}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{d.status === 'submitted' ? 'Submitted' : 'Resume →'}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {resolution.status === 'valid' && resolution.invite && (
        <Alert level="success" title={`Joining ${resolution.invite.teamName} via Coach Invite`}>
          {resolution.invite.club}. Your team will be pre-filled in the Player pathway below.
        </Alert>
      )}
      {resolution.status === 'unknown_team' && (
        <Alert level="warning" title="Invite link not recognized">
          The team in this link couldn&rsquo;t be found. You can still register and select your team manually.
        </Alert>
      )}
      {resolution.status === 'invalid_code' && (
        <Alert level="warning" title="Invite code doesn&rsquo;t match">
          This invite code isn&rsquo;t valid for that team. You can still register and select your team manually.
        </Alert>
      )}
      {resolution.status === 'team_disabled' && (
        <Alert level="warning" title="This team isn&rsquo;t accepting registrations">
          The team in this link has been disabled. You can still register and select your team manually, or contact your coach for an updated link.
        </Alert>
      )}

      {/* Role selector: a sliding pill moves under the active tab. */}
      <div
        role="tablist"
        aria-label="Registration role"
        className="relative mb-4 grid grid-cols-3 rounded-full border border-line bg-surface-2 p-1"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-primary shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${idx * 100}%)` }}
        />
        {ROLES.map((role) => {
          const active = role === selected;
          return (
            <button
              key={role}
              type="button"
              role="tab"
              id={`role-tab-${role}`}
              aria-selected={active}
              aria-controls="role-panel"
              onClick={() => setSelected(role)}
              className={[
                'relative z-10 rounded-full px-3 py-2 font-display text-[13px] font-bold uppercase tracking-wider transition-colors duration-300',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2',
                active ? 'text-primary-foreground' : 'text-ink-soft hover:text-ink'
              ].join(' ')}
            >
              {ROLE_TONE[role].label}
            </button>
          );
        })}
      </div>

      {/* Selected role: what it involves, then straight into the real registration route. */}
      <div
        key={selected}
        id="role-panel"
        role="tabpanel"
        aria-labelledby={`role-tab-${selected}`}
        className={[
          'rounded-l border bg-surface p-5 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-6',
          'animate-[portal-fade_250ms_ease-out] motion-reduce:animate-none',
          selected === 'player' && resolution.status === 'valid' ? 'border-primary ring-1 ring-primary' : 'border-line'
        ].join(' ')}
      >
        <div className="mb-3 flex items-center gap-3">
          <span className={['flex h-11 w-11 shrink-0 items-center justify-center rounded-s', tone.badge].join(' ')}>{info.icon}</span>
          <div className="min-w-0">
            <RoleBadge role={selected} />
          </div>
          <span className="ml-auto text-xs font-semibold text-ink-faint">{info.time}</span>
        </div>
        <p className="mb-4 text-[14px] leading-relaxed text-ink-soft">{info.desc}</p>

        <ol className="m-0 mb-5 grid list-none gap-2 p-0">
          {info.steps.map((label, i) => (
            <li key={label} className="flex items-center gap-2.5 text-[13.5px] text-ink">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-ink-soft">{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <Link
          href={`/register/${selected}${qs}`}
          className="flex w-full items-center justify-center gap-2 rounded-s bg-primary px-4 py-3 text-sm font-bold text-primary-foreground no-underline transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Continue as {tone.label}
          <ChevronRightIcon size={16} />
        </Link>
      </div>

      {selected === 'player' && resolution.status === 'valid' && (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-primary-strong">
          <CheckIcon size={13} strokeWidth={3} /> Team invite applied to this pathway
        </p>
      )}
    </div>
  );
}
