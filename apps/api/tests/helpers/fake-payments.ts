import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import request from 'supertest';
import type {
  CheckoutRequest,
  PaymentProvider,
} from '../../src/infrastructure/payments/payment-provider';
import { createStripePaymentProvider } from '../../src/infrastructure/payments/stripe-provider';

export const WEBHOOK_SECRET = 'whsec_test_0123456789abcdef';
export const FAKE_SECRET_KEY = 'sk_test_FAKEFAKEFAKEFAKE';

/**
 * Stripe at the provider boundary: checkout creation/expiry are in-memory fakes (no network), but webhook
 * verification and event normalization are the REAL Stripe adapter, so signature handling is genuinely tested
 * with events signed offline by the Stripe SDK.
 */
export function createFakePayments() {
  const real = createStripePaymentProvider({
    secretKey: FAKE_SECRET_KEY,
    webhookSecret: WEBHOOK_SECRET,
  });
  const sessions = new Map<
    string,
    { status: 'open' | 'complete' | 'expired'; request: CheckoutRequest }
  >();
  const created: CheckoutRequest[] = [];
  const expired: string[] = [];
  const failures = { create: false, expire: false };
  let counter = 0;

  const provider: PaymentProvider = {
    async createCheckoutSession(req) {
      if (failures.create) throw new Error(`stripe exploded (${FAKE_SECRET_KEY})`);
      const sessionId = `cs_test_${++counter}_${randomUUID().slice(0, 8)}`;
      sessions.set(sessionId, { status: 'open', request: req });
      created.push(req);
      return {
        sessionId,
        url: `https://checkout.test/pay/${sessionId}`,
        expiresAt: new Date(Date.now() + req.expiresInSeconds * 1000),
      };
    },
    async expireCheckoutSession(sessionId) {
      if (failures.expire) throw new Error('stripe exploded');
      const s = sessions.get(sessionId);
      if (s?.status === 'complete') return 'COMPLETE';
      if (s) s.status = 'expired';
      expired.push(sessionId);
      return 'EXPIRED';
    },
    verifyWebhook: (raw, header) => real.verifyWebhook(raw, header),
  };

  return {
    provider,
    created,
    expired,
    failures,
    sessions,
    /** Marks a session as paid at the provider (so a later expire reports COMPLETE). */
    complete: (sessionId: string) => {
      const s = sessions.get(sessionId);
      if (s) s.status = 'complete';
    },
  };
}
export type FakePayments = ReturnType<typeof createFakePayments>;

const signer = new Stripe(FAKE_SECRET_KEY);

export interface SignedWebhook {
  id: string;
  payload: string;
  header: string;
}

export function signPayload(payload: string, secret = WEBHOOK_SECRET, timestamp?: number): string {
  return signer.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}

/** A signed Stripe event envelope around `object`. */
export function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  id = `evt_${randomUUID()}`,
): SignedWebhook {
  const payload = JSON.stringify({
    id,
    object: 'event',
    api_version: '2025-01-01',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
  });
  return { id, payload, header: signPayload(payload) };
}

export interface SessionFields {
  sessionId: string;
  paymentId?: string | null;
  registrationId?: string | null;
  paymentStatus?: 'paid' | 'unpaid';
  amountCents?: number;
  currency?: string;
  paymentIntent?: string;
}

export const sessionObject = (f: SessionFields) => ({
  id: f.sessionId,
  object: 'checkout.session',
  payment_status: f.paymentStatus ?? 'paid',
  amount_total: f.amountCents ?? 9500,
  currency: f.currency ?? 'usd',
  payment_intent: f.paymentIntent ?? `pi_test_${f.sessionId.slice(-8)}`,
  metadata: {
    ...(f.paymentId === null ? {} : { paymentId: f.paymentId }),
    ...(f.registrationId === null ? {} : { registrationId: f.registrationId }),
  },
});

export const paymentIntentObject = (o: {
  paymentId: string;
  registrationId: string;
  code?: string;
  amountCents?: number;
}) => ({
  id: `pi_test_${o.paymentId.slice(0, 8)}`,
  object: 'payment_intent',
  amount: o.amountCents ?? 9500,
  currency: 'usd',
  metadata: { paymentId: o.paymentId, registrationId: o.registrationId },
  last_payment_error: {
    code: 'card_declined',
    decline_code: o.code ?? 'insufficient_funds',
    message: 'Your card has insufficient funds. 4242424242424242',
  },
});

/** Delivers a webhook exactly as Stripe would: raw JSON body plus the Stripe-Signature header. */
export const deliver = (
  app: Parameters<typeof request>[0],
  w: Pick<SignedWebhook, 'payload' | 'header'>,
) =>
  request(app)
    .post('/api/v1/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', w.header)
    .send(w.payload);
