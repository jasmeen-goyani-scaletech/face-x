import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/infrastructure/database/database';
import { migrateUp } from '../src/infrastructure/database/migrate';
import { as, createChild, createOrg } from './helpers/fixtures';
import { buildApi, createUser } from './helpers/test-app';

/**
 * Admin site management: events and teams (create, read, update), the day-of roster, coach/staff registration lists, and the
 * admin actions on a coach or staff registration. Private database, because consent wording and counts are global.
 */
let db: Database;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let adminA: string;
let adminB: string;
const dbName = `facex_admin_mgmt_${Date.now()}`;
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
  app = buildApi(db);
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
});
afterAll(async () => {
  await db.close();
  const admin = new Client({ connectionString: inject('adminDatabaseUrl') });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

const eventBody = (over: Record<string, unknown> = {}) => ({
  name: 'Spring Cup',
  description: 'Opening tournament',
  location: 'Riverside Field',
  timezone: 'America/Los_Angeles',
  startsAt: '2027-03-06T17:30:00-08:00',
  endsAt: '2027-03-06T20:00:00-08:00',
  feeCents: 9500,
  ...over,
});
const createEvent = (userId: string, over: Record<string, unknown> = {}) =>
  as(app, userId).post(`${ADMIN}/events`, eventBody(over));

describe('events: create, read, update', () => {
  it('creates a draft event for the admin organization and lists it', async () => {
    const res = await createEvent(adminA);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Spring Cup',
      status: 'DRAFT',
      timezone: 'America/Los_Angeles',
      fee: { amountCents: 9500, currency: 'usd' },
      description: 'Opening tournament',
    });
    const row = await db.query<{ organization_id: string; created_by: string }>(
      'select organization_id, created_by from public.events where id = $1',
      [res.body.data.id],
    );
    expect(row.rows[0]).toEqual({ organization_id: orgA, created_by: adminA });

    const list = await as(app, adminA).get(`${ADMIN}/events`);
    expect(list.body.data.map((e: { id: string }) => e.id)).toContain(res.body.data.id);
    // another organization never sees it
    const other = await as(app, adminB).get(`${ADMIN}/events`);
    expect(other.body.data.map((e: { id: string }) => e.id)).not.toContain(res.body.data.id);
  });

  it('requires an ADMIN with an organization', async () => {
    expect((await request(app).post(`${ADMIN}/events`).send(eventBody())).status).toBe(401);
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await createEvent(parent.id)).status).toBe(403);
    const orphan = await createUser(db, { roles: ['ADMIN'] });
    const res = await createEvent(orphan.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ORGANIZATION');
  });

  it('validates the body and refuses fields it does not own', async () => {
    for (const bad of [
      { name: '' },
      { location: '' },
      { timezone: 'Mars/Olympus' },
      { startsAt: 'tomorrow' },
      { feeCents: -1 },
      { feeCents: 12.5 },
      { status: 'ARCHIVED' },
      { endsAt: '2027-03-06T10:00:00-08:00' },
      { organizationId: orgB },
    ]) {
      const res = await createEvent(adminA, bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('reads one event of the own organization, 403 for another organization', async () => {
    const id = (await createEvent(adminA)).body.data.id as string;
    expect((await as(app, adminA).get(`${ADMIN}/events/${id}`)).body.data.id).toBe(id);
    expect((await as(app, adminB).get(`${ADMIN}/events/${id}`)).status).toBe(403);
    expect((await as(app, adminA).get(`${ADMIN}/events/${randomUUID()}`)).status).toBe(404);
  });

  it('updates fields and moves through publish / close / publish again', async () => {
    const id = (await createEvent(adminA)).body.data.id as string;
    const url = `${ADMIN}/events/${id}`;
    const renamed = await as(app, adminA).patch(url, {
      name: 'Spring Cup 2',
      feeCents: 0,
      description: null,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({
      name: 'Spring Cup 2',
      fee: { amountCents: 0 },
      description: null,
    });

    for (const status of ['PUBLISHED', 'CLOSED', 'PUBLISHED']) {
      const res = await as(app, adminA).patch(url, { status });
      expect(res.body.data.status).toBe(status);
    }
    // published events are visible to families
    const parent = await createUser(db, { roles: ['PARENT'] });
    const catalog = await as(app, parent.id).get('/api/v1/events');
    expect(catalog.body.data.map((e: { id: string }) => e.id)).toContain(id);
  });

  it('refuses an empty patch, an end before the start, another organization, and unknown fields', async () => {
    const id = (await createEvent(adminA)).body.data.id as string;
    const url = `${ADMIN}/events/${id}`;
    expect((await as(app, adminA).patch(url, {})).status).toBe(422);
    const early = await as(app, adminA).patch(url, { endsAt: '2027-03-06T10:00:00-08:00' });
    expect(early.status).toBe(422);
    expect(early.body.error.details).toEqual([expect.objectContaining({ path: 'endsAt' })]);
    expect((await as(app, adminB).patch(url, { name: 'Hijack' })).status).toBe(403);
    expect((await as(app, adminA).patch(url, { organizationId: orgB })).status).toBe(422);
    expect(
      (await db.query('select name from public.events where id = $1', [id])).rows[0]!.name,
    ).toBe('Spring Cup');
  });

  it('does not let an event with registrations go back to draft', async () => {
    const id = (await createEvent(adminA, { status: 'PUBLISHED' })).body.data.id as string;
    const team = (
      await as(app, adminA).post(`${ADMIN}/events/${id}/teams`, { name: 'Lions', division: 'U12' })
    ).body.data.id;
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    expect(
      (
        await as(app, parent.id).post('/api/v1/registrations', {
          eventId: id,
          playerId,
          teamId: team,
        })
      ).status,
    ).toBe(201);
    const back = await as(app, adminA).patch(`${ADMIN}/events/${id}`, { status: 'DRAFT' });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('EVENT_HAS_REGISTRATIONS');
  });

  it('audits creation and update', async () => {
    const id = (await createEvent(adminA)).body.data.id as string;
    await as(app, adminA).patch(`${ADMIN}/events/${id}`, { name: 'Audited' });
    const { rows } = await db.query<{ action: string; actor_user_id: string }>(
      `select action, actor_user_id from public.audit_logs where entity_id = $1 order by created_at`,
      [id],
    );
    expect(rows).toEqual([
      { action: 'EVENT_CREATED', actor_user_id: adminA },
      { action: 'EVENT_UPDATED', actor_user_id: adminA },
    ]);
  });
});

describe('teams: create, read, update', () => {
  let eventId: string;
  beforeAll(async () => {
    eventId = (await createEvent(adminA, { status: 'PUBLISHED' })).body.data.id as string;
  });

  it('creates a team with a generated invite code, and lists it with its counts', async () => {
    const res = await as(app, adminA).post(`${ADMIN}/events/${eventId}/teams`, {
      name: 'Sharks',
      club: 'Bay FC',
      division: 'U14',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Sharks',
      club: 'Bay FC',
      division: 'U14',
      status: 'ACTIVE',
      eventId,
      registrations: { players: 0, coaches: 0, staff: 0 },
    });
    expect(res.body.data.inviteCode).toMatch(/^[0-9A-F]{8}$/);
    const list = await as(app, adminA).get(`${ADMIN}/events/${eventId}/teams`);
    expect(list.body.data.map((t: { id: string }) => t.id)).toContain(res.body.data.id);
    // the family-facing catalog never shows the invite code
    const parent = await createUser(db, { roles: ['PARENT'] });
    const catalog = await as(app, parent.id).get(`/api/v1/events/${eventId}/teams`);
    expect(JSON.stringify(catalog.body)).not.toContain(res.body.data.inviteCode);
  });

  it('refuses a duplicate name+club (409), validates, and checks the organization', async () => {
    const url = `${ADMIN}/events/${eventId}/teams`;
    expect(
      (await as(app, adminA).post(url, { name: 'Dup', club: 'C', division: 'U10' })).status,
    ).toBe(201);
    const dup = await as(app, adminA).post(url, { name: 'Dup', club: 'C', division: 'U12' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TEAM_ALREADY_EXISTS');
    // same name, different club is fine
    expect(
      (await as(app, adminA).post(url, { name: 'Dup', club: 'D', division: 'U10' })).status,
    ).toBe(201);
    for (const bad of [
      { name: '', division: 'U10' },
      { name: 'X' },
      { name: 'X', division: 'U10', status: 'DISABLED' },
    ]) {
      expect((await as(app, adminA).post(url, bad)).status).toBe(422);
    }
    expect((await as(app, adminB).post(url, { name: 'Intruder', division: 'U10' })).status).toBe(
      403,
    );
    expect((await as(app, adminB).get(url)).status).toBe(403);
  });

  it('updates a team, disables it (families can no longer pick it) and re-enables it', async () => {
    const created = (
      await as(app, adminA).post(`${ADMIN}/events/${eventId}/teams`, {
        name: 'Wolves',
        division: 'U12',
      })
    ).body.data;
    const url = `${ADMIN}/teams/${created.id}`;
    const edited = await as(app, adminA).patch(url, {
      name: 'Grey Wolves',
      club: 'North',
      division: 'U14',
    });
    expect(edited.body.data).toMatchObject({
      name: 'Grey Wolves',
      club: 'North',
      division: 'U14',
      status: 'ACTIVE',
    });
    expect(edited.body.data.inviteCode).toBe(created.inviteCode);

    const parent = await createUser(db, { roles: ['PARENT'] });
    const teams = async () =>
      (await as(app, parent.id).get(`/api/v1/events/${eventId}/teams`)).body.data.map(
        (t: { id: string }) => t.id,
      );
    expect(await teams()).toContain(created.id);
    expect((await as(app, adminA).patch(url, { status: 'DISABLED' })).body.data.status).toBe(
      'DISABLED',
    );
    expect(await teams()).not.toContain(created.id);
    const playerId = await createChild(app, parent.id);
    const blocked = await as(app, parent.id).post('/api/v1/registrations', {
      eventId,
      playerId,
      teamId: created.id,
    });
    expect(blocked.status).toBe(422);
    expect((await as(app, adminA).patch(url, { status: 'ACTIVE' })).body.data.status).toBe(
      'ACTIVE',
    );
    expect(await teams()).toContain(created.id);
  });

  it('refuses renaming into a duplicate, an empty patch, unknown ids and other organizations', async () => {
    const a = (
      await as(app, adminA).post(`${ADMIN}/events/${eventId}/teams`, {
        name: 'Alpha',
        club: 'Z',
        division: 'U10',
      })
    ).body.data;
    const b = (
      await as(app, adminA).post(`${ADMIN}/events/${eventId}/teams`, {
        name: 'Beta',
        club: 'Z',
        division: 'U10',
      })
    ).body.data;
    const clash = await as(app, adminA).patch(`${ADMIN}/teams/${b.id}`, { name: 'Alpha' });
    expect(clash.status).toBe(409);
    expect((await as(app, adminA).get(`${ADMIN}/teams/${b.id}`)).body.data.name).toBe('Beta');
    expect((await as(app, adminA).patch(`${ADMIN}/teams/${a.id}`, {})).status).toBe(422);
    expect((await as(app, adminA).get(`${ADMIN}/teams/${randomUUID()}`)).status).toBe(404);
    expect((await as(app, adminB).get(`${ADMIN}/teams/${a.id}`)).status).toBe(404);
    expect((await as(app, adminB).patch(`${ADMIN}/teams/${a.id}`, { name: 'Hijack' })).status).toBe(
      404,
    );
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await as(app, parent.id).get(`${ADMIN}/teams/${a.id}`)).status).toBe(403);
  });
});

/** Seeds a coach/staff registration straight into the database (the API flow itself is covered in personnel.test.ts). */
async function personnel(
  eventId: string,
  kind: 'COACH' | 'STAFF',
  o: { status?: string; first?: string; last?: string; teamId?: string | null } = {},
) {
  const user = await createUser(db, { roles: [kind] });
  const { rows: p } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email, phone)
     values ($1, $2, $3, $4, $5, $6, '555-019-2831') returning id`,
    [
      user.id,
      kind,
      kind === 'STAFF' ? 'SAFETY_OFFICER' : null,
      o.first ?? 'Pat',
      o.last ?? 'Person',
      user.email,
    ],
  );
  const { rows: r } = await db.query<{ id: string }>(
    `insert into public.registrations (event_id, registrant_type, staff_profile_id, status, team_id)
     values ($1, $2, $3, $4, $5) returning id`,
    [eventId, kind, p[0]!.id, o.status ?? 'DOCUMENT_REVIEW', o.teamId ?? null],
  );
  return { user, profileId: p[0]!.id, regId: r[0]!.id };
}

/** Gives a seeded coach everything check-in re-checks: approved documents and the recorded AB 506 acknowledgement. */
async function clear(coach: { user: { id: string }; regId: string }) {
  for (const type of ['PROFILE_PHOTO', 'FIRST_AID_CPR', 'YALF_TACKLE', 'BACKGROUND_CHECK']) {
    await db.query(
      `insert into public.documents (registration_id, document_type, storage_key, file_name, mime_type, size_bytes, status, uploaded_at, submitted_at)
       values ($1, $2, $3, 'f.pdf', 'application/pdf', 100, 'APPROVED', now(), now())`,
      [coach.regId, type, `registration-documents/${coach.regId}/${randomUUID()}`],
    );
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into public.consents (code, version, title, body, effective_at)
     values ('AB506_ACKNOWLEDGEMENT', 1, 'AB 506', '[TEST]', now() - interval '1 day')
     on conflict (code, version) do update set title = consents.title returning id`,
  );
  await db.query(
    `insert into public.consent_records (consent_id, registration_id, accepted_by_user_id, signed_name)
     values ($1, $2, $3, 'Check In')`,
    [rows[0]!.id, coach.regId, coach.user.id],
  );
}

describe('registration lists for coaches and staff', () => {
  let eventId: string;
  let teamId: string;
  beforeAll(async () => {
    eventId = (await createEvent(adminA, { status: 'PUBLISHED' })).body.data.id as string;
    teamId = (
      await as(app, adminA).post(`${ADMIN}/events/${eventId}/teams`, {
        name: 'Hawks',
        division: 'U16',
      })
    ).body.data.id;
  });

  it('lists coach and staff registrations separately from players, with filters and paging', async () => {
    const c1 = await personnel(eventId, 'COACH', { first: 'Cora', last: 'Alvarez', teamId });
    await personnel(eventId, 'COACH', { first: 'Cole', last: 'Zhang', status: 'VERIFIED' });
    const s1 = await personnel(eventId, 'STAFF', { first: 'Stan', last: 'Lee' });
    const list = (qs: string) =>
      as(app, adminA).get(`${ADMIN}/events/${eventId}/registrations${qs}`);

    const coaches = await list('?registrantType=COACH');
    expect(coaches.body.data.total).toBe(2);
    expect(coaches.body.data.items[0]).toMatchObject({
      registrantType: 'COACH',
      staffProfile: { firstName: expect.any(String), email: expect.any(String), staffRole: null },
      documents: { inReview: 0, approved: 0, rejected: 0, notSubmitted: 0 },
    });
    expect(coaches.body.data.items[0].paymentStatus).toBeUndefined();

    const staff = await list('?registrantType=STAFF');
    expect(staff.body.data.items).toEqual([
      expect.objectContaining({
        id: s1.regId,
        staffProfile: expect.objectContaining({ staffRole: 'SAFETY_OFFICER' }),
      }),
    ]);
    // players are the default and never include them
    expect((await list('')).body.data.total).toBe(0);

    expect((await list('?registrantType=COACH&status=VERIFIED')).body.data.total).toBe(1);
    expect(
      (await list(`?registrantType=COACH&teamId=${teamId}`)).body.data.items.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual([c1.regId]);
    expect((await list('?registrantType=COACH&search=alvarez')).body.data.total).toBe(1);
    expect((await list('?registrantType=COACH&search=nobody')).body.data.total).toBe(0);
    const page2 = await list('?registrantType=COACH&pageSize=1&page=2');
    expect(page2.body.data).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(page2.body.data.items).toHaveLength(1);
    expect((await list('?registrantType=ROBOT')).status).toBe(422);
    // another organization
    expect(
      (await as(app, adminB).get(`${ADMIN}/events/${eventId}/registrations?registrantType=COACH`))
        .status,
    ).toBe(403);
  });

  it('summarises by kind', async () => {
    const coach = await as(app, adminA).get(
      `${ADMIN}/events/${eventId}/summary?registrantType=COACH`,
    );
    expect(coach.body.data.registrationsByStatus).toMatchObject({
      DOCUMENT_REVIEW: 1,
      VERIFIED: 1,
    });
    const players = await as(app, adminA).get(`${ADMIN}/events/${eventId}/summary`);
    expect(
      Object.values(players.body.data.registrationsByStatus).reduce(
        (a, b) => (a as number) + (b as number),
        0,
      ),
    ).toBe(0);
  });

  it('lets an admin reject a coach registration and switch event access, both audited', async () => {
    const c = await personnel(eventId, 'COACH', { first: 'Rex', last: 'Reject' });
    const rej = await as(app, adminA).post(`${ADMIN}/registrations/${c.regId}/reject`, {
      reason: 'Credentials do not match.',
    });
    expect(rej.status).toBe(200);
    expect(rej.body.data.status).toBe('REJECTED');
    const history = (await as(app, c.user.id).get(`/api/v1/registrations/${c.regId}/status`)).body
      .data.history;
    expect(history.at(-1)).toMatchObject({ to: 'REJECTED', reason: 'Credentials do not match.' });
    expect(
      (await as(app, adminA).post(`${ADMIN}/registrations/${c.regId}/reject`, { reason: 'again' }))
        .status,
    ).toBe(409);

    const s = await personnel(eventId, 'STAFF', { status: 'READY_FOR_EVENT' });
    const off = await as(app, adminA).patch(`${ADMIN}/registrations/${s.regId}/event-access`, {
      disabled: true,
      reason: 'Left the league',
    });
    expect(off.body.data).toMatchObject({
      eventAccessDisabled: true,
      eventAccessDisabledReason: 'Left the league',
    });
    expect(
      (
        await as(app, adminB).patch(`${ADMIN}/registrations/${s.regId}/event-access`, {
          disabled: false,
        })
      ).status,
    ).toBe(404);
  });
});

describe('the day-of roster and check-in', () => {
  let eventId: string;
  let teamId: string;
  beforeAll(async () => {
    eventId = (await createEvent(adminA, { status: 'PUBLISHED', feeCents: 0 })).body.data
      .id as string;
    teamId = (
      await as(app, adminA).post(`${ADMIN}/events/${eventId}/teams`, {
        name: 'Falcons',
        division: 'U14',
      })
    ).body.data.id;
  });
  const roster = async (userId = adminA) =>
    as(app, userId).get(`${ADMIN}/events/${eventId}/roster`);

  it('lists players, coaches and staff with their standing, and leaves out drafts and rejections', async () => {
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    const reg = (
      await as(app, parent.id).post('/api/v1/registrations', { eventId, playerId, teamId })
    ).body.data.id as string;
    await as(app, parent.id).post(`/api/v1/registrations/${reg}/submit`);
    await personnel(eventId, 'COACH', {
      first: 'Ready',
      last: 'Coach',
      status: 'READY_FOR_EVENT',
      teamId,
    });
    await personnel(eventId, 'STAFF', {
      first: 'Waiting',
      last: 'Staff',
      status: 'DOCUMENT_REVIEW',
    });
    await personnel(eventId, 'COACH', { first: 'Draft', last: 'Coach', status: 'DRAFT' });
    await personnel(eventId, 'COACH', { first: 'Out', last: 'Coach', status: 'REJECTED' });

    const res = await roster();
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.data.map((e: { firstName: string }) => [e.firstName, e]),
    );
    expect(Object.keys(byName).sort()).toEqual(['Mateo', 'Ready', 'Waiting']);
    expect(byName.Ready).toMatchObject({
      registrantType: 'COACH',
      approved: true,
      flags: [],
      team: { id: teamId, name: 'Falcons', division: 'U14' },
      checkedInAt: null,
      photoDocumentId: null,
    });
    expect(byName.Waiting).toMatchObject({ registrantType: 'STAFF', approved: false });
    expect(byName.Waiting.flags).toContain('Unverified Document');
    expect(byName.Mateo).toMatchObject({
      registrantType: 'Player'.toUpperCase(),
      dateOfBirth: '2014-03-09',
      guardianName: 'Dana Rivera',
      approved: false,
      paymentComplete: true,
    });
    expect(byName.Mateo.flags).toEqual(
      expect.arrayContaining(['Unverified Document', 'Parent Consent Pending']),
    );
  });

  it('is limited to admins of the event organization', async () => {
    expect((await roster(adminB)).status).toBe(403);
    expect((await request(app).get(`${ADMIN}/events/${eventId}/roster`)).status).toBe(401);
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await roster(parent.id)).status).toBe(403);
  });

  it('checks a coach in by hand, once, and the roster then shows when and how', async () => {
    const c = await personnel(eventId, 'COACH', {
      first: 'Check',
      last: 'In',
      status: 'READY_FOR_EVENT',
    });
    await clear(c);
    const body = { method: 'MANUAL', registrationId: c.regId, clientRequestId: randomUUID() };
    const first = await as(app, adminA).post(`/api/v1/events/${eventId}/check-ins`, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await as(app, adminA).post(`/api/v1/events/${eventId}/check-ins`, {
      ...body,
      clientRequestId: randomUUID(),
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');
    const entry = (await roster()).body.data.find(
      (e: { registrationId: string }) => e.registrationId === c.regId,
    );
    expect(entry).toMatchObject({ checkedInMethod: 'MANUAL', checkedInAt: expect.any(String) });

    const notReady = await personnel(eventId, 'STAFF', { status: 'DOCUMENT_REVIEW' });
    const refused = await as(app, adminA).post(`/api/v1/events/${eventId}/check-ins`, {
      method: 'MANUAL',
      registrationId: notReady.regId,
      clientRequestId: randomUUID(),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PLAYER_NOT_ELIGIBLE');
  });

  it('finds a coach in search, with the kind of registration', async () => {
    await personnel(eventId, 'COACH', {
      first: 'Searchable',
      last: 'Coachman',
      status: 'READY_FOR_EVENT',
    });
    const res = await as(app, adminA).get(`/api/v1/events/${eventId}/search-players?q=Searchable`);
    expect(res.body.data.results).toEqual([
      expect.objectContaining({ registrantType: 'COACH', ready: true, checkedIn: false }),
    ]);
  });
});
