'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { AlertTriangleIcon } from '@/components/ui/Icons';
import { PLAYER_REGISTRATION_KEY, parseOutcome, saveRegistrationNow } from '@/lib/payment';
import type { PlayerRegistration } from '@/lib/types';

type Problem = 'no_registration' | 'mismatch' | 'unknown_result';

const PROBLEMS: Record<Problem, { title: string; message: string }> = {
  no_registration: {
    title: 'We couldn’t find your registration',
    message: 'Your registration isn’t saved in this browser. Open the registration on the device you started it on, or start again.'
  },
  mismatch: {
    title: 'This payment doesn’t match your registration',
    message: 'The payment reference doesn’t match the registration in progress. Please return to your registration and try again.'
  },
  unknown_result: {
    title: 'We couldn’t confirm your payment',
    message: 'The payment result wasn’t recognised. If you were charged, contact the league before paying again.'
  }
};

/** Landing page for the payment platform's redirect: records the outcome, then shows the right screen. */
function PaymentReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    const outcome = parseOutcome(params.get('status'));
    const reference = params.get('registrationId') ?? params.get('reference');

    let reg: PlayerRegistration | null = null;
    try {
      const raw = window.localStorage.getItem(PLAYER_REGISTRATION_KEY);
      reg = raw ? (JSON.parse(raw) as PlayerRegistration) : null;
    } catch {
      reg = null;
    }

    if (!reg || !reg.id) return setProblem('no_registration');
    if (!outcome) return setProblem('unknown_result');
    if (reference && reference !== reg.id) return setProblem('mismatch');

    if (reg.payment.status !== 'success') {
      if (outcome === 'pending') {
        // Registration is saved but payment hasn't been taken: show the confirmation with payment pending.
        reg = { ...reg, status: 'submitted', completedAt: reg.completedAt ?? Date.now(), step: 'complete' };
      } else if (outcome === 'success') {
        reg = {
          ...reg,
          status: 'submitted',
          completedAt: Date.now(),
          step: 'complete',
          payment: { ...reg.payment, status: 'success', failReason: '', paidAt: Date.now() }
        };
      } else {
        reg = {
          ...reg,
          step: 'payment',
          payment: {
            ...reg.payment,
            status: outcome === 'failed' ? 'failed' : 'interrupted',
            failReason: outcome === 'failed' ? 'Your payment was declined and you haven’t been charged.' : ''
          }
        };
      }
      saveRegistrationNow(reg);
    }
    router.replace('/register/player');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (problem) {
    const { title, message } = PROBLEMS[problem];
    return (
      <Card className="text-center">
        <AlertTriangleIcon size={34} className="mx-auto mb-3 text-danger" />
        <h1 className="text-xl mb-2">{title}</h1>
        <p className="text-ink-soft mb-5">{message}</p>
        <Link href="/register/player">
          <Button variant="primary" block>
            Back to Registration
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card className="text-center">
      <span className="mx-auto mb-4 block h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" />
      <h1 className="text-xl mb-1">Confirming your payment…</h1>
      <p className="text-ink-soft m-0">Please don&rsquo;t close this page.</p>
    </Card>
  );
}

export default function PaymentReturnPage() {
  return (
    <main>
      <Topbar role="player" eyebrow="Registration payment" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Suspense fallback={null}>
          <PaymentReturn />
        </Suspense>
      </div>
    </main>
  );
}
