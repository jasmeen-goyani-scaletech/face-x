import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { createNodeNativeProvider } from '../src/infrastructure/face/providers/node-native.provider';
import { createTemplateCipher } from '../src/infrastructure/face/providers/node-native/template-cipher';
import { createWorkerEngine } from '../src/infrastructure/face/providers/node-native/worker-engine';
import { createFakeStorage } from './helpers/fake-storage';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { bearerFor, buildApi, createUser, openTestDb } from './helpers/test-app';

/**
 * The whole face path with the REAL engine (face-api on WASM, in its worker thread): register, upload a photo, an admin approves it
 * (automatic enrollment), then scan photos of the same person and of others, and check in by face. It needs real photos of faces, which
 * the repository does not contain, so it only runs when FACE_E2E_DIR names a folder holding:
 *   a.jpg   one clear face (enrolled)            a2.jpg  another photo of the SAME person as a.jpg
 *   b.jpg   a clear face of a second person (enrolled)
 *   c.jpg   a clear face of a third person, never enrolled     none.jpg  a photo with no face in it (optional)
 * Run:  FACE_E2E_DIR=/path/to/photos pnpm --filter @facex/api exec vitest run tests/node-native-e2e.test.ts
 */
const dir = process.env.FACE_E2E_DIR;
const photo = (name: string) => new Uint8Array(readFileSync(path.join(dir ?? '', name)));

describe.skipIf(!dir)(
  'node-native face matching with real photos (real engine, real database)',
  () => {
    let db: Database;
    let app: ReturnType<typeof buildApi>;
    const storage = createFakeStorage();
    const engine = createWorkerEngine();
    let adminId: string;
    let eventId: string;
    let teamId: string;
    const R = '/api/v1/registrations';
    const D = '/api/v1/documents';
    const CODE = 'BIOMETRIC_E2E';

    beforeAll(async () => {
      db = openTestDb();
      const provider = createNodeNativeProvider({
        db,
        engine,
        cipher: createTemplateCipher(randomBytes(32).toString('base64')),
      });
      app = buildApi(db, {
        storage,
        faceRecognition: {
          provider,
          images: storage.reader,
          consentPolicy: CODE,
          timeoutMs: 30_000,
        },
      });
      const org = await createOrg(db);
      eventId = await createEvent(db, org);
      teamId = await createTeam(db, eventId);
      adminId = (await createUser(db, { roles: ['ADMIN'], organizationId: org })).id;
    }, 60_000);
    afterAll(async () => {
      await engine.close();
      await db.close();
    });

    const consentId = async (code: string) => {
      const found = await db.query<{ id: string }>(
        'select id from public.consents where code = $1 order by version desc limit 1',
        [code],
      );
      if (found.rows[0]) return found.rows[0].id;
      return (
        await db.query<{ id: string }>(
          `insert into public.consents (code, version, title, body, effective_at) values ($1, 1, 'Test', '[TEST - not legal wording]', now() - interval '1 day') returning id`,
          [code],
        )
      ).rows[0]!.id;
    };

    /** A family whose photo is uploaded and submitted, with both consents given (so the approval enrolls it), and the registration cleared. */
    async function family(file: string, withFaceConsent = true) {
      const parent = await createUser(db, { roles: ['PARENT'] });
      const playerId = await createChild(app, parent.id);
      const regId = (await as(app, parent.id).post(R, { eventId, playerId, teamId })).body.data
        .id as string;
      for (const code of ['GUARDIAN_CONSENT', ...(withFaceConsent ? [CODE] : [])]) {
        await db.query(
          `insert into public.consent_records (consent_id, registration_id, accepted_by_user_id, signed_name) values ($1, $2, $3, 'Dana Rivera')`,
          [await consentId(code), regId, parent.id],
        );
      }
      const bytes = photo(file);
      const up = await as(app, parent.id).post(`${R}/${regId}/documents/upload-url`, {
        documentType: 'PROFILE_PHOTO',
        fileName: 'me.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      });
      const docId = up.body.data.document.id as string;
      const key = (
        await db.query<{ storage_key: string }>(
          'select storage_key from public.documents where id = $1',
          [docId],
        )
      ).rows[0]!.storage_key;
      storage.put(key, bytes);
      await as(app, parent.id).post(`${D}/${docId}/complete`);
      await as(app, parent.id).post(`${D}/${docId}/submit`);
      // everything else a player needs to enter is already in order
      for (const [type, mime] of [
        ['BIRTH_CERTIFICATE', 'application/pdf'],
        ['SCHOOL_TRANSCRIPT', 'application/pdf'],
        ['CALIFORNIA_KID_ID', 'image/png'],
      ] as const) {
        await db.query(
          `insert into public.documents (registration_id, document_type, storage_key, file_name, mime_type, size_bytes, status, uploaded_at, submitted_at)
         values ($1, $2, $3, 'f', $4, 100, 'APPROVED', now(), now())`,
          [regId, type, `registration-documents/${regId}/${type}`, mime],
        );
      }
      await db.query(
        `update public.registrations set status = 'READY_FOR_EVENT', fee_cents = 0, submitted_at = now() where id = $1`,
        [regId],
      );
      const approved = await as(app, adminId).patch(`${D}/${docId}/review`, {
        decision: 'APPROVED',
      });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      return { parent, playerId, regId };
    }

    const scan = async (bytes: Uint8Array) =>
      request(app)
        .post(`/api/v1/events/${eventId}/face-scan`)
        .set(await bearerFor(adminId))
        .set('Content-Type', 'image/jpeg')
        .send(Buffer.from(bytes));
    const faceCheckIn = async (scanId: string) =>
      request(app)
        .post(`/api/v1/events/${eventId}/check-ins`)
        .set(await bearerFor(adminId))
        .send({
          method: 'FACE',
          scanId,
          clientRequestId: crypto.randomUUID(),
          deviceId: 'e2e-device',
          deviceCheckedInAt: new Date().toISOString(),
        });
    const profile = async (playerId: string) =>
      (
        await db.query<{ status: string; provider: string }>(
          'select status, provider from public.face_profiles where player_id = $1',
          [playerId],
        )
      ).rows;

    let a: Awaited<ReturnType<typeof family>>;
    let b: Awaited<ReturnType<typeof family>>;

    it('the approval of a photo enrolls it (consent given): an encrypted template, a face profile, nothing else', async () => {
      a = await family('a.jpg');
      b = await family('b.jpg');
      for (const f of [a, b])
        expect(await profile(f.playerId)).toEqual([{ status: 'ACTIVE', provider: 'node-native' }]);
      const templates = await db.query<{ n: string }>(
        'select count(*) as n from public.face_templates where subject_id = any($1)',
        [[a.playerId, b.playerId]],
      );
      expect(Number(templates.rows[0]!.n)).toBe(2);
    }, 120_000);

    it('another photo of the same person is a clear MATCH, and checks them in by face', async () => {
      const res = await scan(photo('a2.jpg'));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.result).toBe('MATCH');
      expect(res.body.data.registration.registrationId).toBe(a.regId);
      expect(res.body.data.alreadyCheckedIn).toBe(false);
      const done = await faceCheckIn(res.body.data.scanId);
      expect(done.status, JSON.stringify(done.body)).toBe(201);
      expect(done.body.data).toMatchObject({ registrationId: a.regId, method: 'FACE' });
    }, 60_000);

    it('scanning them again says they are already in; the other enrolled person is matched as themselves', async () => {
      const again = await scan(photo('a.jpg'));
      expect(again.body.data.result).toBe('MATCH');
      expect(again.body.data.registration.registrationId).toBe(a.regId);
      expect(again.body.data.alreadyCheckedIn).toBe(true);
      const other = await scan(photo('b.jpg'));
      expect(other.body.data.result).toBe('MATCH');
      expect(other.body.data.registration.registrationId).toBe(b.regId);
    }, 60_000);

    it('a stranger is never checked in: no match, or at most a person to look at, and a face check-in needs a MATCH', async () => {
      const res = await scan(photo('c.jpg'));
      expect(res.status).toBe(200);
      expect(res.body.data.result).not.toBe('MATCH');
      const forged = await faceCheckIn(res.body.data.scanId);
      expect(forged.status).toBe(409);
    }, 60_000);

    it('a family that did not give the face-scan consent is not enrolled, and so is never matched', async () => {
      const c = await family('c.jpg', false);
      expect(await profile(c.playerId)).toEqual([]);
      const res = await scan(photo('c.jpg'));
      expect(res.body.data.result).not.toBe('MATCH');
    }, 60_000);

    it('a photo with no face is refused with a reason, not a guess', async () => {
      const res = await scan(new Uint8Array(await sharpBlank()));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('FACE_NOT_DETECTED');
    }, 60_000);
  },
);

async function sharpBlank(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 120, g: 130, b: 140 } },
  })
    .jpeg()
    .toBuffer();
}
