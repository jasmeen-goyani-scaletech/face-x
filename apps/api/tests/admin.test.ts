import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/infrastructure/database/database';
import { migrateUp } from '../src/infrastructure/database/migrate';
import {
  createFakePayments,
  deliver,
  sessionObject,
  stripeEvent,
  type FakePayments,
} from './helpers/fake-payments';
import { createFakeStorage, fileBytes, type FakeStorage } from './helpers/fake-storage';
import { as, childBody, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser } from './helpers/test-app';

/**
 * Admin review endpoints against the real Express app and real PostgreSQL, driven through the real family-side
 * document, consent and payment APIs (storage and Stripe are the usual in-memory fakes at their boundaries). Private
 * database: consent wording is global, and the counts below should not depend on other test files.
 */
let db: Database;
let storage: FakeStorage;
let stripe: FakePayments;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let eventA: string;
let eventA2: string;
let teamA: string;
let teamA2: string;
let adminA: string;
let adminB: string;
const dbName = `facex_admin_${Date.now()}`;

const R = '/api/v1/registrations';
const D = '/api/v1/documents';
const ADMIN = '/api/v1/admin';

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
  stripe = createFakePayments();
  app = buildApi(db, { storage, payments: stripe.provider });
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  eventA = await createEvent(db, orgA, { feeCents: 9500 });
  eventA2 = await createEvent(db, orgA, { feeCents: 9500 });
  teamA = await createTeam(db, eventA);
  teamA2 = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
  await db.query(
    `insert into public.consents (code, version, title, body, effective_at)
     values ('GUARDIAN_CONSENT', 1, 'Test guardian consent', '[TEST CONSENT TEXT - not legal wording]', now() - interval '1 day')`,
  );
});
afterAll(async () => {
  await db.close();
  const admin = new Client({ connectionString: inject('adminDatabaseUrl') });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

interface Family {
  user: { id: string };
  playerId: string;
  regId: string;
}

/** A minor registered for `event`, DRAFT unless `submit` is true. */
async function family(
  options: { event?: string; team?: string; submit?: boolean; first?: string; last?: string } = {},
): Promise<Family> {
  const user = await createUser(db, { roles: ['PARENT'] });
  const p = await as(app, user.id).post(
    '/api/v1/players',
    childBody({ firstName: options.first ?? 'Mateo', lastName: options.last ?? 'Rivera' }),
  );
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const playerId = p.body.data.id as string;
  const reg = await as(app, user.id).post(R, {
    eventId: options.event ?? eventA,
    playerId,
    teamId: options.team ?? teamA,
  });
  const regId = reg.body.data.id as string;
  if (options.submit !== false) {
    expect((await as(app, user.id).post(`${R}/${regId}/submit`)).status).toBe(200);
  }
  return { user, playerId, regId };
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
type Spec = (typeof SPECS)[number];

/** request upload -> "browser PUT" -> complete (-> submit). Returns the document id. */
async function uploadDoc(f: Family, spec: Spec, submit = true) {
  const bytes = spec.bytes();
  const up = await as(app, f.user.id).post(`${R}/${f.regId}/documents/upload-url`, {
    documentType: spec.documentType,
    fileName: `${spec.documentType.toLowerCase()}.bin`,
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
  expect((await as(app, f.user.id).post(`${D}/${id}/complete`)).status).toBe(200);
  if (submit) expect((await as(app, f.user.id).post(`${D}/${id}/submit`)).status).toBe(200);
  return id;
}
const submitAll = async (f: Family): Promise<[string, string, string, string]> => [
  await uploadDoc(f, SPECS[0]),
  await uploadDoc(f, SPECS[1]),
  await uploadDoc(f, SPECS[2]),
  await uploadDoc(f, SPECS[3]),
];

const reviewDoc = (admin: string, id: string, decision: 'APPROVED' | 'REJECTED') =>
  as(app, admin).patch(
    `${D}/${id}/review`,
    decision === 'APPROVED'
      ? { decision }
      : { decision, reasonCode: 'UNREADABLE', reason: 'Too blurry to read.' },
  );

async function payFully(f: Family) {
  const ck = await as(app, f.user.id).post(`${R}/${f.regId}/payment`, {});
  expect(ck.status, JSON.stringify(ck.body)).toBe(201);
  const paymentId = ck.body.data.paymentId as string;
  const sessionId = (
    await db.query<{ stripe_checkout_session_id: string }>(
      'select stripe_checkout_session_id from public.payments where id = $1',
      [paymentId],
    )
  ).rows[0]!.stripe_checkout_session_id;
  const ev = stripeEvent(
    'checkout.session.completed',
    sessionObject({ sessionId, paymentId, registrationId: f.regId }),
  );
  expect((await deliver(app, ev)).status).toBe(200);
}

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

const list = (admin: string, event: string, qs = '') =>
  as(app, admin).get(`${ADMIN}/events/${event}/registrations${qs}`);
const rowsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items;

describe('authentication and authorization', () => {
  const anyId = '00000000-0000-4000-8000-0000000000ff';
  it.each([
    ['get', (e: string) => `${ADMIN}/events/${e}/summary`],
    ['get', (e: string) => `${ADMIN}/events/${e}/registrations`],
    ['get', (e: string) => `${ADMIN}/events/${e}/review-queue`],
    ['post', () => `${ADMIN}/registrations/${anyId}/reject`],
  ] as const)('%s %#: needs a signed-in user', async (method, path) => {
    expect((await request(app)[method](path(eventA))).status).toBe(401);
  });

  it.each([
    ['summary', (e: string) => `/events/${e}/summary`],
    ['registrations', (e: string) => `/events/${e}/registrations`],
    ['review-queue', (e: string) => `/events/${e}/review-queue`],
  ])(
    '%s: refused to a family, to an admin of another organization, and to a user with no role',
    async (_n, path) => {
      const parent = await createUser(db, { roles: ['PARENT'] });
      const nobody = await createUser(db);
      for (const who of [parent.id, adminB, nobody.id]) {
        const res = await as(app, who).get(`${ADMIN}${path(eventA)}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EVENT_ACCESS_DENIED');
      }
      expect((await as(app, adminA).get(`${ADMIN}${path(eventA)}`)).status).toBe(200);
    },
  );

  it('answers 404 for an unknown event and 422 for a malformed id', async () => {
    expect(
      (await as(app, adminA).get(`${ADMIN}/events/00000000-0000-4000-8000-0000000000ee/summary`))
        .status,
    ).toBe(404);
    expect((await as(app, adminA).get(`${ADMIN}/events/nope/summary`)).status).toBe(422);
  });

  it('reject: family -> 403 INSUFFICIENT_ROLE; admin of another organization -> 404 (existence not revealed)', async () => {
    const f = await family();
    const asParent = await as(app, f.user.id).post(`${ADMIN}/registrations/${f.regId}/reject`, {
      reason: 'No.',
    });
    expect(asParent.status).toBe(403);
    expect(asParent.body.error.code).toBe('INSUFFICIENT_ROLE');
    const asOther = await as(app, adminB).post(`${ADMIN}/registrations/${f.regId}/reject`, {
      reason: 'No.',
    });
    expect(asOther.status).toBe(404);
    expect(asOther.body.error.code).toBe('REGISTRATION_NOT_FOUND');
    expect(await statusOf(f.regId)).toBe('SUBMITTED');
  });
});

describe('GET /admin/events/:eventId/registrations', () => {
  it('lists submitted registrations with player, team, payment and document counts; hides drafts by default', async () => {
    const draft = await family({ submit: false, first: 'Draftie', last: 'Listtest' });
    const sub = await family({ first: 'Subby', last: 'Listtest', team: teamA2 });
    const res = await list(adminA, eventA, '?search=Listtest');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const ids = rowsOf(res).map((r) => r.id);
    expect(ids).toContain(sub.regId);
    expect(ids).not.toContain(draft.regId);
    const row = res.body.data.items.find((r: { id: string }) => r.id === sub.regId);
    expect(row).toMatchObject({
      status: 'SUBMITTED',
      registrationNumber: expect.stringMatching(/^FX-\d{4}-\d{5}$/),
      player: { firstName: 'Subby', lastName: 'Listtest', dateOfBirth: '2014-03-09' },
      team: { id: teamA2 },
      paymentStatus: 'NOT_STARTED',
      documents: { inReview: 0, approved: 0, rejected: 0, notSubmitted: 0 },
      eventAccessDisabled: false,
    });
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 25, total: 1 });
  });

  it('shows drafts only when asked for status=DRAFT', async () => {
    const draft = await family({ submit: false, first: 'Onlydraft', last: 'Drafttest' });
    const res = await list(adminA, eventA, '?status=DRAFT&search=Drafttest');
    expect(rowsOf(res).map((r) => r.id)).toEqual([draft.regId]);
  });

  it('filters by team, searches name (case-insensitive, partial) and registration number', async () => {
    const a = await family({ first: 'Zelda', last: 'Filterson', team: teamA });
    const b = await family({ first: 'Zeke', last: 'Filterson', team: teamA2 });
    expect(
      rowsOf(await list(adminA, eventA, `?search=filterson&teamId=${teamA2}`)).map((r) => r.id),
    ).toEqual([b.regId]);
    expect(rowsOf(await list(adminA, eventA, '?search=zEl')).map((r) => r.id)).toEqual([a.regId]);
    const number = (
      await db.query<{ registration_number: string }>(
        'select registration_number from public.registrations where id = $1',
        [a.regId],
      )
    ).rows[0]!.registration_number;
    expect(rowsOf(await list(adminA, eventA, `?search=${number}`)).map((r) => r.id)).toEqual([
      a.regId,
    ]);
  });

  it('treats % and _ in a search literally (no wildcard injection)', async () => {
    await family({ first: 'Wild', last: 'Cardson' });
    expect(rowsOf(await list(adminA, eventA, '?search=%25')).length).toBe(0);
    expect(rowsOf(await list(adminA, eventA, '?search=W_ld')).length).toBe(0);
  });

  it("only returns this event, and never another organization's data", async () => {
    const other = await family({
      event: eventA2,
      team: await createTeam(db, eventA2),
      first: 'Elsewhere',
      last: 'Otherevent',
    });
    expect(rowsOf(await list(adminA, eventA, '?search=Otherevent')).length).toBe(0);
    expect(rowsOf(await list(adminA, eventA2, '?search=Otherevent')).map((r) => r.id)).toEqual([
      other.regId,
    ]);
    expect((await list(adminB, eventA2)).status).toBe(403);
  });

  it('paginates with a stable order and an accurate total', async () => {
    for (let i = 0; i < 3; i++) await family({ first: `Page${i}`, last: 'Pagetest' });
    const p1 = await list(adminA, eventA, '?search=Pagetest&pageSize=2&page=1');
    const p2 = await list(adminA, eventA, '?search=Pagetest&pageSize=2&page=2');
    const p3 = await list(adminA, eventA, '?search=Pagetest&pageSize=2&page=3');
    expect(p1.body.data).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(rowsOf(p1)).toHaveLength(2);
    expect(rowsOf(p2)).toHaveLength(1);
    expect(rowsOf(p3)).toHaveLength(0);
    const all = [...rowsOf(p1), ...rowsOf(p2)].map((r) => r.id);
    expect(new Set(all).size).toBe(3);
  });

  it('rejects bad paging and unknown filters with 422', async () => {
    for (const qs of [
      '?page=0',
      '?pageSize=101',
      '?pageSize=abc',
      '?status=NOPE',
      '?teamId=x',
      '?bogus=1',
      '?search=',
    ]) {
      const res = await list(adminA, eventA, qs);
      expect(res.status, qs).toBe(422);
    }
  });

  it('counts documents by their NEWEST version per type, and reports payment (PAID wins)', async () => {
    const f = await family({ first: 'Counta', last: 'Doctest' });
    const [photo, birth, transcript] = [
      await uploadDoc(f, SPECS[0]),
      await uploadDoc(f, SPECS[1]),
      await uploadDoc(f, SPECS[2]),
    ];
    await uploadDoc(f, SPECS[3], false); // uploaded, never submitted
    expect((await reviewDoc(adminA, photo, 'APPROVED')).status).toBe(200);
    expect((await reviewDoc(adminA, birth, 'REJECTED')).status).toBe(200);
    // Replace the rejected birth certificate: the old rejection must no longer count, the new file is in review.
    const replaced = await uploadDoc(f, SPECS[1]);
    expect(replaced).toBeTruthy();
    const row = (await list(adminA, eventA, '?search=Doctest')).body.data.items[0];
    expect(row.documents).toEqual({ inReview: 2, approved: 1, rejected: 0, notSubmitted: 1 });
    expect(transcript).toBeTruthy();

    await payFully(f);
    const paid = (await list(adminA, eventA, '?search=Doctest')).body.data.items[0];
    expect(paid.paymentStatus).toBe('PAID');
  });

  it('documentsPending=true keeps only registrations with documents waiting for review', async () => {
    const waiting = await family({ first: 'Waiting', last: 'Pendtest' });
    await uploadDoc(waiting, SPECS[0]);
    await family({ first: 'Idle', last: 'Pendtest' });
    const res = await list(adminA, eventA, '?search=Pendtest&documentsPending=true');
    expect(rowsOf(res).map((r) => r.id)).toEqual([waiting.regId]);
    expect(rowsOf(await list(adminA, eventA, '?search=Pendtest')).length).toBe(2);
  });
});

describe('GET /admin/events/:eventId/review-queue', () => {
  it('lists submitted, undecided documents oldest first with who and what, and nothing else', async () => {
    const f = await family({ first: 'Queued', last: 'Queuetest' });
    const first = await uploadDoc(f, SPECS[1]);
    const second = await uploadDoc(f, SPECS[2]);
    const decided = await uploadDoc(f, SPECS[0]);
    await reviewDoc(adminA, decided, 'APPROVED');
    await uploadDoc(f, SPECS[3], false); // not submitted: not in the queue

    const res = await as(app, adminA).get(`${ADMIN}/events/${eventA}/review-queue?pageSize=100`);
    expect(res.status).toBe(200);
    const mine = (res.body.data.items as { documentId: string; submittedAt: string }[]).filter(
      (i) => [first, second, decided].includes(i.documentId),
    );
    expect(mine.map((i) => i.documentId)).toEqual([first, second]);
    expect(mine[0]).toMatchObject({
      documentType: 'BIRTH_CERTIFICATE',
      registration: { id: f.regId, status: expect.any(String) },
      player: { firstName: 'Queued', lastName: 'Queuetest' },
      team: { id: teamA },
    });
    expect(mine[0]).not.toHaveProperty('storageKey');
    expect(JSON.stringify(res.body)).not.toMatch(/registration-documents\/|player-images\//);
    const times = (res.body.data.items as { submittedAt: string }[]).map((i) => i.submittedAt);
    expect([...times].sort()).toEqual(times);
  });

  it('drops documents of a rejected registration, and other events', async () => {
    const f = await family({ first: 'Gone', last: 'Queuegone' });
    const doc = await uploadDoc(f, SPECS[1]);
    const other = await family({
      event: eventA2,
      team: await createTeam(db, eventA2),
      first: 'Away',
      last: 'Queueaway',
    });
    const otherDoc = await uploadDoc(other, SPECS[1]);
    const before = (
      await as(app, adminA).get(`${ADMIN}/events/${eventA}/review-queue?pageSize=100`)
    ).body.data.items.map((i: { documentId: string }) => i.documentId);
    expect(before).toContain(doc);
    expect(before).not.toContain(otherDoc);
    expect(
      (
        await as(app, adminA).post(`${ADMIN}/registrations/${f.regId}/reject`, {
          reason: 'Not eligible.',
        })
      ).status,
    ).toBe(200);
    const after = (
      await as(app, adminA).get(`${ADMIN}/events/${eventA}/review-queue?pageSize=100`)
    ).body.data.items.map((i: { documentId: string }) => i.documentId);
    expect(after).not.toContain(doc);
  });

  it('paginates with an accurate total and rejects bad paging', async () => {
    const res = await as(app, adminA).get(
      `${ADMIN}/events/${eventA}/review-queue?pageSize=1&page=1`,
    );
    expect(res.body.data.pageSize).toBe(1);
    expect(res.body.data.items.length).toBeLessThanOrEqual(1);
    expect(res.body.data.total).toBeGreaterThanOrEqual(res.body.data.items.length);
    expect(
      (await as(app, adminA).get(`${ADMIN}/events/${eventA}/review-queue?page=0`)).status,
    ).toBe(422);
    expect((await as(app, adminA).get(`${ADMIN}/events/${eventA}/review-queue?x=1`)).status).toBe(
      422,
    );
  });
});

describe('GET /admin/events/:eventId/summary', () => {
  it('counts registrations by status (all statuses present), documents awaiting review and payments for the event only', async () => {
    // A fresh event so the numbers are exact.
    const ev = await createEvent(db, orgA, { feeCents: 9500 });
    const team = await createTeam(db, ev);
    const empty = await as(app, adminA).get(`${ADMIN}/events/${ev}/summary`);
    expect(empty.status).toBe(200);
    expect(empty.body.data.eventId).toBe(ev);
    expect(Object.keys(empty.body.data.registrationsByStatus).sort()).toEqual([
      'CANCELLED',
      'DOCUMENT_REVIEW',
      'DRAFT',
      'PAYMENT_COMPLETED',
      'PAYMENT_PENDING',
      'READY_FOR_EVENT',
      'REJECTED',
      'SUBMITTED',
      'VERIFIED',
    ]);
    expect(Object.values(empty.body.data.registrationsByStatus).every((n) => n === 0)).toBe(true);

    await family({ event: ev, team, submit: false });
    const a = await family({ event: ev, team });
    const b = await family({ event: ev, team });
    await uploadDoc(a, SPECS[0]);
    await uploadDoc(a, SPECS[1]);
    await payFully(b);
    expect(
      (await as(app, adminA).post(`${ADMIN}/registrations/${a.regId}/reject`, { reason: 'x' }))
        .status,
    ).toBe(200);
    const c = await family({ event: ev, team });
    await uploadDoc(c, SPECS[1]);

    const res = await as(app, adminA).get(`${ADMIN}/events/${ev}/summary`);
    expect(res.body.data.registrationsByStatus).toMatchObject({
      DRAFT: 1,
      SUBMITTED: 1,
      PAYMENT_COMPLETED: 1,
      REJECTED: 1,
    });
    // a's documents no longer count (rejected registration); only c's birth certificate waits.
    expect(res.body.data.documentsAwaitingReview).toBe(1);
    expect(res.body.data.payments).toEqual({
      paidCount: 1,
      paidAmountCents: 9500,
      refundedCount: 0,
    });
    expect(res.body.data.eventAccessDisabled).toBe(0);
  });
});

describe('POST /admin/registrations/:id/reject', () => {
  it('rejects a SUBMITTED registration: status, history with reason and actor, audit entry, family can read the reason', async () => {
    const f = await family({ first: 'Rejecto', last: 'Rejecttest' });
    const res = await as(app, adminA).post(`${ADMIN}/registrations/${f.regId}/reject`, {
      reason: '  Player is outside the age group.  ',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: f.regId,
      status: 'REJECTED',
      registrationNumber: expect.stringMatching(/^FX-/),
    });
    expect(await statusOf(f.regId)).toBe('REJECTED');

    const history = (
      await db.query(
        `select from_status, to_status, changed_by, reason from public.registration_status_history
          where registration_id = $1 order by created_at desc, id desc limit 1`,
        [f.regId],
      )
    ).rows[0];
    expect(history).toEqual({
      from_status: 'SUBMITTED',
      to_status: 'REJECTED',
      changed_by: adminA,
      reason: 'Player is outside the age group.',
    });
    const audit = (
      await db.query(
        `select action, actor_user_id, metadata from public.audit_logs where entity_id = $1 and action = 'REGISTRATION_REJECTED'`,
        [f.regId],
      )
    ).rows;
    expect(audit).toEqual([
      { action: 'REGISTRATION_REJECTED', actor_user_id: adminA, metadata: { from: 'SUBMITTED' } },
    ]);

    const seen = await as(app, f.user.id).get(`${R}/${f.regId}/status`);
    expect(seen.body.data.status).toBe('REJECTED');
    expect(seen.body.data.history.at(-1)).toMatchObject({
      from: 'SUBMITTED',
      to: 'REJECTED',
      reason: 'Player is outside the age group.',
    });
  });

  it('is final: a second rejection, a DRAFT, and a status the workflow does not allow all answer 409', async () => {
    const f = await family({ first: 'Twice', last: 'Rejecttest' });
    const url = `${ADMIN}/registrations/${f.regId}/reject`;
    expect((await as(app, adminA).post(url, { reason: 'First.' })).status).toBe(200);
    const again = await as(app, adminA).post(url, { reason: 'Second.' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const draft = await family({ submit: false });
    const d = await as(app, adminA).post(`${ADMIN}/registrations/${draft.regId}/reject`, {
      reason: 'Nope.',
    });
    expect(d.status).toBe(409);
    expect(await statusOf(draft.regId)).toBe('DRAFT');

    const paid = await family({ first: 'Paid', last: 'Rejecttest' });
    await payFully(paid); // PAYMENT_COMPLETED: the status table has no edge to REJECTED
    const p = await as(app, adminA).post(`${ADMIN}/registrations/${paid.regId}/reject`, {
      reason: 'Nope.',
    });
    expect(p.status).toBe(409);
    expect(await statusOf(paid.regId)).toBe('PAYMENT_COMPLETED');
  });

  it('requires a reason (422), rejects unknown fields, and answers 404 for an unknown registration', async () => {
    const f = await family();
    const url = `${ADMIN}/registrations/${f.regId}/reject`;
    for (const body of [
      {},
      { reason: '' },
      { reason: '   ' },
      { reason: 'x'.repeat(501) },
      { reason: 'ok', status: 'CANCELLED' },
    ]) {
      expect((await as(app, adminA).post(url, body)).status).toBe(422);
    }
    expect(await statusOf(f.regId)).toBe('SUBMITTED');
    expect(
      (
        await as(app, adminA).post(
          `${ADMIN}/registrations/00000000-0000-4000-8000-0000000000dd/reject`,
          { reason: 'x' },
        )
      ).status,
    ).toBe(404);
    expect(
      (await as(app, adminA).post(`${ADMIN}/registrations/nope/reject`, { reason: 'x' })).status,
    ).toBe(422);
  });

  it('freezes the registration: documents can no longer be reviewed or replaced, and readiness never revives it', async () => {
    const f = await family({ first: 'Frozen', last: 'Rejecttest' });
    const doc = await uploadDoc(f, SPECS[1]);
    expect(
      (await as(app, adminA).post(`${ADMIN}/registrations/${f.regId}/reject`, { reason: 'No.' }))
        .status,
    ).toBe(200);
    expect((await reviewDoc(adminA, doc, 'APPROVED')).status).toBe(409);
    const reupload = await as(app, f.user.id).post(`${R}/${f.regId}/documents/upload-url`, {
      documentType: 'SCHOOL_TRANSCRIPT',
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2000,
    });
    expect(reupload.status).toBe(409);
    await as(app, f.user.id).post(`${R}/${f.regId}/readiness/evaluate`, {});
    expect(await statusOf(f.regId)).toBe('REJECTED');
  });
});

describe('the whole review loop, through the real APIs', () => {
  it('submit -> admin queue -> reject one document -> family replaces it -> admin approves all -> READY_FOR_EVENT', async () => {
    const f = await family({ first: 'Loop', last: 'Looptest' });
    await acceptConsent(f);
    await payFully(f);
    const ids = await submitAll(f);

    // The admin finds it in both the queue and the list.
    const queue = (await as(app, adminA).get(`${ADMIN}/events/${eventA}/review-queue?pageSize=100`))
      .body.data.items;
    expect(
      queue.filter((i: { registration: { id: string } }) => i.registration.id === f.regId),
    ).toHaveLength(4);
    expect(
      rowsOf(await list(adminA, eventA, '?search=Looptest&documentsPending=true')).map((r) => r.id),
    ).toEqual([f.regId]);
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW');

    // The admin can open the file (signed download URL, issued to an admin).
    const dl = await as(app, adminA).get(`${D}/${ids[1]}/download-url`);
    expect(dl.status).toBe(200);
    expect(dl.body.data.url).toMatch(/^https:\/\/storage\.test\//);

    // Reject the birth certificate with a reason; approve the rest.
    expect((await reviewDoc(adminA, ids[1], 'REJECTED')).status).toBe(200);
    for (const id of [ids[0], ids[2], ids[3]])
      expect((await reviewDoc(adminA, id, 'APPROVED')).status).toBe(200);
    let row = (await list(adminA, eventA, '?search=Looptest')).body.data.items[0];
    expect(row.documents).toEqual({ inReview: 0, approved: 3, rejected: 1, notSubmitted: 0 });
    expect(row.status).toBe('DOCUMENT_REVIEW');

    // The family sees the reason and replaces the file.
    const mine = await as(app, f.user.id).get(`${R}/${f.regId}/documents`);
    const rejectedDoc = mine.body.data.documents.find((d: { id: string }) => d.id === ids[1]);
    expect(rejectedDoc).toMatchObject({
      state: 'REJECTED',
      review: { reasonCode: 'UNREADABLE', reason: 'Too blurry to read.' },
    });
    const replacement = await uploadDoc(f, SPECS[1]);

    row = (await list(adminA, eventA, '?search=Looptest')).body.data.items[0];
    expect(row.documents).toEqual({ inReview: 1, approved: 3, rejected: 0, notSubmitted: 0 });
    expect((await reviewDoc(adminA, replacement, 'APPROVED')).status).toBe(200);

    // Everything approved + paid + consent => ready, without any further manual step.
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    row = (await list(adminA, eventA, '?search=Looptest')).body.data.items[0];
    expect(row).toMatchObject({
      status: 'READY_FOR_EVENT',
      paymentStatus: 'PAID',
      documents: { approved: 4 },
    });
    const summary = (await as(app, adminA).get(`${ADMIN}/events/${eventA}/summary`)).body.data;
    expect(summary.registrationsByStatus.READY_FOR_EVENT).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /admin/events', () => {
  it("lists the organization's events in every status, newest first, and nobody else's", async () => {
    const own = await createOrg(db);
    const owner = (await createUser(db, { roles: ['ADMIN'], organizationId: own })).id;
    const early = await createEvent(db, own, {
      status: 'CLOSED',
      startsAt: new Date(Date.now() + 5 * 86_400_000),
    });
    const late = await createEvent(db, own, {
      status: 'DRAFT',
      startsAt: new Date(Date.now() + 50 * 86_400_000),
    });
    const live = await createEvent(db, own, {
      status: 'PUBLISHED',
      startsAt: new Date(Date.now() + 20 * 86_400_000),
    });
    await createEvent(db, orgB, { status: 'PUBLISHED' }); // another organization's event

    const res = await as(app, owner).get(`${ADMIN}/events`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.map((e: { id: string }) => e.id)).toEqual([late, live, early]);
    expect(res.body.data.map((e: { status: string }) => e.status)).toEqual([
      'DRAFT',
      'PUBLISHED',
      'CLOSED',
    ]);
    expect(res.body.data[0]).toMatchObject({
      name: 'Event',
      location: 'Field',
      timezone: 'America/Los_Angeles',
      startsAt: expect.any(String),
      endsAt: expect.any(String),
    });
    expect(res.body.data[0]).not.toHaveProperty('organizationId');
  });

  it('is for admins only; an admin with no organization sees an empty list', async () => {
    expect((await request(app).get(`${ADMIN}/events`)).status).toBe(401);
    const parent = await createUser(db, { roles: ['PARENT'] });
    const denied = await as(app, parent.id).get(`${ADMIN}/events`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('INSUFFICIENT_ROLE');
    const orphan = await createUser(db, { roles: ['ADMIN'] });
    expect((await as(app, orphan.id).get(`${ADMIN}/events`)).body.data).toEqual([]);
  });
});

describe('what the admin screens read from the registration endpoints', () => {
  it('registration detail carries eventAccessDisabled, and an admin of the event can read it', async () => {
    const f = await family({ first: 'Access', last: 'Flagtest' });
    const before = await as(app, adminA).get(`${R}/${f.regId}`);
    expect(before.status).toBe(200);
    expect(before.body.data.eventAccessDisabled).toBe(false);
    await db.query('update public.registrations set event_access_disabled = true where id = $1', [
      f.regId,
    ]);
    expect((await as(app, adminA).get(`${R}/${f.regId}`)).body.data.eventAccessDisabled).toBe(true);
    expect((await as(app, adminB).get(`${R}/${f.regId}`)).status).toBe(404);
  });

  it('status history says who acted: the family, the system, or staff', async () => {
    const f = await family({ first: 'Actor', last: 'Historytest' });
    await payFully(f); // system step (webhook)
    expect(
      (await as(app, adminA).post(`${ADMIN}/registrations/${f.regId}/reject`, { reason: 'x' }))
        .status,
    ).toBe(409); // paid: workflow forbids it
    const g = await family({ first: 'Actor2', last: 'Historytest' });
    expect(
      (
        await as(app, adminA).post(`${ADMIN}/registrations/${g.regId}/reject`, {
          reason: 'Because.',
        })
      ).status,
    ).toBe(200);

    const paid = (await as(app, adminA).get(`${R}/${f.regId}/status`)).body.data.history as {
      to: string;
      actor: string;
    }[];
    expect(paid.map((h) => `${h.to}:${h.actor}`)).toEqual([
      'DRAFT:FAMILY',
      'SUBMITTED:FAMILY',
      'PAYMENT_PENDING:FAMILY',
      'PAYMENT_COMPLETED:SYSTEM',
    ]);
    const rejected = (await as(app, adminA).get(`${R}/${g.regId}/status`)).body.data.history as {
      to: string;
      actor: string;
    }[];
    expect(rejected.at(-1)).toMatchObject({ to: 'REJECTED', actor: 'STAFF' });
  });
});

describe('PATCH /admin/registrations/:id/event-access', () => {
  const url = (id: string) => `${ADMIN}/registrations/${id}/event-access`;
  const flagOf = async (regId: string) =>
    (
      await db.query<{ d: boolean; r: string | null }>(
        'select event_access_disabled as d, event_access_disabled_reason as r from public.registrations where id = $1',
        [regId],
      )
    ).rows[0]!;
  const auditCount = async (action: string, regId: string) =>
    (
      await db.query('select 1 from public.audit_logs where action = $1 and entity_id = $2', [
        action,
        regId,
      ])
    ).rowCount;

  /** Paid, consented, all four documents approved: READY_FOR_EVENT. */
  async function ready(first: string) {
    const f = await family({ first, last: 'Accesstest' });
    await acceptConsent(f);
    await payFully(f);
    for (const id of await submitAll(f)) {
      expect((await reviewDoc(adminA, id, 'APPROVED')).status).toBe(200);
    }
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    return f;
  }

  it("needs an admin of the registration's own organization (401 / 403 / 404 / 422)", async () => {
    const f = await family({ first: 'Authz', last: 'Accesstest' });
    expect((await request(app).patch(url(f.regId)).send({ disabled: true })).status).toBe(401);
    const asParent = await as(app, f.user.id).patch(url(f.regId), { disabled: true });
    expect(asParent.status).toBe(403);
    expect(asParent.body.error.code).toBe('INSUFFICIENT_ROLE');
    const other = await as(app, adminB).patch(url(f.regId), { disabled: true });
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('REGISTRATION_NOT_FOUND');
    const unknown = url('00000000-0000-4000-8000-0000000000cc');
    expect((await as(app, adminA).patch(unknown, { disabled: true })).status).toBe(404);
    expect((await as(app, adminA).patch(url('nope'), { disabled: true })).status).toBe(422);
    expect((await flagOf(f.regId)).d).toBe(false);
  });

  it('disables with an optional reason: stored, audited, and visible in the list, summary and registration detail', async () => {
    const f = await family({ first: 'Switchoff', last: 'Accesstest' });
    const res = await as(app, adminA).patch(url(f.regId), {
      disabled: true,
      reason: '  Parent asked us to hold the spot.  ',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({
      id: f.regId,
      registrationNumber: expect.stringMatching(/^FX-/),
      eventAccessDisabled: true,
      eventAccessDisabledReason: 'Parent asked us to hold the spot.',
    });
    expect(await flagOf(f.regId)).toEqual({ d: true, r: 'Parent asked us to hold the spot.' });
    const audit = (
      await db.query(
        `select actor_user_id, metadata from public.audit_logs where action = 'EVENT_ACCESS_DISABLED' and entity_id = $1`,
        [f.regId],
      )
    ).rows;
    expect(audit).toEqual([{ actor_user_id: adminA, metadata: { hadReason: true } }]);
    // The reason is an admin note: it is not copied into the audit metadata, and the family's own view carries none.
    expect(JSON.stringify(audit)).not.toContain('hold the spot');
    const detail = await as(app, f.user.id).get(`${R}/${f.regId}`);
    expect(detail.body.data.eventAccessDisabled).toBe(true);
    expect(JSON.stringify(detail.body)).not.toContain('hold the spot');
    const row = (await list(adminA, eventA, '?search=Switchoff')).body.data.items[0];
    expect(row.eventAccessDisabled).toBe(true);
    const summary = await as(app, adminA).get(`${ADMIN}/events/${eventA}/summary`);
    expect(summary.body.data.eventAccessDisabled).toBeGreaterThanOrEqual(1);
  });

  it('works without a reason and does not change the registration status', async () => {
    const f = await family({ first: 'Noreason', last: 'Accesstest' });
    const before = await statusOf(f.regId);
    const res = await as(app, adminA).patch(url(f.regId), { disabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      eventAccessDisabled: true,
      eventAccessDisabledReason: null,
    });
    expect(await statusOf(f.regId)).toBe(before);
    expect(await auditCount('EVENT_ACCESS_DISABLED', f.regId)).toBe(1);
  });

  it('is idempotent: repeating a setting changes and audits nothing, and never wipes a saved reason', async () => {
    const f = await family({ first: 'Repeat', last: 'Accesstest' });
    await as(app, adminA).patch(url(f.regId), { disabled: true, reason: 'First reason.' });
    const again = await as(app, adminA).patch(url(f.regId), { disabled: true });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({
      eventAccessDisabled: true,
      eventAccessDisabledReason: 'First reason.',
    });
    expect(await flagOf(f.regId)).toEqual({ d: true, r: 'First reason.' });
    expect(await auditCount('EVENT_ACCESS_DISABLED', f.regId)).toBe(1);
    // A new reason on an already-disabled registration is a real change.
    await as(app, adminA).patch(url(f.regId), { disabled: true, reason: 'Second reason.' });
    expect((await flagOf(f.regId)).r).toBe('Second reason.');
    expect(await auditCount('EVENT_ACCESS_DISABLED', f.regId)).toBe(2);
  });

  it('enables again: flag cleared, reason dropped, audited once; enabling an enabled registration is a no-op', async () => {
    const f = await family({ first: 'Backon', last: 'Accesstest' });
    expect((await as(app, adminA).patch(url(f.regId), { disabled: false })).status).toBe(200);
    expect(await auditCount('EVENT_ACCESS_ENABLED', f.regId)).toBe(0); // already enabled: nothing happened
    await as(app, adminA).patch(url(f.regId), { disabled: true, reason: 'Hold.' });
    const on = await as(app, adminA).patch(url(f.regId), { disabled: false });
    expect(on.body.data).toMatchObject({
      eventAccessDisabled: false,
      eventAccessDisabledReason: null,
    });
    expect(await flagOf(f.regId)).toEqual({ d: false, r: null });
    expect(await auditCount('EVENT_ACCESS_ENABLED', f.regId)).toBe(1);
    expect((await as(app, adminA).patch(url(f.regId), { disabled: false })).status).toBe(200);
    expect(await auditCount('EVENT_ACCESS_ENABLED', f.regId)).toBe(1);
  });

  it('rejects malformed bodies with 422 and changes nothing', async () => {
    const f = await family({ first: 'Badbody', last: 'Accesstest' });
    const bodies: unknown[] = [
      {},
      { disabled: 'yes' },
      { disabled: 1 },
      { disabled: true, reason: '' },
      { disabled: true, reason: '   ' },
      { disabled: true, reason: 'x'.repeat(501) },
      { disabled: false, reason: 'Not allowed when enabling.' },
      { disabled: true, status: 'REJECTED' },
    ];
    for (const body of bodies) {
      expect((await as(app, adminA).patch(url(f.regId), body)).status, JSON.stringify(body)).toBe(
        422,
      );
    }
    expect(await flagOf(f.regId)).toEqual({ d: false, r: null });
    expect(await statusOf(f.regId)).toBe('SUBMITTED');
  });

  it('is what check-in obeys: a ready player is refused at the door while access is off, and checks in once it is on', async () => {
    const f = await ready('Door');
    const checkIn = () =>
      as(app, adminA).post(`/api/v1/events/${eventA}/check-ins`, {
        method: 'MANUAL',
        registrationId: f.regId,
        clientRequestId: randomUUID(),
      });
    const checkIns = async () =>
      (await db.query('select 1 from public.check_ins where registration_id = $1', [f.regId]))
        .rowCount;

    const off = await as(app, adminA).patch(url(f.regId), {
      disabled: true,
      reason: 'Hold at the door.',
    });
    expect(off.status).toBe(200);
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT'); // the workflow position is untouched
    const refused = await checkIn();
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('EVENT_ACCESS_DISABLED');
    expect(await checkIns()).toBe(0);

    expect((await as(app, adminA).patch(url(f.regId), { disabled: false })).status).toBe(200);
    const ok = await checkIn();
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await checkIns()).toBe(1);
  });

  it('switching access ON overrides nothing: an unready player still cannot check in', async () => {
    const f = await family({ first: 'Notready', last: 'Accesstest' }); // submitted only
    await as(app, adminA).patch(url(f.regId), { disabled: true });
    await as(app, adminA).patch(url(f.regId), { disabled: false });
    const res = await as(app, adminA).post(`/api/v1/events/${eventA}/check-ins`, {
      method: 'MANUAL',
      registrationId: f.regId,
      clientRequestId: randomUUID(),
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('REGISTRATION_NOT_READY');
  });
});
