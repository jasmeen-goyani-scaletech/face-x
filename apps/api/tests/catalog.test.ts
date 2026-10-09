import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** Events, teams and invite resolution against the real Express app and a real PostgreSQL database. */
let db: Database;
let app: ReturnType<typeof buildApi>;
let org: string;
let published: string;
let closed: string;
let draft: string;
let team: string;
let disabledTeam: string;
let inviteCode: string;
let viewer: string;

const inviteOf = async (teamId: string) =>
  (
    await db.query<{ invite_code: string }>('select invite_code from public.teams where id = $1', [
      teamId,
    ])
  ).rows[0]!.invite_code;

beforeAll(async () => {
  db = openTestDb();
  app = buildApi(db);
  org = await createOrg(db);
  published = await createEvent(db, org, { feeCents: 9500 });
  closed = await createEvent(db, org, { status: 'CLOSED' });
  draft = await createEvent(db, org, { status: 'DRAFT' });
  team = await createTeam(db, published);
  disabledTeam = await createTeam(db, published, { status: 'DISABLED' });
  await createTeam(db, draft);
  inviteCode = await inviteOf(team);
  // A user with no role at all: the catalog is reference data for any signed-in account.
  viewer = (await createUser(db)).id;
});
afterAll(() => db.close());

const V1 = '/api/v1';

describe('authentication', () => {
  it.each([
    ['get', `${V1}/events`],
    ['get', `${V1}/events/${randomUUID()}`],
    ['get', `${V1}/events/${randomUUID()}/teams`],
    ['get', `${V1}/teams/${randomUUID()}`],
    ['post', `${V1}/teams/resolve-invite`],
  ] as const)('%s %s needs a signed-in user', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });
});

describe('GET /events', () => {
  it('lists only PUBLISHED events, without organization or draft data', async () => {
    const res = await as(app, viewer).get(`${V1}/events`);
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(published);
    expect(ids).not.toContain(closed);
    expect(ids).not.toContain(draft);

    const event = (res.body.data as Record<string, unknown>[]).find((e) => e.id === published)!;
    expect(event).toMatchObject({
      name: 'Event',
      location: 'Field',
      timezone: 'America/Los_Angeles',
      fee: { amountCents: 9500, currency: 'usd' },
      status: 'PUBLISHED',
      registrationOpen: true,
    });
    expect(event).not.toHaveProperty('organizationId');
    expect(typeof event.startsAt).toBe('string');
  });

  it('orders soonest first', async () => {
    const later = await createEvent(db, org, { startsAt: new Date(Date.now() + 90 * 86_400_000) });
    const sooner = await createEvent(db, org, { startsAt: new Date(Date.now() + 2 * 86_400_000) });
    const res = await as(app, viewer).get(`${V1}/events`);
    const ids = (res.body.data as { id: string }[]).map((e) => e.id);
    expect(ids.indexOf(sooner)).toBeLessThan(ids.indexOf(later));
  });
});

describe('GET /events/:eventId', () => {
  it('returns a PUBLISHED event', async () => {
    const res = await as(app, viewer).get(`${V1}/events/${published}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: published, registrationOpen: true });
  });

  it('returns a CLOSED event as not open for registration', async () => {
    const res = await as(app, viewer).get(`${V1}/events/${closed}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: closed, status: 'CLOSED', registrationOpen: false });
  });

  it('answers 404 for a DRAFT and for an unknown event', async () => {
    for (const id of [draft, randomUUID()]) {
      const res = await as(app, viewer).get(`${V1}/events/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    }
  });

  it('answers 422 for a malformed id', async () => {
    const res = await as(app, viewer).get(`${V1}/events/not-a-uuid`);
    expect(res.status).toBe(422);
  });
});

describe('GET /events/:eventId/teams', () => {
  it('lists ACTIVE teams only and never exposes invite codes', async () => {
    const res = await as(app, viewer).get(`${V1}/events/${published}/teams`);
    expect(res.status).toBe(200);
    const teams = res.body.data as Record<string, unknown>[];
    expect(teams.map((t) => t.id)).toContain(team);
    expect(teams.map((t) => t.id)).not.toContain(disabledTeam);
    expect(teams[0]).toMatchObject({ eventId: published, club: 'Club', division: 'U12' });
    expect(JSON.stringify(res.body)).not.toContain(inviteCode);
    for (const t of teams) expect(t).not.toHaveProperty('inviteCode');
  });

  it('answers 404 for a DRAFT event, even though it has teams', async () => {
    const res = await as(app, viewer).get(`${V1}/events/${draft}/teams`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
  });

  it('returns an empty list for an event without teams', async () => {
    const res = await as(app, viewer).get(`${V1}/events/${closed}/teams`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /teams/:teamId', () => {
  it('returns the team with its event, without the invite code', async () => {
    const res = await as(app, viewer).get(`${V1}/teams/${team}`);
    expect(res.status).toBe(200);
    expect(res.body.data.team).toMatchObject({ id: team, eventId: published });
    expect(res.body.data.event).toMatchObject({ id: published });
    expect(JSON.stringify(res.body)).not.toContain(inviteCode);
  });

  it('answers 404 for a disabled team, a draft event team and an unknown team', async () => {
    const { rows } = await db.query<{ id: string }>(
      'select id from public.teams where event_id = $1',
      [draft],
    );
    for (const id of [disabledTeam, rows[0]!.id, randomUUID()]) {
      const res = await as(app, viewer).get(`${V1}/teams/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
    }
  });
});

describe('POST /teams/resolve-invite', () => {
  const resolve = (body: unknown) => as(app, viewer).post(`${V1}/teams/resolve-invite`, body);

  it('resolves a valid code to its team and event', async () => {
    const res = await resolve({ inviteCode });
    expect(res.status).toBe(200);
    expect(res.body.data.team).toMatchObject({ id: team, eventId: published });
    expect(res.body.data.event).toMatchObject({ id: published, registrationOpen: true });
    expect(JSON.stringify(res.body)).not.toContain(inviteCode);
  });

  it('is case-insensitive and ignores surrounding spaces', async () => {
    const res = await resolve({ inviteCode: `  ${inviteCode.toLowerCase()} ` });
    expect(res.status).toBe(200);
    expect(res.body.data.team.id).toBe(team);
  });

  it('accepts the teamId the invite link carries when it matches', async () => {
    const res = await resolve({ inviteCode, teamId: team });
    expect(res.status).toBe(200);
  });

  it('gives one identical answer for every kind of failure', async () => {
    const otherTeam = await createTeam(db, published);
    const disabled = await inviteOf(disabledTeam);
    const draftTeam = (
      await db.query<{ id: string }>('select id from public.teams where event_id = $1', [draft])
    ).rows[0]!.id;
    const closedTeam = await createTeam(db, closed);

    const failures = await Promise.all([
      resolve({ inviteCode: 'NOSUCHCD' }), // unknown code
      resolve({ inviteCode, teamId: otherTeam }), // code belongs to a different team
      resolve({ inviteCode, teamId: randomUUID() }), // team does not exist
      resolve({ inviteCode: disabled }), // disabled team
      resolve({ inviteCode: await inviteOf(draftTeam) }), // draft event
      resolve({ inviteCode: await inviteOf(closedTeam) }), // closed event
    ]);
    for (const res of failures) {
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({
        code: 'INVITE_NOT_FOUND',
        message: 'This invite link is not valid',
      });
    }
  });

  it('rejects malformed bodies with 422 and unknown fields', async () => {
    expect((await resolve({})).status).toBe(422);
    expect((await resolve({ inviteCode: 'x' })).status).toBe(422);
    expect((await resolve({ inviteCode: 'ABC DEF12' })).status).toBe(422);
    expect((await resolve({ inviteCode, teamId: 'nope' })).status).toBe(422);
    expect((await resolve({ inviteCode, extra: true })).status).toBe(422);
  });

  it('is rate limited per user so codes cannot be brute-forced', async () => {
    const limited = buildApi(db, { inviteLookupsPerMinute: 3 });
    const user = (await createUser(db)).id;
    const other = (await createUser(db)).id;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push(
        (await as(limited, user).post(`${V1}/teams/resolve-invite`, { inviteCode: 'NOSUCHCD' }))
          .status,
      );
    }
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
    // The limit is per user: someone else is unaffected.
    const res = await as(limited, other).post(`${V1}/teams/resolve-invite`, { inviteCode });
    expect(res.status).toBe(200);
  });
});
