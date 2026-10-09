'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useLogoHref, type RegistrationRole } from '@/lib/activeRole';
import PushNotificationsButton from '@/components/notifications/PushNotificationsButton';
import RoleBadge from '@/components/ui/RoleBadge';

export default function Topbar({ eyebrow, role }: { eyebrow?: string; role?: RegistrationRole }) {
  // Once a registration is under way the logo returns to that role's page, not the landing/role-picker screens.
  const homeHref = useLogoHref();
  const { status, logout } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      // logout() always ends the session here, even if the server call failed.
    }
    router.push('/');
    setSigningOut(false);
  }
  return (
    <div
      className="sticky z-20 flex items-center border-b border-line bg-surface px-4 py-2.5 sm:px-5 sm:py-3"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <Link href={homeHref} className="flex min-w-0 items-center gap-2 font-display font-bold text-lg tracking-wide text-ink no-underline sm:text-xl">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-primary-foreground text-sm font-bold leading-none">
          FX
        </span>
        <span className="flex min-w-0 flex-col justify-center leading-tight">
          <span className="truncate">FACE-X</span>
          {eyebrow && (
            <small className="truncate font-body font-medium normal-case text-[11px] leading-tight text-ink-faint tracking-normal">
              {eyebrow}
            </small>
          )}
        </span>
      </Link>
      {role && <RoleBadge role={role} className="ml-auto shrink-0" />}
      {status === 'signedIn' && (
        <div className={[role ? 'ml-3' : 'ml-auto', 'flex shrink-0 items-center gap-1'].join(' ')}>
          <PushNotificationsButton />
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="shrink-0 rounded-s px-2 py-1 text-[12.5px] font-bold text-primary-strong hover:bg-primary-light disabled:opacity-55"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
