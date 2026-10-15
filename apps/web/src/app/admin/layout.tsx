'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AdminCollapsibleSidenav from '@/components/admin/AdminCollapsibleSidenav';
import OfflineRosterSyncEngine from '@/components/admin/OfflineRosterSyncEngine';
import { useAuth } from '@/components/auth/AuthProvider';
import RequireAuth from '@/components/auth/RequireAuth';
import Card from '@/components/ui/Card';
import { useAdminSidenav } from '@/lib/useAdminSidenav';
import { ToastProvider } from '@/components/ui/Toast';

/** The admin chrome: side navigation and the content column that follows it. */
function AdminShell({ children, personnelOnly = false }: { children: React.ReactNode; personnelOnly?: boolean }) {
  const { collapsed, toggle: toggleSidenav } = useAdminSidenav();
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

/** Coaches and staff reach the team-scoped screens only; every other /admin page sends them to their teams. */
function PersonnelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = !!pathname && (pathname === '/admin/my-teams' || pathname.startsWith('/admin/my-teams/'));
  useEffect(() => {
    if (!allowed) router.replace('/admin/my-teams');
  }, [allowed, router]);
  if (!allowed) return <div className="min-h-screen bg-surface" />;
  return <AdminShell personnelOnly>{children}</AdminShell>;
}

/** A signed-in account that isn't an admin gets a clear answer instead of a screen full of access errors. */
function AdminRoleGate({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  if (user?.roles.includes('ADMIN')) return <AdminShell>{children}</AdminShell>;
  if (user?.roles.some((r) => r === 'COACH' || r === 'STAFF')) return <PersonnelShell>{children}</PersonnelShell>;
  return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center px-5">
      <Card className="w-full max-w-[420px] text-center">
        <h1 className="font-display text-lg uppercase tracking-wide mb-1 text-ink">Staff Access Only</h1>
        <p className="text-ink-soft text-sm mb-5">
          {user?.email} isn&rsquo;t an admin account. Sign in with an account the league has made an admin.
        </p>
        <button
          onClick={() => void logout().then(() => window.location.assign('/admin'))}
          className="w-full rounded-s bg-primary text-primary-foreground font-bold uppercase tracking-wide py-3 text-sm"
        >
          Sign out
        </button>
        <Link href="/" className="mt-3 block text-sm font-semibold text-primary-strong">
          Back to the site
        </Link>
      </Card>
    </div>
  );
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
