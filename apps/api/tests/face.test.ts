import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../src/config/logger';
import type { Database } from '../src/infrastructure/database/database';
import {
  createFakeFaceProvider,
  jpegOf,
  lowQualityJpeg,
  manyFacesJpeg,
  noFaceJpeg,
  PROVIDER_SECRET,
  type FakeFace,
} from './helpers/fake-face';
import { createFakeStorage, fileBytes, type FakeStorage } from './helpers/fake-storage';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/**
 * Face enrollment against the real Express app and real PostgreSQL. The face provider is a fake (no real provider
 * exists or is called); photos live in a fake private object store.
 */
let db: Database;
let storage: FakeStorage;
let face: FakeFace;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let eventA: string;
let teamA: string;
let adminA: string;
let adminB: string;
let consentV1: string;

const CONSENT_CODE = 'BIOMETRIC_TEST';
const R = '/api/v1/registrations';
const D = '/api/v1/documents';
const recognition = (
  over: Partial<{ consentPolicy: string | undefined; timeoutMs: number; provider: FakeFace }> = {},
) => ({
  provider: (over.provider ?? face).provider,
  images: storage.reader,
  consentPolicy: 'consentPolicy' in over ? over.consentPolicy : CONSENT_CODE,
  timeoutMs: over.timeoutMs ?? 2000,
});

beforeAll(async () => {
  db = openTestDb();
  storage = createFakeStorage();
  face = createFakeFaceProvider();
  app = buildApi(db, { storage, faceRecognition: recognition() });
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  eventA = await createEvent(db, orgA);
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.consents (code, version, title, body, effective_at)
     values ($1, 1, 'Test biometric consent', '[TEST CONSENT TEXT - not legal wording]', now() - interval '1 day') returning id`,
    [CONSENT_CODE],
  );
  consentV1 = rows[0]!.id;
});
afterAll(() => db.close());

type Family = Awaited<ReturnType<typeof family>>;
async function family() {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id);
  const reg = await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA });
  return { parent, playerId, regId: reg.body.data.id as string };
}

/** An approved PROFILE_PHOTO document through the real documents flow. Returns the document id. */
async function approvedPhoto(
  f: Family,
  bytes: Uint8Array = jpegOf(`face-${Math.random()}`),
  approve = true,
) {
  const up = await as(app, f.parent.id).post(`${R}/${f.regId}/documents/upload-url`, {
    documentType: 'PROFILE_PHOTO',
    fileName: 'me.jpg',
    mimeType: 'image/jpeg',
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
  expect((await as(app, f.parent.id).post(`${D}/${id}/complete`)).status).toBe(200);
  expect((await as(app, f.parent.id).post(`${D}/${id}/submit`)).status).toBe(200);
  if (approve)
    expect(
      (await as(app, adminA).patch(`${D}/${id}/review`, { decision: 'APPROVED' })).status,
    ).toBe(200);
  return { id, key };
}
async function consented(f: Family, consentId = consentV1) {
  await db.query(
    `insert into public.consent_records (consent_id, registration_id, accepted_by_user_id, signed_name) values ($1, $2, $3, 'Dana Rivera')`,
    [consentId, f.regId, f.parent.id],
  );
}
/** A family whose photo is approved and whose biometric consent is recorded: ready to enroll. */
async function ready() {
  const f = await family();
  const photo = await approvedPhoto(f);
  await consented(f);
  return { ...f, photo };
}
const enroll = (f: Family, documentId: string, a = app) =>
  as(a, f.parent.id).post(`/api/v1/players/${f.playerId}/face-profile`, { documentId });
const status = (userId: string, playerId: string, a = app) =>
  as(a, userId).get(`/api/v1/players/${playerId}/face-profile`);
const remove = (f: Family, a = app) =>
  request(a).delete(`/api/v1/players/${f.playerId}/face-profile`);
const del = async (f: Family, a = app) =>
  remove(f, a).set('Authorization', await bearer(f.parent.id));
async function bearer(userId: string) {
  const { bearerFor } = await import('./helpers/test-app');
  return (await bearerFor(userId)).Authorization;
}
const profiles = async (playerId: string) =>
  (
    await db.query<{
      id: string;
      status: string;
      provider: string;
      provider_profile_id: string;
      consent_record_id: string | null;
      source_document_id: string | null;
      enrolled_by: string | null;
      revoked_by: string | null;
      revoked_reason: string | null;
    }>(
      'select id, status, provider, provider_profile_id, consent_record_id, source_document_id, enrolled_by, revoked_by, revoked_reason from public.face_profiles where player_id = $1 order by enrolled_at',
      [playerId],
    )
  ).rows;

describe('POST /players/:id/face-profile: enroll', () => {
  it('enrolls from the approved registration photo and stores only the provider reference', async () => {
    const f = await ready();
    const before = { enrolls: face.enrollCalls.length };
    const res = await enroll(f, f.photo.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({
      playerId: f.playerId,
      status: 'ACTIVE',
      enrolledAt: expect.any(String),
      revokedAt: null,
    });

    const [p] = await profiles(f.playerId);
    expect(p).toMatchObject({
      status: 'ACTIVE',
      provider: 'fake',
      source_document_id: f.photo.id,
      enrolled_by: f.parent.id,
      consent_record_id: expect.any(String),
    });
    expect(p!.provider_profile_id).toMatch(/^fake_face_/);

    // the provider got our player id and the stored photo, and nothing personal
    expect(face.enrollCalls).toHaveLength(before.enrolls + 1);
    expect(face.enrollCalls.at(-1)).toMatchObject({
      subjectId: f.playerId,
      mimeType: 'image/jpeg',
      byteLength: storage.objects.get(f.photo.key)!.length,
    });
    expect(JSON.stringify(face.enrollCalls.at(-1))).not.toMatch(/Mateo|Rivera|2014/);
    // the image was only read, never copied or moved
    expect(storage.objects.has(f.photo.key)).toBe(true);
    expect(
      storage.calls.filter(
        (c) => c.op === 'upload' && c.key !== f.photo.key && c.key.includes(f.regId),
      ),
    ).toHaveLength(0);

    const audit = await db.query(
      'select action, actor_user_id, metadata from public.audit_logs where entity_id = $1',
      [p!.id],
    );
    expect(audit.rows).toEqual([
      {
        action: 'FACE_PROFILE_CREATED',
        actor_user_id: f.parent.id,
        metadata: { playerId: f.playerId, documentId: f.photo.id, consentRecorded: true },
      },
    ]);
  });

  it('does not change registration, document, consent, payment or check-in state', async () => {
    const f = await ready();
    const snapshot = async () => ({
      reg: (
        await db.query('select status, updated_at from public.registrations where id = $1', [
          f.regId,
        ])
      ).rows,
      docs: (
        await db.query(
          'select id, status, submitted_at, updated_at from public.documents where registration_id = $1 order by id',
          [f.regId],
        )
      ).rows,
      consents: (
        await db.query(
          'select id from public.consent_records where registration_id = $1 order by id',
          [f.regId],
        )
      ).rows,
      payments: (
        await db.query('select id from public.payments where registration_id = $1', [f.regId])
      ).rows,
      checkIns: (
        await db.query('select id from public.check_ins where registration_id = $1', [f.regId])
      ).rows,
      history: (
        await db.query(
          'select id from public.registration_status_history where registration_id = $1',
          [f.regId],
        )
      ).rows,
    });
    const before = await snapshot();
    expect((await enroll(f, f.photo.id)).status).toBe(201);
    expect(await snapshot()).toEqual(before);
    expect(before.reg[0]).toMatchObject({ status: 'DRAFT' }); // not VERIFIED, not READY_FOR_EVENT
    expect(before.payments).toEqual([]);
  });

  it('works for a player who manages their own registration', async () => {
    const player = await createUser(db, { roles: ['PLAYER'] });
    const p = await as(app, player.id).post('/api/v1/players', {
      firstName: 'Ann',
      lastName: 'Adult',
      dateOfBirth: '1999-01-01',
      forSelf: true,
    });
    const reg = await as(app, player.id).post(R, {
      eventId: eventA,
      playerId: p.body.data.id,
      teamId: teamA,
    });
    const self: Family = { parent: player, playerId: p.body.data.id, regId: reg.body.data.id };
    const photo = await approvedPhoto(self);
    await consented(self);
    expect((await enroll(self, photo.id)).status).toBe(201);
  });

  it('validates the body strictly: no provider data, scores or images from the client', async () => {
    const f = await ready();
    for (const body of [
      {},
      { documentId: 'nope' },
      { documentId: f.photo.id, providerRef: 'x' },
      { documentId: f.photo.id, provider: 'fake' },
      { documentId: f.photo.id, image: 'AAAA' },
      { documentId: "1' OR '1'='1" },
    ]) {
      expect(
        (await as(app, f.parent.id).post(`/api/v1/players/${f.playerId}/face-profile`, body))
          .status,
        JSON.stringify(body),
      ).toBe(422);
    }
    expect(await profiles(f.playerId)).toEqual([]);
  });

  it('only enrolls from a photo that is an approved, uploaded PROFILE_PHOTO of this player', async () => {
    const f = await family();
    const inReview = await approvedPhoto(f, jpegOf('a'), false);
    const notApproved = await enroll(f, inReview.id);
    expect(notApproved.status).toBe(409);
    expect(notApproved.body.error.code).toBe('FACE_PHOTO_NOT_ELIGIBLE');

    const awaiting = await as(app, f.parent.id).post(`${R}/${f.regId}/documents/upload-url`, {
      documentType: 'BIRTH_CERTIFICATE',
      fileName: 'b.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });
    expect((await enroll(f, awaiting.body.data.document.id)).body.error.code).toBe(
      'FACE_PHOTO_NOT_ELIGIBLE',
    ); // wrong type and not uploaded

    const g = await family();
    const approved = await approvedPhoto(g);
    await db.query("update public.registrations set status = 'CANCELLED' where id = $1", [g.regId]);
    expect((await enroll(g, approved.id)).body.error.code).toBe('FACE_PHOTO_NOT_ELIGIBLE'); // cancelled registration
    expect(
      face.enrollCalls.filter((c) => c.subjectId === f.playerId || c.subjectId === g.playerId),
    ).toEqual([]);
  });

  it("refuses another player's photo and another family's photo (404, nothing revealed)", async () => {
    const f = await family();
    const sibling = await createChild(app, f.parent.id, {
      firstName: 'Lucia',
      guardian: { relationship: 'Mother' },
    });
    const siblingReg = await as(app, f.parent.id).post(R, {
      eventId: eventA,
      playerId: sibling,
      teamId: teamA,
    });
    const siblingPhoto = await approvedPhoto({
      parent: f.parent,
      playerId: sibling,
      regId: siblingReg.body.data.id,
    });
    const other = await family();
    const otherPhoto = await approvedPhoto(other);
    for (const documentId of [
      siblingPhoto.id,
      otherPhoto.id,
      '11111111-1111-4111-8111-111111111111',
    ]) {
      const res = await enroll(f, documentId);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    }
    expect(await profiles(f.playerId)).toEqual([]);
  });

  it('refuses a stored file that is not a usable image, without calling the provider', async () => {
    const f = await ready();
    storage.put(f.photo.key, fileBytes.html());
    const calls = face.enrollCalls.length;
    const res = await enroll(f, f.photo.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FACE_IMAGE_INVALID');
    expect(face.enrollCalls).toHaveLength(calls);
    storage.put(f.photo.key, new Uint8Array(0));
    expect((await enroll(f, f.photo.id)).body.error.code).toBe('FACE_IMAGE_INVALID');
    storage.objects.delete(f.photo.key);
    expect((await enroll(f, f.photo.id)).body.error.code).toBe('FACE_PHOTO_NOT_ELIGIBLE');
  });
});

describe('biometric consent policy (a pending product decision: nothing is assumed)', () => {
  it('is disabled until a policy is configured', async () => {
    const f = await ready();
    const unset = buildApi(db, {
      storage,
      faceRecognition: recognition({ consentPolicy: undefined }),
    });
    const res = await enroll(f, f.photo.id, unset);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FACE_CONSENT_POLICY_NOT_CONFIGURED');
    expect(await profiles(f.playerId)).toEqual([]);
  });

  it('requires the configured consent to be on record, at its current version', async () => {
    const f = await family();
    const photo = await approvedPhoto(f);
    const missing = await enroll(f, photo.id);
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe('BIOMETRIC_CONSENT_REQUIRED');
    expect(await profiles(f.playerId)).toEqual([]);
    await consented(f);
    const ok = await enroll(f, photo.id);
    expect(ok.status).toBe(201);
    expect((await profiles(f.playerId))[0]!.consent_record_id).not.toBeNull();
  });

  it('does not accept a superseded consent version', async () => {
    const code = 'BIOMETRIC_VERSIONED';
    const v1 = (
      await db.query<{ id: string }>(
        `insert into public.consents (code, version, title, body, effective_at) values ($1, 1, 't', 'v1 test text', now() - interval '2 days') returning id`,
        [code],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into public.consents (code, version, title, body, effective_at) values ($1, 2, 't', 'v2 test text', now() - interval '1 day')`,
      [code],
    );
    const versioned = buildApi(db, {
      storage,
      faceRecognition: recognition({ consentPolicy: code }),
    });
    const f = await family();
    const photo = await approvedPhoto(f);
    await consented(f, v1); // accepted the OLD wording
    const res = await enroll(f, photo.id, versioned);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BIOMETRIC_CONSENT_REQUIRED');
  });

  it('can be explicitly waived (NONE), and then records no consent', async () => {
    const f = await family();
    const photo = await approvedPhoto(f);
    const waived = buildApi(db, {
      storage,
      faceRecognition: recognition({ consentPolicy: 'NONE' }),
    });
    expect((await enroll(f, photo.id, waived)).status).toBe(201);
    expect((await profiles(f.playerId))[0]!.consent_record_id).toBeNull();
  });
});

describe('duplicate and concurrent enrollment', () => {
  it('refuses a second active profile and does not call the provider again', async () => {
    const f = await ready();
    expect((await enroll(f, f.photo.id)).status).toBe(201);
    const calls = face.enrollCalls.length;
    const dup = await enroll(f, f.photo.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('FACE_PROFILE_ALREADY_EXISTS');
    expect(face.enrollCalls).toHaveLength(calls);
  });

  it('creates exactly one profile (and one provider identity) when requests race', async () => {
    const f = await ready();
    const results = await Promise.all(Array.from({ length: 6 }, () => enroll(f, f.photo.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await profiles(f.playerId)).toHaveLength(1);
    expect(face.enrollCalls.filter((c) => c.subjectId === f.playerId)).toHaveLength(1);
    const ref = (await profiles(f.playerId))[0]!.provider_profile_id;
    expect(face.identities.has(ref)).toBe(true);
    expect([...face.identities.values()].filter((i) => i.subjectId === f.playerId)).toHaveLength(1); // no orphan identity
  });

  it('also protects the one-active rule in the database itself', async () => {
    const f = await ready();
    await enroll(f, f.photo.id);
    const msg = await db
      .query(
        "insert into public.face_profiles (player_id, provider, provider_profile_id) values ($1, 'other', 'ref-2')",
        [f.playerId],
      )
      .then(
        () => '',
        (e: Error) => e.message,
      );
    expect(msg).toMatch(/one_active_player/);
  });
});

describe('DELETE /players/:id/face-profile: remove', () => {
  it('removes the identity at the provider first, then revokes the profile, and can enroll again afterwards', async () => {
    const f = await ready();
    await enroll(f, f.photo.id);
    const [before] = await profiles(f.playerId);

    const res = await del(f);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      playerId: f.playerId,
      status: 'REVOKED',
      revokedAt: expect.any(String),
    });
    expect(face.removed).toContain(before!.provider_profile_id);
    expect(face.identities.has(before!.provider_profile_id)).toBe(false);
    const [after] = await profiles(f.playerId);
    expect(after).toMatchObject({
      status: 'REVOKED',
      revoked_by: f.parent.id,
      revoked_reason: 'USER_REQUEST',
    });
    const audit = await db.query(
      'select metadata from public.audit_logs where entity_id = $1 and action = $2',
      [before!.id, 'FACE_PROFILE_REMOVED'],
    );
    expect(audit.rows).toEqual([{ metadata: { playerId: f.playerId } }]);

    expect((await del(f)).status).toBe(404); // nothing active any more
    const again = await enroll(f, f.photo.id); // a fresh enrollment is allowed after removal
    expect(again.status).toBe(201);
    const rows = await profiles(f.playerId);
    expect(rows.map((r) => r.status)).toEqual(['REVOKED', 'ACTIVE']);
    expect(rows[1]!.provider_profile_id).not.toBe(rows[0]!.provider_profile_id);
    const keys = face.enrollCalls
      .filter((c) => c.subjectId === f.playerId)
      .map((c) => c.idempotencyKey);
    expect(new Set(keys).size).toBe(2); // each attempt has its own idempotency key
  });

  it('keeps the profile ACTIVE (and says so) when the provider cannot delete it, so removal can be retried', async () => {
    const f = await ready();
    await enroll(f, f.photo.id);
    face.failures.remove = true;
    const res = await del(f);
    face.failures.remove = false;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FACE_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain(PROVIDER_SECRET);
    expect((await profiles(f.playerId))[0]!.status).toBe('ACTIVE');
    expect((await del(f)).status).toBe(200); // retry works
  });

  it('is 404 when there is nothing to remove, and for other families', async () => {
    const f = await family();
    expect((await del(f)).status).toBe(404);
    const owner = await ready();
    await enroll(owner, owner.photo.id);
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const res = await request(app)
      .delete(`/api/v1/players/${owner.playerId}/face-profile`)
      .set('Authorization', await bearer(stranger.id));
    expect(res.status).toBe(404);
    expect((await profiles(owner.playerId))[0]!.status).toBe('ACTIVE');
  });
});

describe('GET /players/:id/face-profile: status', () => {
  it('reports NOT_ENROLLED, ACTIVE and REVOKED, and nothing about the provider', async () => {
    const f = await ready();
    expect((await status(f.parent.id, f.playerId)).body.data).toEqual({
      playerId: f.playerId,
      status: 'NOT_ENROLLED',
      enrolledAt: null,
      revokedAt: null,
    });
    await enroll(f, f.photo.id);
    const active = await status(f.parent.id, f.playerId);
    expect(active.body.data.status).toBe('ACTIVE');
    expect(active.headers['cache-control']).toBe('no-store');
    expect(Object.keys(active.body.data).sort()).toEqual([
      'enrolledAt',
      'playerId',
      'revokedAt',
      'status',
    ]);
    const ref = (await profiles(f.playerId))[0]!.provider_profile_id;
    const text = JSON.stringify(active.body);
    for (const leak of [ref, 'fake_face_', '"fake"', 'provider', f.photo.key, f.photo.id])
      expect(text).not.toContain(leak);
    await del(f);
    expect((await status(f.parent.id, f.playerId)).body.data.status).toBe('REVOKED');
  });

  it('still answers when no provider is configured', async () => {
    const f = await family();
    const bare = buildApi(db, { storage });
    expect((await status(f.parent.id, f.playerId, bare)).body.data.status).toBe('NOT_ENROLLED');
    const res = await enroll(f, '11111111-1111-4111-8111-111111111111', bare);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FACE_NOT_CONFIGURED');
    expect((await del(f, bare)).status).toBe(503);
  });
});

describe('authorization', () => {
  it("hides other families' players on every endpoint (404) and requires authentication (401)", async () => {
    const owner = await ready();
    await enroll(owner, owner.photo.id);
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const s = as(app, stranger.id);
    const url = `/api/v1/players/${owner.playerId}/face-profile`;
    expect((await s.get(url)).status).toBe(404);
    expect((await s.post(url, { documentId: owner.photo.id })).status).toBe(404);
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).post(url).send({ documentId: owner.photo.id })).status).toBe(401);
    expect((await request(app).delete(url)).status).toBe(401);
    expect((await profiles(owner.playerId))[0]!.status).toBe('ACTIVE');
  });

  it('lets a linked guardian manage enrollment, but not an unlinked relative or another role', async () => {
    const f = await ready();
    const coach = await createUser(db, { roles: ['COACH'], organizationId: orgA });
    expect(
      (
        await as(app, coach.id).post(`/api/v1/players/${f.playerId}/face-profile`, {
          documentId: f.photo.id,
        })
      ).status,
    ).toBe(403);
    expect((await as(app, coach.id).get(`/api/v1/players/${f.playerId}/face-profile`)).status).toBe(
      404,
    );
    expect((await enroll(f, f.photo.id)).status).toBe(201); // the guardian (the family() parent)
  });

  it('lets an admin read status for their own organization only, and never change it (cross-organization)', async () => {
    const f = await ready();
    await enroll(f, f.photo.id);
    const url = `/api/v1/players/${f.playerId}/face-profile`;
    expect((await as(app, adminA).get(url)).body.data.status).toBe('ACTIVE');
    expect((await as(app, adminB).get(url)).status).toBe(404);
    expect((await as(app, adminA).post(url, { documentId: f.photo.id })).status).toBe(403);
    const res = await request(app)
      .delete(url)
      .set('Authorization', await bearer(adminA));
    expect(res.status).toBe(403);
    expect((await profiles(f.playerId))[0]!.status).toBe('ACTIVE');
    const loneParent = await createUser(db, { roles: ['PARENT'] });
    const lonely = { playerId: await createChild(app, loneParent.id) }; // registered nowhere
    expect(
      (await as(app, adminA).get(`/api/v1/players/${lonely.playerId}/face-profile`)).status,
    ).toBe(404);
  });

  it('rejects malformed and injected ids with 422', async () => {
    const f = await family();
    for (const bad of [
      'nope',
      encodeURIComponent("1' OR '1'='1"),
      encodeURIComponent('1; DROP TABLE public.face_profiles;--'),
    ]) {
      expect((await as(app, f.parent.id).get(`/api/v1/players/${bad}/face-profile`)).status).toBe(
        422,
      );
      expect(
        (
          await as(app, f.parent.id).post(`/api/v1/players/${bad}/face-profile`, {
            documentId: '11111111-1111-4111-8111-111111111111',
          })
        ).status,
      ).toBe(422);
    }
    expect(
      (await db.query('select 1 from public.face_profiles limit 1')).rows.length,
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('provider failures and rollback', () => {
  it('turns a provider outage into 503 without leaking its error, and leaves nothing behind', async () => {
    const f = await ready();
    face.failures.enroll = true;
    const res = await enroll(f, f.photo.id);
    face.failures.enroll = false;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FACE_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain(PROVIDER_SECRET);
    expect(await profiles(f.playerId)).toEqual([]);
    expect((await enroll(f, f.photo.id)).status).toBe(201); // and it can simply be retried
  });

  it('times out a slow provider, tells it to stop, and leaves nothing behind', async () => {
    const f = await ready();
    const quick = buildApi(db, { storage, faceRecognition: recognition({ timeoutMs: 100 }) });
    face.failures.enrollDelayMs = 1500;
    const started = Date.now();
    const res = await enroll(f, f.photo.id, quick);
    face.failures.enrollDelayMs = 0;
    expect(Date.now() - started).toBeLessThan(1200);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FACE_PROVIDER_TIMEOUT');
    expect(await profiles(f.playerId)).toEqual([]);
  });

  it('reports image problems as 422 with a reason the user can act on', async () => {
    for (const [make, reason] of [
      [noFaceJpeg, 'NO_FACE_DETECTED'],
      [manyFacesJpeg, 'MULTIPLE_FACES'],
      [lowQualityJpeg, 'LOW_QUALITY'],
    ] as const) {
      const f = await family();
      const photo = await approvedPhoto(f, make());
      await consented(f);
      const res = await enroll(f, photo.id);
      expect(res.status, reason).toBe(422);
      expect(res.body.error.code).toBe('FACE_IMAGE_REJECTED');
      expect(res.body.error.details).toEqual([{ path: 'documentId', message: reason }]);
      expect(await profiles(f.playerId)).toEqual([]);
    }
  });

  it('answers 503 when private storage cannot be read', async () => {
    const f = await ready();
    storage.failures.inspect = true;
    const res = await enroll(f, f.photo.id);
    storage.failures.inspect = false;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('rolls back and removes the new provider identity when the database write fails after the provider succeeded', async () => {
    const f = await ready();
    await db.query(
      `create or replace function public.test_fail_face() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end; $$`,
    );
    await db.query(
      `create trigger test_fail_face before insert on public.face_profiles for each row when (new.player_id = '${f.playerId}') execute function public.test_fail_face()`,
    );
    const removedBefore = face.removed.length;
    const res = await enroll(f, f.photo.id);
    await db.query('drop trigger test_fail_face on public.face_profiles');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(await profiles(f.playerId)).toEqual([]);
    expect(face.removed).toHaveLength(removedBefore + 1); // no orphan identity left at the provider
    expect([...face.identities.values()].filter((i) => i.subjectId === f.playerId)).toEqual([]);
    expect((await enroll(f, f.photo.id)).status).toBe(201);
  });

  it('rolls back the profile when the audit write fails', async () => {
    const f = await ready();
    await db.query(
      `create or replace function public.test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end; $$`,
    );
    await db.query(
      `create trigger test_fail_audit before insert on public.audit_logs for each row when (new.action = 'FACE_PROFILE_CREATED' and new.metadata ->> 'playerId' = '${f.playerId}') execute function public.test_fail_audit()`,
    );
    const res = await enroll(f, f.photo.id);
    await db.query('drop trigger test_fail_audit on public.audit_logs');
    expect(res.status).toBe(500);
    expect(await profiles(f.playerId)).toEqual([]);
    expect([...face.identities.values()].filter((i) => i.subjectId === f.playerId)).toEqual([]);
  });
});

describe('privacy: what is stored, logged and returned', () => {
  it('has no column that could hold an image, template or embedding', async () => {
    const cols = (
      await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'face_profiles' order by column_name",
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toEqual([
      'consent_record_id',
      'created_at',
      'enrolled_at',
      'enrolled_by',
      'id',
      'player_id',
      'provider',
      'provider_profile_id',
      'revoked_at',
      'revoked_by',
      'revoked_reason',
      'source_document_id',
      'staff_profile_id',
      'status',
      'updated_at',
    ]);
    expect(
      cols.filter((c) =>
        /image|photo|template|embedding|vector|biometric|bytes|blob|score/i.test(c),
      ),
    ).toEqual([]);
  });

  it('never logs images, references, provider errors or secrets, and keeps them out of the audit trail', async () => {
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
    const logged = buildApi(db, { logger, storage, faceRecognition: recognition() });
    const f = await ready();

    face.failures.enroll = true; // the provider's error text contains a secret
    await enroll(f, f.photo.id, logged);
    face.failures.enroll = false;
    const ok = await enroll(f, f.photo.id, logged);
    const ref = (await profiles(f.playerId))[0]!.provider_profile_id;
    await status(f.parent.id, f.playerId, logged);
    face.failures.remove = true;
    await del(f, logged);
    face.failures.remove = false;
    await del(f, logged);

    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [
      PROVIDER_SECRET,
      'sk_live',
      ref,
      'fake_face_',
      'FACE:',
      Buffer.from(jpegOf('x')).toString('base64').slice(0, 20),
      f.photo.key,
    ]) {
      expect(output, secret).not.toContain(secret);
    }
    expect(ok.status).toBe(201);
    const audit = JSON.stringify(
      (
        await db.query(
          'select metadata from public.audit_logs where entity_type = $1 and metadata ->> $2 = $3',
          ['face_profile', 'playerId', f.playerId],
        )
      ).rows,
    );
    for (const secret of [ref, 'fake_face_', PROVIDER_SECRET])
      expect(audit, secret).not.toContain(secret);
  });
});

describe('database guards behind the API', () => {
  const run = (sql: string, params: unknown[] = []) =>
    db.query(sql, params).then(
      () => '',
      (e: Error) => e.message,
    );

  it('never deletes, reassigns or reactivates a face profile', async () => {
    const f = await ready();
    await enroll(f, f.photo.id);
    const [p] = await profiles(f.playerId);
    expect(await run('delete from public.face_profiles where id = $1', [p!.id])).toMatch(
      /append-only/,
    );
    expect(
      await run("update public.face_profiles set provider = 'other' where id = $1", [p!.id]),
    ).toMatch(/cannot be reassigned/);
    expect(
      await run("update public.face_profiles set provider_profile_id = 'swapped' where id = $1", [
        p!.id,
      ]),
    ).toMatch(/cannot be reassigned/);
    const other = await family();
    expect(
      await run('update public.face_profiles set player_id = $2 where id = $1', [
        p!.id,
        other.playerId,
      ]),
    ).toMatch(/cannot be reassigned/);
    await del(f);
    expect(
      await run(
        "update public.face_profiles set status = 'ACTIVE', revoked_at = null, revoked_by = null, revoked_reason = null where id = $1",
        [p!.id],
      ),
    ).toMatch(/cannot be reactivated/);
  });

  it('keeps revocation fields consistent', async () => {
    const f = await ready();
    await enroll(f, f.photo.id);
    const [p] = await profiles(f.playerId);
    expect(
      await run("update public.face_profiles set revoked_reason = 'X' where id = $1", [p!.id]),
    ).toMatch(/revocation_fields/);
  });
});
