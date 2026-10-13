'use client';

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import type { ApiPaymentSummary, ApiRegistration } from '@/lib/api/types';
import SaveErrorAlert from './SaveErrorAlert';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Payment happens on Stripe's hosted page. The amount shown is the one the server fixed when the registration was
 * submitted; nothing about it is chosen here.
 */
export default function PaymentStep({
  registration,
  payment,
  onStart,
  onContinue,
  onBack,
  saving,
  saveError,
  apiFieldErrors
}: {
  registration: ApiRegistration;
  payment: ApiPaymentSummary | null;
  /** Start a checkout and leave for the payment page (or, for a free registration, finish). */
  onStart: () => void;
  /** Already paid: carry on to the confirmation. */
  onContinue: () => void;
  onBack: () => void;
  saving: boolean;
  saveError: string | null;
  apiFieldErrors: Record<string, string>;
}) {
  const amount = payment?.amountDue.amountCents ?? registration.fee.amountCents;
  const status = payment?.paymentStatus ?? 'NOT_STARTED';
  const paid = status === 'PAID';
  const free = amount === 0;

  return (
    <Card>
      <h2 className="text-xl mb-1">Registration Payment</h2>
      <p className="text-ink-soft mb-5">{free ? 'There is no fee for this registration.' : 'Continue to pay the registration fee for this player.'}</p>

      <div className="flex justify-between text-base font-semibold mb-4 pb-4 border-b border-line">
        <span className="text-ink-soft font-normal">Registration Fee</span>
        <span>{money(amount)}</span>
      </div>

      {paid && (
        <Alert level="success" title="Payment received">
          Your payment has been confirmed. Continue to see your registration status.
        </Alert>
      )}
      {status === 'FAILED' && (
        <Alert level="danger" title="Payment unsuccessful">
          Your payment didn’t go through and you haven’t been charged. You can try again.
        </Alert>
      )}
      {status === 'CANCELLED' && (
        <Alert level="warning" title="Payment cancelled">
          You left the payment page before finishing, so nothing was charged. Continue when you&rsquo;re ready.
        </Alert>
      )}
      {status === 'PAYMENT_PENDING' && payment?.canStartCheckout === false && (
        <Alert level="info" title="Payment in progress">
          A payment for this registration is already being processed. If you already paid, this page will update shortly.
        </Alert>
      )}
      <SaveErrorAlert title="We couldn’t start your payment" error={saveError} fieldErrors={apiFieldErrors} />

      {paid ? (
        <Button variant="primary" block className="mt-4" onClick={onContinue}>
          Continue
          <ChevronRightIcon size={16} />
        </Button>
      ) : (
        <Button variant="primary" block className="mt-4" loading={saving} disabled={payment?.canStartCheckout === false && !free} onClick={onStart}>
          {free ? 'Complete Registration' : status === 'FAILED' || status === 'CANCELLED' ? 'Try Payment Again' : 'Continue to Payment'}
          <ChevronRightIcon size={16} />
        </Button>
      )}

      <div className="flex justify-between mt-6">
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          <ChevronLeftIcon size={16} /> Back
        </Button>
      </div>
    </Card>
  );
}
