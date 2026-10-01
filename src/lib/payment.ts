import type { PlayerRegistration } from './types';

/**
 * Payments are handled entirely outside this app — nothing here collects or processes card details.
 * The Payment step redirects to `NEXT_PUBLIC_PAYMENT_URL` (for now a hosted "Payment Coming Soon"
 * page; later the real payment platform). If that isn't configured, the built-in
 * `/payment-coming-soon` page is used, so the step never dead-ends.
 *
 * Contract with the destination:
 *   outbound  GET <destination>?registrationId=<id>&amount=<number>&currency=USD&returnUrl=<url>
 *   inbound   GET <returnUrl>?status=success|failed|cancelled|pending&registrationId=<id>
 * No personal details are sent in either direction. `pending` means "registration saved, payment not
 * taken yet" and lands the user on the Complete step.
 */
export const PLAYER_REGISTRATION_KEY = 'facex-player-registration';
export const PAYMENT_RETURN_PATH = '/register/player/payment-return';
export const COMING_SOON_PATH = '/payment-coming-soon';

export type PaymentOutcome = 'success' | 'failed' | 'cancelled' | 'pending';

export function paymentPlatformUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_PAYMENT_URL?.trim();
  return url ? url : null;
}

/** Registration reference shared with the destination; also the number shown on the confirmation. */
export function newRegistrationReference(): string {
  return `FX-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Where to send the user to pay: the configured destination, else the built-in coming-soon page. */
export function buildPaymentUrl(reg: PlayerRegistration, registrationId: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(paymentPlatformUrl() ?? `${origin}${COMING_SOON_PATH}`);
  } catch {
    url = new URL(`${origin}${COMING_SOON_PATH}`);
  }
  url.searchParams.set('registrationId', registrationId);
  url.searchParams.set('amount', reg.payment.amount.toFixed(2));
  url.searchParams.set('currency', 'USD');
  url.searchParams.set('returnUrl', `${origin}${PAYMENT_RETURN_PATH}`);
  return url.toString();
}

/**
 * Writes the registration straight to localStorage. State setters persist lazily, so this is used
 * right before the page is left to guarantee the data is there when the user returns.
 */
export function saveRegistrationNow(reg: PlayerRegistration): boolean {
  try {
    window.localStorage.setItem(PLAYER_REGISTRATION_KEY, JSON.stringify(reg));
    return true;
  } catch {
    return false;
  }
}

export function parseOutcome(value: string | null): PaymentOutcome | null {
  const v = value?.toLowerCase();
  if (v === 'success' || v === 'succeeded' || v === 'paid') return 'success';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  if (v === 'pending') return 'pending';
  if (v === 'failed' || v === 'failure' || v === 'declined') return 'failed';
  return null;
}
