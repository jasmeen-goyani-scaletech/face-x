'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import RegistrationHeader from '@/components/layout/RegistrationHeader';
import RequireAuth from '@/components/auth/RequireAuth';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { AlertTriangleIcon } from '@/components/ui/Icons';
import { describeError, hasCode } from '@/lib/api/errors';
import { evaluateReadiness, getPayment } from '@/lib/api/payments';
import { parseOutcome } from '@/lib/payment';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The webhook normally lands within a few seconds of the redirect. Beyond this we stop waiting and say so. */
const POLL_EVERY_MS = 2000;
const POLL_ATTEMPTS = 15;

type View =
  | { kind: 'confirming' }
  | { kind: 'still_pending' }
  | { kind: 'problem'; title: string; message: string };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Where Stripe sends the customer back. The `status` in the URL is only a hint (anyone can type it): the payment counts
 * as paid only when the API says so, because only Stripe's signed webhook can mark it paid. So after a "success"
 * redirect this page asks the API, for up to ~30 seconds, until the webhook has landed.
 */
function PaymentReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const registrationId = params.get('registrationId') ?? params.get('reference') ?? '';
  const outcome = parseOutcome(params.get('status'));
  const [view, setView] = useState<View>({ kind: 'confirming' });
  // Counts confirmation runs so a superseded or abandoned poll stops quietly.
  const generation = useRef({ n: 0 });

  const confirm = useCallback(async () => {
    const gen = generation.current;
    const mine = ++gen.n;
    const stale = () => mine !== gen.n;
    setView({ kind: 'confirming' });

    if (!UUID.test(registrationId)) {
      setView({ kind: 'problem', title: 'We couldn’t find your registration', message: 'This payment link is missing its registration reference. Please return to your registration.' });
      return;
    }
    const back = (query: string) => router.replace(`/register/player?registrationId=${registrationId}${query}`);

    // The customer backed out: nothing to confirm, send them back to try again.
    if (outcome === 'cancelled' || outcome === 'failed') return back(`&payment=${outcome}`);

    try {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        const payment = await getPayment(registrationId);
        if (stale()) return;
        if (payment.paymentStatus === 'PAID') {
          // Let the server move the registration along (best effort: the webhook normally already did).
          await evaluateReadiness(registrationId).catch(() => undefined);
          if (!stale()) back('');
          return;
        }
        if (payment.paymentStatus === 'FAILED' || payment.paymentStatus === 'CANCELLED') {
          return back(`&payment=${payment.paymentStatus === 'FAILED' ? 'failed' : 'cancelled'}`);
        }
        await wait(POLL_EVERY_MS);
        if (stale()) return;
      }
      setView({ kind: 'still_pending' });
    } catch (e) {
      if (stale()) return;
      if (hasCode(e, 'REGISTRATION_NOT_FOUND')) {
        setView({ kind: 'problem', title: 'We couldn’t find your registration', message: 'That registration isn’t on this account. Sign in with the account you registered with, or start again.' });
      } else {
        setView({ kind: 'problem', title: 'We couldn’t confirm your payment', message: `${describeError(e)} If you were charged, contact the league before paying again.` });
      }
    }
  }, [registrationId, outcome, router]);

  useEffect(() => {
    const gen = generation.current;
    void confirm();
    return () => {
      gen.n++; // abandon an in-flight poll when leaving the page
    };
  }, [confirm]);

  if (view.kind === 'problem') {
    return (
      <Card className="text-center">
        <AlertTriangleIcon size={34} className="mx-auto mb-3 text-danger" />
        <h1 className="text-xl mb-2">{view.title}</h1>
        <p className="text-ink-soft mb-5">{view.message}</p>
        <Link href="/register/player">
          <Button variant="primary" block>
            Back to Registration
          </Button>
        </Link>
      </Card>
    );
  }

  if (view.kind === 'still_pending') {
    return (
      <Card className="text-center">
        <AlertTriangleIcon size={34} className="mx-auto mb-3 text-warning" />
        <h1 className="text-xl mb-2">We’re still confirming your payment</h1>
        <p className="text-ink-soft mb-5">
          The payment provider hasn’t confirmed it yet. This can take a minute. Your registration is saved and you won’t be charged twice — check again shortly, or come back to your status page later.
        </p>
        <Button variant="primary" block onClick={() => void confirm()}>
          Check again
        </Button>
        <Link href="/dashboard/player" className="mt-3 block text-sm font-bold text-primary-strong">
          Go to my status page
        </Link>
      </Card>
    );
  }

  return (
    <Card className="text-center">
      <span className="mx-auto mb-4 block h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
      <h1 className="text-xl mb-1">Confirming your payment…</h1>
      <p role="status" className="text-ink-soft m-0">
        Please don&rsquo;t close this page.
      </p>
    </Card>
  );
}

export default function PaymentReturnPage() {
  return (
    <main>
      <RegistrationHeader role="PLAYER" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Suspense fallback={null}>
          <RequireAuth>
            <PaymentReturn />
          </RequireAuth>
        </Suspense>
      </div>
    </main>
  );
}
