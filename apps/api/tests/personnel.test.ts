import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { createFakeStorage, fileBytes, type FakeStorage } from './helpers/fake-storage';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** Coach and staff registration end to end: profile, registration, documents, consent, review, readiness. */
let db: Database;
let storage: FakeStorage;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let eventA: string;
let teamA: string;
let adminA: string;
let ab506: string;

const P = '/api/v1/staff-profiles';
const R = '/api/v1/registrations';
const D = '/api/v1/documents';

beforeAll(async () => {
  db = openTestDb();
  storage = createFakeStorage();
  app = buildApi(db, { storage });
  orgA = await createOrg(db);
  eventA = await createEvent(db, orgA, { feeCents: 9500 });
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  ab506 = (
    await db.query<{ id: string }>(
      `insert into public.consents (code, version, title, body, effective_at)
       values ('AB506_ACKNOWLEDGEMENT', 1, 'AB 506', '[TEST AB506]', now() - interval '1 day')
       on conflict (code, version) do update set title = excluded.title returning id`,
    )
  ).rows[0]!.id;
});
afterAll(() => db.close());

const coachBody = (over: Record<string, unknown> = {}) => ({
  profileType: 'COACH',
  firstName: 'Casey',
  lastName: 'Coach',
  email: 'Casey.Coach@Example.com',
  phone: '555-019-2831',
  ...over,
});
const staffBody = (over: Record<string, unknown> = {}) => ({
  profileType: 'STAFF',
  staffRole: 'TEAM_MANAGER',
  firstName: 'Sam',
  lastName: 'Staff',
  email: 'sam.staff@example.com',
  ...over,
});

/** A signed-in coach/staff account with a profile and a DRAFT registration for the event. */
async function person(kind: 'COACH' | 'STAFF', registration: Record<string, unknown> = {}) {
  const user = await createUser(db, { roles: [kind] });
  const profile = await as(app, user.id).post(P, kind === 'COACH' ? coachBody() : staffBody());
  expect(profile.status, JSON.stringify(profile.body)).toBe(201);
  const profileId = profile.body.data.id as string;
  const reg = await as(app, user.id).post(R, {
    eventId: eventA,
    staffProfileId: profileId,
    ...registration,
  });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  return { user, profileId, regId: reg.body.data.id as string };
}
type Person = Awaited<ReturnType<typeof person>>;

/** The photo is an image (its own storage area refuses PDFs); everything else is a PDF. */
const docBody = (documentType: string, over: Record<string, unknown> = {}) =>
  documentType === 'PROFILE_PHOTO'
    ? { documentType, fileName: 'selfie.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, ...over }
    : {
        documentType,
        fileName: `${documentType}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        ...over,
      };
const bytesFor = (documentType: string) =>
  documentType === 'PROFILE_PHOTO' ? fileBytes.jpeg(2048) : fileBytes.pdf(2048);
const keyOf = async (documentId: string) =>
  (
    await db.query<{ storage_key: string }>(
      'select storage_key from public.documents where id = $1',
      [documentId],
    )
  ).rows[0]!.storage_key;

/** request -> "browser uploads" -> complete -> submit. */
async function sendDocument(p: Person, documentType: string) {
  const res = await as(app, p.user.id).post(
    `${R}/${p.regId}/documents/upload-url`,
    docBody(documentType),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.data.document.id as string;
  storage.put(await keyOf(id), bytesFor(documentType));
  expect((await as(app, p.user.id).post(`${D}/${id}/complete`)).status).toBe(200);
  expect((await as(app, p.user.id).post(`${D}/${id}/submit`)).status).toBe(200);
  return id;
}
const COACH_DOCS = ['PROFILE_PHOTO', 'FIRST_AID_CPR', 'YALF_TACKLE', 'BACKGROUND_CHECK'];
const STAFF_DOCS = ['PROFILE_PHOTO', 'BACKGROUND_CHECK'];
const statusOf = async (regId: string) =>
  (
    await db.query<{ status: string }>('select status from public.registrations where id = $1', [
      regId,
    ])
  ).rows[0]!.status;
const evaluate = (p: Person) => as(app, p.user.id).post(`${R}/${p.regId}/readiness/evaluate`);
const approve = (id: string) =>
  as(app, adminA).patch(`${D}/${id}/review`, { decision: 'APPROVED' });

describe('staff profiles', () => {
  it('creates a coach profile for an account with the COACH role, lowercasing the email', async () => {
    const user = await createUser(db, { roles: ['COACH'] });
    const res = await as(app, user.id).post(P, coachBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      profileType: 'COACH',
      staffRole: null,
      firstName: 'Casey',
      email: 'casey.coach@example.com',
    });
    expect(Object.keys(res.body.data)).not.toContain('userId');
    const list = await as(app, user.id).get(P);
    expect(list.body.data).toHaveLength(1);
  });

  it('creates a staff profile with its administrative role', async () => {
    const user = await createUser(db, { roles: ['STAFF'] });
    const res = await as(app, user.id).post(P, staffBody({ staffRole: 'SAFETY_OFFICER' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ profileType: 'STAFF', staffRole: 'SAFETY_OFFICER' });
  });

  it('requires authentication and the matching role', async () => {
    expect((await request(app).post(P).send(coachBody())).status).toBe(401);
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await as(app, parent.id).post(P, coachBody())).status).toBe(403);
    const staffOnly = await createUser(db, { roles: ['STAFF'] });
    const wrongType = await as(app, staffOnly.id).post(P, coachBody());
    expect(wrongType.status).toBe(403);
    expect(wrongType.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('validates the body: staff needs a role, a coach must not have one, unknown fields are rejected', async () => {
    const both = await createUser(db, { roles: ['COACH', 'STAFF'] });
    const noRole = await as(app, both.id).post(P, staffBody({ staffRole: undefined }));
    expect(noRole.status).toBe(422);
    expect(noRole.body.error.details).toEqual([expect.objectContaining({ path: 'staffRole' })]);
    expect((await as(app, both.id).post(P, coachBody({ staffRole: 'TEAM_MANAGER' }))).status).toBe(
      422,
    );
    expect((await as(app, both.id).post(P, coachBody({ userId: both.id }))).status).toBe(422);
    expect((await as(app, both.id).post(P, coachBody({ email: 'nope' }))).status).toBe(422);
    expect((await as(app, both.id).post(P, coachBody({ phone: '123' }))).status).toBe(422);
    expect((await as(app, both.id).post(P, staffBody({ staffRole: 'JANITOR' }))).status).toBe(422);
  });

  it('allows one profile per type per account (409 on a second)', async () => {
    const user = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, user.id).post(P, coachBody())).status).toBe(201);
    const again = await as(app, user.id).post(P, coachBody());
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('STAFF_PROFILE_ALREADY_EXISTS');
  });

  it('lets the owner edit while the registration is a draft, then locks it', async () => {
    const p = await person('COACH');
    const edited = await as(app, p.user.id).patch(`${P}/${p.profileId}`, {
      firstName: 'Kay',
      phone: null,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ firstName: 'Kay', phone: null });
    expect(
      (await as(app, p.user.id).patch(`${P}/${p.profileId}`, { staffRole: 'TEAM_MANAGER' })).status,
    ).toBe(422);
    expect((await as(app, p.user.id).patch(`${P}/${p.profileId}`, {})).status).toBe(422);

    expect((await as(app, p.user.id).post(`${R}/${p.regId}/submit`)).status).toBe(200);
    const locked = await as(app, p.user.id).patch(`${P}/${p.profileId}`, { firstName: 'Late' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('STAFF_PROFILE_LOCKED');
  });

  it("hides one person's profile from everyone else (404), but not from an admin of the event's organization", async () => {
    const p = await person('COACH');
    const other = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, other.id).get(`${P}/${p.profileId}`)).status).toBe(404);
    expect((await as(app, other.id).patch(`${P}/${p.profileId}`, { firstName: 'X' })).status).toBe(
      404,
    );
    expect((await as(app, adminA).get(`${P}/${p.profileId}`)).status).toBe(200);
    const otherOrgAdmin = await createUser(db, {
      roles: ['ADMIN'],
      organizationId: await createOrg(db),
    });
    expect((await as(app, otherOrgAdmin.id).get(`${P}/${p.profileId}`)).status).toBe(404);
  });
});

describe('coach and staff registrations', () => {
  it('creates a DRAFT coach registration with no fee and shows the profile instead of a player', async () => {
    const p = await person('COACH');
    const res = await as(app, p.user.id).get(`${R}/${p.regId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      registrantType: 'COACH',
      status: 'DRAFT',
      guestCount: 0,
      fee: { amountCents: 0 },
      staffProfile: { id: p.profileId, firstName: 'Casey', staffRole: null },
    });
    expect(res.body.data.player).toBeUndefined();
    expect(res.body.data.registrationNumber).toMatch(/^FX-\d{4}-\d{5}$/);
  });

  it('creates a staff registration that carries the staff role', async () => {
    const p = await person('STAFF');
    const res = await as(app, p.user.id).get(`${R}/${p.regId}`);
    expect(res.body.data).toMatchObject({
      registrantType: 'STAFF',
      staffProfile: { staffRole: 'TEAM_MANAGER' },
    });
  });

  it('refuses a second registration for the same person and event, and mixes of player and staff ids', async () => {
    const p = await person('COACH');
    const dup = await as(app, p.user.id).post(R, { eventId: eventA, staffProfileId: p.profileId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('REGISTRATION_ALREADY_EXISTS');

    const parent = await createUser(db, { roles: ['PARENT', 'COACH'] });
    const playerId = await createChild(app, parent.id);
    const both = await as(app, parent.id).post(R, {
      eventId: eventA,
      playerId,
      staffProfileId: p.profileId,
    });
    expect(both.status).toBe(422);
    const neither = await as(app, parent.id).post(R, { eventId: eventA });
    expect(neither.status).toBe(422);
  });

  it("cannot register someone else's profile, or a player, with the wrong role", async () => {
    const p = await person('COACH');
    const stranger = await createUser(db, { roles: ['COACH'] });
    const taken = await as(app, stranger.id).post(R, {
      eventId: eventA,
      staffProfileId: p.profileId,
    });
    expect(taken.status).toBe(404);
    expect(taken.body.error.code).toBe('STAFF_PROFILE_NOT_FOUND');

    // a coach with no family role cannot register a player, even their own child
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'COACH')`, [
      parent.id,
    ]);
    await db.query(`delete from public.user_roles where user_id = $1 and role = 'PARENT'`, [
      parent.id,
    ]);
    const asCoach = await as(app, parent.id).post(R, { eventId: eventA, playerId });
    expect(asCoach.status).toBe(403);
  });

  it('keeps guests for players only', async () => {
    const user = await createUser(db, { roles: ['COACH'] });
    const profile = (await as(app, user.id).post(P, coachBody())).body.data.id as string;
    const bad = await as(app, user.id).post(R, {
      eventId: eventA,
      staffProfileId: profile,
      guestCount: 2,
    });
    expect(bad.status).toBe(422);
    const ok = await as(app, user.id).post(R, { eventId: eventA, staffProfileId: profile });
    expect(
      (await as(app, user.id).patch(`${R}/${ok.body.data.id}`, { guestCount: 2 })).status,
    ).toBe(422);
  });

  it('accepts an active team of the event, rejects one from elsewhere', async () => {
    const user = await createUser(db, { roles: ['STAFF'] });
    const profile = (await as(app, user.id).post(P, staffBody())).body.data.id as string;
    const otherEventTeam = await createTeam(db, await createEvent(db, orgA));
    const bad = await as(app, user.id).post(R, {
      eventId: eventA,
      staffProfileId: profile,
      teamId: otherEventTeam,
    });
    expect(bad.status).toBe(422);
    const ok = await as(app, user.id).post(R, {
      eventId: eventA,
      staffProfileId: profile,
      teamId: teamA,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.team).toMatchObject({ id: teamA });
  });

  it('lists the caller own registrations by type; the default list stays players only', async () => {
    const p = await person('COACH');
    const coachList = await as(app, p.user.id).get(`${R}?registrantType=COACH`);
    expect(coachList.body.data).toEqual([
      expect.objectContaining({
        id: p.regId,
        registrantType: 'COACH',
        staffProfile: expect.objectContaining({ id: p.profileId }),
      }),
    ]);
    const byProfile = await as(app, p.user.id).get(
      `${R}?registrantType=COACH&staffProfileId=${p.profileId}&eventId=${eventA}`,
    );
    expect(byProfile.body.data).toHaveLength(1);
    const playersOnly = await as(app, p.user.id).get(R);
    expect(playersOnly.body.data).toEqual([]);

    const stranger = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, stranger.id).get(`${R}?registrantType=COACH`)).body.data).toEqual([]);
    expect((await as(app, stranger.id).get(`${R}/${p.regId}`)).status).toBe(404);
  });

  it('submits without a team, a fee or a guardian, and fixes the fee at zero', async () => {
    const p = await person('COACH');
    const res = await as(app, p.user.id).post(`${R}/${p.regId}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'SUBMITTED', fee: { amountCents: 0 } });
    const again = await as(app, p.user.id).post(`${R}/${p.regId}/submit`);
    expect(again.status).toBe(409);
    // no payment endpoints for them
    expect((await as(app, p.user.id).post(`${R}/${p.regId}/payments/checkout`)).status).toBe(404);
  });
});

describe('documents for coach and staff', () => {
  it('accepts exactly the types of each kind of registration', async () => {
    const coach = await person('COACH');
    const staff = await person('STAFF');
    const tryUpload = (p: Person, type: string) =>
      as(app, p.user.id).post(`${R}/${p.regId}/documents/upload-url`, docBody(type));

    for (const type of ['FIRST_AID_CPR', 'YALF_TACKLE', 'BACKGROUND_CHECK', 'PROFILE_PHOTO']) {
      expect((await tryUpload(coach, type)).status, type).toBe(201);
    }
    for (const type of ['BIRTH_CERTIFICATE', 'SCHOOL_ID', 'CALIFORNIA_KID_ID', 'SAFESPORT']) {
      const res = await tryUpload(coach, type);
      expect(res.status, type).toBe(422);
      expect(res.body.error.code).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
    }
    for (const type of ['PROFILE_PHOTO', 'BACKGROUND_CHECK', 'SAFESPORT']) {
      expect((await tryUpload(staff, type)).status, type).toBe(201);
    }
    for (const type of ['FIRST_AID_CPR', 'YALF_TACKLE', 'SCHOOL_TRANSCRIPT']) {
      expect((await tryUpload(staff, type)).status, type).toBe(422);
    }
  });

  it('refuses a player document type on a coach registration and a coach type on a player registration', async () => {
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    const reg = (await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA }))
      .body.data.id;
    const res = await as(app, parent.id).post(
      `${R}/${reg}/documents/upload-url`,
      docBody('FIRST_AID_CPR'),
    );
    expect(res.status).toBe(422);
  });

  it('reports completeness against the coach list and the staff list (SAFESPORT is optional)', async () => {
    const coach = await person('COACH');
    const staff = await person('STAFF');
    const c = await as(app, coach.user.id).get(`${R}/${coach.regId}/documents`);
    expect(
      c.body.data.completeness.required.map((r: { documentType: string }) => r.documentType),
    ).toEqual(COACH_DOCS);
    const s = await as(app, staff.user.id).get(`${R}/${staff.regId}/documents`);
    expect(
      s.body.data.completeness.required.map((r: { documentType: string }) => r.documentType),
    ).toEqual(STAFF_DOCS);
  });

  it("keeps one person's documents away from everyone else, including a signed download link", async () => {
    const p = await person('COACH');
    const id = await sendDocument(p, 'FIRST_AID_CPR');
    const other = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, other.id).get(`${D}/${id}/download-url`)).status).toBe(404);
    expect(
      (await as(app, other.id).post(`${R}/${p.regId}/documents/upload-url`, docBody('YALF_TACKLE')))
        .status,
    ).toBe(404);
    const own = await as(app, p.user.id).get(`${D}/${id}/download-url`);
    expect(own.status).toBe(200);
    expect(own.body.data.url).toContain(p.regId);
  });
});

describe('consent: the coach AB 506 acknowledgement', () => {
  it('lists AB 506 as required for a coach, nothing for staff, and lets the coach sign for themself', async () => {
    const coach = await person('COACH');
    const staff = await person('STAFF');

    const staffStatus = await as(app, staff.user.id).get(`${R}/${staff.regId}/consents`);
    expect(staffStatus.body.data.requirements).toEqual([]);

    const before = await as(app, coach.user.id).get(`${R}/${coach.regId}/consents`);
    expect(before.body.data.requirements).toEqual([
      expect.objectContaining({ code: 'AB506_ACKNOWLEDGEMENT', required: true, accepted: false }),
    ]);

    const wrongName = await as(app, coach.user.id).post(`${R}/${coach.regId}/consents`, {
      consentId: ab506,
      signedName: 'Somebody Else',
      accepted: true,
    });
    expect(wrongName.status).toBe(422);
    expect(wrongName.body.error.code).toBe('SIGNATURE_MISMATCH');

    const ok = await as(app, coach.user.id).post(`${R}/${coach.regId}/consents`, {
      consentId: ab506,
      signedName: 'Casey Coach',
      accepted: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ code: 'AB506_ACKNOWLEDGEMENT', signedBy: 'SELF' });
    const after = await as(app, coach.user.id).get(`${R}/${coach.regId}/consents`);
    expect(after.body.data.requirements[0]).toMatchObject({ accepted: true });
  });

  it('does not let a staff member or a player registration record the coach consent (nor a coach the guardian one)', async () => {
    const staff = await person('STAFF');
    const res = await as(app, staff.user.id).post(`${R}/${staff.regId}/consents`, {
      consentId: ab506,
      signedName: 'Sam Staff',
      accepted: true,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CONSENT_NOT_APPLICABLE');
  });
});

describe('readiness and approval', () => {
  it('moves a coach SUBMITTED -> DOCUMENT_REVIEW -> VERIFIED -> READY_FOR_EVENT with no payment step', async () => {
    const p = await person('COACH');
    const ids: string[] = [];
    for (const type of COACH_DOCS) ids.push(await sendDocument(p, type));
    expect((await as(app, p.user.id).post(`${R}/${p.regId}/submit`)).status).toBe(200);

    const first = await evaluate(p);
    expect(first.status).toBe(200);
    expect(first.body.data.readiness.blockers).not.toContain('PAYMENT_NOT_COMPLETED');
    expect(await statusOf(p.regId)).toBe('DOCUMENT_REVIEW');

    // a partial approval does not verify
    expect((await approve(ids[0]!)).status).toBe(200);
    expect(await statusOf(p.regId)).toBe('DOCUMENT_REVIEW');
    for (const id of ids.slice(1)) expect((await approve(id)).status).toBe(200);
    expect(await statusOf(p.regId)).toBe('VERIFIED');

    // not ready until the AB 506 acknowledgement is recorded
    expect((await evaluate(p)).body.data.readiness.blockers).toEqual(['CONSENT_NOT_ACCEPTED']);
    const consent = await as(app, p.user.id).post(`${R}/${p.regId}/consents`, {
      consentId: ab506,
      signedName: 'Casey Coach',
      accepted: true,
    });
    expect(consent.status).toBe(201);
    expect(await statusOf(p.regId)).toBe('READY_FOR_EVENT');

    const history = (await as(app, p.user.id).get(`${R}/${p.regId}/status`)).body.data.history;
    expect(history.map((h: { to: string }) => h.to)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'DOCUMENT_REVIEW',
      'VERIFIED',
      'READY_FOR_EVENT',
    ]);
    const payments = await db.query('select 1 from public.payments where registration_id = $1', [
      p.regId,
    ]);
    expect(payments.rowCount).toBe(0);
  });

  it('moves a staff member to READY_FOR_EVENT with just a photo and a background proof (no consent, no safe-sport)', async () => {
    const p = await person('STAFF');
    const ids: string[] = [];
    for (const type of STAFF_DOCS) ids.push(await sendDocument(p, type));
    expect((await as(app, p.user.id).post(`${R}/${p.regId}/submit`)).status).toBe(200);
    await evaluate(p);
    for (const id of ids) await approve(id);
    expect(await statusOf(p.regId)).toBe('READY_FOR_EVENT');
  });

  it('sends a rejected document back for replacement and advances once the replacement is approved', async () => {
    const p = await person('STAFF');
    const ids: string[] = [];
    for (const type of STAFF_DOCS) ids.push(await sendDocument(p, type));
    await as(app, p.user.id).post(`${R}/${p.regId}/submit`);
    await evaluate(p);
    const rejected = await as(app, adminA).patch(`${D}/${ids[1]}/review`, {
      decision: 'REJECTED',
      reasonCode: 'UNREADABLE',
      reason: 'Too blurry.',
    });
    expect(rejected.status).toBe(200);
    await approve(ids[0]!);
    expect(await statusOf(p.regId)).toBe('DOCUMENT_REVIEW');

    const replacement = await sendDocument(p, 'BACKGROUND_CHECK');
    await approve(replacement);
    expect(await statusOf(p.regId)).toBe('READY_FOR_EVENT');
  });

  it('grants event access only once approved: the role alone is not enough', async () => {
    const p = await person('COACH');
    const roster = (userId: string) => as(app, userId).get(`/api/v1/events/${eventA}/teams`);
    expect((await roster(p.user.id)).status).toBe(200); // the catalog is public to signed-in users
    const { rows } = await db.query<{ registrant_type: string; status: string }>(
      `select registrant_type, status from public.registrations where id = $1`,
      [p.regId],
    );
    expect(rows[0]).toEqual({ registrant_type: 'COACH', status: 'DRAFT' });
  });
});
