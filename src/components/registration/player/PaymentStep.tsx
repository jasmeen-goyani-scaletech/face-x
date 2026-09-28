'use client';

import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DummyStripeCheckout from '@/components/payment/DummyStripeCheckout';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import type { PlayerRegistration } from '@/lib/types';

export default function PaymentStep({
  reg,
  onChange,
  onBack,
  onComplete
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onBack: () => void;
  onComplete: () => void;
}) {
  const router = useRouter();

  return (
    <Card>
      <h2 className="text-xl mb-1">Registration Payment</h2>
      <p className="text-ink-soft mb-5">Sandbox checkout — no real card is charged.</p>

      <div className="flex justify-between text-base font-semibold mb-4 pb-4 border-b border-line">
        <span className="text-ink-soft font-normal">Registration Fee</span>
        <span>${reg.payment.amount.toFixed(2)}</span>
      </div>

      <DummyStripeCheckout payment={reg.payment} onChange={(p) => onChange({ ...reg, payment: p })} />

      <div className="flex justify-between mt-6">
        <Button variant="secondary" onClick={onBack}>
          <ChevronLeftIcon size={16} /> Back
        </Button>
        {reg.payment.status === 'success' && (
          <Button variant="primary" onClick={onComplete}>
            Continue <ChevronRightIcon size={16} />
          </Button>
        )}
        {(reg.payment.status === 'failed' || reg.payment.status === 'interrupted') && (
          <Button
            variant="secondary"
            onClick={() => {
              onChange({ ...reg, status: 'draft' });
              router.push('/register');
            }}
          >
            Save as Draft
          </Button>
        )}
      </div>
    </Card>
  );
}
