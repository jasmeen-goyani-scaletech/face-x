import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../src/config/logger';
import type { Database } from '../src/infrastructure/database/database';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import {
  FAKE_SECRET_KEY,
  WEBHOOK_SECRET,
  createFakePayments,
  deliver,
  paymentIntentObject,
  sessionObject,
  signPayload,
  stripeEvent,
  type FakePayments,
  type SessionFields,
} from './helpers/fake-payments';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/**
 * Payments against the real Express app and real PostgreSQL. Stripe is faked at the provider boundary for
 * checkout creation; webhooks are signed with the Stripe SDK and verified by the real adapter.
 */
let db: Database;
let stripe: FakePayments;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let eventA: string;
let teamA: string;
let adminA: string;
let adminB: string;

beforeAll(async () => {
  db = openTestDb();
  stripe = createFakePayments();
  app = buildApi(db, { payments: stripe.provider });
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  eventA = await createEvent(db, orgA, { feeCents: 9500 });
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
});
afterAll(() => db.close());

const R = '/api/v1/registrations';
type Family = Awaited<ReturnType<typeof family>>;

/** A parent whose child's registration is SUBMITTED (the point where payment becomes possible). */
async function family(options: { submit?: boolean; event?: string } = {}) {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id);
  const teamId = options.event ? await createTeam(db, options.event) : teamA;
  const reg = await as(app, parent.id).post(R, {
    eventId: options.event ?? eventA,
    playerId,
    teamId,
  });
  const regId = reg.body.data.id as string;
  if (options.submit !== false) {
    const sub = await as(app, parent.id).post(`${R}/${regId}/submit`);
    if (sub.status !== 200)
      throw new Error(`submit failed ${sub.status} ${JSON.stringify(sub.body)}`);
  }
  return { parent, playerId, regId };
}
const checkout = (f: Family, body: unknown = {}) =>
  as(app, f.parent.id).post(`${R}/${f.regId}/payment`, body);
const sessionOf = async (paymentId: string) =>
  (
    await db.query<{ stripe_checkout_session_id: string }>(
      'select stripe_checkout_session_id from public.payments where id = $1',
      [paymentId],
    )
  ).rows[0]!.stripe_checkout_session_id;
const regStatus = async (regId: string) =>
  (
    await db.query<{ status: string }>('select status from public.registrations where id = $1', [
      regId,
    ])
  ).rows[0]!.status;
const payments = async (regId: string) =>
  (
    await db.query<{
      id: string;
      status: string;
      failure_reason: string | null;
      stripe_payment_intent_id: string | null;
      paid_at: Date | null;
    }>(
      'select id, status, failure_reason, stripe_payment_intent_id, paid_at from public.payments where registration_id = $1 order by created_at',
      [regId],
    )
  ).rows;
const count = async (sql: string, params: unknown[]) =>
  (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

/** Starts a checkout and returns the references a webhook would carry. */
async function started(f: Family) {
  const res = await checkout(f);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const paymentId = res.body.data.paymentId as string;
  return { paymentId, sessionId: await sessionOf(paymentId), regId: f.regId };
}
const sessionEvent = (
  type: string,
  c: { paymentId: string; sessionId: string; regId: string },
  over: Partial<SessionFields> = {},
) =>
  stripeEvent(
    type,
    sessionObject({
      sessionId: c.sessionId,
      paymentId: c.paymentId,
      registrationId: c.regId,
      ...over,
    }),
  );
const paidEvent = (
  c: { paymentId: string; sessionId: string; regId: string },
  over: Partial<SessionFields> = {},
) => sessionEvent('checkout.session.completed', c, over);

describe('POST /registrations/:id/payment: create a checkout', () => {
  it('creates a pending payment for the server-side amount and returns only what the browser needs', async () => {
    const f = await family();
    const res = await checkout(f);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body.data).sort()).toEqual(['checkoutUrl', 'expiresAt', 'paymentId']);
    expect(res.body.data.checkoutUrl).toMatch(/^https:\/\/checkout\.test\/pay\/cs_test_/);
    const ttl = new Date(res.body.data.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60_000); // Stripe's minimum is 30 minutes

    const [p] = await payments(f.regId);
    expect(p).toMatchObject({ status: 'PAYMENT_PENDING', paid_at: null });
    const row = (
      await db.query(
        'select amount_cents, currency, provider, created_by from public.payments where id = $1',
        [p!.id],
      )
    ).rows[0];
    expect(row).toEqual({
      amount_cents: 9500,
      currency: 'usd',
      provider: 'STRIPE',
      created_by: f.parent.id,
    });

    // what the provider was asked for: our amount, our references, our return pages, no personal data
    const sent = stripe.created.at(-1)!;
    expect(sent).toMatchObject({
      paymentId: p!.id,
      registrationId: f.regId,
      amountCents: 9500,
      currency: 'usd',
    });
    expect(sent.successUrl).toBe(
      `http://localhost:3000/register/player/payment-return?status=success&registrationId=${f.regId}`,
    );
    expect(sent.cancelUrl).toBe(
      `http://localhost:3000/register/player/payment-return?status=cancelled&registrationId=${f.regId}`,
    );
    expect(sent.description).toMatch(/^Registration FX-\d{4}-\d{5} - Event$/);
    expect(sent.description).not.toContain('Mateo');

    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING'); // workflow step; not verified, not ready
    const hist = await db.query(
      'select from_status, to_status, changed_by from public.registration_status_history where registration_id = $1 and to_status = $2',
      [f.regId, 'PAYMENT_PENDING'],
    );
    expect(hist.rows).toEqual([
      { from_status: 'SUBMITTED', to_status: 'PAYMENT_PENDING', changed_by: f.parent.id },
    ]);
    const audit = await db.query(
      'select action, actor_user_id, metadata from public.audit_logs where entity_id = $1',
      [p!.id],
    );
    expect(audit.rows).toEqual([
      {
        action: 'PAYMENT_CHECKOUT_CREATED',
        actor_user_id: f.parent.id,
        metadata: { registrationId: f.regId, amountCents: 9500, currency: 'usd' },
      },
    ]);
  });

  it('never accepts an amount, currency, price or status from the client', async () => {
    const f = await family();
    for (const body of [
      { amount: 1 },
      { amountCents: 1 },
      { currency: 'eur' },
      { price: 0 },
      { status: 'PAID' },
      { amountCents: 1, currency: 'usd' },
      { paymentId: f.regId },
    ]) {
      expect((await checkout(f, body)).status, JSON.stringify(body)).toBe(422);
    }
    expect(await payments(f.regId)).toEqual([]);
    expect(stripe.created.filter((c) => c.registrationId === f.regId)).toEqual([]);
  });

  it('charges the fee fixed at submission, whatever happens to the event price afterwards', async () => {
    const event = await createEvent(db, orgA, { feeCents: 12000 });
    const f = await family({ event });
    await db.query('update public.events set registration_fee_cents = 100 where id = $1', [event]);
    const res = await checkout(f);
    expect(res.status).toBe(201);
    expect(stripe.created.at(-1)!.amountCents).toBe(12000);
  });

  it('only allows a registration that is submitted and unpaid, and that owes something', async () => {
    const draft = await family({ submit: false });
    const notSubmitted = await checkout(draft);
    expect(notSubmitted.status).toBe(409);
    expect(notSubmitted.body.error.code).toBe('REGISTRATION_NOT_PAYABLE');

    const cancelled = await family();
    await db.query("update public.registrations set status = 'CANCELLED' where id = $1", [
      cancelled.regId,
    ]);
    expect((await checkout(cancelled)).body.error.code).toBe('REGISTRATION_NOT_PAYABLE');
    const verified = await family();
    await db.query("update public.registrations set status = 'VERIFIED' where id = $1", [
      verified.regId,
    ]);
    expect((await checkout(verified)).body.error.code).toBe('REGISTRATION_NOT_PAYABLE');

    const freeEvent = await createEvent(db, orgA, { feeCents: 0 });
    const free = await family({ event: freeEvent });
    const none = await checkout(free);
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('PAYMENT_NOT_REQUIRED');
    expect(
      await count(
        'select count(*)::int as n from public.payments where registration_id = any($1)',
        [[draft.regId, cancelled.regId, verified.regId, free.regId]],
      ),
    ).toBe(0);
  });

  it("refuses another family's registration (404), non-family roles (403) and anonymous callers (401)", async () => {
    const owner = await family();
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const res = await as(app, stranger.id).post(`${R}/${owner.regId}/payment`, {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REGISTRATION_NOT_FOUND');
    for (const roles of [[], ['COACH'], ['STAFF'], ['ADMIN']] as const) {
      const u = await createUser(db, { roles: [...roles], organizationId: orgA });
      expect((await as(app, u.id).post(`${R}/${owner.regId}/payment`, {})).status).toBe(403);
    }
    expect((await request(app).post(`${R}/${owner.regId}/payment`).send({})).status).toBe(401);
    expect(await payments(owner.regId)).toEqual([]);
    expect(await regStatus(owner.regId)).toBe('SUBMITTED');
  });

  it('rejects unknown and malformed registration ids, including injection', async () => {
    const f = await family();
    const p = as(app, f.parent.id);
    expect((await p.post(`${R}/11111111-1111-4111-8111-111111111111/payment`, {})).status).toBe(
      404,
    );
    for (const bad of [
      'nope',
      encodeURIComponent("1' OR '1'='1"),
      encodeURIComponent('1; DROP TABLE public.payments;--'),
    ]) {
      expect((await p.post(`${R}/${bad}/payment`, {})).status).toBe(422);
      expect((await p.get(`${R}/${bad}/payment`)).status).toBe(422);
    }
    expect(
      await count('select count(*)::int as n from public.payments', []),
    ).toBeGreaterThanOrEqual(0);
  });

  it('answers 503 and leaves no trace when the provider fails, without leaking its error', async () => {
    const f = await family();
    stripe.failures.create = true;
    const res = await checkout(f);
    stripe.failures.create = false;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('sk_test');
    expect(await payments(f.regId)).toEqual([]);
    expect(await regStatus(f.regId)).toBe('SUBMITTED');
    expect((await checkout(f)).status).toBe(201); // and the user can simply try again
  });

  it('answers 503 PAYMENT_NOT_CONFIGURED when Stripe is not configured', async () => {
    const f = await family();
    const bare = buildApi(db);
    const res = await as(bare, f.parent.id).post(`${R}/${f.regId}/payment`, {});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');
    expect(
      (
        await request(bare)
          .post('/api/v1/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .send('{}')
      ).status,
    ).toBe(503);
  });
});

describe('retry and concurrent checkout creation', () => {
  it('retry closes the earlier checkout at the provider first, then replaces it', async () => {
    const f = await family();
    const first = await started(f);
    const second = await started(f);
    expect(second.paymentId).not.toBe(first.paymentId);
    expect(stripe.expired).toContain(first.sessionId);
    const rows = await payments(f.regId);
    expect(rows.map((r) => [r.id, r.status, r.failure_reason])).toEqual([
      [first.paymentId, 'CANCELLED', 'SUPERSEDED'],
      [second.paymentId, 'PAYMENT_PENDING', null],
    ]);
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
    expect(
      await count(
        "select count(*)::int as n from public.registration_status_history where registration_id = $1 and to_status = 'PAYMENT_PENDING'",
        [f.regId],
      ),
    ).toBe(1);
    const audit = await db.query(
      'select action from public.audit_logs where entity_id = $1 order by action',
      [first.paymentId],
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      'PAYMENT_CANCELLED',
      'PAYMENT_CHECKOUT_CREATED',
    ]);
  });

  it('never starts a second charge when the earlier checkout was already paid at the provider', async () => {
    const f = await family();
    const first = await started(f);
    stripe.complete(first.sessionId); // paid at Stripe; our webhook has not arrived yet
    const res = await checkout(f);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    expect((await payments(f.regId)).map((p) => p.status)).toEqual(['PAYMENT_PENDING']);
    expect(stripe.created.filter((c) => c.registrationId === f.regId)).toHaveLength(1);
    // the confirming webhook then completes it
    expect((await deliver(app, paidEvent(first))).status).toBe(200);
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
  });

  it('keeps exactly one open checkout when many are requested at once', async () => {
    const f = await family();
    const results = await Promise.all(Array.from({ length: 5 }, () => checkout(f)));
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(results.some((r) => r.status === 201)).toBe(true);
    const rows = await payments(f.regId);
    expect(rows.filter((r) => r.status === 'PAYMENT_PENDING')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'PAID')).toHaveLength(0);
    // every checkout except the surviving one was closed at the provider
    const open = [...stripe.sessions.entries()].filter(
      ([, s]) => s.status === 'open' && s.request.registrationId === f.regId,
    );
    expect(open).toHaveLength(1);
    expect(await sessionOf(rows.find((r) => r.status === 'PAYMENT_PENDING')!.id)).toBe(open[0]![0]);
    expect(
      await count(
        "select count(*)::int as n from public.registration_status_history where registration_id = $1 and to_status = 'PAYMENT_PENDING'",
        [f.regId],
      ),
    ).toBe(1);
  });

  it('refuses a new checkout once the registration is paid', async () => {
    const f = await family();
    await deliver(app, paidEvent(await started(f)));
    const res = await checkout(f);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_ALREADY_COMPLETED');
  });
});

describe('webhook signature verification', () => {
  it('rejects a bad signature with 400 and changes nothing', async () => {
    const f = await family();
    const c = await started(f);
    const ev = paidEvent(c);
    const wrongSecret = {
      payload: ev.payload,
      header: signPayload(ev.payload, 'whsec_someone_else'),
    };
    const tampered = { payload: ev.payload.replace('9500', '1'), header: ev.header };
    const stale = {
      payload: ev.payload,
      header: signPayload(ev.payload, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600),
    };
    for (const [name, w] of [
      ['wrong secret', wrongSecret],
      ['tampered body', tampered],
      ['old timestamp (replay)', stale],
      ['garbage header', { payload: ev.payload, header: 'nonsense' }],
    ] as const) {
      const res = await deliver(app, w);
      expect(res.status, name).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    }
    const missing = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(ev.payload);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');

    expect((await payments(f.regId)).map((p) => p.status)).toEqual(['PAYMENT_PENDING']);
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
    expect(
      await count(
        'select count(*)::int as n from public.payment_webhook_events where event_id = $1',
        [ev.id],
      ),
    ).toBe(0);
  });

  it('does not process (or store) an unverified body, even a malformed one', async () => {
    for (const body of [
      'not json at all',
      '{"id":"evt_x","type":"checkout.session.completed"}',
      '',
    ]) {
      const res = await request(app)
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=abc')
        .send(body);
      expect(res.status).toBe(400);
    }
    const wrongType = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'text/plain')
      .set('Stripe-Signature', 't=1,v1=abc')
      .send('x');
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.code).toBe('INVALID_WEBHOOK_BODY');
  });

  it('is not subject to the browser session, CORS or JSON parsing: only the signature matters', async () => {
    const f = await family();
    const c = await started(f);
    const res = await deliver(app, paidEvent(c)); // no Authorization header, no cookie
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});

describe('successful payment', () => {
  it('confirms the payment from the webhook alone, with history and audit, and stops at PAYMENT_COMPLETED', async () => {
    const f = await family();
    const c = await started(f);
    const ev = paidEvent(c);
    expect((await deliver(app, ev)).status).toBe(200);

    const [p] = await payments(f.regId);
    expect(p).toMatchObject({
      status: 'PAID',
      failure_reason: null,
      stripe_payment_intent_id: expect.stringMatching(/^pi_test_/),
    });
    expect(p!.paid_at).toBeInstanceOf(Date);
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
    const hist = await db.query(
      'select from_status, to_status, changed_by, reason from public.registration_status_history where registration_id = $1 and to_status = $2',
      [f.regId, 'PAYMENT_COMPLETED'],
    );
    expect(hist.rows).toEqual([
      {
        from_status: 'PAYMENT_PENDING',
        to_status: 'PAYMENT_COMPLETED',
        changed_by: null,
        reason: 'Payment confirmed',
      },
    ]);
    const audit = await db.query(
      'select action, actor_user_id, metadata from public.audit_logs where entity_id = $1 and action = $2',
      [p!.id, 'PAYMENT_CONFIRMED'],
    );
    expect(audit.rows).toEqual([
      {
        action: 'PAYMENT_CONFIRMED',
        actor_user_id: null,
        metadata: {
          registrationId: f.regId,
          amountCents: 9500,
          registrationStatus: 'PAYMENT_PENDING',
        },
      },
    ]);
    const evt = await db.query(
      'select outcome, payment_id from public.payment_webhook_events where event_id = $1',
      [ev.id],
    );
    expect(evt.rows).toEqual([{ outcome: 'APPLIED', payment_id: p!.id }]);
  });

  it('keeps payment separate from documents, consent and check-in (no READY_FOR_EVENT, nothing else touched)', async () => {
    const f = await family();
    await deliver(app, paidEvent(await started(f)));
    expect(await regStatus(f.regId)).not.toBe('READY_FOR_EVENT');
    expect(await regStatus(f.regId)).not.toBe('VERIFIED');
    for (const table of ['documents', 'consent_records', 'check_ins']) {
      expect(
        await count(`select count(*)::int as n from public.${table} where registration_id = $1`, [
          f.regId,
        ]),
        table,
      ).toBe(0);
    }
    const docs = await as(app, f.parent.id).get(`${R}/${f.regId}/documents`);
    expect(docs.body.data.completeness.allRequiredApproved).toBe(false);
  });

  it('works when the browser is closed right after paying: nothing but the webhook is needed', async () => {
    const f = await family();
    const c = await started(f);
    // no return page, no GET: only Stripe talks to us
    await deliver(app, paidEvent(c));
    const later = await as(app, f.parent.id).get(`${R}/${f.regId}/payment`); // the user comes back tomorrow
    expect(later.body.data).toMatchObject({ paymentStatus: 'PAID', canStartCheckout: false });
    expect(later.body.data.payments).toHaveLength(1);
  });

  it('is fine when the webhook arrives before the browser returns, and the return page proves nothing', async () => {
    const f = await family();
    const c = await started(f);
    // the customer is sent back to the success page: until a webhook arrives, nothing is paid
    expect(
      (await as(app, f.parent.id).get(`${R}/${f.regId}/payment`)).body.data.paymentStatus,
    ).toBe('PAYMENT_PENDING');
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
    await deliver(app, paidEvent(c));
    expect(
      (await as(app, f.parent.id).get(`${R}/${f.regId}/payment`)).body.data.paymentStatus,
    ).toBe('PAID');
  });

  it('refuses a payment whose amount or currency differs from what was asked, and never marks it paid', async () => {
    const f = await family();
    const c = await started(f);
    for (const over of [{ amountCents: 100 }, { amountCents: 9501 }, { currency: 'eur' }]) {
      const ev = paidEvent(c, over);
      expect((await deliver(app, ev)).status).toBe(200);
      const evt = await db.query(
        'select outcome, detail from public.payment_webhook_events where event_id = $1',
        [ev.id],
      );
      expect(evt.rows).toEqual([{ outcome: 'REJECTED', detail: 'AMOUNT_MISMATCH' }]);
    }
    expect((await payments(f.regId))[0]!.status).toBe('PAYMENT_PENDING');
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
    expect(
      await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'PAYMENT_WEBHOOK_REJECTED'",
        [c.paymentId],
      ),
    ).toBe(3);
  });

  it('records the payment but leaves a cancelled registration untouched', async () => {
    const f = await family();
    const c = await started(f);
    await db.query("update public.registrations set status = 'CANCELLED' where id = $1", [f.regId]);
    await deliver(app, paidEvent(c));
    expect((await payments(f.regId))[0]!.status).toBe('PAID'); // the money was taken: it must be on record
    expect(await regStatus(f.regId)).toBe('CANCELLED');
    const audit = await db.query(
      'select metadata from public.audit_logs where entity_id = $1 and action = $2',
      [c.paymentId, 'PAYMENT_CONFIRMED'],
    );
    expect(audit.rows[0]!.metadata).toMatchObject({ registrationStatus: 'CANCELLED' });
  });
});

describe('idempotency: duplicate and concurrent webhooks', () => {
  it('applies a redelivered event once', async () => {
    const f = await family();
    const c = await started(f);
    const ev = paidEvent(c);
    const first = await deliver(app, ev);
    const second = await deliver(app, ev);
    const third = await deliver(app, ev);
    expect(first.body).toEqual({ received: true });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true, note: 'DUPLICATE' });
    expect(third.body.note).toBe('DUPLICATE');
    expect(
      await count(
        "select count(*)::int as n from public.registration_status_history where registration_id = $1 and to_status = 'PAYMENT_COMPLETED'",
        [f.regId],
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'PAYMENT_CONFIRMED'",
        [c.paymentId],
      ),
    ).toBe(1);
    expect(
      await count(
        'select count(*)::int as n from public.payment_webhook_events where event_id = $1',
        [ev.id],
      ),
    ).toBe(1);
  });

  it('applies exactly once when the same event is delivered simultaneously', async () => {
    const f = await family();
    const c = await started(f);
    const ev = paidEvent(c);
    const results = await Promise.all(Array.from({ length: 10 }, () => deliver(app, ev)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.note === undefined)).toHaveLength(1); // one applied...
    expect(results.filter((r) => r.body.note === 'DUPLICATE')).toHaveLength(9); // ...nine recognized as duplicates
    expect((await payments(f.regId)).map((p) => p.status)).toEqual(['PAID']);
    expect(
      await count(
        "select count(*)::int as n from public.registration_status_history where registration_id = $1 and to_status = 'PAYMENT_COMPLETED'",
        [f.regId],
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'PAYMENT_CONFIRMED'",
        [c.paymentId],
      ),
    ).toBe(1);
  });

  it('handles a different event id reporting the same payment (completed + async succeeded) as a no-op', async () => {
    const f = await family();
    const c = await started(f);
    await deliver(app, paidEvent(c));
    const again = paidEvent(c);
    expect((await deliver(app, again)).status).toBe(200);
    const evt = await db.query(
      'select outcome, detail from public.payment_webhook_events where event_id = $1',
      [again.id],
    );
    expect(evt.rows).toEqual([{ outcome: 'NOOP', detail: 'ALREADY_PAID' }]);
    expect(
      await count(
        "select count(*)::int as n from public.registration_status_history where registration_id = $1 and to_status = 'PAYMENT_COMPLETED'",
        [f.regId],
      ),
    ).toBe(1);
  });

  it('rolls everything back on an internal error so the provider retry is applied (no lost payment)', async () => {
    const f = await family();
    const c = await started(f);
    const ev = paidEvent(c);
    await db.query(
      `create or replace function public.test_fail_confirm() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end; $$`,
    );
    await db.query(
      `create trigger test_fail_confirm before insert on public.audit_logs for each row when (new.action = 'PAYMENT_CONFIRMED' and new.entity_id = '${c.paymentId}') execute function public.test_fail_confirm()`,
    );
    const failed = await deliver(app, ev);
    await db.query('drop trigger test_fail_confirm on public.audit_logs');
    expect(failed.status).toBe(500);
    expect((await payments(f.regId))[0]!.status).toBe('PAYMENT_PENDING'); // nothing half-applied
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
    expect(
      await count(
        'select count(*)::int as n from public.payment_webhook_events where event_id = $1',
        [ev.id],
      ),
    ).toBe(0);

    const retry = await deliver(app, ev); // Stripe redelivers the same event
    expect(retry.status).toBe(200);
    expect(retry.body.note).toBeUndefined();
    expect((await payments(f.regId))[0]!.status).toBe('PAID');
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
  });

  it('prevents two PAID payments for one registration, even at the database level', async () => {
    const f = await family();
    const a = await started(f);
    await deliver(app, paidEvent(a));
    const msg = await db
      .query(
        "insert into public.payments (registration_id, status, amount_cents, paid_at, stripe_checkout_session_id) values ($1, 'PAID', 9500, now(), 'cs_dup')",
        [f.regId],
      )
      .then(
        () => '',
        (e: Error) => e.message,
      );
    expect(msg).toMatch(/one_paid_per_registration/);
  });

  it('flags a second charge for an already-paid registration instead of paying it twice', async () => {
    const f = await family();
    const a = await started(f);
    const b = await started(f); // retry: a is superseded, b is the open one
    await deliver(app, paidEvent(a)); // the customer actually paid on the OLD page
    expect((await payments(f.regId)).map((p) => p.status).sort()).toEqual(['CANCELLED', 'PAID']);
    expect(stripe.expired).toContain(b.sessionId); // b was closed so it cannot be paid
    const dup = paidEvent(b); // ...and a second charge on the other page still arrived
    expect((await deliver(app, dup)).status).toBe(200);
    const rows = await payments(f.regId);
    expect(rows.filter((p) => p.status === 'PAID')).toHaveLength(1);
    expect(rows.find((p) => p.id === b.paymentId)).toMatchObject({
      status: 'CANCELLED',
      failure_reason: 'DUPLICATE_NEEDS_REFUND',
    });
    const evt = await db.query(
      'select outcome, detail from public.payment_webhook_events where event_id = $1',
      [dup.id],
    );
    expect(evt.rows).toEqual([{ outcome: 'REJECTED', detail: 'DUPLICATE_PAYMENT' }]);
    expect(
      await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'PAYMENT_WEBHOOK_REJECTED'",
        [b.paymentId],
      ),
    ).toBe(1);
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
  });
});

describe('failed, cancelled and expired payments', () => {
  it('marks an asynchronous failure FAILED (no registration change) and lets the user retry and pay', async () => {
    const f = await family();
    const c = await started(f);
    const ev = sessionEvent('checkout.session.async_payment_failed', c, {
      paymentStatus: 'unpaid',
    });
    expect((await deliver(app, ev)).status).toBe(200);
    const [p] = await payments(f.regId);
    expect(p).toMatchObject({ status: 'FAILED', failure_reason: 'async_payment_failed' });
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING'); // a failed payment does not move the workflow back or forward
    expect(
      await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'PAYMENT_FAILED'",
        [c.paymentId],
      ),
    ).toBe(1);
    const view = await as(app, f.parent.id).get(`${R}/${f.regId}/payment`);
    expect(view.body.data).toMatchObject({ paymentStatus: 'FAILED', canStartCheckout: true });

    const retry = await started(f); // user retries
    expect(retry.paymentId).not.toBe(c.paymentId);
    await deliver(app, paidEvent(retry));
    expect((await payments(f.regId)).map((x) => x.status)).toEqual(['FAILED', 'PAID']);
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
  });

  it('records a single failed card attempt without ending the checkout (the customer can retry on the same page)', async () => {
    const f = await family();
    const c = await started(f);
    const ev = stripeEvent(
      'payment_intent.payment_failed',
      paymentIntentObject({
        paymentId: c.paymentId,
        registrationId: f.regId,
        code: 'insufficient_funds',
      }),
    );
    expect((await deliver(app, ev)).status).toBe(200);
    expect((await payments(f.regId))[0]).toMatchObject({
      status: 'PAYMENT_PENDING',
      failure_reason: 'insufficient_funds',
    });
    // only the short code is kept: never the provider's message (which can echo card details)
    const dump =
      JSON.stringify(
        (await db.query('select * from public.payments where id = $1', [c.paymentId])).rows,
      ) +
      JSON.stringify(
        (await db.query('select * from public.audit_logs where entity_id = $1', [c.paymentId]))
          .rows,
      );
    expect(dump).not.toContain('4242');
    expect(dump).not.toContain('insufficient funds');
    // ...and the same page can still succeed afterwards
    await deliver(app, paidEvent(c));
    expect((await payments(f.regId))[0]!.status).toBe('PAID');
  });

  it('marks an expired checkout CANCELLED and allows a fresh one', async () => {
    const f = await family();
    const c = await started(f);
    expect(
      (await deliver(app, sessionEvent('checkout.session.expired', c, { paymentStatus: 'unpaid' })))
        .status,
    ).toBe(200);
    expect((await payments(f.regId))[0]).toMatchObject({
      status: 'CANCELLED',
      failure_reason: 'CHECKOUT_EXPIRED',
    });
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
    expect(
      await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'PAYMENT_CANCELLED'",
        [c.paymentId],
      ),
    ).toBe(1);
    const fresh = await started(f);
    await deliver(app, paidEvent(fresh));
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
  });

  it('treats a customer who abandons the hosted page as still pending, then cancelled once superseded', async () => {
    const f = await family();
    const c = await started(f);
    // the customer hits "back" on Stripe: Stripe sends no event; the return page cannot change our state
    expect(
      (await as(app, f.parent.id).get(`${R}/${f.regId}/payment`)).body.data.paymentStatus,
    ).toBe('PAYMENT_PENDING');
    await started(f);
    expect((await payments(f.regId))[0]).toMatchObject({
      id: c.paymentId,
      status: 'CANCELLED',
      failure_reason: 'SUPERSEDED',
    });
  });

  it('still honours a payment that completes after its checkout was marked expired (money wins)', async () => {
    const f = await family();
    const c = await started(f);
    await deliver(app, sessionEvent('checkout.session.expired', c, { paymentStatus: 'unpaid' }));
    await deliver(app, paidEvent(c));
    expect((await payments(f.regId))[0]!.status).toBe('PAID');
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
  });

  it('waits for funds on asynchronous methods: unpaid completion is a no-op, the later success pays', async () => {
    const f = await family();
    const c = await started(f);
    const early = sessionEvent('checkout.session.completed', c, { paymentStatus: 'unpaid' });
    expect((await deliver(app, early)).status).toBe(200);
    expect((await payments(f.regId))[0]!.status).toBe('PAYMENT_PENDING');
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
    await deliver(
      app,
      sessionEvent('checkout.session.async_payment_succeeded', c, { paymentStatus: 'paid' }),
    );
    expect((await payments(f.regId))[0]!.status).toBe('PAID');
  });

  it('does not let a late failure or expiry undo a payment that succeeded', async () => {
    const f = await family();
    const c = await started(f);
    await deliver(app, paidEvent(c));
    await deliver(
      app,
      sessionEvent('checkout.session.async_payment_failed', c, { paymentStatus: 'unpaid' }),
    );
    await deliver(app, sessionEvent('checkout.session.expired', c, { paymentStatus: 'unpaid' }));
    expect((await payments(f.regId))[0]!.status).toBe('PAID');
    expect(await regStatus(f.regId)).toBe('PAYMENT_COMPLETED');
  });
});

describe('events that are not ours, or not yet', () => {
  it('acknowledges event types we do not handle without storing them', async () => {
    const ev = stripeEvent('customer.created', { id: 'cus_1', object: 'customer' });
    const res = await deliver(app, ev);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, note: 'IGNORED' });
    expect(
      await count(
        'select count(*)::int as n from public.payment_webhook_events where event_id = $1',
        [ev.id],
      ),
    ).toBe(0);
  });

  it('records and ignores a payment event that carries none of our references', async () => {
    const ev = stripeEvent(
      'checkout.session.completed',
      sessionObject({ sessionId: 'cs_foreign_1', paymentId: null, registrationId: null }),
    );
    expect((await deliver(app, ev)).status).toBe(200);
    const evt = await db.query(
      'select outcome, detail, payment_id from public.payment_webhook_events where event_id = $1',
      [ev.id],
    );
    expect(evt.rows).toEqual([{ outcome: 'IGNORED', detail: 'NOT_OURS', payment_id: null }]);
  });

  it('asks the provider to retry when our reference is not found yet, and stores nothing meanwhile', async () => {
    const ev = stripeEvent(
      'checkout.session.completed',
      sessionObject({
        sessionId: 'cs_early',
        paymentId: '99999999-9999-4999-8999-999999999999',
        registrationId: '88888888-8888-4888-8888-888888888888',
      }),
    );
    const res = await deliver(app, ev);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND_YET');
    expect(
      await count(
        'select count(*)::int as n from public.payment_webhook_events where event_id = $1',
        [ev.id],
      ),
    ).toBe(0);
  });

  it('rejects an event whose registration reference does not match the payment', async () => {
    const f = await family();
    const other = await family();
    const c = await started(f);
    const ev = paidEvent({ ...c, regId: other.regId });
    expect((await deliver(app, ev)).status).toBe(200);
    const evt = await db.query(
      'select outcome, detail from public.payment_webhook_events where event_id = $1',
      [ev.id],
    );
    expect(evt.rows).toEqual([{ outcome: 'REJECTED', detail: 'METADATA_MISMATCH' }]);
    expect((await payments(f.regId))[0]!.status).toBe('PAYMENT_PENDING');
    expect(await regStatus(other.regId)).toBe('SUBMITTED');
  });

  it('treats hostile reference values as plain data (no SQL injection, no server error)', async () => {
    for (const bad of ["' OR '1'='1", "1'; DROP TABLE public.payments;--", '../../etc/passwd']) {
      const viaMeta = stripeEvent(
        'checkout.session.completed',
        sessionObject({ sessionId: bad, paymentId: bad, registrationId: bad }),
      );
      const viaSession = stripeEvent(
        'checkout.session.expired',
        sessionObject({ sessionId: bad, paymentId: null, registrationId: null }),
      );
      for (const ev of [viaMeta, viaSession]) {
        const res = await deliver(app, ev);
        expect(res.status).toBe(200);
      }
    }
    expect(
      await count('select count(*)::int as n from public.payments', []),
    ).toBeGreaterThanOrEqual(0); // table intact
  });
});

describe('reading payment state', () => {
  it('shows the owner a summary without provider references, and nothing to anyone else', async () => {
    const f = await family();
    await started(f);
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const view = await as(app, f.parent.id).get(`${R}/${f.regId}/payment`);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.body.data).toMatchObject({
      registrationId: f.regId,
      amountDue: { amountCents: 9500, currency: 'usd' },
      paymentStatus: 'PAYMENT_PENDING',
      canStartCheckout: true,
    });
    expect(Object.keys(view.body.data.payments[0]).sort()).toEqual([
      'amountCents',
      'checkoutExpiresAt',
      'createdAt',
      'currency',
      'failureReason',
      'id',
      'paidAt',
      'status',
      'updatedAt',
    ]);
    const text = JSON.stringify(view.body);
    for (const leak of ['cs_test', 'pi_', 'checkout.test', 'stripe', 'created_by', 'sk_'])
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());

    expect((await as(app, stranger.id).get(`${R}/${f.regId}/payment`)).status).toBe(404);
    expect((await request(app).get(`${R}/${f.regId}/payment`)).status).toBe(401);
  });

  it('follows the organization rule for admins: own organization reads, another gets 404, nobody edits', async () => {
    const f = await family();
    await started(f);
    expect((await as(app, adminA).get(`${R}/${f.regId}/payment`)).status).toBe(200);
    expect((await as(app, adminB).get(`${R}/${f.regId}/payment`)).status).toBe(404);
    expect((await as(app, adminA).post(`${R}/${f.regId}/payment`, {})).status).toBe(403); // no override
    const cross = await family({ event: await createEvent(db, orgB) });
    expect((await as(app, adminA).get(`${R}/${cross.regId}/payment`)).status).toBe(404);
  });

  it('reports NOT_STARTED before any checkout', async () => {
    const f = await family();
    const view = await as(app, f.parent.id).get(`${R}/${f.regId}/payment`);
    expect(view.body.data).toMatchObject({
      paymentStatus: 'NOT_STARTED',
      payments: [],
      canStartCheckout: true,
    });
  });
});

describe('sensitive data protection', () => {
  it('never logs secrets, signatures, checkout links or Stripe references, even on failures', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = pino(
      { level: 'trace', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
      sink,
    );
    const logged = buildApi(db, { logger, payments: stripe.provider });
    const f = await family();

    stripe.failures.create = true; // the provider error text contains the secret key
    await as(logged, f.parent.id).post(`${R}/${f.regId}/payment`, {});
    stripe.failures.create = false;
    const res = await as(logged, f.parent.id).post(`${R}/${f.regId}/payment`, {});
    const ev = paidEvent({
      paymentId: res.body.data.paymentId,
      sessionId: await sessionOf(res.body.data.paymentId),
      regId: f.regId,
    });
    await deliver(logged, ev);
    await deliver(logged, {
      payload: ev.payload,
      header: signPayload(ev.payload, 'whsec_attacker'),
    }); // rejected webhook

    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [
      FAKE_SECRET_KEY,
      'sk_test',
      WEBHOOK_SECRET,
      'whsec_',
      ev.header,
      res.body.data.checkoutUrl,
      'cs_test_',
      'pi_test_',
      'checkout.test',
    ]) {
      expect(output, secret).not.toContain(secret);
    }
    expect(output).toContain('invalid signature'); // the rejection itself is logged, without any of the above
  });

  it('keeps provider payloads and references out of the audit trail and the webhook table', async () => {
    const f = await family();
    const c = await started(f);
    await deliver(app, paidEvent(c));
    await deliver(
      app,
      stripeEvent(
        'payment_intent.payment_failed',
        paymentIntentObject({ paymentId: c.paymentId, registrationId: f.regId }),
      ),
    );
    const audit = JSON.stringify(
      (await db.query('select metadata from public.audit_logs where entity_id = $1', [c.paymentId]))
        .rows,
    );
    const events = JSON.stringify(
      (
        await db.query('select * from public.payment_webhook_events where payment_id = $1', [
          c.paymentId,
        ])
      ).rows,
    );
    for (const secret of [c.sessionId, 'pi_test_', 'checkout.test', 'whsec_', 'sk_test', '4242']) {
      expect(audit, secret).not.toContain(secret);
      expect(events, secret).not.toContain(secret);
    }
  });

  it('makes processed webhook events permanent (they cannot be deleted)', async () => {
    const f = await family();
    const c = await started(f);
    const ev = paidEvent(c);
    await deliver(app, ev);
    const msg = await db
      .query('delete from public.payment_webhook_events where event_id = $1', [ev.id])
      .then(
        () => '',
        (e: Error) => e.message,
      );
    expect(msg).toMatch(/append-only/);
  });

  it('stores no card data: the payments table has no column that could hold it', async () => {
    const cols = (
      await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'payments'",
      )
    ).rows.map((r) => r.column_name);
    expect(cols.filter((c) => /card|cvv|cvc|pan|number|token|secret/i.test(c))).toEqual([]);
  });
});
