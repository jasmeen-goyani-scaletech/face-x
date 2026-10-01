'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import UnifiedRegistrationPortal from '@/components/registration/UnifiedRegistrationPortal';
import { resolveInvite, type InviteResolution } from '@/lib/teams';

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
