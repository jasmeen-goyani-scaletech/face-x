'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, LogoutIcon, ShieldIcon, TrophyIcon, UsersIcon, XIcon } from '@/components/ui/Icons';

const NAV = [
  { href: '/admin/tournaments', label: 'Tournaments', icon: TrophyIcon },
  { href: '/admin/teams', label: 'Teams', icon: UsersIcon },
  { href: '/admin/players', label: 'Players', icon: UsersIcon },
  { href: '/admin/coaches', label: 'Coaches', icon: UsersIcon },
  { href: '/admin/staff', label: 'Staff Members', icon: ShieldIcon },
  { href: '/admin/event-day', label: 'Event Day', icon: CalendarIcon }
];

const ADMIN_SESSION_KEY = 'facex-admin-authed';

function signOut() {
  // Admin is its own product surface: signing out returns to the admin passcode screen, never the public site.
  try {
    window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
  window.location.assign('/admin');
}

/** A label that, when the rail is collapsed, shows as a tooltip beside the icon on hover and keyboard focus. */
function Tip({ show, children }: { show: boolean; children: string }) {
  if (!show) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-s bg-ink px-2.5 py-1.5 text-xs font-semibold text-surface opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

const itemBase =
  'group relative flex items-center rounded-s text-sm font-semibold no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Admin navigation.
 *  - md and up: fixed left rail, 16rem expanded / 5rem icon-only, with tooltips when collapsed. Pair it with a content
 *    wrapper using `md:ml-64` / `md:ml-20` so the page follows the rail.
 *  - below md (phones): a top bar with a menu button that opens a slide-over drawer.
 * `collapsed` and `onToggle` come from `useAdminSidenav`, which persists the choice.
 */
export default function AdminCollapsibleSidenav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const isActive = (href: string) => pathname === href || !!pathname?.startsWith(href + '/');

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <>
      {/* md+: fixed collapsible rail */}
      <aside
        aria-label="Admin navigation"
        className={[
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface py-4 md:flex',
          'transition-[width] duration-300 ease-out motion-reduce:transition-none',
          collapsed ? 'w-20' : 'w-64'
        ].join(' ')}
      >
        <div className={['mb-6 flex items-center gap-2', collapsed ? 'justify-center px-2' : 'px-5'].join(' ')}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-sm font-bold text-primary-foreground">FX</span>
          {!collapsed && <span className="truncate font-display text-base font-bold tracking-wide text-ink">Admin</span>}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={[
                  itemBase,
                  collapsed ? 'justify-center px-0 py-3' : 'gap-2.5 px-3 py-2.5',
                  active ? 'bg-primary-light text-primary-strong' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                ].join(' ')}
              >
                <Icon size={19} className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
                <Tip show={collapsed}>{item.label}</Tip>
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 flex flex-col gap-0.5 px-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={[itemBase, 'text-ink-soft hover:bg-surface-2 hover:text-ink', collapsed ? 'justify-center py-3' : 'gap-2.5 px-3 py-2.5'].join(' ')}
          >
            {collapsed ? <ChevronRightIcon size={19} /> : <ChevronLeftIcon size={19} />}
            {!collapsed && <span>Collapse</span>}
            <Tip show={collapsed}>Expand sidebar</Tip>
          </button>
          <button
            type="button"
            onClick={signOut}
            aria-label={collapsed ? 'Sign out' : undefined}
            className={[itemBase, 'text-ink-soft hover:bg-surface-2 hover:text-ink', collapsed ? 'justify-center py-3' : 'gap-2.5 px-3 py-2.5'].join(' ')}
          >
            <LogoutIcon size={19} className="shrink-0" />
            {!collapsed && <span>Sign out</span>}
            <Tip show={collapsed}>Sign out</Tip>
          </button>
        </div>
      </aside>

      {/* < md: top bar + slide-over drawer */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-3 py-2 md:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="admin-drawer"
            className="flex h-10 w-10 items-center justify-center rounded-s text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
          <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-primary text-sm font-bold text-primary-foreground">FX</span>
          <span className="font-display text-sm font-bold tracking-wide text-ink">Admin</span>
        </div>
        <button type="button" onClick={signOut} className="flex items-center gap-1.5 px-2 py-2 text-[12.5px] font-semibold text-ink-soft">
          <LogoutIcon size={14} /> Sign out
        </button>
      </div>

      <div className={['fixed inset-0 z-40 md:hidden', drawerOpen ? '' : 'pointer-events-none'].join(' ')}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close navigation menu"
          onClick={() => setDrawerOpen(false)}
          className={['absolute inset-0 bg-black/40 transition-opacity duration-300 motion-reduce:transition-none', drawerOpen ? 'opacity-100' : 'opacity-0'].join(' ')}
        />
        <aside
          id="admin-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Admin navigation"
          aria-hidden={!drawerOpen}
          className={[
            'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface py-4 shadow-xl',
            'transition-[transform,visibility] duration-300 ease-out motion-reduce:transition-none',
            drawerOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
          ].join(' ')}
        >
          <div className="mb-4 flex items-center justify-between px-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary text-sm font-bold text-primary-foreground">FX</span>
              <span className="font-display text-base font-bold tracking-wide text-ink">Admin</span>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation menu"
              className="flex h-10 w-10 items-center justify-center rounded-s text-ink-soft hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <XIcon size={18} />
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-3">
            {NAV.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    itemBase,
                    'min-h-[44px] gap-3 px-3 py-3',
                    active ? 'bg-primary-light text-primary-strong' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                  ].join(' ')}
                >
                  <Icon size={19} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="px-3">
            <button type="button" onClick={signOut} className={[itemBase, 'min-h-[44px] w-full gap-3 px-3 py-3 text-ink-soft hover:bg-surface-2 hover:text-ink'].join(' ')}>
              <LogoutIcon size={19} /> Sign out
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
