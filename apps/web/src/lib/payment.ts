export type PaymentOutcome = 'success' | 'failed' | 'cancelled' | 'pending';

/** Reads the `?status=` the payment provider's return URL carries into one of the four outcomes (null when it isn't one). */
export function parseOutcome(value: string | null): PaymentOutcome | null {
  const v = value?.toLowerCase();
  if (v === 'success' || v === 'succeeded' || v === 'paid') return 'success';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  if (v === 'pending') return 'pending';
  if (v === 'failed' || v === 'failure' || v === 'declined') return 'failed';
  return null;
}
