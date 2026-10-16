import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import {
  createFakePayments,
  deliver,
  signPayload,
  stripeEvent,
  type FakePayments,
} from './helpers/fake-payments';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/**
 * Player payments through a Stripe Payment Link (test mode): the player is sent to the link tagged with the payment's id as
 * client_reference_id, and only Stripe's signed webhook marks the payment paid. Real Express app, real PostgreSQL; the
 * webhooks are signed with the Stripe SDK and verified by the real adapter.
 */
const LINK = 'https://buy.stripe.com/test_FAKEFAKEFAKE';
let db: Database;
let stripe: FakePayments;
let app: ReturnType<typeof buildApi>;
let eventPaid: string;
let eventFree: string;

beforeAll(async () => {
  db = openTestDb();
  stripe = createFakePayments();
  app = buildApi(db, { payments: stripe.provider, paymentLinkUrl: LINK, paymentLinkAmountCents: 9500 });
  const org = await createOrg(db);
  eventPaid = await createEvent(db, org, { feeCents: 9500 });
  eventFree = await createEvent(db, org, { feeCents: 0 });
});
afterAll(() => db.close());

const R = '/api/v1/registrations';

async function family(event = eventPaid) {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id);
  const teamId = await createTeam(db, event);
  const reg = await as(app, parent.id).post(R, { eventId: event, playerId, teamId });
  const regId = reg.body.data.id as string;
  const sub = await as(app, parent.id).post(`${R}/${regId}/submit`);
  if (sub.status !== 200) throw new Error(`submit failed ${sub.status} ${JSON.stringify(sub.body)}`);
  return { parent, regId };
}
type Family = Awaited<ReturnType<typeof family>>;

const start = (f: Family) => as(app, f.parent.id).post(`${R}/${f.regId}/payment`, {});
const regStatus = async (regId: string) =>
  (await db.query<{ status: string }>('select status from public.registrations where id = $1', [regId]))
    .rows[0]!.status;
const rows = async (regId: string) =>
  (
    await db.query<{
      id: string;
      status: string;
      stripe_checkout_session_id: string | null;
      stripe_payment_intent_id: string | null;
      paid_at: Date | null;
    }>(
      `select id, status, stripe_checkout_session_id, stripe_payment_intent_id, paid_at
         from public.payments where registration_id = $1 order by created_at`,
      [regId],
    )
  ).rows;

/** What Stripe sends when a Payment Link is paid: no metadata, our payment id in client_reference_id. */
const linkCompleted = (
  clientReferenceId: string,
  o: { amount?: number; status?: 'paid' | 'unpaid'; session?: string; id?: string } = {},
) => {
  const session = o.session ?? `cs_test_link_${clientReferenceId.slice(0, 8)}`;
  return stripeEvent(
    'checkout.session.completed',
    {
      id: session,
      object: 'checkout.session',
      payment_status: o.status ?? 'paid',
      amount_total: o.amount ?? 9500,
      currency: 'usd',
      payment_intent: `pi_test_${session.slice(-8)}`,
      client_reference_id: clientReferenceId,
      metadata: {},
    },
    o.id,
  );
};

describe('starting a player payment with a Payment Link', () => {
  it('sends the player to the link tagged with the payment id, without creating a Checkout Session', async () => {
    const f = await family();
    const before = stripe.created.length;
    const res = await start(f);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const url = new URL(res.body.data.checkoutUrl as string);
    expect(`${url.origin}${url.pathname}`).toBe(LINK);
    expect(url.searchParams.get('client_reference_id')).toBe(res.body.data.paymentId);
    expect(res.body.data.expiresAt).toBeNull();
    expect(stripe.created.length).toBe(before);
    expect((await rows(f.regId)).map((p) => p.status)).toEqual(['PAYMENT_PENDING']);
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
  });

  it('refuses, before the redirect, a registration whose fee is not what the link charges', async () => {
    const org = await createOrg(db);
    const other = await family(await createEvent(db, org, { feeCents: 4550 }));
    const res = await start(other);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_LINK_AMOUNT_MISMATCH');
    expect(await rows(other.regId)).toEqual([]);
    expect(await regStatus(other.regId)).toBe('SUBMITTED');
  });

  it('keeps a free registration free: no payment is started', async () => {
    const f = await family(eventFree);
    const res = await start(f);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_REQUIRED');
    expect(await rows(f.regId)).toEqual([]);
  });

  it('leaves a payment that was not finished unpaid, and a retry replaces it', async () => {
    const f = await family();
    const first = (await start(f)).body.data.paymentId as string;
    // The player came back without paying: no webhook, so nothing is paid, however long they wait.
    const summary = await as(app, f.parent.id).get(`${R}/${f.regId}/payment`);
    expect(summary.body.data.paymentStatus).toBe('PAYMENT_PENDING');
    expect(summary.body.data.canStartCheckout).toBe(true);

    const second = (await start(f)).body.data.paymentId as string;
    expect(second).not.toBe(first);
    expect((await rows(f.regId)).map((p) => p.status)).toEqual(['CANCELLED', 'PAYMENT_PENDING']);
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
  });
});

describe('the webhook for a Payment Link payment', () => {
  it('marks the right registration paid and stores the payment details', async () => {
    const a = await family();
    const b = await family();
    const pa = (await start(a)).body.data.paymentId as string;
    const pb = (await start(b)).body.data.paymentId as string;

    const res = await deliver(app, linkCompleted(pa));
    expect(res.status).toBe(200);

    const [paid] = await rows(a.regId);
    expect(paid).toMatchObject({ id: pa, status: 'PAID' });
    expect(paid!.paid_at).not.toBeNull();
    expect(paid!.stripe_checkout_session_id).toMatch(/^cs_test_link_/);
    expect(paid!.stripe_payment_intent_id).toMatch(/^pi_test_/);
    expect(await regStatus(a.regId)).toBe('PAYMENT_COMPLETED');
    // The other player's payment is untouched.
    expect((await rows(b.regId))[0]).toMatchObject({ id: pb, status: 'PAYMENT_PENDING' });
    expect(await regStatus(b.regId)).toBe('PAYMENT_PENDING');
    expect((await as(app, a.parent.id).get(`${R}/${a.regId}/payment`)).body.data.paymentStatus).toBe('PAID');
  });

  it('applies a retried delivery once', async () => {
    const f = await family();
    const p = (await start(f)).body.data.paymentId as string;
    const ev = linkCompleted(p);
    expect((await deliver(app, ev)).status).toBe(200);
    const again = await deliver(app, ev);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ received: true, note: 'DUPLICATE' });
    expect(await rows(f.regId)).toHaveLength(1);
    const { rows: events } = await db.query(
      'select 1 from public.payment_webhook_events where event_id = $1',
      [ev.id],
    );
    expect(events).toHaveLength(1);
    // A second event for the same payment (a new event id) changes nothing either.
    expect((await deliver(app, linkCompleted(p))).status).toBe(200);
    expect((await rows(f.regId)).filter((r) => r.status === 'PAID')).toHaveLength(1);
  });

  it('rejects a bad signature and changes nothing', async () => {
    const f = await family();
    const p = (await start(f)).body.data.paymentId as string;
    const ev = linkCompleted(p);
    for (const header of [signPayload(ev.payload, 'whsec_someone_else'), 'nonsense']) {
      const res = await deliver(app, { payload: ev.payload, header });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    }
    expect((await rows(f.regId))[0]!.status).toBe('PAYMENT_PENDING');
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
  });

  it('does not mark a payment paid when the money has not arrived, or the amount is not the fee', async () => {
    const f = await family();
    const p = (await start(f)).body.data.paymentId as string;
    expect((await deliver(app, linkCompleted(p, { status: 'unpaid' }))).status).toBe(200);
    expect((await rows(f.regId))[0]!.status).toBe('PAYMENT_PENDING');
    expect((await deliver(app, linkCompleted(p, { amount: 100 }))).status).toBe(200);
    expect((await rows(f.regId))[0]!.status).toBe('PAYMENT_PENDING');
    expect(await regStatus(f.regId)).toBe('PAYMENT_PENDING');
  });

  it('ignores a Payment Link event that is not about one of our payments', async () => {
    const res = await deliver(app, linkCompleted('some-other-reference'));
    expect(res.status).toBe(200);
  });
});
