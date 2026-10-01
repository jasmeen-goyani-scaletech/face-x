'use client';

import Link from 'next/link';
import { useLogoHref, type RegistrationRole } from '@/lib/activeRole';
import RoleBadge from '@/components/ui/RoleBadge';

export default function Topbar({ eyebrow, role }: { eyebrow?: string; role?: RegistrationRole }) {
  // Once a registration is under way the logo returns to that role's page, not the landing/role-picker screens.
  const homeHref = useLogoHref();
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
    </div>
  );
}
