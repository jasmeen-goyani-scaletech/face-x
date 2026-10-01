'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarIcon,
  LogoutIcon,
  ShieldIcon,
  TrophyIcon,
  UsersIcon
} from '@/components/ui/Icons';

const NAV = [
  { href: '/admin/tournaments', label: 'Tournaments', icon: TrophyIcon },
  { href: '/admin/teams', label: 'Teams', icon: UsersIcon },
  { href: '/admin/players', label: 'Players', icon: UsersIcon },
  { href: '/admin/coaches', label: 'Coaches', icon: UsersIcon },
  { href: '/admin/staff', label: 'Staff Members', icon: ShieldIcon },
  { href: '/admin/event-day', label: 'Event Day', icon: CalendarIcon }
];

const ADMIN_SESSION_KEY = 'facex-admin-authed';

export default function AdminSidebar() {
  const pathname = usePathname();

  // Admin is its own product surface: signing out returns to the admin passcode screen, never the public site.
  function signOut() {
    try {
      window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      // ignore
    }
    window.location.assign('/admin');
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden sm:flex sm:w-60 sm:shrink-0 sm:flex-col sm:border-r sm:border-line sm:bg-surface sm:py-5">
        <div className="px-5 mb-6 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary text-primary-foreground text-sm font-bold">FX</span>
          <span className="font-display font-bold text-base tracking-wide text-ink">Admin</span>
        </div>
        <nav className="flex-1 flex flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex items-center gap-2.5 rounded-s px-3 py-2.5 text-sm font-semibold no-underline',
                  active ? 'bg-primary-light text-primary-strong' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                ].join(' ')}
              >
                <Icon size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 mt-4">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-s px-3 py-2.5 text-sm font-semibold text-ink-soft hover:bg-surface-2 hover:text-ink"
          >
            <LogoutIcon size={17} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar + horizontal scroll nav */}
      <div className="sm:hidden sticky top-0 z-20 border-b border-line bg-surface">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-primary text-primary-foreground text-sm font-bold">FX</span>
            <span className="font-display font-bold text-sm tracking-wide text-ink">Admin</span>
          </div>
          <button onClick={signOut} className="flex items-center gap-1.5 text-ink-soft text-[12.5px] font-semibold">
            <LogoutIcon size={14} /> Sign out
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2.5 no-scrollbar">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold no-underline',
                  active ? 'bg-primary text-primary-foreground' : 'bg-surface-2 text-ink-soft'
                ].join(' ')}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
