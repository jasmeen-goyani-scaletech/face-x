import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** Per-team registration limits (players / coaches / staff): configuration, enforcement and the counting rules. */
let db: Database;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let eventId: string;
let adminA: string;

beforeAll(async () => {
  db = openTestDb();
  app = buildApi(db);
  orgA = await createOrg(db);
  eventId = await createEvent(db, orgA, { feeCents: 0 });
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
});
afterAll(() => db.close());

const T = '/api/v1/admin/teams';
const R = '/api/v1/registrations';

const setLimits = (teamId: string, body: Record<string, unknown>) =>
  as(app, adminA).patch(`${T}/${teamId}`, body);

/** A parent with a child, plus a DRAFT registration for the child on the team (made through the API). */
async function draftPlayer(teamId: string | null) {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id);
  const res = await as(app, parent.id).post(R, { eventId, playerId, ...(teamId ? { teamId } : {}) });
  return { parent, playerId, res, regId: res.body.data?.id as string };
}

/** Creates and submits; returns the submit response. */
async function submitPlayer(teamId: string) {
  const d = await draftPlayer(teamId);
  if (d.res.status !== 201) throw new Error(`create failed: ${d.res.status}`);
  return { ...d, submit: await as(app, d.parent.id).post(`${R}/${d.regId}/submit`) };
}

/** A coach/staff member with a profile and a DRAFT registration on the team (seeded; the flow itself is tested elsewhere). */
async function draftPersonnel(kind: 'COACH' | 'STAFF', teamId: string) {
  const user = await createUser(db, { roles: [kind] });
  const { rows: p } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
     values ($1, $2, $3, 'Pat', 'Person', $4) returning id`,
    [user.id, kind, kind === 'STAFF' ? 'TEAM_MANAGER' : null, user.email],
  );
  const { rows: r } = await db.query<{ id: string }>(
    `insert into public.registrations (event_id, registrant_type, staff_profile_id, status, team_id)
     values ($1, $2, $3, 'DRAFT', $4) returning id`,
    [eventId, kind, p[0]!.id, teamId],
  );
  return { user, regId: r[0]!.id };
}

describe('configuring limits (admin)', () => {
  it('defaults to unlimited for all three kinds', async () => {
    const team = await createTeam(db, eventId);
    const res = await as(app, adminA).get(`${T}/${team}`);
    expect(res.body.data.limits).toEqual({
      players: { max: null, used: 0 },
      coaches: { max: null, used: 0 },
      staff: { max: null, used: 0 },
    });
    // Unlimited really is unlimited.
    for (let i = 0; i < 3; i++) expect((await submitPlayer(team)).submit.status).toBe(200);
  });

  it('sets, updates and removes a limit per kind independently', async () => {
    const team = await createTeam(db, eventId);
    let res = await setLimits(team, { maxPlayers: 5, maxStaff: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.limits).toMatchObject({
      players: { max: 5 },
      coaches: { max: null },
      staff: { max: 2 },
    });
    res = await setLimits(team, { maxPlayers: 8 });
    expect(res.body.data.limits).toMatchObject({ players: { max: 8 }, staff: { max: 2 } });
    res = await setLimits(team, { maxStaff: null });
    expect(res.body.data.limits).toMatchObject({ players: { max: 8 }, staff: { max: null } });
    // The listing the admin screens use carries the limits too.
    const list = await as(app, adminA).get(`/api/v1/admin/events/${eventId}/teams`);
    expect(list.body.data.find((t: { id: string }) => t.id === team).limits.players.max).toBe(8);
  });

  it('rejects limits that are not positive whole numbers', async () => {
    const team = await createTeam(db, eventId);
    for (const bad of [0, -1, 1.5, '3', 1_000_000]) {
      expect((await setLimits(team, { maxPlayers: bad })).status).toBe(422);
    }
  });

  it('is admin-only, and only for the admin of the team’s organization', async () => {
    const team = await createTeam(db, eventId);
    const orgB = await createOrg(db);
    const adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
    expect((await as(app, adminB).patch(`${T}/${team}`, { maxPlayers: 1 })).status).toBe(404);
    const parent = await createUser(db, { roles: ['PARENT'] });
    expect((await as(app, parent.id).patch(`${T}/${team}`, { maxPlayers: 1 })).status).toBe(403);
    expect((await as(app, adminA).get(`${T}/${team}`)).body.data.limits.players.max).toBeNull();
  });
});

describe('enforcement', () => {
  it('stops players once the team is full, with a clear, consistent error', async () => {
    const team = await createTeam(db, eventId);
    const other = await createTeam(db, eventId);
    await setLimits(team, { maxPlayers: 2 });

    expect((await submitPlayer(team)).submit.status).toBe(200);
    expect((await submitPlayer(team)).submit.status).toBe(200);

    const third = await draftPlayer(team);
    // Refused already when the family picks the full team…
    expect(third.res.status).toBe(409);
    expect(third.res.body.error.code).toBe('TEAM_REGISTRATION_FULL');
    expect(third.res.body.error.message).toMatch(/full.*cannot accept any more players/i);

    // …and a draft made earlier (on an open team) cannot be moved onto it, nor submitted into it.
    const early = await draftPlayer(other);
    const move = await as(app, early.parent.id).patch(`${R}/${early.regId}`, { teamId: team });
    expect(move.status).toBe(409);
    expect(move.body.error.code).toBe('TEAM_REGISTRATION_FULL');

    // Other teams are not affected.
    expect((await as(app, early.parent.id).post(`${R}/${early.regId}/submit`)).status).toBe(200);
  });

  it('enforces at submit for a draft that was created before the team filled up', async () => {
    const team = await createTeam(db, eventId);
    const early = await draftPlayer(team); // team still unlimited
    await setLimits(team, { maxPlayers: 1 });
    expect((await submitPlayer(team)).submit.status).toBe(200); // takes the only place
    const late = await as(app, early.parent.id).post(`${R}/${early.regId}/submit`);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({ code: 'TEAM_REGISTRATION_FULL' });
    expect(late.body.error.message).toContain('Registration for ');
    // The draft is untouched and can be submitted once a place frees up.
    expect((await as(app, early.parent.id).get(`${R}/${early.regId}`)).body.data.status).toBe(
      'DRAFT',
    );
    await setLimits(team, { maxPlayers: null });
    expect((await as(app, early.parent.id).post(`${R}/${early.regId}/submit`)).status).toBe(200);
  });

  it('limits coaches and staff separately from players and from each other', async () => {
    const team = await createTeam(db, eventId);
    await setLimits(team, { maxCoaches: 1, maxStaff: 1 });

    const c1 = await draftPersonnel('COACH', team);
    const c2 = await draftPersonnel('COACH', team);
    expect((await as(app, c1.user.id).post(`${R}/${c1.regId}/submit`)).status).toBe(200);
    const blockedCoach = await as(app, c2.user.id).post(`${R}/${c2.regId}/submit`);
    expect(blockedCoach.status).toBe(409);
    expect(blockedCoach.body.error.code).toBe('TEAM_REGISTRATION_FULL');
    expect(blockedCoach.body.error.message).toMatch(/coaches/);

    const s1 = await draftPersonnel('STAFF', team);
    const s2 = await draftPersonnel('STAFF', team);
    expect((await as(app, s1.user.id).post(`${R}/${s1.regId}/submit`)).status).toBe(200);
    const blockedStaff = await as(app, s2.user.id).post(`${R}/${s2.regId}/submit`);
    expect(blockedStaff.status).toBe(409);
    expect(blockedStaff.body.error.message).toMatch(/staff members/);

    // Players on the same team have no limit and are not blocked by the full coach/staff slots.
    expect((await submitPlayer(team)).submit.status).toBe(200);
    const used = (await as(app, adminA).get(`${T}/${team}`)).body.data.limits;
    expect(used).toMatchObject({
      players: { max: null, used: 1 },
      coaches: { max: 1, used: 1 },
      staff: { max: 1, used: 1 },
    });
  });

  it('keeps existing registrations when a limit is lowered, and blocks new ones until the count falls below it', async () => {
    const team = await createTeam(db, eventId);
    const first = await submitPlayer(team);
    await submitPlayer(team);
    await submitPlayer(team);

    const lowered = await setLimits(team, { maxPlayers: 1 });
    expect(lowered.status).toBe(200);
    expect(lowered.body.data.limits.players).toEqual({ max: 1, used: 3 });
    expect((await as(app, first.parent.id).get(`${R}/${first.regId}`)).body.data.status).toBe(
      'SUBMITTED',
    );
    expect((await draftPlayer(team)).res.status).toBe(409);

    // Cancelling frees a place only once the count is back under the limit.
    await db.query(`update public.registrations set status = 'CANCELLED' where id = $1`, [first.regId]);
    expect((await draftPlayer(team)).res.status).toBe(409); // 2 used, limit 1
    await setLimits(team, { maxPlayers: 3 });
    expect((await submitPlayer(team)).submit.status).toBe(200); // 2 used, limit 3
  });

  it('counts only registrations that hold a place: draft, cancelled and rejected do not', async () => {
    const team = await createTeam(db, eventId);
    await setLimits(team, { maxPlayers: 1 });
    const a = await submitPlayer(team);
    expect((await draftPlayer(team)).res.status).toBe(409);

    for (const status of ['REJECTED', 'CANCELLED']) {
      await db.query('update public.registrations set status = $2 where id = $1', [a.regId, status]);
      const open = await submitPlayer(team); // the freed place is taken
      expect(open.submit.status).toBe(200);
      await db.query(`update public.registrations set status = 'CANCELLED' where id = $1`, [open.regId]);
    }
    // A draft never counted: several drafts can exist on a team with room, only the submit is binding.
    const used = (await as(app, adminA).get(`${T}/${team}`)).body.data.limits.players.used;
    expect(used).toBe(0);
  });

  it('never lets concurrent submissions exceed the limit', async () => {
    const team = await createTeam(db, eventId);
    const drafts = await Promise.all(Array.from({ length: 6 }, () => draftPlayer(team)));
    await setLimits(team, { maxPlayers: 2 });
    const results = await Promise.all(
      drafts.map((d) => as(app, d.parent.id).post(`${R}/${d.regId}/submit`)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    const { rows } = await db.query<{ n: string }>(
      `select count(*) as n from public.registrations where team_id = $1 and status <> 'DRAFT'`,
      [team],
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });
});
