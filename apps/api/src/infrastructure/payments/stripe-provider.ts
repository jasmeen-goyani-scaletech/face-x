import Stripe from 'stripe';
import {
  InvalidWebhookSignatureError,
  PaymentProviderNotConfiguredError,
  type PaymentProvider,
  type ProviderEvent,
} from './payment-provider';

/**
 * The only file that talks to the Stripe SDK. Hosted Checkout: Stripe collects and handles the card, so no
 * card number, CVV or payment credential ever reaches this server (and none is logged or stored).
 */
export function createStripePaymentProvider(config: {
  secretKey: string;
  /** Needed to verify webhooks. Checkout works without it, webhooks then answer "not configured". */
  webhookSecret?: string;
}): PaymentProvider {
  const stripe = new Stripe(config.secretKey, {
    timeout: 10_000, // a slow Stripe must not hold a database transaction open for long
    maxNetworkRetries: 1,
    appInfo: { name: 'face-x-api' },
  });

  return {
    async createCheckoutSession(r) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: r.currency,
                unit_amount: r.amountCents,
                product_data: { name: r.description },
              },
            },
          ],
          success_url: r.successUrl,
          cancel_url: r.cancelUrl,
          client_reference_id: r.registrationId,
          // Our ids come back on every related event, so webhooks can be matched without trusting the browser.
          metadata: { paymentId: r.paymentId, registrationId: r.registrationId },
          payment_intent_data: {
            metadata: { paymentId: r.paymentId, registrationId: r.registrationId },
          },
          expires_at: Math.floor(Date.now() / 1000) + r.expiresInSeconds,
        },
        { idempotencyKey: `checkout-${r.paymentId}` },
      );
      if (!session.url) throw new Error('Stripe returned a checkout session without a URL');
      return {
        sessionId: session.id,
        url: session.url,
        expiresAt: new Date(session.expires_at * 1000),
      };
    },

    async expireCheckoutSession(sessionId) {
      try {
        await stripe.checkout.sessions.expire(sessionId);
        return 'EXPIRED';
      } catch (err) {
        // Only an open session can be expired; otherwise find out why it is not open.
        if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.status === 'complete') return 'COMPLETE';
        if (session.status === 'expired') return 'EXPIRED';
        throw err;
      }
    },

    verifyWebhook(rawBody, signatureHeader) {
      if (!config.webhookSecret)
        throw new PaymentProviderNotConfiguredError('Stripe webhook secret');
      if (!signatureHeader) throw new InvalidWebhookSignatureError();
      let event: Stripe.Event;
      try {
        // Verifies the HMAC over the raw bytes (and the timestamp tolerance) BEFORE the body is parsed.
        event = stripe.webhooks.constructEvent(rawBody, signatureHeader, config.webhookSecret);
      } catch {
        throw new InvalidWebhookSignatureError();
      }
      return normalize(event);
    },
  };
}

const nullIfEmpty = (v: string | null | undefined) => (v ? v : null);

function normalize(event: Stripe.Event): ProviderEvent {
  const base: ProviderEvent = {
    id: event.id,
    type: event.type,
    kind: 'IGNORED',
    sessionId: null,
    paymentIntentId: null,
    amountCents: null,
    currency: null,
    paymentId: null,
    registrationId: null,
    failureCode: null,
  };

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const s = event.data.object;
      const paymentIntent =
        typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      const kind =
        event.type === 'checkout.session.expired'
          ? 'EXPIRED'
          : event.type === 'checkout.session.async_payment_failed'
            ? 'FAILED'
            : s.payment_status === 'paid'
              ? 'PAID'
              : 'AWAITING_FUNDS';
      return {
        ...base,
        kind,
        sessionId: s.id,
        paymentIntentId: nullIfEmpty(paymentIntent),
        amountCents: s.amount_total ?? null,
        currency: nullIfEmpty(s.currency)?.toLowerCase() ?? null,
        // A Checkout Session carries our ids in metadata; a Payment Link session has none, so the payment id we put in the
        // link's client_reference_id is used instead.
        paymentId: nullIfEmpty(s.metadata?.paymentId) ?? nullIfEmpty(s.client_reference_id),
        registrationId: nullIfEmpty(s.metadata?.registrationId),
        failureCode:
          kind === 'FAILED'
            ? 'async_payment_failed'
            : kind === 'EXPIRED'
              ? 'CHECKOUT_EXPIRED'
              : null,
      };
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      return {
        ...base,
        kind: 'ATTEMPT_FAILED',
        paymentIntentId: pi.id,
        amountCents: pi.amount,
        currency: nullIfEmpty(pi.currency)?.toLowerCase() ?? null,
        paymentId: nullIfEmpty(pi.metadata?.paymentId),
        registrationId: nullIfEmpty(pi.metadata?.registrationId),
        // Only the short code: never the message, which can echo card details.
        failureCode:
          nullIfEmpty(pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code) ??
          'payment_failed',
      };
    }
    default:
      return base;
  }
}
