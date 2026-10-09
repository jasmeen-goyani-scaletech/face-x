'use client';

import { useEffect, type ReactNode } from 'react';
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
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status, restore } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (status === 'idle') void restore();
  }, [status, restore]);

  useEffect(() => {
    if (status !== 'signedOut') return;
    const qs = params.toString();
    router.replace(`/login?next=${encodeURIComponent(qs ? `${pathname}?${qs}` : pathname)}`);
  }, [status, router, pathname, params]);

  if (status !== 'signedIn') {
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
