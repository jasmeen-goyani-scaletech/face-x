import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** Admin assignment of teams to coaches/staff, and the team-scoped access that follows from it. */
let db: Database;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let eventA: string;
let teamA1: string;
let teamA2: string;
let teamA3: string;
let adminA: string;

beforeAll(async () => {
  db = openTestDb();
  app = buildApi(db);
  orgA = await createOrg(db);
  eventA = await createEvent(db, orgA, { feeCents: 0 });
  teamA1 = await createTeam(db, eventA);
  teamA2 = await createTeam(db, eventA);
  teamA3 = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
});
afterAll(() => db.close());

/** A coach/staff account with a profile and a registration, seeded directly (the registration flow is tested elsewhere). */
async function person(
  kind: 'COACH' | 'STAFF',
  status: string,
  o: { eventId?: string; teamId?: string | null; disabled?: boolean } = {},
) {
  const user = await createUser(db, { roles: [kind] });
  const { rows: p } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
     values ($1, $2, $3, 'Pat', 'Person', $4) returning id`,
    [user.id, kind, kind === 'STAFF' ? 'TEAM_MANAGER' : null, user.email],
  );
  const { rows: r } = await db.query<{ id: string }>(
    `insert into public.registrations (event_id, registrant_type, staff_profile_id, status, team_id, event_access_disabled)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [o.eventId ?? eventA, kind, p[0]!.id, status, o.teamId ?? null, o.disabled ?? false],
  );
  return { user, profileId: p[0]!.id, regId: r[0]!.id };
}

/** A player registration on a team (seeded), so a team has someone on its roster. */
async function playerOn(teamId: string, status = 'READY_FOR_EVENT') {
  const { rows: pl } = await db.query<{ id: string }>(
    `insert into public.players (first_name, last_name, date_of_birth) values ('Pia', 'Player', '2014-01-01') returning id`,
  );
  await db.query(
    `insert into public.registrations (event_id, registrant_type, player_id, status, team_id)
     values ($1, 'PLAYER', $2, $3, $4)`,
    [eventA, pl[0]!.id, status, teamId],
  );
}

const A = '/api/v1/admin/registrations';

describe('admin: assigning teams to a coach', () => {
  it('lets an admin add several teams, list them and remove one', async () => {
    const c = await person('COACH', 'VERIFIED');
    const admin = as(app, adminA);

    expect((await admin.get(`${A}/${c.regId}/teams`)).body.data).toEqual([]);
    const first = await admin.post(`${A}/${c.regId}/teams`, { teamId: teamA1 });
    expect(first.status).toBe(201);
    const second = await admin.post(`${A}/${c.regId}/teams`, { teamId: teamA2 });
    expect(second.body.data.map((t: { teamId: string }) => t.teamId).sort()).toEqual(
      [teamA1, teamA2].sort(),
    );

    // Adding the same team again changes nothing.
    const again = await admin.post(`${A}/${c.regId}/teams`, { teamId: teamA2 });
    expect(again.body.data).toHaveLength(2);

    const removed = await admin.delete(`${A}/${c.regId}/teams/${teamA1}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.map((t: { teamId: string }) => t.teamId)).toEqual([teamA2]);
    const { rows } = await db.query(
      `select action from public.audit_logs where entity_id = $1 order by created_at`,
      [c.regId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'TEAM_ASSIGNMENT_ADDED',
      'TEAM_ASSIGNMENT_ADDED',
      'TEAM_ASSIGNMENT_REMOVED',
    ]);
  });

  it('refuses everyone but an admin of the registration’s organization', async () => {
    const c = await person('COACH', 'VERIFIED');
    const coach = as(app, c.user.id);
    expect((await request(app).get(`${A}/${c.regId}/teams`)).status).toBe(401);
    expect((await coach.get(`${A}/${c.regId}/teams`)).status).toBe(403);
    // A coach cannot assign themselves.
    expect((await coach.post(`${A}/${c.regId}/teams`, { teamId: teamA1 })).status).toBe(403);

    const orgB = await createOrg(db);
    const adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
    expect((await as(app, adminB).get(`${A}/${c.regId}/teams`)).status).toBe(404);
    expect((await as(app, adminB).post(`${A}/${c.regId}/teams`, { teamId: teamA1 })).status).toBe(
      404,
    );
  });

  it('refuses a team of another event, an unknown team, a player registration and a bad body', async () => {
    const c = await person('COACH', 'VERIFIED');
    const otherEvent = await createEvent(db, orgA, { feeCents: 0 });
    const foreign = await createTeam(db, otherEvent);
    const admin = as(app, adminA);
    expect((await admin.post(`${A}/${c.regId}/teams`, { teamId: foreign })).status).toBe(404);
    expect(
      (await admin.post(`${A}/${c.regId}/teams`, { teamId: '00000000-0000-4000-8000-00000000dead' }))
        .status,
    ).toBe(404);
    expect((await admin.post(`${A}/${c.regId}/teams`, { teamId: 'nope' })).status).toBe(422);
    expect((await admin.post(`${A}/${c.regId}/teams`, { teamId: teamA1, x: 1 })).status).toBe(422);

    const { rows } = await db.query<{ id: string }>(
      `insert into public.players (first_name, last_name, date_of_birth) values ('A', 'B', '2014-01-01') returning id`,
    );
    const { rows: reg } = await db.query<{ id: string }>(
      `insert into public.registrations (event_id, registrant_type, player_id, status) values ($1, 'PLAYER', $2, 'DRAFT') returning id`,
      [eventA, rows[0]!.id],
    );
    expect((await admin.get(`${A}/${reg[0]!.id}/teams`)).status).toBe(404);
  });
});

describe('team-scoped access for coaches and staff', () => {
  it('gives a coach every assigned team and nothing else', async () => {
    const c = await person('COACH', 'READY_FOR_EVENT');
    await playerOn(teamA1);
    await playerOn(teamA2);
    await playerOn(teamA3);
    await as(app, adminA).post(`${A}/${c.regId}/teams`, { teamId: teamA1 });
    await as(app, adminA).post(`${A}/${c.regId}/teams`, { teamId: teamA2 });
    const coach = as(app, c.user.id);

    const mine = await coach.get('/api/v1/me/teams');
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((t: { id: string }) => t.id).sort()).toEqual([teamA1, teamA2].sort());
    expect(mine.body.data[0]).toMatchObject({ via: 'COACH', event: { id: eventA } });
    expect(mine.body.data[0].inviteCode).toMatch(/^[0-9A-F]{8}$/);

    for (const team of [teamA1, teamA2]) {
      const roster = await coach.get(`/api/v1/team-access/teams/${team}/roster`);
      expect(roster.status).toBe(200);
      expect(roster.body.data).toHaveLength(1);
      expect(roster.body.data[0]).toMatchObject({ registrantType: 'PLAYER' });
      // No documents, payments or email addresses are part of what a coach sees.
      expect(roster.body.data[0]).not.toHaveProperty('email');
      expect(roster.body.data[0]).not.toHaveProperty('documents');
    }
    // Direct requests naming an unassigned team get a 404, whatever the endpoint.
    expect((await coach.get(`/api/v1/team-access/teams/${teamA3}`)).status).toBe(404);
    expect((await coach.get(`/api/v1/team-access/teams/${teamA3}/roster`)).status).toBe(404);
  });

  it('stops working the moment the admin removes the assignment', async () => {
    const c = await person('COACH', 'VERIFIED');
    await as(app, adminA).post(`${A}/${c.regId}/teams`, { teamId: teamA1 });
    const coach = as(app, c.user.id);
    expect((await coach.get(`/api/v1/team-access/teams/${teamA1}`)).status).toBe(200);
    await as(app, adminA).delete(`${A}/${c.regId}/teams/${teamA1}`);
    expect((await coach.get(`/api/v1/team-access/teams/${teamA1}`)).status).toBe(404);
    expect((await coach.get('/api/v1/me/teams')).body.data).toEqual([]);
  });

  it('gives staff their assigned teams, without the invite code', async () => {
    const s = await person('STAFF', 'VERIFIED');
    await as(app, adminA).post(`${A}/${s.regId}/teams`, { teamId: teamA3 });
    const staff = as(app, s.user.id);
    const mine = await staff.get('/api/v1/me/teams');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ id: teamA3, via: 'STAFF', inviteCode: null });
    expect((await staff.get(`/api/v1/team-access/teams/${teamA1}/roster`)).status).toBe(404);
  });

  it('needs an approved registration, not just an assignment', async () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'DOCUMENT_REVIEW', 'REJECTED', 'CANCELLED']) {
      const c = await person('COACH', status);
      await as(app, adminA).post(`${A}/${c.regId}/teams`, { teamId: teamA1 });
      expect((await as(app, c.user.id).get(`/api/v1/team-access/teams/${teamA1}`)).status).toBe(404);
    }
    const off = await person('COACH', 'READY_FOR_EVENT', { disabled: true });
    await as(app, adminA).post(`${A}/${off.regId}/teams`, { teamId: teamA1 });
    expect((await as(app, off.user.id).get(`/api/v1/team-access/teams/${teamA1}`)).status).toBe(404);
  });

  it('does not let an assignment reach a team of an event the person is not registered for', async () => {
    const c = await person('COACH', 'VERIFIED');
    const otherEvent = await createEvent(db, orgA, { feeCents: 0 });
    const foreign = await createTeam(db, otherEvent);
    // Seeded directly, bypassing the admin API's same-event check: the access query still refuses it.
    await db.query('insert into public.team_assignments (staff_profile_id, team_id) values ($1, $2)', [
      c.profileId,
      foreign,
    ]);
    expect((await as(app, c.user.id).get(`/api/v1/team-access/teams/${foreign}`)).status).toBe(404);
  });

  it('keeps parents, players and strangers out, and admins of other organizations too', async () => {
    expect((await request(app).get('/api/v1/me/teams')).status).toBe(401);
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await as(app, parent.id).get('/api/v1/me/teams')).status).toBe(403);
    expect((await as(app, parent.id).get(`/api/v1/team-access/teams/${teamA1}`)).status).toBe(403);

    const orgB = await createOrg(db);
    const adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
    expect((await as(app, adminB).get(`/api/v1/team-access/teams/${teamA1}`)).status).toBe(404);
    // The admin of the owning organization keeps access.
    const own = await as(app, adminA).get(`/api/v1/team-access/teams/${teamA1}`);
    expect(own.status).toBe(200);
    expect(own.body.data.via).toBe('ADMIN');
  });

  it('does not let a coach or staff member use admin endpoints', async () => {
    const c = await person('COACH', 'READY_FOR_EVENT');
    await as(app, adminA).post(`${A}/${c.regId}/teams`, { teamId: teamA1 });
    const coach = as(app, c.user.id);
    expect((await coach.get(`/api/v1/admin/events/${eventA}/roster`)).status).toBe(403);
    expect((await coach.get(`/api/v1/admin/teams/${teamA1}`)).status).toBe(403);
    expect((await coach.patch(`/api/v1/admin/teams/${teamA1}`, { maxPlayers: 1 })).status).toBe(403);
  });
});

describe('existing teams become assignments', () => {
  it('a coach who creates a team holds it', async () => {
    const c = await person('COACH', 'VERIFIED');
    const res = await as(app, c.user.id).post(`/api/v1/registrations/${c.regId}/team`, {
      name: `Hawks ${Date.now()}`,
    });
    expect(res.status).toBe(201);
    const mine = await as(app, c.user.id).get('/api/v1/me/teams');
    expect(mine.body.data.map((t: { id: string }) => t.id)).toEqual([res.body.data.team.id]);
  });
});
