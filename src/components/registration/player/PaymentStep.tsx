'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { buildPaymentUrl, newRegistrationReference, saveRegistrationNow } from '@/lib/payment';
import type { PlayerRegistration } from '@/lib/types';

export default function PaymentStep({
  reg,
  onChange,
  onBack
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onBack: () => void;
}) {
  const [saveFailed, setSaveFailed] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const { status, failReason } = reg.payment;

  function continueToPayment() {
    const registrationId = reg.id || newRegistrationReference();
    // Keep everything the user entered: persist synchronously before leaving the page.
    const next: PlayerRegistration = {
      ...reg,
      id: registrationId,
      status: reg.status === 'not_started' ? 'draft' : reg.status,
      step: 'payment',
      payment: { ...reg.payment, status: 'not_started', failReason: '' }
    };
    if (!saveRegistrationNow(next)) {
      // Leaving now would lose their answers, so stay put.
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    setRedirecting(true);
    onChange(next);
    window.location.assign(buildPaymentUrl(next, registrationId, window.location.origin));
  }

  return (
    <Card>
      <h2 className="text-xl mb-1">Registration Payment</h2>
      <p className="text-ink-soft mb-5">Continue to pay the registration fee for this player.</p>

      <div className="flex justify-between text-base font-semibold mb-4 pb-4 border-b border-line">
        <span className="text-ink-soft font-normal">Registration Fee</span>
        <span>${reg.payment.amount.toFixed(2)}</span>
      </div>

      {status === 'failed' && (
        <Alert level="danger" title="Payment unsuccessful">
          {failReason || 'Your payment didn’t go through and you haven’t been charged.'} You can try again.
        </Alert>
      )}
      {status === 'interrupted' && (
        <Alert level="warning" title="Payment cancelled">
          You left the payment page before finishing, so nothing was charged. Continue when you&rsquo;re ready.
        </Alert>
      )}
      {saveFailed && (
        <Alert level="danger" title="Registration not saved">
          We couldn&rsquo;t save your registration in this browser, so we haven&rsquo;t left this page. Check your browser&rsquo;s storage settings and try again.
        </Alert>
      )}

      <Button variant="primary" block className="mt-4" loading={redirecting} onClick={continueToPayment}>
        {status === 'failed' || status === 'interrupted' ? 'Try Payment Again' : 'Continue to Payment'}
        <ChevronRightIcon size={16} />
      </Button>

      <div className="flex justify-between mt-6">
        <Button variant="secondary" onClick={onBack} disabled={redirecting}>
          <ChevronLeftIcon size={16} /> Back
        </Button>
      </div>
    </Card>
  );
}
