import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FaceProviderError,
  IMAGE_PROBLEM_CODES,
  type FaceImage,
} from '../src/infrastructure/face/face-provider';
import {
  createFaceProvider,
  registeredFaceProviders,
} from '../src/infrastructure/face/provider-registry';
import type { Database } from '../src/infrastructure/database/database';
import { createFakeFaceProvider, jpegOf, noFaceJpeg } from './helpers/fake-face';
import { runFaceProviderContract } from './helpers/face-provider-contract';
import { createFakeStorage, fileBytes } from './helpers/fake-storage';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, bearerFor, createUser, openTestDb } from './helpers/test-app';

const img = (bytes: Uint8Array): FaceImage => ({ bytes, mimeType: 'image/jpeg' });
const samples = {
  faceA1: img(jpegOf('person-a')),
  faceA2: img(jpegOf('person-a')),
  faceB: img(jpegOf('person-b')),
  noFace: img(noFaceJpeg()),
};

// The same contract, against two independent implementations: a future real adapter must pass it too.
runFaceProviderContract('fake provider "fake"', () => createFakeFaceProvider().provider, samples, {
  sameFaceMatchesAcrossPhotos: false,
});
runFaceProviderContract(
  'second fake provider "alt" (different name and reference format)',
  () => createFakeFaceProvider({ name: 'alt', referencePrefix: 'ALT-' }).provider,
  samples,
  { sameFaceMatchesAcrossPhotos: false },
);

describe('provider registry', () => {
  it('registers only the real node-native adapter: no stand-in provider is shipped in production code', () => {
    expect(registeredFaceProviders()).toEqual(['node-native']);
    expect(createFaceProvider('rekognition', {}, { db: {} as never })).toBeUndefined();
    expect(createFaceProvider(undefined, {}, { db: {} as never })).toBeUndefined();
    expect(createFaceProvider('fake', {}, { db: {} as never })).toBeUndefined();
  });
});

describe('error vocabulary', () => {
  it('separates image problems the user can fix from provider outages', () => {
    expect(IMAGE_PROBLEM_CODES).toEqual([
      'NO_FACE_DETECTED',
      'MULTIPLE_FACES',
      'LOW_QUALITY',
      'IMAGE_REJECTED',
    ]);
    expect(IMAGE_PROBLEM_CODES).not.toContain('UNAVAILABLE');
    expect(IMAGE_PROBLEM_CODES).not.toContain('TIMEOUT');
    const e = new FaceProviderError('TIMEOUT');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('FaceProviderError');
    expect(e.message).toBe('TIMEOUT'); // a code, never provider text
  });
});

/** The application depends only on the interface: swapping the implementation changes nothing else. */
describe('swapping the provider behind the interface', () => {
  let db: Database;
  beforeAll(() => {
    db = openTestDb();
  });
  afterAll(() => db.close());

  async function setup(provider: ReturnType<typeof createFakeFaceProvider>) {
    const storage = createFakeStorage();
    const app = buildApi(db, {
      storage,
      faceRecognition: {
        provider: provider.provider,
        images: storage.reader,
        consentPolicy: 'NONE',
        timeoutMs: 2000,
      },
    });
    return { storage, app };
  }

  async function readyFamily(
    app: ReturnType<typeof buildApi>,
    storage: ReturnType<typeof createFakeStorage>,
  ) {
    const org = await createOrg(db);
    const admin = await createUser(db, { roles: ['ADMIN'], organizationId: org });
    const event = await createEvent(db, org);
    const team = await createTeam(db, event);
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    const regId = (
      await as(app, parent.id).post('/api/v1/registrations', {
        eventId: event,
        playerId,
        teamId: team,
      })
    ).body.data.id as string;
    const bytes = jpegOf('swap-test');
    const up = await as(app, parent.id).post(
      `/api/v1/registrations/${regId}/documents/upload-url`,
      {
        documentType: 'PROFILE_PHOTO',
        fileName: 'p.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      },
    );
    const docId = up.body.data.document.id as string;
    const key = (
      await db.query<{ storage_key: string }>(
        'select storage_key from public.documents where id = $1',
        [docId],
      )
    ).rows[0]!.storage_key;
    storage.put(key, bytes);
    await as(app, parent.id).post(`/api/v1/documents/${docId}/complete`);
    await as(app, parent.id).post(`/api/v1/documents/${docId}/submit`);
    await as(app, admin.id).patch(`/api/v1/documents/${docId}/review`, { decision: 'APPROVED' });
    return { parent, playerId, docId };
  }

  it('records whichever provider enrolled the profile, with the same API behavior', async () => {
    for (const [name, prefix] of [
      ['fake', 'fake_face_'],
      ['alt', 'ALT-'],
    ] as const) {
      const provider = createFakeFaceProvider({ name, referencePrefix: prefix });
      const { app, storage } = await setup(provider);
      const f = await readyFamily(app, storage);
      // The admin's approval of the photo (in readyFamily) already enrolled it, as the policy here waives consent.
      const res = await as(app, f.parent.id).get(`/api/v1/players/${f.playerId}/face-profile`);
      expect(res.status, name).toBe(200);
      expect(res.body.data).toEqual({
        playerId: f.playerId,
        status: 'ACTIVE',
        enrolledAt: expect.any(String),
        revokedAt: null,
      });
      const row = (
        await db.query<{ provider: string; provider_profile_id: string }>(
          'select provider, provider_profile_id from public.face_profiles where player_id = $1',
          [f.playerId],
        )
      ).rows[0]!;
      expect(row.provider).toBe(name);
      expect(row.provider_profile_id.startsWith(prefix)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(prefix);
    }
  });

  it('does not allow a second provider to enroll while one profile is active; switching means removing first', async () => {
    const first = createFakeFaceProvider({ name: 'fake' });
    const second = createFakeFaceProvider({ name: 'alt', referencePrefix: 'ALT-' });
    const a = await setup(first);
    const b = {
      app: buildApi(db, {
        storage: a.storage,
        faceRecognition: {
          provider: second.provider,
          images: a.storage.reader,
          consentPolicy: 'NONE',
          timeoutMs: 2000,
        },
      }),
    };
    const f = await readyFamily(a.app, a.storage);
    const url = `/api/v1/players/${f.playerId}/face-profile`;

    // enrolled by the approval of the photo
    expect((await as(a.app, f.parent.id).get(url)).body.data.status).toBe('ACTIVE');
    const blocked = await as(b.app, f.parent.id).post(url, { documentId: f.docId });
    expect(blocked.status).toBe(409);
    expect(second.enrollCalls).toEqual([]);

    // the new provider is asked to remove an identity it never held: that must simply succeed
    const { default: request } = await import('supertest');
    expect(
      (
        await request(b.app)
          .delete(url)
          .set('Authorization', (await bearerFor(f.parent.id)).Authorization)
      ).status,
    ).toBe(200);
    expect((await as(b.app, f.parent.id).post(url, { documentId: f.docId })).status).toBe(201);
    const rows = (
      await db.query<{ provider: string; status: string }>(
        'select provider, status from public.face_profiles where player_id = $1 order by enrolled_at',
        [f.playerId],
      )
    ).rows;
    expect(rows).toEqual([
      { provider: 'fake', status: 'REVOKED' },
      { provider: 'alt', status: 'ACTIVE' },
    ]);
  });

  it('keeps unused interface operations (identify, verify) provider-neutral and ready for event-day use', async () => {
    const { provider } = createFakeFaceProvider();
    const enrolled = await provider.enroll({
      subjectId: 'p',
      image: img(fileBytes.jpeg()),
      idempotencyKey: 'k',
    });
    const found = await provider.identify({ image: img(fileBytes.jpeg()), maxCandidates: 3 });
    const verified = await provider.verify({
      reference: enrolled.reference,
      image: img(fileBytes.jpeg()),
    });
    expect(found.candidates[0]).toMatchObject({ reference: enrolled.reference });
    expect(verified.similarity).toBeGreaterThan(0.5);
  });
});
