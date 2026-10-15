import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** A coach's own team: view it, create it once approved, and read the roster of the people registered to it. */
let db: Database;
let app: ReturnType<typeof buildApi>;
let eventId: string;
let otherTeam: string;

beforeAll(async () => {
  db = openTestDb();
  app = buildApi(db);
  const org = await createOrg(db);
  eventId = await createEvent(db, org, { feeCents: 0 });
  otherTeam = await createTeam(db, eventId);
});
afterAll(() => db.close());

const R = '/api/v1/registrations';

/** A coach with a registration in the given status, seeded directly (the registration flow itself is tested elsewhere). */
async function coach(status: string, o: { teamId?: string | null; disabled?: boolean } = {}) {
  const user = await createUser(db, { roles: ['COACH'] });
  const { rows: p } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, first_name, last_name, email)
     values ($1, 'COACH', 'Cora', 'Coach', $2) returning id`,
    [user.id, user.email],
  );
  const { rows: r } = await db.query<{ id: string }>(
    `insert into public.registrations (event_id, registrant_type, staff_profile_id, status, team_id, event_access_disabled)
     values ($1, 'COACH', $2, $3, $4, $5) returning id`,
    [eventId, p[0]!.id, status, o.teamId ?? null, o.disabled ?? false],
  );
  return { user, regId: r[0]!.id };
}

describe('GET /registrations/:id/team', () => {
  it('shows the coach their event and that they may create a team once approved', async () => {
    const c = await coach('VERIFIED');
    const res = await as(app, c.user.id).get(`${R}/${c.regId}/team`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      registrationId: c.regId,
      registrationStatus: 'VERIFIED',
      team: null,
      canCreateTeam: true,
      rosterOpen: false,
      event: { id: eventId, name: 'Event' },
    });
  });

  it('does not offer team creation before approval', async () => {
    const c = await coach('DOCUMENT_REVIEW');
    const res = await as(app, c.user.id).get(`${R}/${c.regId}/team`);
    expect(res.body.data).toMatchObject({ canCreateTeam: false, rosterOpen: false });
  });

  it('shows the invite code of the team the coach is on', async () => {
    const c = await coach('READY_FOR_EVENT', { teamId: otherTeam });
    const res = await as(app, c.user.id).get(`${R}/${c.regId}/team`);
    expect(res.body.data.team).toMatchObject({ id: otherTeam, status: 'ACTIVE' });
    expect(res.body.data.team.inviteCode).toMatch(/^[0-9A-F]{8}$/);
    expect(res.body.data).toMatchObject({ canCreateTeam: false, rosterOpen: true });
  });

  it('is private to the coach: other users, other roles and strangers get 401/403/404', async () => {
    const c = await coach('VERIFIED');
    expect((await request(app).get(`${R}/${c.regId}/team`)).status).toBe(401);
    const other = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, other.id).get(`${R}/${c.regId}/team`)).status).toBe(404);
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await as(app, parent.id).get(`${R}/${c.regId}/team`)).status).toBe(403);
    expect((await as(app, c.user.id).get(`${R}/not-a-uuid/team`)).status).toBe(422);
  });
});

describe('POST /registrations/:id/team', () => {
  it('creates the team for an approved coach and attaches it to their registration', async () => {
    const c = await coach('READY_FOR_EVENT');
    const res = await as(app, c.user.id).post(`${R}/${c.regId}/team`, { name: 'Hawks U14' });
    expect(res.status).toBe(201);
    expect(res.body.data.team).toMatchObject({
      name: 'Hawks U14',
      club: 'Hawks U14',
      division: 'Open',
      status: 'ACTIVE',
    });
    expect(res.body.data).toMatchObject({ canCreateTeam: false });
    const { rows } = await db.query(
      `select t.coach_profile_id is not null as owned, r.team_id = t.id as attached, t.event_id = r.event_id as same_event
         from public.teams t join public.registrations r on r.id = $1 where t.id = $2`,
      [c.regId, res.body.data.team.id],
    );
    expect(rows[0]).toEqual({ owned: true, attached: true, same_event: true });
    const audit = await db.query(
      `select actor_user_id from public.audit_logs where entity_id = $1 and action = 'TEAM_CREATED'`,
      [res.body.data.team.id],
    );
    expect(audit.rows).toEqual([{ actor_user_id: c.user.id }]);
  });

  it('refuses an unapproved coach, a second team, a duplicate name, bad input and strangers', async () => {
    const early = await coach('DOCUMENT_REVIEW');
    const refused = await as(app, early.user.id).post(`${R}/${early.regId}/team`, {
      name: 'Early FC',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('REGISTRATION_NOT_APPROVED');

    const c = await coach('VERIFIED');
    expect((await as(app, c.user.id).post(`${R}/${c.regId}/team`, { name: 'First' })).status).toBe(
      201,
    );
    const second = await as(app, c.user.id).post(`${R}/${c.regId}/team`, { name: 'Second' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('COACH_ALREADY_HAS_TEAM');

    const d = await coach('VERIFIED');
    const dup = await as(app, d.user.id).post(`${R}/${d.regId}/team`, { name: 'First' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TEAM_ALREADY_EXISTS');

    const e = await coach('VERIFIED');
    for (const bad of [
      {},
      { name: '' },
      { name: 'X', eventId },
      { name: 'X', inviteCode: 'ABC' },
    ]) {
      expect((await as(app, e.user.id).post(`${R}/${e.regId}/team`, bad)).status).toBe(422);
    }
    const stranger = await createUser(db, { roles: ['COACH'] });
    expect(
      (await as(app, stranger.id).post(`${R}/${e.regId}/team`, { name: 'Steal' })).status,
    ).toBe(404);
  });
});

describe('GET /registrations/:id/team/roster', () => {
  async function member(
    team: string,
    kind: 'PLAYER' | 'STAFF' | 'COACH',
    status: string,
    name: string,
  ) {
    if (kind === 'PLAYER') {
      const parent = await createUser(db, { roles: ['PARENT'] });
      const playerId = await createChild(app, parent.id, { firstName: name });
      await db.query(
        `insert into public.registrations (event_id, registrant_type, player_id, status, team_id) values ($1, 'PLAYER', $2, $3, $4)`,
        [eventId, playerId, status, team],
      );
      return;
    }
    const user = await createUser(db, { roles: [kind] });
    const { rows } = await db.query<{ id: string }>(
      `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
       values ($1, $2, $3, $4, 'Member', $5) returning id`,
      [user.id, kind, kind === 'STAFF' ? 'TEAM_MANAGER' : null, name, user.email],
    );
    await db.query(
      `insert into public.registrations (event_id, registrant_type, staff_profile_id, status, team_id) values ($1, $2, $3, $4, $5)`,
      [eventId, kind, rows[0]!.id, status, team],
    );
  }

  it("lists only this team's players, never staff, coaches or other teams, with no email or documents", async () => {
    const lead = await coach('READY_FOR_EVENT');
    const created = await as(app, lead.user.id).post(`${R}/${lead.regId}/team`, {
      name: 'Roster Team',
    });
    const teamId = created.body.data.team.id as string;
    await member(teamId, 'PLAYER', 'READY_FOR_EVENT', 'Pia');
    await member(teamId, 'PLAYER', 'DOCUMENT_REVIEW', 'Pending');
    await member(teamId, 'STAFF', 'READY_FOR_EVENT', 'Stu');
    await member(teamId, 'COACH', 'READY_FOR_EVENT', 'Assistant');
    await member(teamId, 'PLAYER', 'DRAFT', 'Draftee');
    await member(otherTeam, 'PLAYER', 'READY_FOR_EVENT', 'Elsewhere');

    const res = await as(app, lead.user.id).get(`${R}/${lead.regId}/team/roster`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((m: { firstName: string }) => m.firstName).sort();
    expect(names).toEqual(['Pending', 'Pia']);
    const pia = res.body.data.find((m: { firstName: string }) => m.firstName === 'Pia');
    expect(pia).toMatchObject({
      registrantType: 'PLAYER',
      approved: true,
      guardianName: 'Dana Rivera',
      dateOfBirth: '2014-03-09',
    });
    const pending = res.body.data.find((m: { firstName: string }) => m.firstName === 'Pending');
    expect(pending).toMatchObject({ approved: false });
    expect(pending.flags.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/email|storage|photoDocumentId|fee/i);
  });

  it('is closed until the coach is cleared, and while access is off', async () => {
    const pending = await coach('VERIFIED', { teamId: otherTeam });
    const closed = await as(app, pending.user.id).get(`${R}/${pending.regId}/team/roster`);
    expect(closed.status).toBe(403);
    expect(closed.body.error.code).toBe('TEAM_ROSTER_NOT_AVAILABLE');
    const off = await coach('READY_FOR_EVENT', { teamId: otherTeam, disabled: true });
    expect((await as(app, off.user.id).get(`${R}/${off.regId}/team/roster`)).status).toBe(403);
    const none = await coach('READY_FOR_EVENT');
    const noTeam = await as(app, none.user.id).get(`${R}/${none.regId}/team/roster`);
    expect(noTeam.status).toBe(409);
    expect(noTeam.body.error.code).toBe('COACH_HAS_NO_TEAM');
    const other = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, other.id).get(`${R}/${pending.regId}/team/roster`)).status).toBe(404);
  });
});
