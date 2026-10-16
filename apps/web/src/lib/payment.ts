const PENDING_KEY = 'facex-payment-registration';

/**
 * A Stripe Payment Link can only send the player back to a fixed address, so the registration being paid for is remembered in
 * this tab before leaving and read again on the return page. It is only a pointer: the API still decides whether it was paid.
 */
export function rememberPaymentRegistration(registrationId: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, registrationId);
  } catch {
    // Storage blocked: the return URL can still carry the registration id.
  }
}

export function recallPaymentRegistration(): string {
  try {
    return window.sessionStorage.getItem(PENDING_KEY) ?? '';
  } catch {
    return '';
  }
}

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
