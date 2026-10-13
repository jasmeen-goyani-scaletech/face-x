import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/infrastructure/database/database';
import { migrateUp } from '../src/infrastructure/database/migrate';
import { evaluateReadinessIn } from '../src/modules/readiness/repository';
import {
  createFakePayments,
  deliver,
  sessionObject,
  stripeEvent,
  type FakePayments,
} from './helpers/fake-payments';
import { createFakeStorage, fileBytes, type FakeStorage } from './helpers/fake-storage';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser } from './helpers/test-app';

/**
 * Registration readiness against the real Express app and real PostgreSQL, driven through the real payment,
 * document and consent flows (Stripe and storage are the usual in-memory fakes at their boundaries).
 */
let db: Database;
let storage: FakeStorage;
let stripe: FakePayments;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let paidEvent: string;
let freeEvent: string;
let adminA: string;
let adminB: string;

const R = '/api/v1/registrations';
const D = '/api/v1/documents';

/**
 * These tests own a private, freshly migrated database. Guardian-consent wording is global state (one code, shared by
 * every test file), and the consent tests publish newer versions while the suite runs; sharing it would make "consent
 * accepted at the current version" depend on timing between files.
 */
const dbName = `facex_readiness_${Date.now()}`;

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
  paidEvent = await createEvent(db, orgA, { feeCents: 9500 });
  freeEvent = await createEvent(db, orgA, { feeCents: 0 });
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
  user: { id: string; email: string };
  playerId: string;
  regId: string;
  adult: boolean;
}

/** A SUBMITTED registration: a parent with a minor child, or (adult) a player managing their own registration. */
async function family(options: { event?: string; adult?: boolean } = {}): Promise<Family> {
  const event = options.event ?? paidEvent;
  const team = await createTeam(db, event);
  let user: Family['user'];
  let playerId: string;
  if (options.adult) {
    user = await createUser(db, { roles: ['PLAYER'] });
    const p = await as(app, user.id).post('/api/v1/players', {
      firstName: 'Ann',
      lastName: 'Adult',
      dateOfBirth: '1999-01-01',
      forSelf: true,
    });
    playerId = p.body.data.id;
  } else {
    user = await createUser(db, { roles: ['PARENT'] });
    playerId = await createChild(app, user.id);
  }
  const reg = await as(app, user.id).post(R, { eventId: event, playerId, teamId: team });
  const regId = reg.body.data.id as string;
  expect((await as(app, user.id).post(`${R}/${regId}/submit`)).status).toBe(200);
  return { user, playerId, regId, adult: options.adult === true };
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

/** upload -> "browser PUT" -> complete -> submit for review. Returns the document id. */
async function submitDoc(f: Family, spec: (typeof SPECS)[number]) {
  const bytes = spec.bytes();
  const up = await as(app, f.user.id).post(`${R}/${f.regId}/documents/upload-url`, {
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
  expect((await as(app, f.user.id).post(`${D}/${id}/complete`)).status).toBe(200);
  expect((await as(app, f.user.id).post(`${D}/${id}/submit`)).status).toBe(200);
  return id;
}
const submitAllDocs = async (f: Family) => {
  const ids: string[] = [];
  for (const spec of SPECS) ids.push(await submitDoc(f, spec));
  return ids;
};
const approve = (id: string) =>
  as(app, adminA).patch(`${D}/${id}/review`, { decision: 'APPROVED' });
const reject = (id: string) =>
  as(app, adminA).patch(`${D}/${id}/review`, {
    decision: 'REJECTED',
    reasonCode: 'UNREADABLE',
    reason: 'Too blurry.',
  });
const approveAll = async (ids: string[]) => {
  for (const id of ids) expect((await approve(id)).status).toBe(200);
};

/** checkout -> Stripe webhook "paid". The webhook alone completes the payment. */
async function pay(f: Family) {
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
  return { paymentId, event, deliver: () => deliver(app, event) };
}
const payNow = async (f: Family) => {
  const p = await pay(f);
  expect((await p.deliver()).status).toBe(200);
  return p;
};

async function acceptConsent(f: Family) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const st = await as(app, f.user.id).get(`${R}/${f.regId}/consents`);
    const current = st.body.data.requirements[0].current;
    const res = await as(app, f.user.id).post(`${R}/${f.regId}/consents`, {
      consentId: current.id,
      signedName: 'Dana Rivera',
      accepted: true,
    });
    if (res.status !== 409 || res.body.error.code !== 'CONSENT_VERSION_OUTDATED') {
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return;
    }
  }
  throw new Error('could not accept the current consent');
}

const statusOf = async (regId: string) =>
  (
    await db.query<{ status: string }>('select status from public.registrations where id = $1', [
      regId,
    ])
  ).rows[0]!.status;
const history = async (regId: string) =>
  (
    await db.query<{
      from_status: string | null;
      to_status: string;
      changed_by: string | null;
      reason: string | null;
      metadata: Record<string, unknown>;
    }>(
      'select from_status, to_status, changed_by, reason, metadata from public.registration_status_history where registration_id = $1 order by created_at, id',
      [regId],
    )
  ).rows;
const path = async (regId: string) => (await history(regId)).map((h) => h.to_status);
const readiness = (f: Family, userId = f.user.id) =>
  as(app, userId).get(`${R}/${f.regId}/readiness`);
const evaluate = (f: Family, userId = f.user.id) =>
  as(app, userId).post(`${R}/${f.regId}/readiness/evaluate`, {});
const count = async (sql: string, params: unknown[]) =>
  (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

describe('the full journey, through the real payment, document and consent flows', () => {
  it('advances step by step and ends READY_FOR_EVENT, with every system step recorded', async () => {
    const f = await family();
    expect(await statusOf(f.regId)).toBe('SUBMITTED');
    const start = await readiness(f);
    expect(start.body.data).toMatchObject({
      status: 'SUBMITTED',
      ready: false,
      blockers: ['PAYMENT_NOT_COMPLETED', 'DOCUMENTS_NOT_SUBMITTED', 'CONSENT_NOT_ACCEPTED'],
    });

    await payNow(f);
    expect(await statusOf(f.regId)).toBe('PAYMENT_COMPLETED'); // paid, but documents are still missing

    const ids: string[] = [];
    for (const spec of SPECS.slice(0, 3)) ids.push(await submitDoc(f, spec));
    expect(await statusOf(f.regId)).toBe('PAYMENT_COMPLETED'); // three of four required documents submitted
    ids.push(await submitDoc(f, SPECS[3]));
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW'); // all four submitted for review

    for (const id of ids.slice(0, 3)) await approve(id);
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW'); // one still in review
    await approve(ids[3]!);
    expect(await statusOf(f.regId)).toBe('VERIFIED'); // all approved; guardian consent still missing
    expect((await readiness(f)).body.data).toMatchObject({
      status: 'VERIFIED',
      ready: false,
      blockers: ['CONSENT_NOT_ACCEPTED'],
    });

    await acceptConsent(f);
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    expect((await readiness(f)).body.data).toMatchObject({
      status: 'READY_FOR_EVENT',
      ready: true,
      blockers: [],
      payment: { required: true, satisfied: true },
    });

    expect(await path(f.regId)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
      'DOCUMENT_REVIEW',
      'VERIFIED',
      'READY_FOR_EVENT',
    ]);
    const rows = await history(f.regId);
    for (const system of rows.slice(-3)) {
      expect(system.changed_by).toBeNull();
      expect(system.metadata).toEqual({ actor: 'SYSTEM', source: 'READINESS' });
    }
    expect(rows.slice(-3).map((r) => r.reason)).toEqual([
      'System: all required documents submitted for review',
      'System: all required documents approved',
      'System: payment, documents and consent complete',
    ]);
    expect(rows[3]).toMatchObject({ to_status: 'PAYMENT_COMPLETED', reason: 'Payment confirmed' }); // the webhook's own step, unchanged
    const audit = await db.query(
      'select actor_user_id, metadata from public.audit_logs where entity_id = $1 and action = $2 order by created_at',
      [f.regId, 'REGISTRATION_READINESS_ADVANCED'],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: null,
        metadata: { from: 'PAYMENT_COMPLETED', to: 'DOCUMENT_REVIEW', steps: 1 },
      },
      { actor_user_id: null, metadata: { from: 'DOCUMENT_REVIEW', to: 'VERIFIED', steps: 1 } },
      { actor_user_id: null, metadata: { from: 'VERIFIED', to: 'READY_FOR_EVENT', steps: 1 } },
    ]);
  });

  it('does not depend on the order things happen in: documents and consent first, payment last', async () => {
    const f = await family();
    await approveAll(await submitAllDocs(f));
    await acceptConsent(f);
    expect(await statusOf(f.regId)).toBe('SUBMITTED'); // everything but payment is done, so it waits
    expect((await readiness(f)).body.data.blockers).toEqual(['PAYMENT_NOT_COMPLETED']);

    await payNow(f); // one webhook carries it all the way
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    expect(await path(f.regId)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
      'DOCUMENT_REVIEW',
      'VERIFIED',
      'READY_FOR_EVENT',
    ]);
  });

  it('needs no consent for an adult player', async () => {
    const f = await family({ adult: true });
    await payNow(f);
    await approveAll(await submitAllDocs(f));
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    const consent = await as(app, f.user.id).get(`${R}/${f.regId}/consents`);
    expect(consent.body.data.requirements[0].required).toBe(false);
    expect((await readiness(f)).body.data.consent).toMatchObject({
      satisfied: true,
      requirements: [{ code: 'GUARDIAN_CONSENT', required: false, accepted: false }],
    });
  });

  it('never requires a face profile', async () => {
    const f = await family({ adult: true });
    await payNow(f);
    await approveAll(await submitAllDocs(f));
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    expect(
      await count('select count(*)::int as n from public.face_profiles where player_id = $1', [
        f.playerId,
      ]),
    ).toBe(0);
  });
});

describe('free registrations (fee is zero)', () => {
  it('reach READY_FOR_EVENT without any payment record, using the existing steps', async () => {
    const f = await family({ event: freeEvent });
    expect(await statusOf(f.regId)).toBe('SUBMITTED'); // submitting itself is unchanged
    expect((await as(app, f.user.id).post(`${R}/${f.regId}/payment`, {})).body.error.code).toBe(
      'PAYMENT_NOT_REQUIRED',
    );

    const ids = await submitAllDocs(f); // the first submission already lets the free registration through the payment steps
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW');
    await approveAll(ids);
    expect(await statusOf(f.regId)).toBe('VERIFIED');
    await acceptConsent(f);
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');

    expect(await path(f.regId)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
      'DOCUMENT_REVIEW',
      'VERIFIED',
      'READY_FOR_EVENT',
    ]);
    const free = (await history(f.regId)).filter(
      (h) => h.reason === 'System: no payment required (fee is zero)',
    );
    expect(free.map((h) => h.to_status)).toEqual(['PAYMENT_PENDING', 'PAYMENT_COMPLETED']);
    expect(
      await count('select count(*)::int as n from public.payments where registration_id = $1', [
        f.regId,
      ]),
    ).toBe(0); // nothing is faked
    expect((await readiness(f)).body.data.payment).toEqual({ required: false, satisfied: true });
  });

  it('can also be advanced on demand', async () => {
    const f = await family({ event: freeEvent, adult: true });
    const res = await evaluate(f);
    expect(res.status).toBe(200);
    expect(res.body.data.steps.map((s: { to: string }) => s.to)).toEqual([
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
    ]);
    expect(await statusOf(f.regId)).toBe('PAYMENT_COMPLETED'); // documents are the next requirement
  });
});

describe('what blocks readiness', () => {
  it('unpaid: documents and consent alone are not enough', async () => {
    const f = await family();
    await approveAll(await submitAllDocs(f));
    await acceptConsent(f);
    const res = await evaluate(f);
    expect(res.body.data.steps).toEqual([]);
    expect(await statusOf(f.regId)).toBe('SUBMITTED');
    expect(res.body.data.readiness.blockers).toEqual(['PAYMENT_NOT_COMPLETED']);
  });

  it('a started but unfinished checkout is not payment either', async () => {
    const f = await family();
    await approveAll(await submitAllDocs(f));
    await acceptConsent(f);
    await pay(f); // checkout created, nobody paid
    expect(await statusOf(f.regId)).toBe('PAYMENT_PENDING');
    expect((await evaluate(f)).body.data.steps).toEqual([]);
  });

  it('missing consent stops a verified registration', async () => {
    const f = await family();
    await payNow(f);
    await approveAll(await submitAllDocs(f));
    expect(await statusOf(f.regId)).toBe('VERIFIED');
    expect((await readiness(f)).body.data.blockers).toEqual(['CONSENT_NOT_ACCEPTED']);
  });

  it('documents that are submitted but not approved stop it at DOCUMENT_REVIEW', async () => {
    const f = await family();
    await payNow(f);
    await acceptConsent(f);
    const ids = await submitAllDocs(f);
    await approveAll(ids.slice(0, 3));
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW');
    const r = (await readiness(f)).body.data;
    expect(r.blockers).toEqual(['DOCUMENTS_NOT_APPROVED']);
    expect(r.documents.submitted).toBe(true);
  });

  it('a rejected document does not reject or reverse the registration: it waits, and resumes when replaced and approved', async () => {
    const f = await family();
    await payNow(f);
    await acceptConsent(f);
    const ids = await submitAllDocs(f);
    await approveAll(ids.slice(0, 3));
    expect((await reject(ids[3]!)).status).toBe(200);
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW'); // never REJECTED, never moved back
    expect((await readiness(f)).body.data.blockers).toEqual(['DOCUMENTS_NOT_SUBMITTED']);

    const replacement = await submitDoc(f, SPECS[3]);
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW');
    expect((await approve(replacement)).status).toBe(200);
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
  });

  it('leaves DRAFT, CANCELLED and REJECTED registrations alone, even when everything is satisfied', async () => {
    const draftUser = await createUser(db, { roles: ['PLAYER'] });
    const p = await as(app, draftUser.id).post('/api/v1/players', {
      firstName: 'Dre',
      lastName: 'Draft',
      dateOfBirth: '1999-01-01',
      forSelf: true,
    });
    const reg = await as(app, draftUser.id).post(R, {
      eventId: freeEvent,
      playerId: p.body.data.id,
      teamId: await createTeam(db, freeEvent),
    });
    const draft: Family = {
      user: draftUser,
      playerId: p.body.data.id,
      regId: reg.body.data.id,
      adult: true,
    };
    await approveAll(await submitAllDocs(draft));
    const d = await evaluate(draft);
    expect(d.body.data.steps).toEqual([]);
    expect(await statusOf(draft.regId)).toBe('DRAFT');
    expect(d.body.data.readiness.blockers).toContain('REGISTRATION_NOT_SUBMITTED');

    for (const terminal of ['CANCELLED', 'REJECTED'] as const) {
      const f = await family({ event: freeEvent, adult: true });
      await approveAll(await submitAllDocs(f));
      expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT'); // adult + free: nothing else is required
      await db.query('update public.registrations set status = $2 where id = $1', [
        f.regId,
        terminal,
      ]);
      expect((await evaluate(f)).body.data.steps).toEqual([]);
      expect(await statusOf(f.regId)).toBe(terminal);
      expect((await readiness(f)).body.data.blockers).toEqual([`REGISTRATION_${terminal}`]);
    }
  });

  it('never moves backward: a ready registration stays ready but reports a requirement that later regressed', async () => {
    const f = await family({ adult: true });
    const p = await payNow(f);
    await approveAll(await submitAllDocs(f));
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    await db.query(
      "update public.payments set status = 'REFUNDED', refunded_at = now() where id = $1",
      [p.paymentId],
    );
    const res = await evaluate(f);
    expect(res.body.data.steps).toEqual([]);
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    expect(res.body.data.readiness).toMatchObject({
      ready: true,
      blockers: ['PAYMENT_NOT_COMPLETED'],
    });
  });
});

describe('idempotency and concurrency', () => {
  it('does nothing and writes nothing when there is nothing to do', async () => {
    const f = await family({ adult: true });
    await payNow(f);
    await approveAll(await submitAllDocs(f));
    const before = {
      history: (await history(f.regId)).length,
      audit: await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'REGISTRATION_READINESS_ADVANCED'",
        [f.regId],
      ),
    };
    for (let i = 0; i < 3; i++) expect((await evaluate(f)).body.data.steps).toEqual([]);
    expect((await history(f.regId)).length).toBe(before.history);
    expect(
      await count(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'REGISTRATION_READINESS_ADVANCED'",
        [f.regId],
      ),
    ).toBe(before.audit);
  });

  it('applies each step exactly once when evaluations race', async () => {
    // facts satisfied but the status is far behind: only the evaluator can catch it up
    const f = await family({ event: freeEvent, adult: true });
    for (const spec of SPECS) {
      await db.query(
        `insert into public.documents (registration_id, document_type, storage_key, file_name, mime_type, size_bytes, status, uploaded_at, submitted_at)
         values ($1, $2, $3, 'f', $4, 100, 'APPROVED', now(), now())`,
        [
          f.regId,
          spec.documentType,
          `registration-documents/${f.regId}/${crypto.randomUUID()}`,
          spec.mimeType,
        ],
      );
    }
    const results = await Promise.all(Array.from({ length: 6 }, () => evaluate(f)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.reduce((n, r) => n + r.body.data.steps.length, 0)).toBe(5); // 5 steps in total, across all callers
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    const system = (await history(f.regId))
      .filter((h) => h.metadata.source === 'READINESS')
      .map((h) => `${h.from_status}>${h.to_status}`);
    expect(system).toEqual([
      'SUBMITTED>PAYMENT_PENDING',
      'PAYMENT_PENDING>PAYMENT_COMPLETED',
      'PAYMENT_COMPLETED>DOCUMENT_REVIEW',
      'DOCUMENT_REVIEW>VERIFIED',
      'VERIFIED>READY_FOR_EVENT',
    ]);
  });

  it('survives documents being reviewed at the same moment (no deadlock, no duplicate step)', async () => {
    for (let round = 0; round < 3; round++) {
      const f = await family();
      await payNow(f);
      await acceptConsent(f);
      const ids = await submitAllDocs(f);
      const results = await Promise.all(ids.map((id) => approve(id)));
      expect(
        results.map((r) => r.status),
        `round ${round}`,
      ).toEqual([200, 200, 200, 200]);
      expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
      const seq = await path(f.regId);
      expect(seq.filter((s) => s === 'VERIFIED')).toHaveLength(1);
      expect(seq.filter((s) => s === 'READY_FOR_EVENT')).toHaveLength(1);
    }
  });

  it('survives a payment webhook racing document approvals and a consent', async () => {
    const f = await family();
    const ids = await submitAllDocs(f);
    const p = await pay(f);
    const results = await Promise.all([
      p.deliver(),
      acceptConsentRaw(f),
      ...ids.map((id) => approve(id)),
    ]);
    expect(
      results.every((r) => r.status === 200 || r.status === 201),
      JSON.stringify(results.map((r) => r.status)),
    ).toBe(true);
    // whichever finished last made the registration ready; nothing is applied twice
    await evaluate(f);
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
    const seq = await path(f.regId);
    expect(new Set(seq).size).toBe(seq.length);
  });
});

async function acceptConsentRaw(f: Family) {
  const st = await as(app, f.user.id).get(`${R}/${f.regId}/consents`);
  return as(app, f.user.id).post(`${R}/${f.regId}/consents`, {
    consentId: st.body.data.requirements[0].current.id,
    signedName: 'Dana Rivera',
    accepted: true,
  });
}

describe('failures never leave a half-applied state', () => {
  const installFailure = async (regId: string, name: string) => {
    await db.query(
      `create or replace function public.${name}() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end; $$`,
    );
    await db.query(
      `create trigger ${name} before insert on public.registration_status_history for each row when (new.registration_id = '${regId}' and new.metadata ->> 'source' = 'READINESS') execute function public.${name}()`,
    );
  };
  const removeFailure = (name: string) =>
    db.query(`drop trigger ${name} on public.registration_status_history`);

  it('a failed re-evaluation after a document review does not fail the review, and a later evaluation catches up', async () => {
    const f = await family({ adult: true });
    await payNow(f);
    const ids = await submitAllDocs(f);
    await approveAll(ids.slice(0, 3));
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW');

    await installFailure(f.regId, 'test_fail_readiness_docs');
    const last = await approve(ids[3]!);
    await removeFailure('test_fail_readiness_docs');
    expect(last.status).toBe(200); // the review itself committed and is reported as such
    expect(last.body.data.state).toBe('APPROVED');
    expect(await statusOf(f.regId)).toBe('DOCUMENT_REVIEW'); // the failed evaluation rolled back completely: no half step
    expect((await path(f.regId)).includes('VERIFIED')).toBe(false);

    const recovered = await evaluate(f);
    expect(recovered.body.data.steps.map((s: { to: string }) => s.to)).toEqual([
      'VERIFIED',
      'READY_FOR_EVENT',
    ]);
  });

  it('a failure inside the payment webhook rolls back the payment too, so the provider retry applies it', async () => {
    const f = await family({ adult: true });
    await approveAll(await submitAllDocs(f));
    const p = await pay(f);
    await installFailure(f.regId, 'test_fail_readiness_webhook');
    const failed = await p.deliver();
    await removeFailure('test_fail_readiness_webhook');
    expect(failed.status).toBe(500);
    expect(
      (await db.query('select status from public.payments where id = $1', [p.paymentId])).rows[0],
    ).toEqual({ status: 'PAYMENT_PENDING' });
    expect(await statusOf(f.regId)).toBe('PAYMENT_PENDING');
    expect(
      await count(
        'select count(*)::int as n from public.payment_webhook_events where event_id = $1',
        [p.event.id],
      ),
    ).toBe(0);

    const retry = await p.deliver(); // the same event, redelivered
    expect(retry.status).toBe(200);
    expect(
      (await db.query('select status from public.payments where id = $1', [p.paymentId])).rows[0],
    ).toEqual({ status: 'PAID' });
    expect(await statusOf(f.regId)).toBe('READY_FOR_EVENT');
  });
});

describe('GET /readiness and POST /readiness/evaluate: access', () => {
  it('shows the owner and an admin of the event organization, and nobody else', async () => {
    const f = await family();
    const stranger = await createUser(db, { roles: ['PARENT'] });
    expect((await readiness(f)).status).toBe(200);
    expect((await readiness(f, adminA)).status).toBe(200);
    expect((await readiness(f, adminB)).status).toBe(404); // another organization
    expect((await readiness(f, stranger.id)).status).toBe(404);
    expect((await evaluate(f, stranger.id)).status).toBe(404);
    expect((await evaluate(f, adminB)).status).toBe(404);
    expect((await evaluate(f, adminA)).status).toBe(200); // deterministic and idempotent, so allowed
    expect((await request(app).get(`${R}/${f.regId}/readiness`)).status).toBe(401);
    expect((await request(app).post(`${R}/${f.regId}/readiness/evaluate`).send({})).status).toBe(
      401,
    );
    const coach = await createUser(db, { roles: ['COACH'], organizationId: orgA });
    expect((await readiness(f, coach.id)).status).toBe(404);
  });

  it('rejects anything a client might try to supply, and malformed or injected ids', async () => {
    const f = await family();
    for (const body of [
      { status: 'READY_FOR_EVENT' },
      { force: true },
      { override: true },
      { paymentSatisfied: true },
    ]) {
      expect(
        (await as(app, f.user.id).post(`${R}/${f.regId}/readiness/evaluate`, body)).status,
        JSON.stringify(body),
      ).toBe(422);
    }
    expect(await statusOf(f.regId)).toBe('SUBMITTED');
    for (const bad of [
      'nope',
      encodeURIComponent("1' OR '1'='1"),
      encodeURIComponent('1; DROP TABLE public.registrations;--'),
    ]) {
      expect((await as(app, f.user.id).get(`${R}/${bad}/readiness`)).status).toBe(422);
      expect((await as(app, f.user.id).post(`${R}/${bad}/readiness/evaluate`, {})).status).toBe(
        422,
      );
    }
    expect(
      (await as(app, f.user.id).get(`${R}/11111111-1111-4111-8111-111111111111/readiness`)).status,
    ).toBe(404);
  });

  it('returns only readiness facts: no ids of payments, documents or consents, no storage or provider data', async () => {
    const f = await family();
    await payNow(f);
    const text = JSON.stringify((await readiness(f)).body);
    for (const leak of [
      'storage',
      'cs_test',
      'pi_test',
      'created_by',
      'user_id',
      'password',
      'checkout',
    ])
      expect(text.toLowerCase()).not.toContain(leak);
    expect(Object.keys((await readiness(f)).body.data).sort()).toEqual([
      'blockers',
      'consent',
      'documents',
      'payment',
      'ready',
      'registrationId',
      'status',
    ]);
  });
});

describe('what the readiness evaluator leaves alone', () => {
  it('evaluates coach and staff registrations on their own path (no payment step)', async () => {
    const user = await createUser(db, { roles: ['COACH'] });
    const profile = (
      await db.query<{ id: string }>(
        `insert into public.staff_profiles (user_id, profile_type, first_name, last_name, email) values ($1, 'COACH', 'C', 'K', $2) returning id`,
        [user.id, user.email],
      )
    ).rows[0]!.id;
    const reg = (
      await db.query<{ id: string }>(
        `insert into public.registrations (event_id, registrant_type, staff_profile_id, status) values ($1, 'COACH', $2, 'SUBMITTED') returning id`,
        [freeEvent, profile],
      )
    ).rows[0]!.id;
    // No documents yet, so a coach waits at SUBMITTED, and is never sent to payment.
    const result = await evaluateReadinessIn(db, reg);
    expect(result?.steps).toEqual([]);
    expect(result?.report.payment).toEqual({ required: false, satisfied: true });
    expect(await statusOf(reg)).toBe('SUBMITTED');
    expect(await evaluateReadinessIn(db, '11111111-1111-4111-8111-111111111111')).toBeNull();
  });

  it('produces exactly the status the existing event-day database guard accepts, and nothing earlier', async () => {
    const ready = await family({ adult: true });
    await payNow(ready);
    await approveAll(await submitAllDocs(ready));
    const verifiedOnly = await family();
    await payNow(verifiedOnly);
    await approveAll(await submitAllDocs(verifiedOnly)); // minor without consent: VERIFIED
    expect(await statusOf(verifiedOnly.regId)).toBe('VERIFIED');

    const checkIn = (regId: string, eventId: string) =>
      db
        .query(
          `insert into public.check_ins (event_id, registration_id, method, checked_in_by) values ($1, $2, 'MANUAL', $3)`,
          [eventId, regId, adminA],
        )
        .then(
          () => '',
          (e: Error) => e.message,
        );
    expect(await checkIn(ready.regId, paidEvent)).toBe(''); // the existing trigger accepts a READY_FOR_EVENT registration
    expect(await checkIn(verifiedOnly.regId, paidEvent)).toMatch(
      /not eligible for check-in \(status: VERIFIED\)/,
    );
  });
});
