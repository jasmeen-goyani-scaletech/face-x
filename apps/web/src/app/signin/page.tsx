'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import { redeemSignInLink } from '@/lib/api/auth';
import { describeError } from '@/lib/api/errors';

/**
 * Landing page for the one-time sign-in link an admin sends to a coach or staff member (`/signin#token=…`). It spends the
 * link, signs the person in and takes them to their registration. The token is read from the URL fragment and removed from
 * the address bar straight away.
 */
export default function SignInLinkPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Read once and kept: the fragment is removed from the address bar, and React (strict mode, in development) runs the effect twice.
  const tokenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (tokenRef.current === undefined) {
      tokenRef.current = new URLSearchParams(window.location.hash.slice(1)).get('token');
      window.history.replaceState(null, '', window.location.pathname);
    }
    const token = tokenRef.current;
    if (!token) {
      setError('This sign-in link is incomplete. Ask the organizer for a new one.');
      return;
    }
    let cancelled = false;
    redeemSignInLink(token)
      .then((user) => {
        if (cancelled) return;
        router.replace(user.roles.includes('ADMIN') ? '/admin' : '/admin/my-teams');
      })
      .catch((e) => {
        if (!cancelled) setError(describeError(e, 'We couldn’t sign you in with this link.'));
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main>
      <Topbar eyebrow="Sign in" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Card className="text-center">
          {error ? (
            <>
              <Alert level="danger" title="Couldn’t sign you in">
                {error}
              </Alert>
              <p className="mt-4 mb-0 text-sm text-ink-soft">
                A link works once and expires after 24 hours. Ask the organizer for a new one, or{' '}
                <Link href="/login" className="font-bold text-primary-strong">
                  sign in with a password
                </Link>
                .
              </p>
            </>
          ) : (
            <>
              <span className="mx-auto mb-4 block h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
              <p role="status" className="m-0 text-ink-soft">
                Signing you in…
              </p>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
