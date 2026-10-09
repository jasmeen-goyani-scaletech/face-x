'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import UnifiedRegistrationPortal from '@/components/registration/UnifiedRegistrationPortal';
import { useAuth } from '@/components/auth/AuthProvider';
import { resolveInvite as resolveInviteApi } from '@/lib/api/catalog';
import { readLocalOwner } from '@/lib/localCopy';
import type { InviteResolution } from '@/lib/teams';

interface DraftInfo {
  key: string;
  href: string;
  role: string;
  name: string;
  status: string;
}

function readDrafts(): DraftInfo[] {
  // Copies belong to the account that made them; ones nobody has claimed (or left by someone else) are not shown.
  if (!readLocalOwner()) return [];
  const sources: { key: string; href: string; role: string }[] = [
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
  // An invite is checked by the server, so its resolution only exists on the client, after sign-in.
  const [resolution, setResolution] = useState<InviteResolution>({ invite: null, status: 'none' });
  const { status: authStatus, user, restore } = useAuth();

  useEffect(() => {
    setDrafts(user && readLocalOwner() !== user.id ? [] : readDrafts());
  }, [user]);

  // A player invite is checked by the server, which needs a signed-in visitor. Someone arriving from an invite link may
  // already have a session cookie, so look for one (only when there is an invite to check).
  useEffect(() => {
    if (inviteCode && authStatus === 'idle') void restore();
  }, [inviteCode, authStatus, restore]);

  useEffect(() => {
    if (!inviteCode) return setResolution({ invite: null, status: 'none' });
    if (authStatus === 'signedOut') return setResolution({ invite: null, status: 'needs_signin' });
    if (authStatus !== 'signedIn') return setResolution({ invite: null, status: 'none' });
    let cancelled = false;
    resolveInviteApi({ inviteCode, teamId: teamId ?? undefined })
      .then((r) => {
        if (cancelled) return;
        setResolution({ invite: { teamId: r.team.id, inviteCode, teamName: r.team.name, club: r.team.club }, status: 'valid' });
      })
      .catch(() => !cancelled && setResolution({ invite: null, status: 'unknown_team' }));
    return () => {
      cancelled = true;
    };
  }, [teamId, inviteCode, authStatus]);

  return (
    <main>
      <Topbar eyebrow="New registration" />
      <UnifiedRegistrationPortal drafts={drafts} resolution={resolution} qs={qs} />
    </main>
  );
}

export default function RegisterEntryPage() {
  return (
    <Suspense fallback={null}>
      <RoleSelection />
    </Suspense>
  );
}
