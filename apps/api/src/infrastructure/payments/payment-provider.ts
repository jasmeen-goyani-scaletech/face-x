/**
 * Provider-independent boundary for taking payments. The rest of the application depends on this interface
 * only; everything Stripe-specific lives in stripe-provider.ts. Nothing here carries card data: the customer
 * pays on the provider's hosted page.
 */
export interface CheckoutRequest {
  /** Our payments.id. Also used as the provider idempotency key, so a retried call cannot create two sessions. */
  paymentId: string;
  registrationId: string;
  /** Shown to the customer on the hosted page. Must not contain personal data. */
  description: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  expiresInSeconds: number;
}

export interface CheckoutSession {
  /** The provider's reference for the session (stored in payments.stripe_checkout_session_id). */
  sessionId: string;
  /** Where to send the customer. A bearer link: never logged or stored. */
  url: string;
  expiresAt: Date;
}

/** Result of asking the provider to close a checkout session so it can no longer be paid. */
export type ExpireResult = 'EXPIRED' | 'COMPLETE';

/**
 * A verified webhook event, normalized so the payment logic never sees provider payloads.
 *  PAID            the customer's money was captured
 *  AWAITING_FUNDS  checkout finished but funds are not confirmed yet (async methods): wait for a later event
 *  FAILED          an asynchronous payment failed for good
 *  EXPIRED         the hosted checkout expired unpaid
 *  ATTEMPT_FAILED  one card attempt failed; the customer may still retry on the same page
 *  IGNORED         an event type we do not act on
 */
export type ProviderEventKind =
  'PAID' | 'AWAITING_FUNDS' | 'FAILED' | 'EXPIRED' | 'ATTEMPT_FAILED' | 'IGNORED';

export interface ProviderEvent {
  id: string;
  type: string;
  kind: ProviderEventKind;
  sessionId: string | null;
  paymentIntentId: string | null;
  amountCents: number | null;
  currency: string | null;
  /** Our references, copied back by the provider from the metadata we attached. */
  paymentId: string | null;
  registrationId: string | null;
  /** Short machine code only (e.g. card_declined). Never a provider message or payload. */
  failureCode: string | null;
}

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super('Webhook signature verification failed');
    this.name = 'InvalidWebhookSignatureError';
  }
}

export class PaymentProviderNotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured`);
    this.name = 'PaymentProviderNotConfiguredError';
  }
}

export interface PaymentProvider {
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Closes an open session so it can no longer be paid. `COMPLETE` means it was already paid or is being paid. */
  expireCheckoutSession(sessionId: string): Promise<ExpireResult>;
  /**
   * Verifies the signature over the EXACT raw request body and returns the normalized event. Throws
   * InvalidWebhookSignatureError for a missing/invalid signature or tampered body, and nothing is parsed first.
   */
  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): ProviderEvent;
}
