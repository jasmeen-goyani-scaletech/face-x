'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import { useAuth } from './AuthProvider';

/** Only same-site paths are allowed as a post-login destination (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = '/register'): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : fallback;
}

/**
 * Renders its children only for a signed-in user. Everything inside therefore mounts (and starts its API calls) only
 * after a session exists, so no protected request is ever made while signed out. Signed-out visitors go to /login and
 * come back to the page they asked for.
 *
 * `allowGuest` is for public registration and invite links: once the session lookup has settled, the children render for
 * a signed-out visitor too (no redirect, no account screen). They must use only public endpoints until the form has
 * collected a contact email and called `ensureSession`.
 */
export default function RequireAuth({ children, allowGuest }: { children: ReactNode; allowGuest?: boolean }) {
  const { status, restore } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const next = encodeURIComponent(qs ? `${pathname}?${qs}` : pathname);

  useEffect(() => {
    if (status === 'idle') void restore();
  }, [status, restore]);

  useEffect(() => {
    if (status !== 'signedOut' || allowGuest) return;
    router.replace(`/login?next=${next}`);
  }, [status, router, next, allowGuest]);

  if (status !== 'signedIn' && !(allowGuest && status === 'signedOut')) {
    return (
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Card className="text-center">
          <span className="mx-auto mb-4 block h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
          <p role="status" className="m-0 text-ink-soft">
            Checking your sign-in…
          </p>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
