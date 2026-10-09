import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, childBody, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { bearerFor, buildApi, createUser, openTestDb } from './helpers/test-app';

/** Self-service onboarding (PARENT / PLAYER) and the registration list filters. */
let db: Database;
let app: ReturnType<typeof buildApi>;

beforeAll(() => {
  db = openTestDb();
  app = buildApi(db);
});
afterAll(() => db.close());

const ROLES = '/api/v1/users/me/roles';
const rolesOf = async (userId: string) =>
  (
    await db.query<{ role: string }>(
      'select role from public.user_roles where user_id = $1 order by role',
      [userId],
    )
  ).rows.map((r) => r.role);

describe('POST /users/me/roles', () => {
  it('needs a signed-in user', async () => {
    expect((await request(app).post(ROLES).send({ role: 'PARENT' })).status).toBe(401);
  });

  it.each(['PARENT', 'PLAYER'])('lets an account take the %s role and audits it', async (role) => {
    const user = await createUser(db);
    const res = await as(app, user.id).post(ROLES, { role });
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual([role]);
    expect(await rolesOf(user.id)).toEqual([role]);

    const { rows } = await db.query(
      `select action, actor_user_id, metadata from public.audit_logs
        where entity_id = $1 and action = 'USER_ROLE_ASSIGNED'`,
      [user.id],
    );
    expect(rows).toEqual([
      { action: 'USER_ROLE_ASSIGNED', actor_user_id: user.id, metadata: { role, self: true } },
    ]);
  });

  it('is idempotent: repeating the request changes and audits nothing more', async () => {
    const user = await createUser(db);
    await as(app, user.id).post(ROLES, { role: 'PARENT' });
    const again = await as(app, user.id).post(ROLES, { role: 'PARENT' });
    expect(again.status).toBe(200);
    expect(again.body.data.roles).toEqual(['PARENT']);
    const { rows } = await db.query(
      `select 1 from public.audit_logs where entity_id = $1 and action = 'USER_ROLE_ASSIGNED'`,
      [user.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('keeps existing roles when adding another', async () => {
    const user = await createUser(db, { roles: ['PARENT'] });
    const res = await as(app, user.id).post(ROLES, { role: 'PLAYER' });
    expect(res.body.data.roles).toEqual(['PARENT', 'PLAYER']);
  });

  it.each(['ADMIN', 'SUPERUSER', ''])(
    'refuses to self-assign %s (no privilege escalation)',
    async (role) => {
      const user = await createUser(db);
      const res = await as(app, user.id).post(ROLES, { role });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await rolesOf(user.id)).toEqual([]);
    },
  );

  it.each(['COACH', 'STAFF'])(
    'lets an account choose %s (it grants no event access by itself)',
    async (role) => {
      const user = await createUser(db);
      const res = await as(app, user.id).post(ROLES, { role });
      expect(res.status).toBe(200);
      expect(res.body.data.roles).toEqual([role]);
    },
  );

  it('rejects a missing role and unknown fields', async () => {
    const user = await createUser(db);
    expect((await as(app, user.id).post(ROLES, {})).status).toBe(422);
    expect((await as(app, user.id).post(ROLES, { role: 'PARENT', userId: 'x' })).status).toBe(422);
    expect(await rolesOf(user.id)).toEqual([]);
  });

  it('applies to the caller only: the target is never taken from the request', async () => {
    const caller = await createUser(db);
    const victim = await createUser(db);
    await as(app, caller.id).post(ROLES, { role: 'PARENT' });
    expect(await rolesOf(victim.id)).toEqual([]);
  });

  it('takes effect immediately: a brand-new account can then register a player end to end', async () => {
    const user = await createUser(db);
    const before = await as(app, user.id).post('/api/v1/players', childBody());
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('INSUFFICIENT_ROLE');

    await as(app, user.id).post(ROLES, { role: 'PARENT' });
    const after = await as(app, user.id).post('/api/v1/players', childBody());
    expect(after.status).toBe(201);

    // /auth/me reflects the new role with the same access token.
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(await bearerFor(user.id));
    expect(me.body.data.roles ?? me.body.data.user?.roles).toContain('PARENT');
  });
});

describe('GET /registrations filters', () => {
  async function setup() {
    const org = await createOrg(db);
    const eventA = await createEvent(db, org);
    const eventB = await createEvent(db, org);
    const teamA = await createTeam(db, eventA);
    const teamB = await createTeam(db, eventB);
    const parent = await createUser(db, { roles: ['PARENT'] });
    const make = async (firstName: string) =>
      (await as(app, parent.id).post('/api/v1/players', childBody({ firstName }))).body.data
        .id as string;
    const kid1 = await make('Ana');
    const kid2 = await make('Ben');
    const reg = async (eventId: string, playerId: string, teamId: string) =>
      (await as(app, parent.id).post('/api/v1/registrations', { eventId, playerId, teamId })).body
        .data.id as string;
    return {
      parent,
      eventA,
      eventB,
      kid1,
      kid2,
      r1A: await reg(eventA, kid1, teamA),
      r1B: await reg(eventB, kid1, teamB),
      r2A: await reg(eventA, kid2, teamA),
    };
  }
  const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((r) => r.id).sort();

  it('narrows by event, by player, or both; no filter returns everything', async () => {
    const s = await setup();
    const get = (qs: string) => as(app, s.parent.id).get(`/api/v1/registrations${qs}`);

    expect(ids(await get(''))).toEqual([s.r1A, s.r1B, s.r2A].sort());
    expect(ids(await get(`?eventId=${s.eventA}`))).toEqual([s.r1A, s.r2A].sort());
    expect(ids(await get(`?playerId=${s.kid1}`))).toEqual([s.r1A, s.r1B].sort());
    expect(ids(await get(`?eventId=${s.eventA}&playerId=${s.kid1}`))).toEqual([s.r1A]);
  });

  it("never reveals another family's registrations, whatever the filter", async () => {
    const s = await setup();
    const stranger = await createUser(db, { roles: ['PARENT'] });
    const res = await as(app, stranger.id).get(
      `/api/v1/registrations?eventId=${s.eventA}&playerId=${s.kid1}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects malformed or unknown filters with 422', async () => {
    const s = await setup();
    const get = (qs: string) => as(app, s.parent.id).get(`/api/v1/registrations${qs}`);
    expect((await get('?eventId=nope')).status).toBe(422);
    expect((await get('?status=DRAFT')).status).toBe(422);
  });
});

describe('player registration, end to end through the read APIs', () => {
  it('a brand-new account can go from sign-up to a submitted registration using only the API', async () => {
    const org = await createOrg(db);
    const event = await createEvent(db, org, { feeCents: 9500 });
    const team = await createTeam(db, event);
    const inviteCode = (
      await db.query<{ invite_code: string }>(
        'select invite_code from public.teams where id = $1',
        [team],
      )
    ).rows[0]!.invite_code;
    const user = await createUser(db);
    const api = as(app, user.id);

    expect((await api.post(ROLES, { role: 'PARENT' })).status).toBe(200);

    // Pick the event and team (here via a coach invite link: code + team id).
    const events = await api.get('/api/v1/events');
    expect((events.body.data as { id: string }[]).map((e) => e.id)).toContain(event);
    const invite = await api.post('/api/v1/teams/resolve-invite', { inviteCode, teamId: team });
    expect(invite.body.data.event.id).toBe(event);
    const teams = await api.get(`/api/v1/events/${event}/teams`);
    expect((teams.body.data as { id: string }[]).map((t) => t.id)).toEqual([team]);

    const player = (await api.post('/api/v1/players', childBody())).body.data.id as string;
    expect(
      (await api.get(`/api/v1/registrations?eventId=${event}&playerId=${player}`)).body.data,
    ).toEqual([]);

    const created = await api.post('/api/v1/registrations', {
      eventId: event,
      playerId: player,
      teamId: invite.body.data.team.id,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await api.post(`/api/v1/registrations/${id}/submit`)).body.data.status).toBe(
      'SUBMITTED',
    );

    // The filter now finds it, which is how a client knows not to create a second one.
    const found = await api.get(`/api/v1/registrations?eventId=${event}&playerId=${player}`);
    expect(found.body.data).toHaveLength(1);
    expect(found.body.data[0]).toMatchObject({ id, status: 'SUBMITTED' });
    expect((await api.get(`/api/v1/registrations/${id}/status`)).body.data.status).toBe(
      'SUBMITTED',
    );
  });
});
