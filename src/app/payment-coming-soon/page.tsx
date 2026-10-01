'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Topbar from '@/components/layout/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { CreditCardIcon } from '@/components/ui/Icons';
import { PAYMENT_RETURN_PATH } from '@/lib/payment';

function ComingSoon() {
  const registrationId = useSearchParams().get('registrationId') ?? '';
  const back = `${PAYMENT_RETURN_PATH}?status=pending${registrationId ? `&registrationId=${encodeURIComponent(registrationId)}` : ''}`;
  return (
    <Card className="text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-primary-strong">
        <CreditCardIcon size={28} />
      </div>
      <h1 className="text-2xl mb-2">Online Payments Coming Soon</h1>
      <p className="text-ink-soft mb-6">
        Online payment integration will be introduced soon. Your registration details have been saved, and we will notify you once payment
        processing opens.
      </p>
      <Link href={back}>
        <Button variant="primary" block>
          Return to Registration
        </Button>
      </Link>
    </Card>
  );
}

export default function PaymentComingSoonPage() {
  return (
    <main>
      <Topbar eyebrow="Registration payment" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Suspense fallback={null}>
          <ComingSoon />
        </Suspense>
      </div>
    </main>
  );
}
