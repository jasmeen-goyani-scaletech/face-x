import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { Client } from 'pg';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { REDACT_PATHS } from '../src/config/logger';
import { createDatabase, type Database } from '../src/infrastructure/database/database';
import { migrateUp } from '../src/infrastructure/database/migrate';
import { checkEligibility } from '../src/modules/eventday/eligibility';
import type { FaceScanPolicy } from '../src/modules/eventday';
import { SCAN_MAX_AGE_SECONDS } from '../src/modules/eventday/service';
import {
  PROVIDER_SECRET,
  createFakeFaceProvider,
  jpegOf,
  lowQualityJpeg,
  manyFacesJpeg,
  noFaceJpeg,
  type FakeFace,
} from './helpers/fake-face';
import { createFakeStorage } from './helpers/fake-storage';
import { createEvent, createOrg } from './helpers/fixtures';
import { bearerFor, buildApi, createUser } from './helpers/test-app';

/**
 * Event-day backend (scan, check-in, search) against the real Express app and real PostgreSQL. The face provider
 * is the in-memory fake (it never looks at a face; tests script its scores). Registrations are seeded straight
 * into READY_FOR_EVENT with SQL on purpose: check-in must re-check the facts and never trust the status alone.
 *
 * Owns a private database: the guardian-consent wording is global state shared by every other test file.
 */
let db: Database;
let app: ReturnType<typeof buildApi>;
let face: FakeFace;
let orgA: string;
let orgB: string;
let eventA: string;
let eventA2: string; // a second event of the same organization
let eventB: string;
let adminA: string;
let adminA2: string; // a second scanner operator in the same organization
let adminB: string;
let consentV1: string;

const dbName = `facex_eventday_${Date.now()}`;
const POLICY: FaceScanPolicy = {
  matchThreshold: 0.9,
  reviewThreshold: 0.75,
  ambiguityMargin: 0.05,
  timeoutMs: 400,
};
const recognition = (f: FakeFace = face) => ({
  provider: f.provider,
  images: createFakeStorage().reader,
  consentPolicy: 'NONE' as const,
  timeoutMs: 2000,
});

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
  face = createFakeFaceProvider();
  app = buildApi(db, { faceRecognition: recognition(), faceScan: POLICY });
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  eventA = await createEvent(db, orgA);
  eventA2 = await createEvent(db, orgA);
  eventB = await createEvent(db, orgB);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminA2 = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.consents (code, version, title, body, effective_at)
     values ('GUARDIAN_CONSENT', 1, 'Test guardian consent', '[TEST CONSENT TEXT - not legal wording]', now() - interval '1 day')
     returning id`,
  );
  consentV1 = rows[0]!.id;
});
afterAll(async () => {
  await db.close();
  const admin = new Client({ connectionString: inject('adminDatabaseUrl') });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

// ---------------------------------------------------------------- fixtures

interface Seed {
  playerId: string;
  regId: string;
  regNumber: string;
  label: string;
  firstName: string;
  lastName: string;
  reference: string | null;
  profileId: string | null;
}

const DOC_TYPES = [
  ['PROFILE_PHOTO', 'image/jpeg'],
  ['BIRTH_CERTIFICATE', 'application/pdf'],
  ['SCHOOL_TRANSCRIPT', 'application/pdf'],
  ['CALIFORNIA_KID_ID', 'image/png'],
] as const;

/** A player registered for `event` and (by default) fully eligible, written directly as READY_FOR_EVENT. */
async function seed(
  o: {
    event?: string;
    label?: string;
    firstName?: string;
    lastName?: string;
    dob?: string;
    schoolId?: string | null;
    status?: string;
    paid?: boolean;
    docs?: 'approved' | 'missing';
    minor?: boolean;
    consent?: boolean;
    face?: boolean;
    disabled?: boolean;
  } = {},
): Promise<Seed> {
  const event = o.event ?? eventA;
  const label = o.label ?? `face-${randomUUID()}`;
  const firstName = o.firstName ?? 'Mateo';
  const lastName = o.lastName ?? 'Rivera';
  const dob = o.dob ?? (o.minor ? '2014-03-09' : '1999-01-01');
  const { rows: p } = await db.query<{ id: string }>(
    `insert into public.players (first_name, last_name, date_of_birth, school_id) values ($1, $2, $3, $4) returning id`,
    [firstName, lastName, dob, o.schoolId ?? null],
  );
  const playerId = p[0]!.id;
  const paid = o.paid ?? true;
  const { rows: r } = await db.query<{ id: string; registration_number: string }>(
    `insert into public.registrations
       (event_id, registrant_type, player_id, status, fee_cents, submitted_at, event_access_disabled)
     values ($1, 'PLAYER', $2, $3, $4, now(), $5) returning id, registration_number`,
    [event, playerId, o.status ?? 'READY_FOR_EVENT', paid ? 9500 : 0, o.disabled ?? false],
  );
  const regId = r[0]!.id;
  if (paid) {
    await db.query(
      `insert into public.payments (registration_id, status, amount_cents, paid_at, stripe_checkout_session_id)
       values ($1, 'PAID', 9500, now(), $2)`,
      [regId, `cs_${randomUUID()}`],
    );
  }
  for (const [type, mime] of DOC_TYPES) {
    if (o.docs === 'missing' && type === 'BIRTH_CERTIFICATE') continue;
    await db.query(
      `insert into public.documents (registration_id, document_type, storage_key, file_name, mime_type, size_bytes, status, uploaded_at, submitted_at)
       values ($1, $2, $3, 'f', $4, 100, 'APPROVED', now(), now())`,
      [regId, type, `registration-documents/${regId}/${randomUUID()}`, mime],
    );
  }
  if (o.minor && (o.consent ?? true)) {
    await db.query(
      `insert into public.consent_records (consent_id, registration_id, accepted_by_user_id, signed_name) values ($1, $2, $3, 'Parent')`,
      [consentV1, regId, adminA],
    );
  }
  let reference: string | null = null;
  let profileId: string | null = null;
  if (o.face ?? true) {
    const enrolled = await face.provider.enroll({
      subjectId: playerId,
      image: { bytes: jpegOf(label), mimeType: 'image/jpeg' },
      idempotencyKey: `seed:${playerId}`,
    });
    reference = enrolled.reference;
    const { rows: fp } = await db.query<{ id: string }>(
      `insert into public.face_profiles (player_id, provider, provider_profile_id) values ($1, $2, $3) returning id`,
      [playerId, face.provider.name, reference],
    );
    profileId = fp[0]!.id;
  }
  return {
    playerId,
    regId,
    regNumber: r[0]!.registration_number,
    label,
    firstName,
    lastName,
    reference,
    profileId,
  };
}

const base = (eventId: string) => `/api/v1/events/${eventId}`;
const SCAN_ARGS = (
  a: ReturnType<typeof buildApi>,
  eventId: string,
  token: Record<string, string>,
  bytes: Uint8Array,
  type: string,
) =>
  request(a)
    .post(`${base(eventId)}/face-scan`)
    .set(token)
    .set('Content-Type', type)
    .send(Buffer.from(bytes));

async function scan(
  userId: string,
  eventId: string,
  bytes: Uint8Array,
  options: { type?: string; app?: ReturnType<typeof buildApi> } = {},
) {
  return SCAN_ARGS(
    options.app ?? app,
    eventId,
    await bearerFor(userId),
    bytes,
    options.type ?? 'image/jpeg',
  );
}
async function checkIn(
  userId: string,
  eventId: string,
  body: Record<string, unknown>,
  a: ReturnType<typeof buildApi> = app,
) {
  return request(a)
    .post(`${base(eventId)}/check-ins`)
    .set(await bearerFor(userId))
    .send(body);
}
const manual = (userId: string, eventId: string, s: Seed, clientRequestId = randomUUID()) =>
  checkIn(userId, eventId, { method: 'MANUAL', registrationId: s.regId, clientRequestId });
async function faceCheckIn(userId: string, eventId: string, scanId: string, id = randomUUID()) {
  return checkIn(userId, eventId, { method: 'FACE', scanId, clientRequestId: id });
}
async function search(userId: string, eventId: string, q: string, a = app) {
  return request(a)
    .get(`${base(eventId)}/search-players`)
    .query({ q })
    .set(await bearerFor(userId));
}
const checkInRows = async (regId: string) =>
  (await db.query('select * from public.check_ins where registration_id = $1', [regId])).rows;
const auditOf = async (action: string, entityId?: string) =>
  (
    await db.query(
      `select * from public.audit_logs where action = $1 ${entityId ? 'and entity_id = $2' : ''} order by created_at`,
      entityId ? [action, entityId] : [action],
    )
  ).rows;
const reset = () => {
  face.failures.identify = null;
  face.failures.identifyExplodes = false;
  face.failures.identifyDelayMs = 0;
  face.script.candidates = null;
};

// ---------------------------------------------------------------- eligibility

describe('event-day eligibility (live, from the database)', () => {
  const elig = (s: Seed, method: 'FACE' | 'MANUAL', event = eventA) =>
    checkEligibility(db, {
      eventId: event,
      registrationId: s.regId,
      method,
      faceProfileId: s.profileId,
    });

  it('a ready, paid, documented, consented registration is eligible by FACE and MANUAL', async () => {
    const s = await seed({ minor: true });
    expect(await elig(s, 'FACE')).toMatchObject({ eligible: true, reasons: [] });
    expect(await elig(s, 'MANUAL')).toMatchObject({ eligible: true, reasons: [] });
  });

  it('a zero-fee registration needs no payment', async () => {
    expect((await elig(await seed({ paid: false }), 'MANUAL')).eligible).toBe(true);
  });

  it('is blocked, with structured reason codes, when a requirement is not met even though the status says READY', async () => {
    const unpaid = await seed({ paid: true });
    await db.query(
      `update public.payments set status = 'REFUNDED', refunded_at = now() where registration_id = $1`,
      [unpaid.regId],
    );
    expect(await elig(unpaid, 'MANUAL')).toMatchObject({
      eligible: false,
      reasons: ['PAYMENT_NOT_COMPLETED'],
    });
    expect((await elig(await seed({ docs: 'missing' }), 'MANUAL')).reasons).toEqual([
      'DOCUMENTS_NOT_APPROVED',
    ]);
    expect((await elig(await seed({ minor: true, consent: false }), 'MANUAL')).reasons).toEqual([
      'CONSENT_NOT_ACCEPTED',
    ]);
    expect((await elig(await seed({ disabled: true }), 'MANUAL')).reasons).toEqual([
      'EVENT_ACCESS_DISABLED',
    ]);
    expect((await elig(await seed({ status: 'VERIFIED' }), 'MANUAL')).reasons).toEqual([
      'REGISTRATION_NOT_READY',
    ]);
  });

  it('requires a face profile only for FACE', async () => {
    const noProfile = await seed({ face: false });
    expect((await elig(noProfile, 'MANUAL')).eligible).toBe(true);
    expect((await elig(noProfile, 'FACE')).reasons).toEqual(['FACE_PROFILE_NOT_ACTIVE']);

    const revoked = await seed();
    await db.query(
      `update public.face_profiles set status = 'REVOKED', revoked_at = now() where id = $1`,
      [revoked.profileId],
    );
    expect((await elig(revoked, 'FACE')).reasons).toEqual(['FACE_PROFILE_NOT_ACTIVE']);
    expect((await elig(revoked, 'MANUAL')).eligible).toBe(true);
  });

  it('applies the existing event rule: the event must be PUBLISHED', async () => {
    const closedEvent = await createEvent(db, orgA, { status: 'CLOSED' });
    const s = await seed({ event: closedEvent });
    expect((await elig(s, 'MANUAL', closedEvent)).reasons).toEqual(['EVENT_NOT_OPEN']);
  });

  it('a registration of another event is "not found" and says nothing else', async () => {
    const other = await seed({ event: eventA2 });
    expect(await elig(other, 'MANUAL', eventA)).toEqual({
      eligible: false,
      reasons: ['REGISTRATION_NOT_FOUND'],
      registration: null,
    });
  });
});

// ---------------------------------------------------------------- authorization

describe('event-day authorization', () => {
  it('requires authentication on all three endpoints', async () => {
    const body = { method: 'MANUAL', registrationId: randomUUID(), clientRequestId: randomUUID() };
    expect(
      (
        await request(app)
          .post(`${base(eventA)}/face-scan`)
          .send(jpegOf('x'))
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`${base(eventA)}/check-ins`)
          .send(body)
      ).status,
    ).toBe(401);
    expect((await request(app).get(`${base(eventA)}/search-players?q=abc`)).status).toBe(401);
  });

  it('only an ADMIN of the event organization may operate the scanner', async () => {
    const parent = (await createUser(db, { roles: ['PARENT'] })).id;
    const player = (await createUser(db, { roles: ['PLAYER'] })).id;
    const coach = (await createUser(db, { roles: ['COACH'] })).id;
    const staff = (await createUser(db, { roles: ['STAFF'] })).id;
    const adminWithoutOrg = (await createUser(db, { roles: ['ADMIN'] })).id;
    const s = await seed();
    for (const who of [parent, player, coach, staff, adminB, adminWithoutOrg]) {
      expect((await scan(who, eventA, jpegOf(s.label))).status, 'scan').toBe(403);
      expect((await manual(who, eventA, s)).status, 'check-in').toBe(403);
      expect((await search(who, eventA, 'Rivera')).status, 'search').toBe(403);
    }
    expect(await checkInRows(s.regId)).toHaveLength(0);
    expect((await search(adminA, eventA, 'Rivera')).status).toBe(200);
  });

  it('an unknown event is 404, a malformed event id is a validation error', async () => {
    expect((await search(adminA, randomUUID(), 'Rivera')).status).toBe(404);
    expect((await search(adminA, 'not-a-uuid', 'Rivera')).status).toBe(422);
  });
});

// ---------------------------------------------------------------- face scan

describe('POST /events/:id/face-scan', () => {
  it('a clear single match for a registered, eligible player is a MATCH with minimal event-scoped data', async () => {
    reset();
    const s = await seed({ minor: true, firstName: 'Lucia', lastName: 'Ortega' });
    const res = await scan(adminA, eventA, jpegOf(s.label));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      result: 'MATCH',
      registration: {
        registrationId: s.regId,
        registrationNumber: s.regNumber,
        firstName: 'Lucia',
        lastName: 'Ortega',
      },
      alreadyCheckedIn: false,
    });
    expect(Object.keys(res.body.data.registration).sort()).toEqual([
      'firstName',
      'lastName',
      'registrantType',
      'registrationId',
      'registrationNumber',
    ]);
    const { rows } = await db.query(`select * from public.face_scans where id = $1`, [
      res.body.data.scanId,
    ]);
    expect(rows[0]).toMatchObject({
      event_id: eventA,
      scanned_by: adminA,
      result: 'MATCH',
      matched_player_id: s.playerId,
      face_profile_id: s.profileId,
      provider: 'fake',
    });
    expect(Number(rows[0]!.provider_score)).toBeGreaterThan(0.9);
    // only the provider is asked, and only for the bounded number of candidates
    expect(face.identifyCalls.at(-1)).toMatchObject({ maxCandidates: 10 });
  });

  it('an unknown face is NO_MATCH and reveals nothing', async () => {
    reset();
    await seed();
    const res = await scan(adminA, eventA, jpegOf('a-total-stranger'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ scanId: expect.any(String), result: 'NO_MATCH' });
  });

  it('a player registered only for another event behaves exactly like an unknown face', async () => {
    reset();
    const elsewhere = await seed({ event: eventA2, firstName: 'Elsewhere' });
    const otherOrg = await seed({ event: eventB, firstName: 'OtherOrg' });
    for (const who of [elsewhere, otherOrg]) {
      const res = await scan(adminA, eventA, jpegOf(who.label));
      expect(res.body.data).toEqual({ scanId: expect.any(String), result: 'NO_MATCH' });
      expect(JSON.stringify(res.body)).not.toMatch(/Elsewhere|OtherOrg|FX-/);
      const { rows } = await db.query('select * from public.face_scans where id = $1', [
        res.body.data.scanId,
      ]);
      expect(rows[0]).toMatchObject({
        result: 'NO_MATCH',
        matched_player_id: null,
        face_profile_id: null,
      });
    }
    // ...and the same face at its own event is a match
    expect((await scan(adminB, eventB, jpegOf(otherOrg.label))).body.data.result).toBe('MATCH');
  });

  it('an inactive (revoked) face profile is never matched', async () => {
    reset();
    const s = await seed();
    await db.query(
      `update public.face_profiles set status = 'REVOKED', revoked_at = now() where id = $1`,
      [s.profileId],
    );
    expect((await scan(adminA, eventA, jpegOf(s.label))).body.data.result).toBe('NO_MATCH');
  });

  it('a matched but ineligible player needs review and the reason codes say why (nothing personal)', async () => {
    reset();
    const s = await seed({ docs: 'missing' });
    const res = await scan(adminA, eventA, jpegOf(s.label));
    expect(res.body.data).toMatchObject({
      result: 'REVIEW_REQUIRED',
      reason: 'NOT_ELIGIBLE',
      eligibility: ['DOCUMENTS_NOT_APPROVED'],
      candidates: [
        { registrationId: s.regId, registrationNumber: s.regNumber, displayName: 'Mateo R.' },
      ],
    });
    // never usable for a check-in
    const used = await faceCheckIn(adminA, eventA, res.body.data.scanId);
    expect(used.body.error.code).toBe('SCAN_NOT_A_MATCH');
  });

  describe('decision policy (scores scripted at the provider; the application decides)', () => {
    const cand = (s: Seed, similarity: number) => ({ reference: s.reference!, similarity });

    it('a score in the review band is REVIEW_REQUIRED, never an automatic check-in', async () => {
      const s = await seed({ lastName: 'Bandit' });
      face.script.candidates = [cand(s, 0.8)];
      const res = await scan(adminA, eventA, jpegOf('any'));
      expect(res.body.data).toMatchObject({
        result: 'REVIEW_REQUIRED',
        reason: 'LOW_CONFIDENCE',
        candidates: [{ registrationId: s.regId, displayName: 'Mateo B.' }],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/0\.8|similarity|score|reference/i);
      expect((await faceCheckIn(adminA, eventA, res.body.data.scanId)).status).toBe(409);
      reset();
    });

    it('below the review threshold is NO_MATCH', async () => {
      const s = await seed();
      face.script.candidates = [cand(s, 0.5)];
      expect((await scan(adminA, eventA, jpegOf('any'))).body.data.result).toBe('NO_MATCH');
      reset();
    });

    it('several strong candidates need review', async () => {
      const a = await seed();
      const b = await seed();
      face.script.candidates = [cand(a, 0.99), cand(b, 0.95)];
      const res = await scan(adminA, eventA, jpegOf('any'));
      expect(res.body.data).toMatchObject({
        result: 'REVIEW_REQUIRED',
        reason: 'MULTIPLE_STRONG_CANDIDATES',
      });
      expect(res.body.data.candidates).toHaveLength(2);
      reset();
    });

    it('a leader without enough margin over the runner-up is ambiguous', async () => {
      const a = await seed();
      const b = await seed();
      face.script.candidates = [cand(a, 0.93), cand(b, 0.89)];
      const res = await scan(adminA, eventA, jpegOf('any'));
      expect(res.body.data).toMatchObject({ result: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS_MATCH' });
      reset();
    });

    it('a strong match is not disturbed by a look-alike registered only for another event', async () => {
      const mine = await seed();
      const lookAlike = await seed({ event: eventA2 });
      face.script.candidates = [cand(lookAlike, 0.98), cand(mine, 0.93)];
      const res = await scan(adminA, eventA, jpegOf('any'));
      expect(res.body.data).toMatchObject({
        result: 'MATCH',
        registration: { registrationId: mine.regId },
      });
      reset();
    });

    it('ignores references that belong to no profile', async () => {
      face.script.candidates = [{ reference: 'no-such-reference', similarity: 0.99 }];
      expect((await scan(adminA, eventA, jpegOf('any'))).body.data.result).toBe('NO_MATCH');
      reset();
    });
  });

  describe('image and provider failures are safe, structured errors', () => {
    it.each([
      ['no face', noFaceJpeg, 422, 'FACE_NOT_DETECTED'],
      ['multiple faces', manyFacesJpeg, 422, 'FACE_MULTIPLE'],
      ['low quality', lowQualityJpeg, 422, 'FACE_LOW_QUALITY'],
    ])('%s', async (_n, image, status, code) => {
      reset();
      const res = await scan(adminA, eventA, image());
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ success: false, error: { code, message: expect.any(String) } });
    });

    it('provider unavailable: 503, no fabricated match, no check-in, failure recorded', async () => {
      reset();
      const before = (await db.query('select count(*)::int n from public.check_ins')).rows[0]!.n;
      face.failures.identify = 'UNAVAILABLE';
      const res = await scan(adminA, eventA, jpegOf('x'));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('FACE_PROVIDER_UNAVAILABLE');
      expect((await db.query('select count(*)::int n from public.check_ins')).rows[0]!.n).toBe(
        before,
      );
      const { rows } = await db.query(
        `select * from public.face_scans where event_id = $1 and result = 'ERROR' order by created_at desc limit 1`,
        [eventA],
      );
      expect(rows[0]).toMatchObject({ error_code: 'UNAVAILABLE', matched_player_id: null });
      reset();
    });

    it('provider timeout: 503 FACE_PROVIDER_TIMEOUT', async () => {
      reset();
      face.failures.identifyDelayMs = 1500; // the policy deadline is 400 ms
      const res = await scan(adminA, eventA, jpegOf('x'));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('FACE_PROVIDER_TIMEOUT');
      reset();
    });

    it('an unexpected provider failure never leaks its text, and an operator error never becomes a match', async () => {
      reset();
      face.failures.identifyExplodes = true; // error text contains a secret
      const res = await scan(adminA, eventA, jpegOf('x'));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('FACE_PROVIDER_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toContain(PROVIDER_SECRET);
      expect(JSON.stringify(res.body)).not.toMatch(/exploded/);
      reset();
    });

    it('with no provider configured: 503 FACE_NOT_CONFIGURED, nothing recorded, manual check-in still works', async () => {
      const bare = buildApi(db, { faceScan: POLICY });
      const s = await seed();
      const before = (await db.query('select count(*)::int n from public.face_scans')).rows[0]!.n;
      const res = await scan(adminA, eventA, jpegOf(s.label), { app: bare });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('FACE_NOT_CONFIGURED');
      expect((await db.query('select count(*)::int n from public.face_scans')).rows[0]!.n).toBe(
        before,
      );
      expect(
        (
          await checkIn(
            adminA,
            eventA,
            { method: 'MANUAL', registrationId: s.regId, clientRequestId: randomUUID() },
            bare,
          )
        ).status,
      ).toBe(201);
    });

    it('validates the image and enforces a strict size limit before any provider call', async () => {
      reset();
      const calls = face.identifyCalls.length;
      const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1);
      tooBig.set([0xff, 0xd8, 0xff]);
      const big = await scan(adminA, eventA, tooBig);
      expect(big.status).toBe(400);
      expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      const notAnImage = await scan(
        adminA,
        eventA,
        Buffer.from('<html>not an image</html>'.repeat(50)),
      );
      expect(notAnImage.status).toBe(422);
      expect(notAnImage.body.error.code).toBe('IMAGE_INVALID'); // declared jpeg, bytes are not
      const wrongType = await scan(adminA, eventA, jpegOf('x'), { type: 'text/plain' });
      expect(wrongType.status).toBe(422);
      expect(wrongType.body.error.code).toBe('IMAGE_REQUIRED');
      const json = await request(app)
        .post(`${base(eventA)}/face-scan`)
        .set(await bearerFor(adminA))
        .send({ image: 'aGVsbG8=' });
      expect(json.status).toBe(422);
      const empty = await scan(adminA, eventA, new Uint8Array(0));
      expect(empty.status).toBe(422);
      expect(face.identifyCalls.length).toBe(calls);
    });

    it('is rate limited per operator', async () => {
      reset();
      const limited = buildApi(db, {
        faceRecognition: recognition(),
        faceScan: POLICY,
        eventDayRateLimits: { scanPerMinute: 2, searchPerMinute: 2 },
      });
      const op = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
      const other = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
      const statuses = [];
      for (let i = 0; i < 3; i++)
        statuses.push((await scan(op, eventA, jpegOf('x'), { app: limited })).status);
      expect(statuses).toEqual([200, 200, 429]);
      expect((await scan(other, eventA, jpegOf('x'), { app: limited })).status).toBe(200); // per user, not shared
    });
  });
});

// ---------------------------------------------------------------- check-in

describe('POST /events/:id/check-ins', () => {
  it('FACE: a valid MATCH scan checks the player in; the client never names the player', async () => {
    reset();
    const s = await seed({ minor: true });
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    const id = randomUUID();
    const res = await faceCheckIn(adminA, eventA, sc.scanId, id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      registrationId: s.regId,
      registrationNumber: s.regNumber,
      method: 'FACE',
      idempotentReplay: false,
    });
    const rows = await checkInRows(s.regId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_id: eventA,
      method: 'FACE',
      face_scan_id: sc.scanId,
      checked_in_by: adminA,
      client_request_id: id,
    });
    const audit = await auditOf('CHECK_IN_COMPLETED', rows[0]!.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: adminA, entity_type: 'check_in' });
    expect(audit[0]!.metadata).toEqual({
      eventId: eventA,
      registrationId: s.regId,
      playerId: s.playerId,
      method: 'FACE',
      scanId: sc.scanId,
    });
  });

  it('MANUAL: the server resolves the registration and applies the same eligibility; no override exists', async () => {
    const s = await seed({ face: false });
    const res = await manual(adminA, eventA, s);
    expect(res.status).toBe(201);
    expect(res.body.data.method).toBe('MANUAL');
    expect((await checkInRows(s.regId))[0]).toMatchObject({ method: 'MANUAL', face_scan_id: null });

    const blocked = await seed({ docs: 'missing' });
    const refused = await manual(adminA, eventA, blocked);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: 'PLAYER_NOT_ELIGIBLE',
      details: [{ path: 'reason', message: 'DOCUMENTS_NOT_APPROVED' }],
    });
    for (const attempt of [{ override: true }, { force: true }, { method: 'OVERRIDE' }]) {
      const o = await checkIn(adminA, eventA, {
        method: 'MANUAL',
        registrationId: blocked.regId,
        clientRequestId: randomUUID(),
        ...attempt,
      });
      expect(o.status).toBe(422);
    }
    expect(await checkInRows(blocked.regId)).toHaveLength(0);
  });

  it('MANUAL: a registration of another event or organization is 404, and nothing is checked in', async () => {
    const elsewhere = await seed({ event: eventA2 });
    const otherOrg = await seed({ event: eventB });
    expect((await manual(adminA, eventA, elsewhere)).status).toBe(404);
    expect((await manual(adminA, eventA, otherOrg)).status).toBe(404);
    expect((await manual(adminA, eventB, otherOrg)).status).toBe(403);
    expect(
      (
        await checkIn(adminA, eventA, {
          method: 'MANUAL',
          registrationId: randomUUID(),
          clientRequestId: randomUUID(),
        })
      ).status,
    ).toBe(404);
    expect(await checkInRows(elsewhere.regId)).toHaveLength(0);
    expect(await checkInRows(otherOrg.regId)).toHaveLength(0);
  });

  it('a scan can be used once', async () => {
    reset();
    const s = await seed();
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    expect((await faceCheckIn(adminA, eventA, sc.scanId)).status).toBe(201);
    const again = await faceCheckIn(adminA, eventA, sc.scanId); // a different request id
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SCAN_ALREADY_USED');
    expect(await checkInRows(s.regId)).toHaveLength(1);
  });

  it('a stale scan is refused', async () => {
    reset();
    const s = await seed();
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    await db.query(
      `update public.face_scans set created_at = now() - make_interval(secs => $2) where id = $1`,
      [sc.scanId, SCAN_MAX_AGE_SECONDS + 5],
    );
    const res = await faceCheckIn(adminA, eventA, sc.scanId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCAN_EXPIRED');
    expect(await checkInRows(s.regId)).toHaveLength(0);
  });

  it("another event's scan and another operator's scan are 'not found' (and still usable by their owner)", async () => {
    reset();
    const s = await seed();
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    // same organization, different event
    const wrongEvent = await faceCheckIn(adminA, eventA2, sc.scanId);
    expect(wrongEvent.status).toBe(404);
    expect(wrongEvent.body.error.code).toBe('SCAN_NOT_FOUND');
    // same event, different operator
    const wrongOperator = await faceCheckIn(adminA2, eventA, sc.scanId);
    expect(wrongOperator.status).toBe(404);
    expect(wrongOperator.body.error.code).toBe('SCAN_NOT_FOUND');
    // a scan id that does not exist looks identical
    expect((await faceCheckIn(adminA, eventA, randomUUID())).body.error.code).toBe(
      'SCAN_NOT_FOUND',
    );
    expect(await checkInRows(s.regId)).toHaveLength(0);
    expect((await faceCheckIn(adminA, eventA, sc.scanId)).status).toBe(201);
  });

  it('scans that did not produce a MATCH can never be turned into a check-in', async () => {
    reset();
    const none = (await scan(adminA, eventA, jpegOf('nobody-at-all'))).body.data;
    expect(none.result).toBe('NO_MATCH');
    const r1 = await faceCheckIn(adminA, eventA, none.scanId);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('SCAN_NOT_A_MATCH');

    face.failures.identify = 'UNAVAILABLE';
    await scan(adminA, eventA, jpegOf('x'));
    reset();
    const { rows } = await db.query(
      `select id from public.face_scans where result = 'ERROR' and scanned_by = $1 limit 1`,
      [adminA],
    );
    expect((await faceCheckIn(adminA, eventA, rows[0]!.id)).body.error.code).toBe(
      'SCAN_NOT_A_MATCH',
    );
  });

  it('eligibility is re-checked at check-in: a change between scan and check-in blocks it', async () => {
    reset();
    const cases: [string, (s: Seed) => Promise<unknown>, string][] = [
      [
        'payment refunded',
        (s) =>
          db.query(
            `update public.payments set status = 'REFUNDED', refunded_at = now() where registration_id = $1`,
            [s.regId],
          ),
        'PAYMENT_NOT_COMPLETED',
      ],
      [
        'access disabled',
        (s) =>
          db.query(`update public.registrations set event_access_disabled = true where id = $1`, [
            s.regId,
          ]),
        'EVENT_ACCESS_DISABLED',
      ],
      [
        'profile revoked',
        (s) =>
          db.query(
            `update public.face_profiles set status = 'REVOKED', revoked_at = now() where id = $1`,
            [s.profileId],
          ),
        'FACE_PROFILE_NOT_ACTIVE',
      ],
      [
        'registration cancelled',
        (s) =>
          db.query(`update public.registrations set status = 'CANCELLED' where id = $1`, [s.regId]),
        'REGISTRATION_NOT_READY',
      ],
    ];
    for (const [name, change, reason] of cases) {
      const s = await seed();
      const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
      expect(sc.result, name).toBe('MATCH');
      await change(s);
      const res = await faceCheckIn(adminA, eventA, sc.scanId);
      expect(res.status, name).toBe(409);
      expect(res.body.error.code, name).toBe('PLAYER_NOT_ELIGIBLE');
      expect(
        res.body.error.details.map((d: { message: string }) => d.message),
        name,
      ).toContain(reason);
      expect(await checkInRows(s.regId), name).toHaveLength(0);
    }
  });

  it('a revoked profile blocks FACE only: the same player can still be checked in manually', async () => {
    reset();
    const s = await seed();
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    await db.query(
      `update public.face_profiles set status = 'REVOKED', revoked_at = now() where id = $1`,
      [s.profileId],
    );
    expect((await faceCheckIn(adminA, eventA, sc.scanId)).status).toBe(409);
    expect((await manual(adminA, eventA, s)).status).toBe(201);
  });

  it('a device id and the device time are kept in the audit record; the check-in time stays the server clock', async () => {
    const s = await seed();
    const deviceCheckedInAt = '2020-01-01T08:00:00.000Z'; // a wrong or old device clock
    const res = await checkIn(adminA, eventA, {
      method: 'MANUAL',
      registrationId: s.regId,
      clientRequestId: randomUUID(),
      deviceId: 'door-tablet-2',
      deviceCheckedInAt,
    });
    expect(res.status).toBe(201);
    expect(new Date(res.body.data.checkedInAt).getFullYear()).toBeGreaterThan(2020);
    const audit = await auditOf('CHECK_IN_COMPLETED', res.body.data.checkInId);
    expect(audit[0]!.metadata).toMatchObject({ deviceId: 'door-tablet-2', deviceCheckedInAt });
  });

  it('ALREADY_CHECKED_IN tells the loser when (server time) and how the winner checked in, not who', async () => {
    const s = await seed();
    const win = await manual(adminA, eventA, s);
    expect(win.status).toBe(201);
    const late = await checkIn(adminA, eventA, {
      method: 'MANUAL',
      registrationId: s.regId,
      clientRequestId: randomUUID(),
      deviceId: 'door-tablet-2',
      deviceCheckedInAt: '2020-01-01T08:00:00.000Z',
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ALREADY_CHECKED_IN');
    expect(late.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'checkedInAt', message: win.body.data.checkedInAt },
        { path: 'method', message: 'MANUAL' },
      ]),
    );
    expect(JSON.stringify(late.body)).not.toContain(adminA);
  });

  it('a duplicate check-in is a controlled 409 ALREADY_CHECKED_IN', async () => {
    const s = await seed();
    expect((await manual(adminA, eventA, s)).status).toBe(201);
    const dup = await manual(adminA, eventA, s); // new request id
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_CHECKED_IN');
    expect(await checkInRows(s.regId)).toHaveLength(1);
    // a face scan of someone already in says so up front
    reset();
    expect((await scan(adminA, eventA, jpegOf(s.label))).body.data.alreadyCheckedIn).toBe(true);
  });

  it('is idempotent: the same request id never creates a second check-in, and an exact retry returns the first', async () => {
    const s = await seed();
    const id = randomUUID();
    const first = await manual(adminA, eventA, s, id);
    const retry = await manual(adminA, eventA, s, id);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({
      checkInId: first.body.data.checkInId,
      idempotentReplay: true,
    });
    expect(retry.body.data.checkedInAt).toBe(first.body.data.checkedInAt);
    expect(await checkInRows(s.regId)).toHaveLength(1);
    expect(await auditOf('CHECK_IN_COMPLETED', first.body.data.checkInId)).toHaveLength(1);
    // still a success after the world changed: the check-in did happen
    await db.query(`update public.registrations set event_access_disabled = true where id = $1`, [
      s.regId,
    ]);
    expect((await manual(adminA, eventA, s, id)).status).toBe(200);
  });

  it('an exact FACE retry also returns the first result (the scan is already consumed)', async () => {
    reset();
    const s = await seed();
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    const id = randomUUID();
    const first = await faceCheckIn(adminA, eventA, sc.scanId, id);
    const retry = await faceCheckIn(adminA, eventA, sc.scanId, id);
    expect([first.status, retry.status]).toEqual([201, 200]);
    expect(retry.body.data.checkInId).toBe(first.body.data.checkInId);
  });

  it('a request id cannot be reused for a different registration, event, operator or method', async () => {
    reset();
    const a = await seed();
    const b = await seed();
    const c = await seed({ event: eventA2 });
    const id = randomUUID();
    expect((await manual(adminA, eventA, a, id)).status).toBe(201);
    for (const res of [
      await manual(adminA, eventA, b, id), // other registration
      await manual(adminA, eventA2, c, id), // other event
      await manual(adminA2, eventA, a, id), // other operator
      await faceCheckIn(adminA, eventA, randomUUID(), id), // other method
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLIENT_REQUEST_ID_REUSED');
    }
    expect(await checkInRows(b.regId)).toHaveLength(0);
    expect(await checkInRows(c.regId)).toHaveLength(0);
  });

  it('rejects a body that tries to say who was recognized', async () => {
    const s = await seed();
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    for (const body of [
      { method: 'FACE', scanId: sc.scanId, playerId: s.playerId, clientRequestId: randomUUID() },
      { method: 'FACE', scanId: sc.scanId, registrationId: s.regId, clientRequestId: randomUUID() },
      { method: 'FACE', scanId: sc.scanId },
      { method: 'FACE', clientRequestId: randomUUID() },
    ]) {
      expect((await checkIn(adminA, eventA, body)).status).toBe(422);
    }
    expect(await checkInRows(s.regId)).toHaveLength(0);
  });

  describe('concurrency (real PostgreSQL)', () => {
    it('many scanners on one player: exactly one succeeds, the rest get 409 ALREADY_CHECKED_IN', async () => {
      const s = await seed();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => manual(i % 2 ? adminA : adminA2, eventA, s)),
      );
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
      expect(
        new Set(results.filter((r) => r.status === 409).map((r) => r.body.error.code)),
      ).toEqual(new Set(['ALREADY_CHECKED_IN']));
      expect(await checkInRows(s.regId)).toHaveLength(1);
      expect(await auditOf('CHECK_IN_COMPLETED', (await checkInRows(s.regId))[0]!.id)).toHaveLength(
        1,
      );
    });

    it('two operators scanning the same player at once: one check-in', async () => {
      reset();
      const s = await seed();
      const [s1, s2] = await Promise.all([
        scan(adminA, eventA, jpegOf(s.label)),
        scan(adminA2, eventA, jpegOf(s.label)),
      ]);
      expect([s1.body.data.result, s2.body.data.result]).toEqual(['MATCH', 'MATCH']);
      const results = await Promise.all([
        faceCheckIn(adminA, eventA, s1.body.data.scanId),
        faceCheckIn(adminA2, eventA, s2.body.data.scanId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe('ALREADY_CHECKED_IN');
      expect(await checkInRows(s.regId)).toHaveLength(1);
    });

    it('one scan used by several requests at once: one check-in, the others are refused', async () => {
      reset();
      const s = await seed();
      const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
      const results = await Promise.all(
        Array.from({ length: 5 }, () => faceCheckIn(adminA, eventA, sc.scanId)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        new Set(results.filter((r) => r.status !== 201).map((r) => r.body.error.code)),
      ).toEqual(new Set(['SCAN_ALREADY_USED']));
      expect(await checkInRows(s.regId)).toHaveLength(1);
    });

    it('concurrent identical retries (same request id) all succeed with the same check-in', async () => {
      reset();
      const s = await seed();
      const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
      const id = randomUUID();
      const faceResults = await Promise.all(
        Array.from({ length: 5 }, () => faceCheckIn(adminA, eventA, sc.scanId, id)),
      );
      expect(faceResults.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
      expect(new Set(faceResults.map((r) => r.body.data.checkInId)).size).toBe(1);
      expect(await checkInRows(s.regId)).toHaveLength(1);

      const m = await seed();
      const mid = randomUUID();
      const manualResults = await Promise.all(
        Array.from({ length: 5 }, () => manual(adminA, eventA, m, mid)),
      );
      expect(manualResults.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
      expect(await checkInRows(m.regId)).toHaveLength(1);
    });

    it('an admin disabling access while a check-in is in flight can never be overtaken', async () => {
      const s = await seed();
      const [res] = await Promise.all([
        manual(adminA, eventA, s),
        db.query(`update public.registrations set event_access_disabled = true where id = $1`, [
          s.regId,
        ]),
      ]);
      const rows = await checkInRows(s.regId);
      // either order is valid, but a check-in must never exist for a registration that ended up disabled
      // unless it committed before the disable: if refused, nothing exists.
      if (res.status === 409) expect(rows).toHaveLength(0);
      else expect(res.status).toBe(201);
    });
  });

  it('refusals are audited with ids and a reason code only', async () => {
    const s = await seed({ docs: 'missing' });
    await manual(adminA, eventA, s);
    const rows = (await auditOf('CHECK_IN_REFUSED')).filter(
      (r) => r.metadata.registrationId === s.regId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: adminA,
      entity_type: 'event',
      entity_id: eventA,
    });
    expect(rows[0]!.metadata).toEqual({
      eventId: eventA,
      method: 'MANUAL',
      reasonCode: 'PLAYER_NOT_ELIGIBLE',
      registrationId: s.regId,
      scanId: null,
    });
  });
});

// ---------------------------------------------------------------- database protections

describe('the database is the last line of defence', () => {
  const insertFace = (
    event: string,
    reg: string,
    scanId: string,
    by: string,
    requestId = randomUUID(),
  ) =>
    db.query(
      `insert into public.check_ins (event_id, registration_id, method, face_scan_id, checked_in_by, client_request_id)
       values ($1, $2, 'FACE', $3, $4, $5)`,
      [event, reg, scanId, by, requestId],
    );
  const matchScan = async (s: Seed, by = adminA, event = eventA, result = 'MATCH') =>
    (
      await db.query<{ id: string }>(
        `insert into public.face_scans (event_id, scanned_by, result, matched_player_id, face_profile_id, provider)
         values ($1, $2, $3, $4, $5, 'fake') returning id`,
        [
          event,
          by,
          result,
          result === 'MATCH' ? s.playerId : null,
          result === 'MATCH' ? s.profileId : null,
        ],
      )
    ).rows[0]!.id;

  it('one scan can back only one check-in, and one request id only one check-in', async () => {
    const a = await seed();
    const b = await seed();
    const scanId = await matchScan(a);
    await insertFace(eventA, a.regId, scanId, adminA);
    await expect(insertFace(eventA, b.regId, scanId, adminA)).rejects.toThrow(
      /check_ins_face_scan_id_key|check_violation|does not match/,
    );
    const id = randomUUID();
    await db.query(
      `insert into public.check_ins (event_id, registration_id, method, checked_in_by, client_request_id) values ($1, $2, 'MANUAL', $3, $4)`,
      [eventA, b.regId, adminA, id],
    );
    const c = await seed();
    await expect(
      db.query(
        `insert into public.check_ins (event_id, registration_id, method, checked_in_by, client_request_id) values ($1, $2, 'MANUAL', $3, $4)`,
        [eventA, c.regId, adminA, id],
      ),
    ).rejects.toThrow(/check_ins_client_request_id_key/);
  });

  it('a FACE check-in must be backed by a MATCH scan of this player, event and operator', async () => {
    const player = await seed();
    const other = await seed();
    const reject = /does not match this check-in/;
    await expect(insertFace(eventA, player.regId, await matchScan(other), adminA)).rejects.toThrow(
      reject,
    ); // other player
    await expect(
      insertFace(eventA, player.regId, await matchScan(player, adminA2), adminA),
    ).rejects.toThrow(reject); // other operator
    await expect(
      insertFace(eventA, player.regId, await matchScan(player, adminA, eventA2), adminA),
    ).rejects.toThrow(reject); // other event
    await expect(
      insertFace(eventA, player.regId, await matchScan(player, adminA, eventA, 'NO_MATCH'), adminA),
    ).rejects.toThrow(reject); // not a match
    await insertFace(eventA, player.regId, await matchScan(player), adminA); // the right one works
  });

  it('the existing trigger still refuses a registration that is not ready or has access disabled', async () => {
    const notReady = await seed({ status: 'VERIFIED' });
    const disabled = await seed({ disabled: true });
    for (const s of [notReady, disabled]) {
      await expect(
        db.query(
          `insert into public.check_ins (event_id, registration_id, method, checked_in_by, client_request_id) values ($1, $2, 'MANUAL', $3, $4)`,
          [eventA, s.regId, adminA, randomUUID()],
        ),
      ).rejects.toThrow(/not eligible|disabled/);
    }
  });
});

// ---------------------------------------------------------------- search

describe('GET /events/:id/search-players', () => {
  it('finds a player by name (prefix, any order), registration number, school ID and exact date of birth', async () => {
    const s = await seed({
      firstName: 'Sofia',
      lastName: 'Quintanilla',
      dob: '2013-07-21',
      schoolId: 'SCH-77231',
    });
    const found = async (q: string) =>
      (await search(adminA, eventA, q)).body.data.results.map(
        (r: { registrationId: string }) => r.registrationId,
      );
    for (const q of [
      'Quintanilla',
      'quint',
      'sofia quin',
      'Quin, Sof',
      s.regNumber,
      s.regNumber.toLowerCase(),
      'SCH-77231',
      'sch-77231',
      '2013-07-21',
    ]) {
      expect(await found(q), q).toContain(s.regId);
    }
    // identifiers are exact, names are prefixes: no fuzzy matching
    for (const q of ['SCH-7723', 'uintanilla', 'Quintanila', '2013-07-22', 'FX-2026-99999']) {
      expect(await found(q), q).not.toContain(s.regId);
    }
  });

  it('returns minimal fields only', async () => {
    const s = await seed({
      firstName: 'Minimal',
      lastName: 'Fields',
      dob: '2002-02-02',
      schoolId: 'SID-1',
    });
    const res = await search(adminA, eventA, 'Minimal Fields');
    expect(res.status).toBe(200);
    const row = res.body.data.results.find(
      (r: { registrationId: string }) => r.registrationId === s.regId,
    );
    expect(Object.keys(row).sort()).toEqual([
      'checkedIn',
      'firstName',
      'lastName',
      'ready',
      'registrantType',
      'registrationId',
      'registrationNumber',
      'teamName',
    ]);
    expect(row).toMatchObject({ ready: true, checkedIn: false });
    expect(JSON.stringify(res.body)).not.toMatch(
      /2002-02-02|SID-1|guardian|phone|email|playerId|fake_face/i,
    );
    const done = await manual(adminA, eventA, s);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const again = (await search(adminA, eventA, 'Minimal Fields')).body.data.results;
    expect(again.map((r: { checkedIn: boolean }) => r.checkedIn)).toEqual([true]);
  });

  it('shows why someone is not ready, hides drafts and cancelled registrations', async () => {
    const verified = await seed({ lastName: 'Statusson', status: 'VERIFIED' });
    const draft = await seed({ lastName: 'Statusson', status: 'DRAFT' });
    const cancelled = await seed({ lastName: 'Statusson', status: 'CANCELLED' });
    const disabled = await seed({ lastName: 'Statusson', disabled: true });
    const rows = (await search(adminA, eventA, 'Statusson')).body.data.results as {
      registrationId: string;
      ready: boolean;
    }[];
    const byId = new Map(rows.map((r) => [r.registrationId, r.ready]));
    expect(byId.get(verified.regId)).toBe(false);
    expect(byId.get(disabled.regId)).toBe(false);
    expect(byId.has(draft.regId)).toBe(false);
    expect(byId.has(cancelled.regId)).toBe(false);
  });

  it('is isolated to the event: no cross-event or cross-organization leakage', async () => {
    const mine = await seed({
      firstName: 'Leaky',
      lastName: 'Isolation',
      dob: '2011-11-11',
      schoolId: 'ISO-1',
    });
    const sameOrg = await seed({
      event: eventA2,
      firstName: 'Leaky',
      lastName: 'Isolation',
      dob: '2011-11-11',
      schoolId: 'ISO-2',
    });
    const otherOrg = await seed({
      event: eventB,
      firstName: 'Leaky',
      lastName: 'Isolation',
      dob: '2011-11-11',
      schoolId: 'ISO-3',
    });
    for (const q of [
      'Isolation',
      'Leaky Iso',
      '2011-11-11',
      'ISO-1',
      'ISO-2',
      'ISO-3',
      sameOrg.regNumber,
      otherOrg.regNumber,
    ]) {
      const ids = (await search(adminA, eventA, q)).body.data.results.map(
        (r: { registrationId: string }) => r.registrationId,
      );
      expect(ids, q).not.toContain(sameOrg.regId);
      expect(ids, q).not.toContain(otherOrg.regId);
    }
    expect(
      (await search(adminA, eventA, 'ISO-1')).body.data.results.map(
        (r: { registrationId: string }) => r.registrationId,
      ),
    ).toEqual([mine.regId]);
    expect(
      (await search(adminB, eventB, 'Isolation')).body.data.results.map(
        (r: { registrationId: string }) => r.registrationId,
      ),
    ).toEqual([otherOrg.regId]);
  });

  it('enforces a minimum query length and rejects unknown parameters', async () => {
    for (const q of ['', 'a', 'ab', '  a ']) {
      const res = await search(adminA, eventA, q);
      expect(res.status, JSON.stringify(q)).toBe(422);
    }
    const noQuery = await request(app)
      .get(`${base(eventA)}/search-players`)
      .set(await bearerFor(adminA));
    expect(noQuery.status).toBe(422);
    const extra = await request(app)
      .get(`${base(eventA)}/search-players?q=abcd&limit=500`)
      .set(await bearerFor(adminA));
    expect(extra.status).toBe(422);
    const twice = await request(app)
      .get(`${base(eventA)}/search-players?q=abc&q=def`)
      .set(await bearerFor(adminA));
    expect(twice.status).toBe(422);
    expect((await search(adminA, eventA, 'x'.repeat(81))).status).toBe(422);
  });

  it('caps the number of results and says when it truncated', async () => {
    for (let i = 0; i < 23; i++) await seed({ lastName: 'Capperson', face: false });
    const res = await search(adminA, eventA, 'Capperson');
    expect(res.body.data.results).toHaveLength(20);
    expect(res.body.data).toMatchObject({ truncated: true, limit: 20 });
    const small = await search(adminA, eventA, 'Capperson 2013-01-01');
    expect(small.body.data.truncated).toBe(false);
  });

  it('is safe against SQL injection and treats wildcards literally', async () => {
    const s = await seed({ lastName: 'Safe' });
    for (const q of [
      `'; drop table public.players; --`,
      `x' or '1'='1`,
      `Safe%`,
      `%%%`,
      `___`,
      `Safe' union select * from public.users --`,
      '2014-13-45',
      '\\\\\\',
    ]) {
      const res = await search(adminA, eventA, q);
      expect(res.status, q).toBe(200);
      expect(res.body.data.results, q).toEqual([]);
    }
    expect(
      (await db.query('select count(*)::int n from public.players where id = $1', [s.playerId]))
        .rows[0]!.n,
    ).toBe(1);
  });

  it('is rate limited per operator', async () => {
    const limited = buildApi(db, {
      faceScan: POLICY,
      eventDayRateLimits: { scanPerMinute: 5, searchPerMinute: 2 },
    });
    const op = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await search(op, eventA, 'Rivera', limited)).status);
    expect(statuses).toEqual([200, 200, 429]);
  });
});

// ---------------------------------------------------------------- privacy

describe('privacy: the image, provider data and secrets never leave memory', () => {
  it('never stores the image, a template or the candidate list, and never audits them', async () => {
    reset();
    const marker = `PRIVACYMARKER${randomUUID().replaceAll('-', '')}`;
    const s = await seed({ label: marker });
    const sc = (await scan(adminA, eventA, jpegOf(marker))).body.data;
    await faceCheckIn(adminA, eventA, sc.scanId);
    await scan(adminA, eventA, jpegOf(`${marker}-stranger`)); // NO_MATCH
    face.script.candidates = [{ reference: s.reference!, similarity: 0.8 }];
    await scan(adminA, eventA, jpegOf(marker)); // REVIEW_REQUIRED
    reset();

    // the face-scan record has no column that could hold an image, a template or an embedding. The one exception is
    // scan_image_url: the ADDRESS of the frame the face service kept (checked below to hold no image data).
    const { rows: cols } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name in ('face_scans', 'check_ins')`,
    );
    expect(
      cols
        .map((c) => c.column_name)
        .filter((c) => /image|photo|template|embedding|vector|bytes|blob|candidate/i.test(c)),
    ).toEqual(['scan_image_url']);

    // and no text anywhere near the event-day tables contains the image (its bytes carry the marker)
    for (const table of ['face_scans', 'check_ins', 'audit_logs']) {
      const { rows } = await db.query(
        `select count(*)::int n from public.${table} t where to_jsonb(t)::text ilike $1`,
        [`%${marker}%`],
      );
      expect(rows[0]!.n, table).toBe(0);
    }
    expect(
      (
        await db.query(
          'select count(*)::int n from public.face_scans where provider_score is not null and result <> $1',
          ['MATCH'],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });

  it('audit entries hold only ids, the result and a reason code', async () => {
    reset();
    const s = await seed();
    const sc = (await scan(adminA, eventA, jpegOf(s.label))).body.data;
    const entry = (await auditOf('FACE_SCAN_PERFORMED', sc.scanId))[0];
    expect(entry).toMatchObject({ actor_user_id: adminA, entity_type: 'face_scan' });
    expect(entry!.metadata).toEqual({
      eventId: eventA,
      result: 'MATCH',
      reasonCode: null,
      registrationId: s.regId,
      playerId: s.playerId,
      candidateCount: null,
    });
    const all = [
      ...(await auditOf('FACE_SCAN_PERFORMED')),
      ...(await auditOf('CHECK_IN_COMPLETED')),
      ...(await auditOf('CHECK_IN_REFUSED')),
    ];
    const text = JSON.stringify(all);
    expect(text).not.toMatch(
      /fake_face_|PROVIDERSECRET|similarity|score|signed|storage_key|base64|authorization|bearer/i,
    );
  });

  it('responses never contain provider references, scores, other events or provider text', async () => {
    reset();
    const s = await seed({ firstName: 'Sensitive', lastName: 'Scan' });
    const responses = [
      await scan(adminA, eventA, jpegOf(s.label)),
      await scan(adminA, eventA, jpegOf('stranger')),
      await scan(adminA, eventA, noFaceJpeg()),
      await scan(adminA, eventB, jpegOf(s.label)), // 403
    ];
    face.failures.identifyExplodes = true;
    responses.push(await scan(adminA, eventA, jpegOf(s.label)));
    reset();
    face.script.candidates = [{ reference: s.reference!, similarity: 0.8 }];
    responses.push(await scan(adminA, eventA, jpegOf(s.label)));
    reset();
    const text = JSON.stringify(responses.map((r) => r.body));
    expect(text).not.toMatch(
      /fake_face_|similarity|score|reference|providerId|provider_profile|PROVIDERSECRET|exploded|identity/i,
    );
    expect(text).not.toContain(s.reference!);
  });

  it('never logs the image, references, provider errors, tokens or secrets', async () => {
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
    const logged = buildApi(db, { logger, faceRecognition: recognition(), faceScan: POLICY });
    const marker = `LOGMARKER${randomUUID().replaceAll('-', '')}`;
    const s = await seed({ label: marker });
    const token = (await bearerFor(adminA)).Authorization;

    reset();
    const ok = (await scan(adminA, eventA, jpegOf(marker), { app: logged })).body.data;
    await checkIn(
      adminA,
      eventA,
      { method: 'FACE', scanId: ok.scanId, clientRequestId: randomUUID() },
      logged,
    );
    face.failures.identifyExplodes = true; // the provider's error text contains a secret
    await scan(adminA, eventA, jpegOf(marker), { app: logged });
    reset();
    face.failures.identify = 'UNAVAILABLE';
    await scan(adminA, eventA, jpegOf(marker), { app: logged });
    reset();
    await search(adminA, eventA, 'Rivera 1999-01-01', logged);
    await scan(adminA, eventA, Buffer.alloc(3 * 1024 * 1024, 0xff), { app: logged });

    const out = lines.join('\n');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain(marker);
    expect(out).not.toContain(s.reference!);
    expect(out).not.toContain(PROVIDER_SECRET);
    expect(out).not.toContain(token.replace('Bearer ', ''));
    expect(out).not.toMatch(/1999-01-01|authorization/i); // (the scrubbed error text may be logged; the secret may not)
  });
});

// ---------------------------------------------------------------- migration

describe('migration 20261011000001_event_day_check_ins (real PostgreSQL)', () => {
  it('adds the idempotency column and the scan-reuse constraint, and replaces the old plain index', async () => {
    const { rows: cons } = await db.query<{ conname: string }>(
      `select conname from pg_constraint where conrelid = 'public.check_ins'::regclass and contype = 'u'`,
    );
    expect(cons.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'check_ins_face_scan_id_key',
        'check_ins_client_request_id_key',
        'check_ins_registration_id_key',
      ]),
    );
    const { rows: idx } = await db.query(
      `select 1 from pg_indexes where indexname = 'check_ins_face_scan_idx'`,
    );
    expect(idx).toHaveLength(0);
    const { rows: trg } = await db.query(
      `select tgname from pg_trigger where tgrelid = 'public.check_ins'::regclass and not tgisinternal order by tgname`,
    );
    expect(trg.map((t) => t.tgname)).toEqual(
      expect.arrayContaining([
        'check_ins_require_ready_registration',
        'check_ins_require_valid_scan',
      ]),
    );
  });
});
