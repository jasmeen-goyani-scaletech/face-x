import { describe, expect, it } from 'vitest';
import {
  InvalidWebhookSignatureError,
  PaymentProviderNotConfiguredError,
} from '../src/infrastructure/payments/payment-provider';
import { createStripePaymentProvider } from '../src/infrastructure/payments/stripe-provider';
import { safeCause, scrubSecrets } from '../src/shared/utils/scrub';
import {
  FAKE_SECRET_KEY,
  WEBHOOK_SECRET,
  paymentIntentObject,
  sessionObject,
  signPayload,
  stripeEvent,
} from './helpers/fake-payments';

/** The real Stripe adapter, offline: signature verification and event normalization need no network. */
const provider = createStripePaymentProvider({
  secretKey: FAKE_SECRET_KEY,
  webhookSecret: WEBHOOK_SECRET,
});
const verify = (w: { payload: string; header: string }) =>
  provider.verifyWebhook(Buffer.from(w.payload), w.header);

describe('Stripe webhook verification', () => {
  it('accepts a correctly signed event and returns it normalized (no provider payload leaks through)', () => {
    const ev = stripeEvent(
      'checkout.session.completed',
      sessionObject({
        sessionId: 'cs_1',
        paymentId: 'p-1',
        registrationId: 'r-1',
        amountCents: 9500,
      }),
    );
    expect(verify(ev)).toEqual({
      id: ev.id,
      type: 'checkout.session.completed',
      kind: 'PAID',
      sessionId: 'cs_1',
      paymentIntentId: 'pi_test_cs_1',
      amountCents: 9500,
      currency: 'usd',
      paymentId: 'p-1',
      registrationId: 'r-1',
      failureCode: null,
    });
  });

  it('rejects: wrong secret, tampered body, expired timestamp, missing or malformed header', () => {
    const ev = stripeEvent('checkout.session.completed', sessionObject({ sessionId: 'cs_1' }));
    const attempts: [string, Buffer, string | undefined][] = [
      ['wrong secret', Buffer.from(ev.payload), signPayload(ev.payload, 'whsec_other')],
      ['tampered body', Buffer.from(ev.payload.replace('9500', '1')), ev.header],
      [
        'expired timestamp',
        Buffer.from(ev.payload),
        signPayload(ev.payload, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600),
      ],
      ['missing header', Buffer.from(ev.payload), undefined],
      ['malformed header', Buffer.from(ev.payload), 'v1=abc'],
      ['empty body', Buffer.alloc(0), ev.header],
    ];
    for (const [name, body, header] of attempts) {
      expect(() => provider.verifyWebhook(body, header), name).toThrow(
        InvalidWebhookSignatureError,
      );
    }
  });

  it('refuses to verify anything when no webhook secret is configured', () => {
    const unconfigured = createStripePaymentProvider({ secretKey: FAKE_SECRET_KEY });
    const ev = stripeEvent('checkout.session.completed', sessionObject({ sessionId: 'cs_1' }));
    expect(() => unconfigured.verifyWebhook(Buffer.from(ev.payload), ev.header)).toThrow(
      PaymentProviderNotConfiguredError,
    );
  });
});

describe('Stripe event normalization', () => {
  const kindOf = (type: string, object: Record<string, unknown>) =>
    verify(stripeEvent(type, object));

  it('maps each Stripe event we use to one provider-neutral kind', () => {
    const paid = sessionObject({ sessionId: 'cs_1', paymentStatus: 'paid' });
    const unpaid = sessionObject({ sessionId: 'cs_1', paymentStatus: 'unpaid' });
    expect(kindOf('checkout.session.completed', paid).kind).toBe('PAID');
    expect(kindOf('checkout.session.async_payment_succeeded', paid).kind).toBe('PAID');
    expect(kindOf('checkout.session.completed', unpaid).kind).toBe('AWAITING_FUNDS');
    expect(kindOf('checkout.session.async_payment_failed', unpaid)).toMatchObject({
      kind: 'FAILED',
      failureCode: 'async_payment_failed',
    });
    expect(kindOf('checkout.session.expired', unpaid)).toMatchObject({
      kind: 'EXPIRED',
      failureCode: 'CHECKOUT_EXPIRED',
    });
    expect(kindOf('customer.created', { id: 'cus_1' }).kind).toBe('IGNORED');
    expect(kindOf('charge.refunded', { id: 'ch_1' }).kind).toBe('IGNORED');
  });

  it('keeps only the failure code of a failed attempt, never the provider message', () => {
    const e = kindOf(
      'payment_intent.payment_failed',
      paymentIntentObject({ paymentId: 'p', registrationId: 'r', code: 'insufficient_funds' }),
    );
    expect(e).toMatchObject({
      kind: 'ATTEMPT_FAILED',
      failureCode: 'insufficient_funds',
      paymentId: 'p',
      registrationId: 'r',
    });
    expect(JSON.stringify(e)).not.toContain('4242');
    expect(JSON.stringify(e)).not.toContain('insufficient funds');
  });

  it('treats missing references as null rather than guessing', () => {
    const e = kindOf(
      'checkout.session.completed',
      sessionObject({ sessionId: 'cs_1', paymentId: null, registrationId: null }),
    );
    expect(e).toMatchObject({ paymentId: null, registrationId: null });
  });
});

describe('secret scrubbing for logged errors', () => {
  it('removes keys, webhook secrets, signed-URL signatures, checkout links and bearer tokens', () => {
    const dirty = [
      'key sk_test_ABC123def456',
      'live rk_live_XYZ789',
      'hook whsec_abcDEF123',
      'aws AKIAABCDEFGHIJKL',
      'url https://s3.example/b/k?X-Amz-Signature=deadbeef&X-Amz-Expires=300',
      'pay https://checkout.stripe.com/c/pay/cs_test_a1b2#fid',
      'hdr Bearer abc.def.ghi',
    ].join(' | ');
    const clean = scrubSecrets(dirty);
    for (const secret of [
      'sk_test_ABC123def456',
      'rk_live_XYZ789',
      'whsec_abcDEF123',
      'AKIAABCDEFGHIJKL',
      'deadbeef',
      'cs_test_a1b2',
      'abc.def.ghi',
    ]) {
      expect(clean).not.toContain(secret);
    }
    expect(clean).toContain('X-Amz-Expires=300'); // harmless parts survive for debugging
  });

  it('produces a safe copy of an error cause, keeping its name and non-sensitive diagnostics', () => {
    const original = Object.assign(new Error(`boom ${FAKE_SECRET_KEY}`), {
      name: 'StripeAPIError',
      code: 'rate_limit',
      statusCode: 429,
      requestId: 'req_1',
      apiKey: FAKE_SECRET_KEY,
    });
    const safe = safeCause(original) as Error & Record<string, unknown>;
    expect(safe.name).toBe('StripeAPIError');
    expect(safe.message).not.toContain('sk_test');
    expect(safe.stack).not.toContain('sk_test');
    expect(safe).toMatchObject({ code: 'rate_limit', statusCode: 429, requestId: 'req_1' });
    expect(safe.apiKey).toBeUndefined(); // arbitrary properties are not copied
    expect(safeCause('plain string sk_test_QQQ').message).not.toContain('sk_test_QQQ');
  });
});
