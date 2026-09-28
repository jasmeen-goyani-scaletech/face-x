'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { CreditCardIcon, RefreshIcon, ShieldIcon } from '@/components/ui/Icons';
import type { PaymentInfo } from '@/lib/types';

type Outcome = 'success' | 'failed' | 'interrupted';

export default function DummyStripeCheckout({
  payment,
  onChange
}: {
  payment: PaymentInfo;
  onChange: (next: PaymentInfo) => void;
}) {
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvc: '' });

  function useTestCard() {
    setCard({ name: 'J. Athlete', number: '4242 4242 4242 4242', expiry: '12 / 29', cvc: '123' });
  }

  function resolve(outcome: Outcome) {
    if (outcome === 'success') {
      onChange({ ...payment, status: 'success', cardLast4: '4242', paidAt: Date.now(), failReason: '' });
    } else if (outcome === 'failed') {
      onChange({ ...payment, status: 'failed', failReason: 'Your card was declined (sandbox: insufficient funds).' });
    } else {
      onChange({ ...payment, status: 'interrupted', failReason: '' });
    }
  }

  function pay() {
    onChange({ ...payment, status: 'processing' });
    setTimeout(() => resolve('success'), 1100);
  }

  if (payment.status === 'processing') {
    return (
      <div className="flex items-center gap-3 rounded-m bg-info-soft text-info px-4 py-3.5 text-sm">
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
        <div>
          <div className="font-bold">Processing payment…</div>
          <p className="m-0 opacity-90">This usually takes a few seconds.</p>
        </div>
      </div>
    );
  }

  if (payment.status === 'success') {
    return (
      <Alert level="success" title="Payment received">
        ${payment.amount.toFixed(2)} paid with card ending in {payment.cardLast4}.
      </Alert>
    );
  }

  if (payment.status === 'failed' || payment.status === 'interrupted') {
    return (
      <div>
        <Alert level={payment.status === 'failed' ? 'danger' : 'warning'} title={payment.status === 'failed' ? 'Payment declined' : 'Payment interrupted'}>
          {payment.status === 'failed'
            ? payment.failReason || 'Your card was not charged.'
            : "The payment didn't finish. Nothing was charged."}{' '}
          Try again, or save your registration and finish later.
        </Alert>
        <Button variant="primary" onClick={() => onChange({ ...payment, status: 'not_started', failReason: '' })}>
          <RefreshIcon size={16} /> Try Again
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-m border border-line-strong p-4 mb-1">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint flex items-center gap-1.5">
            <ShieldIcon size={13} /> Sandbox card element
          </span>
          <button type="button" onClick={useTestCard} className="text-[12px] font-bold text-accent-strong">
            Use test card
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            aria-label="Cardholder name"
            className="col-span-2 rounded-s border border-line-strong px-3 py-2.5 text-sm"
            placeholder="Name on card"
            value={card.name}
            onChange={(e) => setCard({ ...card, name: e.target.value })}
          />
          <input
            aria-label="Card number"
            className="col-span-2 rounded-s border border-line-strong px-3 py-2.5 text-sm font-mono"
            placeholder="4242 4242 4242 4242"
            value={card.number}
            onChange={(e) => setCard({ ...card, number: e.target.value })}
          />
          <input
            aria-label="Expiry"
            className="rounded-s border border-line-strong px-3 py-2.5 text-sm font-mono"
            placeholder="MM / YY"
            value={card.expiry}
            onChange={(e) => setCard({ ...card, expiry: e.target.value })}
          />
          <input
            aria-label="CVC"
            className="rounded-s border border-line-strong px-3 py-2.5 text-sm font-mono"
            placeholder="CVC"
            value={card.cvc}
            onChange={(e) => setCard({ ...card, cvc: e.target.value })}
          />
        </div>
        <p className="text-[11.5px] text-ink-faint m-0">Simulated checkout element — no real card is charged.</p>
      </div>

      <Button variant="primary" block className="mt-4" onClick={pay}>
        <CreditCardIcon size={16} /> Pay ${payment.amount.toFixed(2)}
      </Button>

      <div className="mt-4 rounded-m border border-dashed border-gold bg-gold-soft p-3.5">
        <div className="text-[11px] font-display font-bold uppercase tracking-wide text-gold mb-2">
          Demo controls (not part of the real product)
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => resolve('success')} className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold">
            Force Success
          </button>
          <button type="button" onClick={() => resolve('failed')} className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold">
            Force Failed
          </button>
          <button type="button" onClick={() => resolve('interrupted')} className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold">
            Force Interrupted
          </button>
        </div>
      </div>
    </div>
  );
}
