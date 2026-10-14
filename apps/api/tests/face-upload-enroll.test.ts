import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import {
  createFakeFaceProvider,
  jpegOf,
  noFaceJpeg,
  type FakeFace,
} from './helpers/fake-face';
import { createFakeStorage, type FakeStorage } from './helpers/fake-storage';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';
import { checkEligibility } from '../src/modules/eventday/eligibility';

/** A profile photo becomes a face the moment it is uploaded; an admin rejecting it takes the face away and flags the person. */
let db: Database;
let storage: FakeStorage;
let face: FakeFace;
let app: ReturnType<typeof buildApi>;
let eventA: string;
let teamA: string;
let adminA: string;

const R = '/api/v1/registrations';
const D = '/api/v1/documents';

beforeAll(async () => {
  db = openTestDb();
  storage = createFakeStorage();
  face = createFakeFaceProvider();
  app = buildApi(db, {
    storage,
    faceRecognition: {
      provider: face.provider,
      images: storage.reader,
      consentPolicy: 'BIOMETRIC_TEST', // no such consent is ever recorded below: upload enrollment must not need it
      timeoutMs: 2000,
      enrollOnUpload: true,
    },
  });
  const org = await createOrg(db);
  eventA = await createEvent(db, org);
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: org })).id;
});
afterAll(() => db.close());

async function family() {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id);
  const reg = await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA });
  return { parent, playerId, regId: reg.body.data.id as string };
}
type Family = Awaited<ReturnType<typeof family>>;

/** Uploads and confirms a PROFILE_PHOTO. Returns the document id and the answer to "complete". */
async function uploadPhoto(f: Family, bytes: Uint8Array) {
  const up = await as(app, f.parent.id).post(`${R}/${f.regId}/documents/upload-url`, {
    documentType: 'PROFILE_PHOTO',
    fileName: 'me.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: bytes.length,
  });
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  const id = up.body.data.document.id as string;
  const { rows } = await db.query<{ storage_key: string }>(
    'select storage_key from public.documents where id = $1',
    [id],
  );
  storage.put(rows[0]!.storage_key, bytes);
  const done = await as(app, f.parent.id).post(`${D}/${id}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return { id, done };
}

const profile = async (playerId: string) =>
  (
    await db.query<{ status: string; consent_record_id: string | null; source_document_id: string }>(
      'select status, consent_record_id, source_document_id from public.face_profiles where player_id = $1 order by created_at',
      [playerId],
    )
  ).rows;

describe('face enrollment on photo upload', () => {
  it('enrolls at once, with no admin approval and no biometric consent', async () => {
    const f = await family();
    const { id, done } = await uploadPhoto(f, jpegOf(`upload-${Math.random()}`));
    expect(done.body.data.faceEnrollment).toEqual({ outcome: 'ENROLLED' });
    expect(await profile(f.playerId)).toEqual([
      { status: 'ACTIVE', consent_record_id: null, source_document_id: id },
    ]);
  });

  it('tells the family what to fix when the photo has no usable face, and keeps the upload', async () => {
    const f = await family();
    const { done } = await uploadPhoto(f, noFaceJpeg());
    expect(done.body.data.faceEnrollment).toEqual({ outcome: 'FAILED', problem: 'NO_FACE_DETECTED' });
    expect(done.body.data.uploadedAt).not.toBeNull();
    expect(await profile(f.playerId)).toEqual([]);
  });

  it('replaces the face when the photo is retaken', async () => {
    const f = await family();
    await uploadPhoto(f, jpegOf(`first-${Math.random()}`));
    const second = await uploadPhoto(f, jpegOf(`second-${Math.random()}`));
    expect(second.done.body.data.faceEnrollment?.outcome).toBe('ENROLLED');
    const rows = await profile(f.playerId);
    expect(rows.map((r) => r.status)).toEqual(['REVOKED', 'ACTIVE']);
  });
});

describe('admin rejecting the photo', () => {
  it('removes the face, flags the person, and refuses check-in with the reason', async () => {
    const f = await family();
    const { id } = await uploadPhoto(f, jpegOf(`reject-${Math.random()}`));
    expect((await as(app, f.parent.id).post(`${D}/${id}/submit`)).status).toBe(200);
    const removedBefore = face.removed.length;
    const review = await as(app, adminA).patch(`${D}/${id}/review`, {
      decision: 'REJECTED',
      reasonCode: 'UNREADABLE',
      reason: 'Not the player',
    });
    expect(review.status, JSON.stringify(review.body)).toBe(200);

    expect(face.removed.length).toBe(removedBefore + 1);
    expect((await profile(f.playerId)).map((r) => r.status)).toEqual(['REVOKED']);

    for (const method of ['FACE', 'MANUAL'] as const) {
      const result = await checkEligibility(db, {
        eventId: eventA,
        registrationId: f.regId,
        method,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('PHOTO_REJECTED');
    }
  });
});
