import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/infrastructure/database/database';
import { migrateUp } from '../src/infrastructure/database/migrate';
import { createNotificationRepository } from '../src/modules/notifications/repository';
import { createNotificationService } from '../src/modules/notifications/service';
import { createFakePayments, deliver, sessionObject, stripeEvent } from './helpers/fake-payments';
import { createFakePush, type FakePush } from './helpers/fake-push';
import { createFakeStorage, fileBytes, type FakeStorage } from './helpers/fake-storage';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { bearerFor, buildApi, createUser, silentLogger, unique } from './helpers/test-app';

/**
 * Web Push against the real Express app and real PostgreSQL. Only the push service itself (the browser vendor's
 * endpoint) is replaced by a recording fake; every notification here is triggered by the real review / readiness /
 * payment business flows, never called directly.
 */
let db: Database;
let storage: FakeStorage;
let push: FakePush;
let app: ReturnType<typeof buildApi>;
let appWithoutPush: ReturnType<typeof buildApi>;
let stripe: ReturnType<typeof createFakePayments>;
let orgA: string;
let freeEvent: string;
let paidEvent: string;
let adminA: string;

const R = '/api/v1/registrations';
const D = '/api/v1/documents';
const SUBS = '/api/v1/notifications/push/subscriptions';
const KEY = '/api/v1/notifications/push/public-key';

// Own database: guardian-consent wording is global state shared by every test file (same reason as readiness.test.ts).
const dbName = `facex_notifications_${Date.now()}`;

beforeAll(async () => {
  const adminUrl = inject('adminDatabaseUrl');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  await migrateUp(url.toString());
  db = createDatabase({ url: url.toString() });
  storage = createFakeStorage();
  push = createFakePush();
  stripe = createFakePayments();
  app = buildApi(db, { storage, payments: stripe.provider, pushSender: push.sender });
  appWithoutPush = buildApi(db, { storage });
  orgA = await createOrg(db);
  freeEvent = await createEvent(db, orgA, { feeCents: 0 });
  paidEvent = await createEvent(db, orgA, { feeCents: 9500 });
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  await db.query(
    `insert into public.consents (code, version, title, body, effective_at)
     values ('GUARDIAN_CONSENT', 1, 'Test guardian consent', '[TEST CONSENT TEXT]', now() - interval '1 day'),
            ('AB506_ACKNOWLEDGEMENT', 1, 'AB 506', '[TEST AB506]', now() - interval '1 day')`,
  );
});
afterAll(async () => {
  await db.close();
  const admin = new Client({ connectionString: inject('adminDatabaseUrl') });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});
beforeEach(() => push.reset());

const endpointUrl = () => `https://push.example.test/send/${unique('device')}`;
const subscriptionBody = (endpoint = endpointUrl()) => ({
  endpoint,
  keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'authSecret123' },
});
const subscribe = async (userId: string, body = subscriptionBody(), application = app) =>
  request(application)
    .post(SUBS)
    .set(await bearerFor(userId))
    .send(body);
const unsubscribe = async (userId: string, endpoint: string) =>
  request(app)
    .delete(SUBS)
    .set(await bearerFor(userId))
    .send({ endpoint });
const rowsFor = async (userId: string) =>
  (
    await db.query<{ endpoint: string; failure_count: number }>(
      'select endpoint, failure_count from public.push_subscriptions where user_id = $1 order by created_at',
      [userId],
    )
  ).rows;
const countByEndpoint = async (endpoint: string) =>
  (
    await db.query<{ n: number }>(
      'select count(*)::int as n from public.push_subscriptions where endpoint = $1',
      [endpoint],
    )
  ).rows[0]!.n;

// --- business-flow helpers (the same real flows the readiness tests use) ---

interface Family {
  user: { id: string };
  regId: string;
}
async function family(event: string): Promise<Family> {
  const team = await createTeam(db, event);
  const user = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, user.id);
  const reg = await as(app, user.id).post(R, { eventId: event, playerId, teamId: team });
  const regId = reg.body.data.id as string;
  expect((await as(app, user.id).post(`${R}/${regId}/submit`)).status).toBe(200);
  return { user, regId };
}

const SPECS = [
  { documentType: 'PROFILE_PHOTO', mimeType: 'image/jpeg', bytes: () => fileBytes.jpeg(2000) },
  {
    documentType: 'BIRTH_CERTIFICATE',
    mimeType: 'application/pdf',
    bytes: () => fileBytes.pdf(2000),
  },
  {
    documentType: 'SCHOOL_TRANSCRIPT',
    mimeType: 'application/pdf',
    bytes: () => fileBytes.pdf(2000),
  },
  { documentType: 'CALIFORNIA_KID_ID', mimeType: 'image/png', bytes: () => fileBytes.png(2000) },
] as const;

async function submitDoc(ownerId: string, regId: string, spec: (typeof SPECS)[number]) {
  const bytes = spec.bytes();
  const up = await as(app, ownerId).post(`${R}/${regId}/documents/upload-url`, {
    documentType: spec.documentType,
    fileName: 'f.bin',
    mimeType: spec.mimeType,
    sizeBytes: bytes.length,
  });
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  const id = up.body.data.document.id as string;
  const key = (
    await db.query<{ storage_key: string }>(
      'select storage_key from public.documents where id = $1',
      [id],
    )
  ).rows[0]!.storage_key;
  storage.put(key, bytes);
  expect((await as(app, ownerId).post(`${D}/${id}/complete`)).status).toBe(200);
  expect((await as(app, ownerId).post(`${D}/${id}/submit`)).status).toBe(200);
  return id;
}
const approve = (id: string) =>
  as(app, adminA).patch(`${D}/${id}/review`, { decision: 'APPROVED' });
const reject = (id: string, reason = 'Too blurry to read.') =>
  as(app, adminA).patch(`${D}/${id}/review`, {
    decision: 'REJECTED',
    reasonCode: 'UNREADABLE',
    reason,
  });

async function acceptConsent(f: Family) {
  const st = await as(app, f.user.id).get(`${R}/${f.regId}/consents`);
  const res = await as(app, f.user.id).post(`${R}/${f.regId}/consents`, {
    consentId: st.body.data.requirements[0].current.id,
    signedName: 'Dana Rivera',
    accepted: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
const statusOf = async (regId: string) =>
  (
    await db.query<{ status: string }>('select status from public.registrations where id = $1', [
      regId,
    ])
  ).rows[0]!.status;

describe('subscription flow', () => {
  it('serves the VAPID public key to a signed-in user', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const res = await request(app)
      .get(KEY)
      .set(await bearerFor(u.id));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ publicKey: push.sender.publicKey });
  });

  it('requires authentication for every endpoint', async () => {
    expect((await request(app).get(KEY)).status).toBe(401);
    expect((await request(app).post(SUBS).send(subscriptionBody())).status).toBe(401);
    expect((await request(app).delete(SUBS).send({ endpoint: endpointUrl() })).status).toBe(401);
  });

  it('creates a subscription tied to the authenticated user, never returning its keys', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const body = subscriptionBody();
    const res = await subscribe(u.id, body);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ created: true });
    expect(JSON.stringify(res.body)).not.toContain(body.keys.auth);
    expect(await rowsFor(u.id)).toEqual([{ endpoint: body.endpoint, failure_count: 0 }]);
  });

  it('does not create a duplicate when the same device subscribes again', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const body = subscriptionBody();
    expect((await subscribe(u.id, body)).status).toBe(201);
    const again = await subscribe(u.id, {
      ...body,
      keys: { p256dh: 'BRotatedKey', auth: 'rotatedAuth' },
    });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ created: false });
    expect(await rowsFor(u.id)).toHaveLength(1);
    const stored = await db.query<{ p256dh: string }>(
      'select p256dh from public.push_subscriptions where endpoint = $1',
      [body.endpoint],
    );
    expect(stored.rows[0]!.p256dh).toBe('BRotatedKey'); // refreshed, not duplicated
  });

  it('keeps several devices for the same user', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const [a, b, c] = [subscriptionBody(), subscriptionBody(), subscriptionBody()];
    for (const body of [a, b, c]) expect((await subscribe(u.id, body)).status).toBe(201);
    expect((await rowsFor(u.id)).map((r) => r.endpoint).sort()).toEqual(
      [a.endpoint, b.endpoint, c.endpoint].sort(),
    );
  });

  it('moves a device to whoever is signed in on it now (shared device after a sign-out)', async () => {
    const first = await createUser(db, { roles: ['PARENT'] });
    const second = await createUser(db, { roles: ['PARENT'] });
    const body = subscriptionBody();
    await subscribe(first.id, body);
    expect((await subscribe(second.id, body)).status).toBe(200);
    expect(await rowsFor(first.id)).toHaveLength(0);
    expect(await rowsFor(second.id)).toHaveLength(1);
    expect(await countByEndpoint(body.endpoint)).toBe(1);
  });

  it('caps the devices kept per user, dropping the oldest', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    for (let i = 0; i < 12; i++) expect((await subscribe(u.id)).status).toBe(201);
    expect(await rowsFor(u.id)).toHaveLength(10);
  });

  it('rejects malformed subscriptions', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    for (const bad of [
      {},
      { endpoint: 'not a url', keys: { p256dh: 'a', auth: 'b' } },
      { endpoint: 'http://push.example.test/insecure', keys: { p256dh: 'a', auth: 'b' } },
      { endpoint: endpointUrl(), keys: { p256dh: 'a' } },
      { ...subscriptionBody(), extra: 'field' },
    ]) {
      const res = await subscribe(u.id, bad as never);
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    expect(await rowsFor(u.id)).toHaveLength(0);
  });

  it('answers 503 PUSH_NOT_CONFIGURED when the server has no VAPID keys, and stores nothing', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const body = subscriptionBody();
    const res = await subscribe(u.id, body, appWithoutPush);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PUSH_NOT_CONFIGURED');
    expect(await countByEndpoint(body.endpoint)).toBe(0);
  });
});

describe('subscription removal', () => {
  it('removes this device only, and is idempotent', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const [a, b] = [subscriptionBody(), subscriptionBody()];
    await subscribe(u.id, a);
    await subscribe(u.id, b);
    const res = await unsubscribe(u.id, a.endpoint);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: true });
    expect((await rowsFor(u.id)).map((r) => r.endpoint)).toEqual([b.endpoint]);
    expect((await unsubscribe(u.id, a.endpoint)).body.data).toEqual({ removed: false });
  });

  it("never removes another user's subscription", async () => {
    const owner = await createUser(db, { roles: ['PARENT'] });
    const other = await createUser(db, { roles: ['PARENT'] });
    const body = subscriptionBody();
    await subscribe(owner.id, body);
    expect((await unsubscribe(other.id, body.endpoint)).body.data).toEqual({ removed: false });
    expect(await rowsFor(owner.id)).toHaveLength(1);
  });

  it('is deleted together with the user account', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const body = subscriptionBody();
    await subscribe(u.id, body);
    await db.query('delete from public.users where id = $1', [u.id]);
    expect(await countByEndpoint(body.endpoint)).toBe(0);
  });
});

describe('document accepted / rejected (real review flow)', () => {
  it('notifies every device of the family when a document is accepted', async () => {
    const f = await family(freeEvent);
    const [phone, laptop] = [subscriptionBody(), subscriptionBody()];
    await subscribe(f.user.id, phone);
    await subscribe(f.user.id, laptop);
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);
    expect(push.sent).toHaveLength(0); // submitting is not a decision

    expect((await approve(docId)).status).toBe(200);

    for (const device of [phone, laptop]) {
      const got = push.sentTo(device.endpoint);
      expect(got).toHaveLength(1);
      expect(got[0]!.payload).toMatchObject({
        type: 'DOCUMENT_ACCEPTED',
        title: 'Document accepted',
        body: 'Birth certificate was accepted.',
        url: '/dashboard/player',
        tag: `document-${docId}`,
        data: { registrationId: f.regId, documentId: docId },
      });
    }
  });

  it('notifies with the rejection reason when a document is rejected', async () => {
    const f = await family(freeEvent);
    const device = subscriptionBody();
    await subscribe(f.user.id, device);
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);

    expect((await reject(docId, 'The photo is cut off at the edge.')).status).toBe(200);

    const [msg] = push.sentTo(device.endpoint);
    expect(msg!.payload).toMatchObject({
      type: 'DOCUMENT_REJECTED',
      title: 'Document needs attention',
      url: '/dashboard/player',
      data: { registrationId: f.regId, documentId: docId },
    });
    expect(msg!.payload.body).toBe(
      'Birth certificate was rejected: The photo is cut off at the edge.',
    );
  });

  it('shortens a very long rejection reason so it fits in a notification', async () => {
    const f = await family(freeEvent);
    const device = subscriptionBody();
    await subscribe(f.user.id, device);
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);
    await reject(docId, 'x'.repeat(400));
    const body = push.sentTo(device.endpoint)[0]!.payload.body;
    expect(body.length).toBeLessThan(200);
    expect(body.endsWith('…')).toBe(true);
  });

  it('notifies nobody else: another family and the admin get nothing', async () => {
    const f = await family(freeEvent);
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const [strangerDevice, adminDevice] = [subscriptionBody(), subscriptionBody()];
    await subscribe(stranger.id, strangerDevice);
    await subscribe(adminA, adminDevice);
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);
    await approve(docId);
    expect(push.sent).toHaveLength(0);
  });

  it('notifies a coach about their own document, linking to the coach page', async () => {
    const coach = await createUser(db, { roles: ['COACH'] });
    const profile = await as(app, coach.id).post('/api/v1/staff-profiles', {
      profileType: 'COACH',
      firstName: 'Casey',
      lastName: 'Coach',
      email: `${unique('coach')}@example.com`,
      phone: '555-019-2831',
    });
    expect(profile.status, JSON.stringify(profile.body)).toBe(201);
    const reg = await as(app, coach.id).post(R, {
      eventId: freeEvent,
      staffProfileId: profile.body.data.id,
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const device = subscriptionBody();
    await subscribe(coach.id, device);
    const docId = await submitDoc(coach.id, reg.body.data.id, SPECS[0]);

    expect((await approve(docId)).status).toBe(200);

    expect(push.sentTo(device.endpoint)[0]!.payload).toMatchObject({
      type: 'DOCUMENT_ACCEPTED',
      body: 'Profile photo was accepted.',
      url: '/register/coach',
    });
  });

  it('notifies a staff member only, about a rejection, linking to the staff page; a repeat review sends nothing more', async () => {
    const staff = await createUser(db, { roles: ['STAFF'] });
    const other = await createUser(db, { roles: ['STAFF'] });
    const profile = await as(app, staff.id).post('/api/v1/staff-profiles', {
      profileType: 'STAFF',
      staffRole: 'TEAM_MANAGER',
      firstName: 'Sam',
      lastName: 'Staff',
      email: `${unique('staff')}@example.com`,
      phone: '555-019-2831',
    });
    expect(profile.status, JSON.stringify(profile.body)).toBe(201);
    const reg = await as(app, staff.id).post(R, {
      eventId: freeEvent,
      staffProfileId: profile.body.data.id,
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const device = subscriptionBody();
    const otherDevice = subscriptionBody();
    await subscribe(staff.id, device);
    await subscribe(other.id, otherDevice);
    const docId = await submitDoc(staff.id, reg.body.data.id, SPECS[0]);

    expect((await reject(docId, 'The photo is cut off at the edge.')).status).toBe(200);
    expect((await reject(docId)).status).toBe(409); // already reviewed: no second decision, no second notification

    expect(push.sentTo(device.endpoint)).toHaveLength(1);
    expect(push.sentTo(device.endpoint)[0]!.payload).toMatchObject({
      type: 'DOCUMENT_REJECTED',
      url: '/register/staff',
      data: { registrationId: reg.body.data.id, documentId: docId },
    });
    expect(push.sentTo(otherDevice.endpoint)).toHaveLength(0);
  });

  it('does not notify when the review itself fails (already reviewed)', async () => {
    const f = await family(freeEvent);
    await subscribe(f.user.id);
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);
    await approve(docId);
    push.reset();
    expect((await reject(docId)).status).toBe(409);
    expect(push.sent).toHaveLength(0);
  });
});

describe('permission denied / no subscription', () => {
  it('registration, upload and review all work for a user who never enabled notifications', async () => {
    const f = await family(freeEvent); // no subscription at all: what a denied permission leaves behind
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);
    expect((await approve(docId)).status).toBe(200);
    expect(push.sent).toHaveLength(0);
  });

  it('review still succeeds when push is not configured at all', async () => {
    const f = await family(freeEvent);
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);
    const res = await request(appWithoutPush)
      .patch(`${D}/${docId}/review`)
      .set(await bearerFor(adminA))
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(200);
  });
});

describe('event-day access granted (real readiness transitions)', () => {
  async function allDocsSubmitted(f: Family) {
    const ids: string[] = [];
    for (const spec of SPECS) ids.push(await submitDoc(f.user.id, f.regId, spec));
    return ids;
  }

  it('notifies once, when the last approval makes the registration READY_FOR_EVENT', async () => {
    const f = await family(freeEvent);
    const device = subscriptionBody();
    await subscribe(f.user.id, device);
    await acceptConsent(f);
    const ids = await allDocsSubmitted(f);
    for (const id of ids.slice(0, -1)) await approve(id);
    expect(await statusOf(f.regId)).not.toBe('READY_FOR_EVENT');
    expect(push.sent.filter((s) => s.payload.type === 'EVENT_DAY_ACCESS_GRANTED')).toHaveLength(0);

    expect((await approve(ids.at(-1)!)).status).toBe(200);

    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    const access = push
      .sentTo(device.endpoint)
      .filter((s) => s.payload.type === 'EVENT_DAY_ACCESS_GRANTED');
    expect(access).toHaveLength(1);
    expect(access[0]!.payload).toMatchObject({
      title: "You're approved for event day",
      url: '/dashboard/player',
      tag: `event-day-${f.regId}`,
      data: { registrationId: f.regId },
    });
    // The final document also got its own "accepted" notification.
    expect(
      push.sentTo(device.endpoint).filter((s) => s.payload.type === 'DOCUMENT_ACCEPTED'),
    ).toHaveLength(4);

    // Evaluating again changes nothing, so it does not notify again.
    const again = await as(app, f.user.id).post(`${R}/${f.regId}/readiness/evaluate`, {});
    expect(again.status).toBe(200);
    expect(push.sent.filter((s) => s.payload.type === 'EVENT_DAY_ACCESS_GRANTED')).toHaveLength(1);
  });

  it('notifies when a confirmed payment webhook is the step that completes the registration', async () => {
    const f = await family(paidEvent);
    const device = subscriptionBody();
    await subscribe(f.user.id, device);
    await acceptConsent(f);
    for (const id of await allDocsSubmitted(f)) await approve(id);
    expect(await statusOf(f.regId)).not.toBe('READY_FOR_EVENT');
    push.reset();

    const ck = await as(app, f.user.id).post(`${R}/${f.regId}/payment`, {});
    expect(ck.status, JSON.stringify(ck.body)).toBe(201);
    const paymentId = ck.body.data.paymentId as string;
    const sessionId = (
      await db.query<{ stripe_checkout_session_id: string }>(
        'select stripe_checkout_session_id from public.payments where id = $1',
        [paymentId],
      )
    ).rows[0]!.stripe_checkout_session_id;
    const event = stripeEvent(
      'checkout.session.completed',
      sessionObject({ sessionId, paymentId, registrationId: f.regId }),
    );
    expect((await deliver(app, event)).status).toBe(200);

    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    expect(push.sentTo(device.endpoint).map((s) => s.payload.type)).toEqual([
      'EVENT_DAY_ACCESS_GRANTED',
    ]);
    // A redelivered webhook is a duplicate and must not notify again.
    expect((await deliver(app, event)).status).toBe(200);
    expect(push.sentTo(device.endpoint)).toHaveLength(1);
  });

  it('does not notify while the registration is still waiting on something', async () => {
    const f = await family(freeEvent);
    await subscribe(f.user.id);
    const ids = await allDocsSubmitted(f);
    for (const id of ids) await approve(id); // no consent yet
    expect(await statusOf(f.regId)).not.toBe('READY_FOR_EVENT');
    expect(push.sent.filter((s) => s.payload.type === 'EVENT_DAY_ACCESS_GRANTED')).toHaveLength(0);
  });
});

describe('expired, invalid and failing subscriptions', () => {
  it('deletes a subscription the push service reports as gone (410), keeps the others', async () => {
    const f = await family(freeEvent);
    const [dead, alive] = [subscriptionBody(), subscriptionBody()];
    await subscribe(f.user.id, dead);
    await subscribe(f.user.id, alive);
    push.expire(dead.endpoint);
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);

    expect((await approve(docId)).status).toBe(200);

    expect(await countByEndpoint(dead.endpoint)).toBe(0);
    expect(await countByEndpoint(alive.endpoint)).toBe(1);
    expect(push.sentTo(alive.endpoint)).toHaveLength(1);
  });

  it('a push-service outage never fails the business action, and failures are counted', async () => {
    const f = await family(freeEvent);
    const flaky = subscriptionBody();
    const broken = subscriptionBody();
    await subscribe(f.user.id, flaky);
    await subscribe(f.user.id, broken);
    push.fail(flaky.endpoint);
    push.explode(broken.endpoint); // the sender itself throws
    const docId = await submitDoc(f.user.id, f.regId, SPECS[1]);

    const res = await approve(docId);

    expect(res.status).toBe(200);
    expect(res.body.data.review).toMatchObject({ decision: 'APPROVED' });
    const rows = await rowsFor(f.user.id);
    expect(rows.find((r) => r.endpoint === flaky.endpoint)!.failure_count).toBe(1);
    expect(rows.find((r) => r.endpoint === broken.endpoint)).toBeDefined(); // an unexpected error is not counted as expiry
  });

  it('removes a subscription after repeated failures, and a success resets the count', async () => {
    const u = await createUser(db, { roles: ['PARENT'] });
    const device = subscriptionBody();
    await subscribe(u.id, device);
    const repository = createNotificationRepository(db);
    const service = createNotificationService({
      repository,
      sender: push.sender,
      logger: silentLogger(),
      maxConsecutiveFailures: 3,
    });
    // Drive the real service through a registration the user owns.
    const f = await family(freeEvent);
    await db.query('delete from public.push_subscriptions where user_id = $1', [f.user.id]);
    await subscribe(f.user.id, device); // moves the device to the family's account

    push.fail(device.endpoint);
    await service.eventDayAccessGranted(f.regId);
    await service.eventDayAccessGranted(f.regId);
    expect((await rowsFor(f.user.id))[0]!.failure_count).toBe(2);

    push.heal(device.endpoint);
    await service.eventDayAccessGranted(f.regId);
    expect((await rowsFor(f.user.id))[0]!.failure_count).toBe(0);

    push.fail(device.endpoint);
    for (let i = 0; i < 3; i++) await service.eventDayAccessGranted(f.regId);
    expect(await rowsFor(f.user.id)).toHaveLength(0);
  });

  it('never throws, even when the database lookup fails', async () => {
    const service = createNotificationService({
      repository: {
        ...createNotificationRepository(db),
        recipientsForRegistration: () => Promise.reject(new Error('db down')),
      },
      sender: push.sender,
      logger: silentLogger(),
    });
    await expect(
      service.eventDayAccessGranted('00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined();
    await expect(
      service.documentReviewed({
        registrationId: '00000000-0000-4000-8000-000000000000',
        documentId: '00000000-0000-4000-8000-000000000001',
        documentType: 'BIRTH_CERTIFICATE',
        decision: 'APPROVED',
        reason: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('lets the wording be configured per notification type', async () => {
    const f = await family(freeEvent);
    const device = subscriptionBody();
    await subscribe(f.user.id, device);
    const service = createNotificationService({
      repository: createNotificationRepository(db),
      sender: push.sender,
      logger: silentLogger(),
      templates: {
        EVENT_DAY_ACCESS_GRANTED: () => ({ title: 'Custom', body: 'Custom body', url: '/custom' }),
      },
    });
    await service.eventDayAccessGranted(f.regId);
    expect(push.sentTo(device.endpoint)[0]!.payload).toMatchObject({
      type: 'EVENT_DAY_ACCESS_GRANTED',
      title: 'Custom',
      url: '/custom',
    });
  });
});
