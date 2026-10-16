/** The existing payments.status vocabulary (kept as the project convention). */
export type PaymentStatus = 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

/**
 * What the API returns about one payment attempt. Deliberately omits every provider reference (checkout session
 * id, payment-intent id): the frontend does not need them and they are not ours to hand out.
 */
export interface PaymentDto {
  id: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  /** Short machine code (e.g. CHECKOUT_EXPIRED, SUPERSEDED, card_declined); never provider text. */
  failureReason: string | null;
  checkoutExpiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The payment state of a registration. Separate from the registration status, documents, consent and check-in:
 * it is derived from the payment records, which only the provider's verified webhook can mark PAID.
 */
export interface PaymentSummaryDto {
  registrationId: string;
  /** The amount due, fixed when the registration was submitted. Never taken from the client. */
  amountDue: { amountCents: number; currency: string };
  paymentStatus: 'NOT_STARTED' | PaymentStatus;
  /** A new checkout can be started now (payable status, amount > 0, not already paid). */
  canStartCheckout: boolean;
  payments: PaymentDto[];
}

export interface CheckoutDto {
  paymentId: string;
  /** Redirect the browser here. A bearer link to the provider's hosted page; it is never stored or logged. */
  checkoutUrl: string;
  /** Null for a Payment Link, which does not expire on its own. */
  expiresAt: string | null;
}

export interface WebhookResult {
  received: true;
  /** Why nothing changed, when nothing did. Never provider data. */
  note?: 'DUPLICATE' | 'IGNORED';
}
