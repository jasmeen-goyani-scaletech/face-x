'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AdminCollapsibleSidenav from '@/components/admin/AdminCollapsibleSidenav';
import OfflineRosterSyncEngine from '@/components/admin/OfflineRosterSyncEngine';
import { useAuth } from '@/components/auth/AuthProvider';
import RequireAuth from '@/components/auth/RequireAuth';
import Card from '@/components/ui/Card';
import { listPersonnelRegistrations } from '@/lib/api/registrations';
import type { ApiStaffProfileType } from '@/lib/api/types';
import { useAdminSidenav } from '@/lib/useAdminSidenav';
import { ToastProvider } from '@/components/ui/Toast';

/** The admin chrome: side navigation and the content column that follows it. */
function AdminShell({ children, personnelOnly = false }: { children: React.ReactNode; personnelOnly?: boolean }) {
  const { collapsed, toggle: toggleSidenav } = useAdminSidenav();
  const pathname = usePathname();
  const router = useRouter();
  // The roster belongs to coaches and staff; an admin who types the address is sent back to the admin home.
  const blocked = !personnelOnly && (pathname === '/admin/roster' || !!pathname?.startsWith('/admin/roster/'));
  useEffect(() => {
    if (blocked) router.replace('/admin/tournaments');
  }, [blocked, router]);
  if (blocked) return <div className="min-h-screen bg-surface" />;
  return (
    <ToastProvider>
      <div className="min-h-screen">
        <AdminCollapsibleSidenav collapsed={collapsed} onToggle={toggleSidenav} personnelOnly={personnelOnly} />
        {/* The rail is fixed from md up, so the content column makes room for it and follows it as it collapses. */}
        <div
          className={[
            'min-w-0 transition-[margin] duration-300 ease-out motion-reduce:transition-none',
            collapsed ? 'md:ml-20' : 'md:ml-64'
          ].join(' ')}
        >
          <main
            className="px-4 py-5 sm:px-8 sm:py-8"
            style={{
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))'
            }}
          >
            {children}
          </main>
        </div>
      </div>
      {/* The offline event-day roster is an admin tool; coaches and staff do not load it. */}
      {!personnelOnly && <OfflineRosterSyncEngine />}
    </ToastProvider>
  );
}

/** The registration statuses the API treats as approved for a coach or staff member (api events/access-service.ts). */
const APPROVED = ['VERIFIED', 'READY_FOR_EVENT'];

type Approval = 'checking' | 'approved' | 'pending' | 'error';

/**
 * Whether the signed-in coach or staff member is approved, asked of the API (their own registrations), never remembered in the
 * browser. It is asked again when the page changes and when the tab comes back into view, so a change of status shows up
 * without signing in again. The team and roster APIs enforce the same rule on their own.
 */
function useApproval(kind: ApiStaffProfileType, pathname: string | null): Approval {
  const [state, setState] = useState<Approval>('checking');
  useEffect(() => {
    let live = true;
    const check = () =>
      listPersonnelRegistrations(kind)
        .then((regs) => {
          if (live) setState(regs.some((r) => APPROVED.includes(r.status)) ? 'approved' : 'pending');
        })
        // A failed check never lets the screen through.
        .catch(() => {
          if (live) setState('error');
        });
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [kind, pathname]);
  return state;
}

function PendingReview({ kind, error }: { kind: ApiStaffProfileType; error: boolean }) {
  const { user, logout } = useAuth();
  const who = kind === 'COACH' ? 'coach' : 'staff';
  return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center px-5">
      <Card className="w-full max-w-[420px] text-center">
        <h1 className="font-display text-lg uppercase tracking-wide mb-1 text-ink">{error ? 'Something went wrong' : 'Pending Review'}</h1>
        <p className="text-ink-soft text-sm mb-5">
          {error
            ? 'We couldn’t check your registration. Please refresh the page.'
            : `Your ${who} registration (${user?.email}) is still being reviewed. Your teams and players will appear here once the league approves it.`}
        </p>
        <Link
          href={kind === 'COACH' ? '/register/coach' : '/register/staff'}
          className="block rounded-s bg-primary text-primary-foreground font-bold uppercase tracking-wide py-3 text-sm no-underline"
        >
          View my registration
        </Link>
        <button
          onClick={() => void logout().then(() => window.location.assign('/admin'))}
          className="mt-3 text-sm font-semibold text-primary-strong"
        >
          Sign out
        </button>
      </Card>
    </div>
  );
}

/** Coaches and staff reach the team-scoped screens only, and only once approved; every other /admin page sends them to their teams. */
function PersonnelShell({ children, kind }: { children: React.ReactNode; kind: ApiStaffProfileType }) {
  const pathname = usePathname();
  const router = useRouter();
  const approval = useApproval(kind, pathname);
  // Staff have no team of their own: the roster is their only screen. Coaches also have My Teams.
  const home = kind === 'STAFF' ? '/admin/roster' : '/admin/my-teams';
  const screens = kind === 'STAFF' ? ['/admin/roster'] : ['/admin/my-teams', '/admin/roster'];
  const allowed = !!pathname && screens.some((p) => pathname === p || pathname.startsWith(p + '/'));
  useEffect(() => {
    if (!allowed) router.replace(home);
  }, [allowed, home, router]);
  // Nothing of the screen (or its data) is rendered until the API has said the person is approved.
  if (approval === 'checking' || !allowed) return <div className="min-h-screen bg-surface" />;
  if (approval !== 'approved') return <PendingReview kind={kind} error={approval === 'error'} />;
  return <AdminShell personnelOnly>{children}</AdminShell>;
}

/** Players and parents have no admin screens: an admin address sends them to their own dashboard. */
function SendAway({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return <div className="min-h-screen bg-surface" />;
}

/** An admin gets the admin screens, an approved coach or staff member their teams; everyone else is sent to their own area. */
function AdminRoleGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.roles.includes('ADMIN')) return <AdminShell>{children}</AdminShell>;
  if (user?.roles.includes('COACH')) return <PersonnelShell kind="COACH">{children}</PersonnelShell>;
  if (user?.roles.includes('STAFF')) return <PersonnelShell kind="STAFF">{children}</PersonnelShell>;
  return <SendAway to={user?.roles.some((r) => r === 'PLAYER' || r === 'PARENT') ? '/dashboard/player' : '/'} />;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <RequireAuth>
        <AdminRoleGate>{children}</AdminRoleGate>
      </RequireAuth>
    </Suspense>
  );
}
