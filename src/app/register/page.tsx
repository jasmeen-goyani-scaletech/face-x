'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import Alert from '@/components/ui/Alert';
import { resolveInvite, type InviteResolution } from '@/lib/teams';
import { TrophyIcon, ShieldIcon, UsersIcon, ChevronRightIcon } from '@/components/ui/Icons';

interface DraftInfo {
  key: string;
  href: string;
  role: string;
  name: string;
  status: string;
}

function readDrafts(): DraftInfo[] {
  const sources: { key: string; href: string; role: string }[] = [
    { key: 'facex-player-registration', href: '/register/player', role: 'Player' },
    { key: 'facex-coach-registration', href: '/register/coach', role: 'Coach' },
    { key: 'facex-staff-registration', href: '/register/staff', role: 'Staff' }
  ];
  const drafts: DraftInfo[] = [];
  for (const s of sources) {
    try {
      const raw = window.localStorage.getItem(s.key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed.status === 'draft' || parsed.status === 'submitted') {
        const name = [parsed.basic?.firstName, parsed.basic?.lastName].filter(Boolean).join(' ') || 'In progress';
        drafts.push({ key: s.key, href: s.href, role: s.role, name, status: parsed.status });
      }
    } catch {
      // ignore corrupt entries
    }
  }
  return drafts;
}

function RoleSelection() {
  const params = useSearchParams();
  const teamId = params.get('teamId');
  const inviteCode = params.get('inviteCode');
  const qs = teamId || inviteCode ? `?${params.toString()}` : '';
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  // resolveInvite reads the client-only team store (localStorage-backed), which the server can't
  // see — computing it during the initial render would make server and client output diverge and
  // throw a hydration error. Deferring to an effect (like `drafts` below) keeps first paint
  // identical on both sides; the real resolution appears a tick later on the client only.
  const [resolution, setResolution] = useState<InviteResolution>({ invite: null, status: 'none' });

  useEffect(() => {
    setDrafts(readDrafts());
    setResolution(resolveInvite(teamId, inviteCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, inviteCode]);

  return (
    <main>
      <Topbar eyebrow="New registration" />
      <div className="mx-auto max-w-[640px] page-gutter pt-8 pb-16">
        <h1 className="text-2xl mb-1">Who&rsquo;s registering?</h1>
        <p className="text-ink-soft mb-6">Choose a pathway to get started. Each takes about 10 minutes.</p>

        {drafts.length > 0 && (
          <div className="rounded-l border border-line bg-surface p-4 mb-5">
            <div className="text-[11px] font-display font-bold uppercase tracking-wide text-ink-faint mb-2">
              Continue where you left off
            </div>
            <div className="grid gap-2">
              {drafts.map((d) => (
                <Link
                  key={d.key}
                  href={d.href}
                  className="flex items-center justify-between rounded-s border border-line px-3.5 py-2.5 no-underline hover:border-primary"
                >
                  <span className="text-sm">
                    <strong>{d.role}</strong> · {d.name}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                    {d.status === 'submitted' ? 'Submitted' : 'Resume →'}
                  </span>
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

        <div className="grid gap-3">
          <RoleCard
            href={`/register/player${qs}`}
            icon={<TrophyIcon size={20} />}
            title="Player"
            desc="Register an athlete for the season — info, documents, selfie, consent, and payment."
            highlight={resolution.status === 'valid'}
          />
          <RoleCard
            href={`/register/coach${qs}`}
            icon={<UsersIcon size={20} />}
            title="Coach"
            desc="Personal details and certification uploads. No payment required."
          />
          <RoleCard
            href={`/register/staff${qs}`}
            icon={<ShieldIcon size={20} />}
            title="Staff"
            desc="Team managers, athletic trainers, equipment managers, and safety officers."
          />
        </div>
      </div>
    </main>
  );
}

function RoleCard({
  href,
  icon,
  title,
  desc,
  highlight
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        'flex items-center justify-between gap-3 rounded-l border bg-surface px-5 py-4 no-underline',
        highlight ? 'border-primary ring-1 ring-primary' : 'border-line hover:border-line-strong'
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-s bg-primary-light text-primary-strong">
          {icon}
        </span>
        <div>
          <div className="font-bold text-ink">{title}</div>
          <div className="text-[13px] text-ink-soft">{desc}</div>
        </div>
      </div>
      <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
    </Link>
  );
}

export default function RegisterEntryPage() {
  return (
    <Suspense fallback={null}>
      <RoleSelection />
    </Suspense>
  );
}
