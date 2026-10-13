import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { createFakeFaceProvider, jpegOf, type FakeFace } from './helpers/fake-face';
import { createFakeStorage, fileBytes, type FakeStorage } from './helpers/fake-storage';
import { as, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { bearerFor, buildApi, createUser, openTestDb } from './helpers/test-app';

/**
 * Coaches and staff in face matching, next to players: enrollment when an admin approves their photo, replacing a
 * photo, removal, and event-day scan / check-in with the scanned frame's address recorded. Real Express app and real
 * PostgreSQL; the face provider and the object store are fakes.
 */
let db: Database;
let storage: FakeStorage;
let face: FakeFace;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let eventA: string;
let teamA: string;
let adminA: string;

const P = '/api/v1/staff-profiles';
const R = '/api/v1/registrations';
const D = '/api/v1/documents';
const OBJECT_BASE = 'https://objects.example.test/facex-bucket/';
const FRAME_URL = `${OBJECT_BASE}scans/ev/20261012T101500Z_x.jpg`;

const recognition = (provider: FakeFace) => ({
  provider: provider.provider,
  images: storage.reader,
  // Waived here: consent has its own tests. Everything below is about WHO can be enrolled and matched.
  consentPolicy: 'NONE' as const,
  timeoutMs: 2000,
  objectUrl: (key: string) => `${OBJECT_BASE}${key}`,
});

beforeAll(async () => {
  db = openTestDb();
  storage = createFakeStorage();
  face = createFakeFaceProvider();
  app = buildApi(db, {
    storage,
    faceRecognition: recognition(face),
    // The scanner screen gets a signed link for frames that live in our bucket, and nothing signed for any other address.
    scanImageViewUrl: async (url) =>
      url.startsWith(OBJECT_BASE) ? `${url}?X-Signature=signed` : null,
  });
  orgA = await createOrg(db);
  eventA = await createEvent(db, orgA);
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  await db.query(
    `insert into public.consents (code, version, title, body, effective_at)
     values ('AB506_ACKNOWLEDGEMENT', 1, 'AB 506', '[TEST AB506]', now() - interval '1 day')
     on conflict (code, version) do nothing`,
  );
});
afterAll(() => db.close());

// ------------------------------------------------------------------ people

async function person(kind: 'COACH' | 'STAFF') {
  const user = await createUser(db, { roles: [kind] });
  const profile = await as(app, user.id).post(
    P,
    kind === 'COACH'
      ? {
          profileType: 'COACH',
          firstName: 'Casey',
          lastName: 'Coach',
          email: `c-${randomUUID()}@example.com`,
        }
      : {
          profileType: 'STAFF',
          staffRole: 'TEAM_MANAGER',
          firstName: 'Sam',
          lastName: 'Staff',
          email: `s-${randomUUID()}@example.com`,
        },
  );
  expect(profile.status, JSON.stringify(profile.body)).toBe(201);
  const reg = await as(app, user.id).post(R, {
    eventId: eventA,
    staffProfileId: profile.body.data.id,
    ...(kind === 'COACH' ? { teamId: teamA } : {}),
  });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  return {
    user,
    kind,
    profileId: profile.body.data.id as string,
    regId: reg.body.data.id as string,
  };
}
type Person = Awaited<ReturnType<typeof person>>;

const keyOf = async (documentId: string) =>
  (
    await db.query<{ storage_key: string }>(
      'select storage_key from public.documents where id = $1',
      [documentId],
    )
  ).rows[0]!.storage_key;

/** Upload a profile photo as the person: request -> "browser uploads" -> complete -> submit. Returns the document id. */
async function uploadPhoto(p: Person, bytes: Uint8Array) {
  const up = await as(app, p.user.id).post(`${R}/${p.regId}/documents/upload-url`, {
    documentType: 'PROFILE_PHOTO',
    fileName: 'me.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: bytes.length,
  });
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  const id = up.body.data.document.id as string;
  storage.put(await keyOf(id), bytes);
  expect((await as(app, p.user.id).post(`${D}/${id}/complete`)).status).toBe(200);
  expect((await as(app, p.user.id).post(`${D}/${id}/submit`)).status).toBe(200);
  return id;
}
const review = (id: string, body: Record<string, unknown>) =>
  as(app, adminA).patch(`${D}/${id}/review`, body);
const approve = async (id: string) =>
  expect((await review(id, { decision: 'APPROVED' })).status).toBe(200);
const reject = async (id: string) =>
  expect(
    (await review(id, { decision: 'REJECTED', reasonCode: 'UNREADABLE', reason: 'Blurry' })).status,
  ).toBe(200);

const profilesOf = async (profileId: string) =>
  (
    await db.query<{
      id: string;
      status: string;
      provider_profile_id: string;
      source_document_id: string | null;
      revoked_reason: string | null;
    }>(
      `select id, status, provider_profile_id, source_document_id, revoked_reason
         from public.face_profiles where staff_profile_id = $1 order by enrolled_at, id`,
      [profileId],
    )
  ).rows;
const photoUrlOf = async (profileId: string) =>
  (
    await db.query<{ photo_url: string | null }>(
      'select photo_url from public.staff_profiles where id = $1',
      [profileId],
    )
  ).rows[0]!.photo_url;

// ------------------------------------------------------------------ enrollment

describe('enrolling a coach or staff member when an admin approves their photo', () => {
  for (const kind of ['COACH', 'STAFF'] as const) {
    it(`${kind}: the approved photo is enrolled, tagged with the role, and its address kept on the profile`, async () => {
      const p = await person(kind);
      const before = face.enrollCalls.length;
      const doc = await uploadPhoto(p, jpegOf(`face-${randomUUID()}`));
      expect(await profilesOf(p.profileId)).toEqual([]); // nothing before an admin approves
      await approve(doc);

      const profiles = await profilesOf(p.profileId);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toMatchObject({ status: 'ACTIVE', source_document_id: doc });
      expect(profiles[0]!.provider_profile_id).toMatch(/^fake_face_/);

      // The provider got our id only, and was told the role.
      expect(face.enrollCalls).toHaveLength(before + 1);
      expect(face.enrollCalls.at(-1)).toMatchObject({ subjectId: p.profileId, role: kind });

      // The permanent address of the photo is recorded on the person; the image itself is not.
      expect(await photoUrlOf(p.profileId)).toBe(`${OBJECT_BASE}${await keyOf(doc)}`);

      // The owner sees an ACTIVE status under their staff profile, with no provider reference in it.
      const st = await as(app, p.user.id).get(`${P}/${p.profileId}/face-profile`);
      expect(st.status).toBe(200);
      expect(st.body.data).toMatchObject({ staffProfileId: p.profileId, status: 'ACTIVE' });
      expect(JSON.stringify(st.body)).not.toContain('fake_face_');
    });
  }

  it('a photo that is rejected enrolls nobody', async () => {
    const p = await person('STAFF');
    await reject(await uploadPhoto(p, jpegOf(`face-${randomUUID()}`)));
    expect(await profilesOf(p.profileId)).toEqual([]);
    expect(await photoUrlOf(p.profileId)).toBeNull();
  });

  it('a photo the provider cannot use leaves the approval in place and enrolls nobody', async () => {
    const p = await person('COACH');
    const doc = await uploadPhoto(p, fileBytes.jpeg(3000)); // no "face" marker is fine; make the provider fail instead
    face.failures.enroll = true;
    try {
      await approve(doc);
    } finally {
      face.failures.enroll = false;
    }
    expect(await profilesOf(p.profileId)).toEqual([]);
    expect(
      (await db.query('select status from public.documents where id = $1', [doc])).rows[0],
    ).toEqual({ status: 'APPROVED' });
  });
});

describe('replacing a photo', () => {
  /** The same person registers for a LATER event: a new registration, so a new photo to approve. */
  async function secondEvent(p: Person) {
    const later = await createEvent(db, orgA);
    const reg = await as(app, p.user.id).post(R, {
      eventId: later,
      staffProfileId: p.profileId,
      ...(p.kind === 'COACH' ? { teamId: await createTeam(db, later) } : {}),
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    return { ...p, regId: reg.body.data.id as string };
  }

  it('hard-deletes the old identity at the provider, then enrolls the new photo', async () => {
    const p = await person('COACH');
    await approve(await uploadPhoto(p, jpegOf(`face-${randomUUID()}`)));
    const [old] = await profilesOf(p.profileId);
    expect(old).toMatchObject({ status: 'ACTIVE' });

    const later = await secondEvent(p);
    const second = await uploadPhoto(later, jpegOf(`face-${randomUUID()}`));
    const removedBefore = face.removed.length;
    await approve(second);

    expect(face.removed.slice(removedBefore)).toEqual([old!.provider_profile_id]);
    const all = await profilesOf(p.profileId);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ status: 'REVOKED', revoked_reason: 'PHOTO_REPLACED' });
    expect(all[1]).toMatchObject({ status: 'ACTIVE', source_document_id: second });
    expect(all[1]!.provider_profile_id).not.toBe(old!.provider_profile_id);
    expect(await photoUrlOf(p.profileId)).toBe(`${OBJECT_BASE}${await keyOf(second)}`);
  });

  it('if the provider cannot delete the old identity, nothing changes: the old profile stays ACTIVE', async () => {
    const p = await person('STAFF');
    const first = await uploadPhoto(p, jpegOf(`face-${randomUUID()}`));
    await approve(first);
    const later = await secondEvent(p);
    const second = await uploadPhoto(later, jpegOf(`face-${randomUUID()}`));
    face.failures.remove = true;
    try {
      await approve(second);
    } finally {
      face.failures.remove = false;
    }
    const all = await profilesOf(p.profileId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: 'ACTIVE', source_document_id: first });
  });

  it('if the NEW photo cannot be enrolled after the old identity is deleted, the database says so: no ACTIVE profile', async () => {
    const p = await person('STAFF');
    await approve(await uploadPhoto(p, jpegOf(`face-${randomUUID()}`)));
    const later = await secondEvent(p);
    const second = await uploadPhoto(later, jpegOf(`face-${randomUUID()}`));
    face.failures.enroll = true;
    try {
      await approve(second);
    } finally {
      face.failures.enroll = false;
    }
    const all = await profilesOf(p.profileId);
    expect(all).toHaveLength(1);
    // Never an ACTIVE profile pointing at an identity the provider no longer has.
    expect(all[0]).toMatchObject({ status: 'REVOKED', revoked_reason: 'PHOTO_REPLACED' });
  });

  it('a missing consent for the new registration costs nothing: the old profile is untouched until it is given', async () => {
    const code = `BIO_${randomUUID().slice(0, 8).toUpperCase()}`;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.consents (code, version, title, body, effective_at)
       values ($1, 1, 'Face consent', '[TEST]', now() - interval '1 day') returning id`,
      [code],
    );
    const gated = createFakeFaceProvider();
    const gatedRecognition = { ...recognition(gated), consentPolicy: code };
    const gatedApp = buildApi(db, { storage, faceRecognition: gatedRecognition });
    const p = await person('STAFF');
    const send = async (reg: string, bytes: Uint8Array) => {
      const up = await as(gatedApp, p.user.id).post(`${R}/${reg}/documents/upload-url`, {
        documentType: 'PROFILE_PHOTO',
        fileName: 'me.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      });
      const id = up.body.data.document.id as string;
      storage.put(await keyOf(id), bytes);
      await as(gatedApp, p.user.id).post(`${D}/${id}/complete`);
      await as(gatedApp, p.user.id).post(`${D}/${id}/submit`);
      return id;
    };
    const consent = (reg: string) =>
      db.query(
        `insert into public.consent_records (consent_id, registration_id, accepted_by_user_id, signed_name)
         values ($1, $2, $3, 'Sam Staff')`,
        [rows[0]!.id, reg, p.user.id],
      );
    const approveVia = (id: string) =>
      as(gatedApp, adminA).patch(`${D}/${id}/review`, { decision: 'APPROVED' });
    const { createFaceServiceFor } = await import('../src/modules/face');
    const { silentLogger } = await import('./helpers/test-app');
    const service = createFaceServiceFor({
      db,
      recognition: gatedRecognition,
      logger: silentLogger(),
    });
    const meta = { ip: null, userAgent: null } as never;

    // Approved before any consent: waits, enrolls nobody.
    await approveVia(await send(p.regId, jpegOf(`face-${randomUUID()}`)));
    expect(await profilesOf(p.profileId)).toEqual([]);
    expect(gated.enrollCalls).toHaveLength(0);
    // Consent given: the waiting photo is enrolled (the same call the consent API makes).
    await consent(p.regId);
    expect(
      await service.enrollAfterConsent({ registrationId: p.regId, actorUserId: p.user.id, meta }),
    ).toBe('ENROLLED');
    const [old] = await profilesOf(p.profileId);
    expect(old).toMatchObject({ status: 'ACTIVE' });

    // A later event: new photo approved, but THIS registration has no consent yet. Nothing may be deleted.
    const later = await secondEvent(p);
    await approveVia(await send(later.regId, jpegOf(`face-${randomUUID()}`)));
    expect(gated.removed).toEqual([]);
    expect(await profilesOf(p.profileId)).toHaveLength(1);
    expect((await profilesOf(p.profileId))[0]).toMatchObject({ status: 'ACTIVE' });

    // Once that registration is consented too, the swap goes through.
    await consent(later.regId);
    expect(
      await service.enrollAfterConsent({
        registrationId: later.regId,
        actorUserId: p.user.id,
        meta,
      }),
    ).toBe('ENROLLED');
    expect((await profilesOf(p.profileId)).map((x) => x.status)).toEqual(['REVOKED', 'ACTIVE']);
    expect(gated.removed).toEqual([old!.provider_profile_id]);
  });

  it('approving the same photo twice does not replace it', async () => {
    const p = await person('STAFF');
    const doc = await uploadPhoto(p, jpegOf(`face-${randomUUID()}`));
    await approve(doc);
    const removedBefore = face.removed.length;
    // The service call a replayed approval makes:
    const { createFaceServiceFor } = await import('../src/modules/face');
    const { silentLogger } = await import('./helpers/test-app');
    const service = createFaceServiceFor({
      db,
      recognition: recognition(face),
      logger: silentLogger(),
    });
    const answer = await service.enrollApprovedPhoto({
      playerId: null,
      staffProfileId: p.profileId,
      documentId: doc,
      actorUserId: adminA,
      meta: { ip: null, userAgent: null } as never,
    });
    expect(answer).toBe('SKIPPED');
    expect(face.removed.length).toBe(removedBefore);
    expect(await profilesOf(p.profileId)).toHaveLength(1);
  });
});

describe('removing a coach or staff member from face matching', () => {
  it('the owner removes their own face: purged at the provider first, then the profile is REVOKED', async () => {
    const p = await person('STAFF');
    await approve(await uploadPhoto(p, jpegOf(`face-${randomUUID()}`)));
    const [profile] = await profilesOf(p.profileId);

    const res = await as(app, p.user.id).delete(`${P}/${p.profileId}/face-profile`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ staffProfileId: p.profileId, status: 'REVOKED' });
    expect(face.removed).toContain(profile!.provider_profile_id);
    expect((await profilesOf(p.profileId))[0]).toMatchObject({ status: 'REVOKED' });
    expect((await as(app, p.user.id).delete(`${P}/${p.profileId}/face-profile`)).status).toBe(404);
  });

  it('a provider failure leaves the profile ACTIVE so the removal can be retried', async () => {
    const p = await person('COACH');
    await approve(await uploadPhoto(p, jpegOf(`face-${randomUUID()}`)));
    face.failures.remove = true;
    try {
      expect((await as(app, p.user.id).delete(`${P}/${p.profileId}/face-profile`)).status).toBe(
        503,
      );
    } finally {
      face.failures.remove = false;
    }
    expect((await profilesOf(p.profileId))[0]).toMatchObject({ status: 'ACTIVE' });
    expect((await as(app, p.user.id).delete(`${P}/${p.profileId}/face-profile`)).status).toBe(200);
  });

  it("someone else cannot read or remove another person's face profile", async () => {
    const owner = await person('COACH');
    await approve(await uploadPhoto(owner, jpegOf(`face-${randomUUID()}`)));
    const other = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, other.id).get(`${P}/${owner.profileId}/face-profile`)).status).toBe(404);
    expect((await as(app, other.id).delete(`${P}/${owner.profileId}/face-profile`)).status).toBe(
      404,
    );
    expect((await profilesOf(owner.profileId))[0]).toMatchObject({ status: 'ACTIVE' });
  });

  it('an admin of the event can read the status, never change it', async () => {
    const p = await person('STAFF');
    await approve(await uploadPhoto(p, jpegOf(`face-${randomUUID()}`)));
    const seen = await as(app, adminA).get(`${P}/${p.profileId}/face-profile`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.status).toBe('ACTIVE');
    expect((await as(app, adminA).delete(`${P}/${p.profileId}/face-profile`)).status).toBe(403);
  });

  it('players and parents have no way to use the staff routes', async () => {
    const p = await person('STAFF');
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await as(app, parent.id).delete(`${P}/${p.profileId}/face-profile`)).status).toBe(403);
    expect((await request(app).delete(`${P}/${p.profileId}/face-profile`)).status).toBe(401);
  });
});

// ------------------------------------------------------------------ event day

/** A staff member registered for the event and fully eligible (staff have no payment and no consent), with a face profile. */
async function readyStaff(o: { face?: boolean; label?: string } = {}) {
  const user = await createUser(db, { roles: ['STAFF'] });
  const label = o.label ?? `face-${randomUUID()}`;
  const { rows: sp } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
     values ($1, 'STAFF', 'TEAM_MANAGER', 'Sam', 'Staffer', $2) returning id`,
    [user.id, `sp-${randomUUID()}@example.com`],
  );
  const profileId = sp[0]!.id;
  const { rows: r } = await db.query<{ id: string }>(
    `insert into public.registrations (event_id, registrant_type, staff_profile_id, status, fee_cents, submitted_at)
     values ($1, 'STAFF', $2, 'READY_FOR_EVENT', 0, now()) returning id`,
    [eventA, profileId],
  );
  const regId = r[0]!.id;
  for (const type of ['PROFILE_PHOTO', 'BACKGROUND_CHECK']) {
    await db.query(
      `insert into public.documents (registration_id, document_type, storage_key, file_name, mime_type, size_bytes, status, uploaded_at, submitted_at)
       values ($1, $2, $3, 'f', $4, 100, 'APPROVED', now(), now())`,
      [
        regId,
        type,
        `registration-documents/${regId}/${randomUUID()}`,
        type === 'PROFILE_PHOTO' ? 'image/jpeg' : 'application/pdf',
      ],
    );
  }
  let reference: string | null = null;
  let faceProfileId: string | null = null;
  if (o.face ?? true) {
    reference = (
      await face.provider.enroll({
        subjectId: profileId,
        image: { bytes: jpegOf(label), mimeType: 'image/jpeg' },
        idempotencyKey: `seed:${profileId}`,
        role: 'STAFF',
      })
    ).reference;
    faceProfileId = (
      await db.query<{ id: string }>(
        `insert into public.face_profiles (staff_profile_id, provider, provider_profile_id) values ($1, $2, $3) returning id`,
        [profileId, face.provider.name, reference],
      )
    ).rows[0]!.id;
  }
  return { user, profileId, regId, label, reference, faceProfileId };
}

async function scan(bytes: Uint8Array, eventId = eventA, userId = adminA) {
  return request(app)
    .post(`/api/v1/events/${eventId}/face-scan`)
    .set(await bearerFor(userId))
    .set('Content-Type', 'image/jpeg')
    .send(Buffer.from(bytes));
}
async function checkIn(body: Record<string, unknown>, eventId = eventA, userId = adminA) {
  return request(app)
    .post(`/api/v1/events/${eventId}/check-ins`)
    .set(await bearerFor(userId))
    .send(body);
}

describe('event-day scan and check-in of a coach or staff member', () => {
  it('a clear match is a MATCH for the staff member, who then checks in by FACE', async () => {
    face.script.candidates = null;
    face.script.scanImageUrl = null;
    const s = await readyStaff();
    const res = await scan(jpegOf(s.label));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      result: 'MATCH',
      registration: {
        registrationId: s.regId,
        registrantType: 'STAFF',
        firstName: 'Sam',
        lastName: 'Staffer',
      },
    });
    // No frame was kept by this provider, so there is no scanImageUrl at all.
    expect(res.body.data).not.toHaveProperty('scanImageUrl');

    const { rows } = await db.query(
      `select matched_player_id, matched_staff_profile_id, face_profile_id, scan_image_url
         from public.face_scans where id = $1`,
      [res.body.data.scanId],
    );
    expect(rows[0]).toEqual({
      matched_player_id: null,
      matched_staff_profile_id: s.profileId,
      face_profile_id: s.faceProfileId,
      scan_image_url: null,
    });

    const done = await checkIn({
      method: 'FACE',
      scanId: res.body.data.scanId,
      clientRequestId: randomUUID(),
    });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.data).toMatchObject({ registrationId: s.regId, method: 'FACE' });
    const audit = await db.query(
      `select metadata from public.audit_logs where action = 'CHECK_IN_COMPLETED' and entity_id = $1`,
      [done.body.data.checkInId],
    );
    expect(audit.rows[0]!.metadata).toMatchObject({ staffProfileId: s.profileId, method: 'FACE' });
  });

  it('records where the face service filed the frame, and returns it signed (the stored address stays in the database)', async () => {
    const s = await readyStaff();
    face.script.candidates = [{ reference: s.reference!, similarity: 0.97 }];
    face.script.scanImageUrl = FRAME_URL;
    try {
      const before = face.identifyCalls.length;
      const res = await scan(jpegOf('anyone'));
      expect(res.status).toBe(200);
      expect(res.body.data.result).toBe('MATCH');
      // The provider was told which event the frame belongs to.
      expect(face.identifyCalls.slice(before)).toEqual([
        expect.objectContaining({ eventId: eventA }),
      ]);
      // The scanner receives a signed link; the database holds the plain address.
      expect(res.body.data.scanImageUrl).toBe(`${FRAME_URL}?X-Signature=signed`);
      const { rows } = await db.query(
        'select scan_image_url from public.face_scans where id = $1',
        [res.body.data.scanId],
      );
      expect(rows[0]!.scan_image_url).toBe(FRAME_URL);
    } finally {
      face.script.candidates = null;
      face.script.scanImageUrl = null;
    }
  });

  it('a frame at an address we cannot sign is returned as stored; an unknown face still records its frame', async () => {
    const foreign = 'https://elsewhere.example.test/scans/x.jpg';
    face.script.candidates = [];
    face.script.scanImageUrl = foreign;
    try {
      const res = await scan(jpegOf('nobody-enrolled'));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ result: 'NO_MATCH', scanImageUrl: foreign });
      const { rows } = await db.query(
        'select result, scan_image_url from public.face_scans where id = $1',
        [res.body.data.scanId],
      );
      expect(rows[0]).toEqual({ result: 'NO_MATCH', scan_image_url: foreign });
    } finally {
      face.script.candidates = null;
      face.script.scanImageUrl = null;
    }
  });

  it('a staff member registered for another event is an unknown face here', async () => {
    const s = await readyStaff();
    const otherEvent = await createEvent(db, orgA);
    face.script.candidates = [{ reference: s.reference!, similarity: 0.99 }];
    try {
      const res = await scan(jpegOf('x'), otherEvent);
      expect(res.body.data).toMatchObject({ result: 'NO_MATCH' });
    } finally {
      face.script.candidates = null;
    }
  });

  it('a revoked face profile is never matched', async () => {
    const s = await readyStaff();
    await db.query(
      `update public.face_profiles set status = 'REVOKED', revoked_at = now() where id = $1`,
      [s.faceProfileId],
    );
    face.script.candidates = [{ reference: s.reference!, similarity: 0.99 }];
    try {
      expect((await scan(jpegOf('x'))).body.data).toMatchObject({ result: 'NO_MATCH' });
    } finally {
      face.script.candidates = null;
    }
  });

  it('a staff member whose registration is not eligible comes back as REVIEW_REQUIRED, with their kind', async () => {
    const s = await readyStaff();
    await db.query(`update public.registrations set event_access_disabled = true where id = $1`, [
      s.regId,
    ]);
    face.script.candidates = [{ reference: s.reference!, similarity: 0.99 }];
    try {
      const res = await scan(jpegOf('x'));
      expect(res.body.data).toMatchObject({
        result: 'REVIEW_REQUIRED',
        reason: 'NOT_ELIGIBLE',
        eligibility: ['EVENT_ACCESS_DISABLED'],
        candidates: [{ registrationId: s.regId, registrantType: 'STAFF' }],
      });
    } finally {
      face.script.candidates = null;
    }
  });

  it('the database refuses a FACE check-in whose scan matched someone else', async () => {
    const a = await readyStaff();
    const b = await readyStaff();
    face.script.candidates = [{ reference: a.reference!, similarity: 0.99 }];
    let scanId: string;
    try {
      scanId = (await scan(jpegOf('x'))).body.data.scanId as string;
    } finally {
      face.script.candidates = null;
    }
    await expect(
      db.query(
        `insert into public.check_ins (event_id, registration_id, method, face_scan_id, checked_in_by, client_request_id)
         values ($1, $2, 'FACE', $3, $4, $5)`,
        [eventA, b.regId, scanId, adminA, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
