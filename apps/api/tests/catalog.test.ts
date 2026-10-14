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

describe('public access', () => {
  // A registration form loads these before its visitor has a session.
  it('lists published events and a team list without a session', async () => {
    expect((await request(app).get(`${V1}/events`)).status).toBe(200);
    expect((await request(app).get(`${V1}/events/${published}/teams`)).status).toBe(200);
    expect((await request(app).get(`${V1}/events/${published}`)).status).toBe(200);
  });

  it('resolves an invite code without a session, and still rejects a malformed body', async () => {
    const ok = await request(app).post(`${V1}/teams/resolve-invite`).send({ inviteCode, teamId: team });
    expect(ok.status).toBe(200);
    expect((await request(app).post(`${V1}/teams/resolve-invite`)).status).toBe(422);
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

describe('GET /events with paging', () => {
  it('the plain list is unchanged (an array, the first 100), and unknown parameters are still ignored', async () => {
    // Other test files add open events to this shared database at the same time, so two reads are not compared for equality.
    const plain = await as(app, viewer).get(`${V1}/events`);
    expect(Array.isArray(plain.body.data)).toBe(true);
    expect(plain.body.data.length).toBeLessThanOrEqual(100);
    expect(plain.body.data.map((e: { id: string }) => e.id)).toContain(published);
    const ignored = await as(app, viewer).get(`${V1}/events?whatever=1`);
    expect(ignored.status).toBe(200);
    expect(Array.isArray(ignored.body.data)).toBe(true); // still the plain list, not a page
    expect(ignored.body.data.map((e: { id: string }) => e.id)).toContain(published);
  });

  it('reaches every open event when there are more than 100: pages cover them all, once each, soonest first', async () => {
    const day = 86_400_000;
    const other = await createOrg(db);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.events (organization_id, name, location, timezone, starts_at, ends_at, registration_fee_cents, status)
       select $1, 'Bulk ' || n, 'Field', 'America/Los_Angeles', to_timestamp($2::bigint / 1000.0 + n * 86400),
              to_timestamp($2::bigint / 1000.0 + n * 86400 + 10800), 0, 'PUBLISHED'
         from generate_series(1, 130) n returning id`,
      [other, Date.now() + 400 * day],
    );
    const bulk = new Set(rows.map((r) => r.id));

    // The plain list stops at 100: it is the compatibility form, and cannot reach the later events.
    const plain = await as(app, viewer).get(`${V1}/events`);
    expect(plain.body.data).toHaveLength(100);
    expect(plain.body.data.filter((e: { id: string }) => bulk.has(e.id)).length).toBeLessThan(130);

    // This database is shared with other test files that also add open events, so a row can move between pages while the
    // pages are read one after another. Rows seen twice are collapsed; what must hold is that none of ours is missing.
    const first = await as(app, viewer).get(`${V1}/events?page=1&pageSize=100`);
    expect(first.status).toBe(200);
    expect(first.body.data.total).toBeGreaterThanOrEqual(130);
    const pages = Math.ceil(first.body.data.total / 100);
    const seen: { id: string; startsAt: string; status: string }[] = [...first.body.data.items];
    for (let page = 2; page <= pages; page += 1) {
      seen.push(...(await as(app, viewer).get(`${V1}/events?page=${page}&pageSize=100`)).body.data.items);
    }
    const all = [...new Map(seen.map((e) => [e.id, e])).values()];
    for (const id of bulk) expect(all.map((e) => e.id)).toContain(id); // none of the 130 is unreachable
    expect(all.length).toBeGreaterThanOrEqual(130);
    expect(all.every((e) => e.status === 'PUBLISHED')).toBe(true); // closed and draft events never appear
    expect(all.map((e) => e.id)).not.toContain(closed);
    expect(all.map((e) => e.id)).not.toContain(draft);
    const starts = all.map((e) => Date.parse(e.startsAt));
    expect([...starts].sort((x, y) => x - y)).toEqual(starts); // soonest first across the page boundary
  });

  it('a page without the other parameter takes its default, a page past the end is empty, and bad paging is 422', async () => {
    const onlySize = await as(app, viewer).get(`${V1}/events?pageSize=2`);
    expect(onlySize.body.data).toMatchObject({ page: 1, pageSize: 2 });
    expect(onlySize.body.data.items).toHaveLength(2);
    const onlyPage = await as(app, viewer).get(`${V1}/events?page=1`);
    expect(onlyPage.body.data).toMatchObject({ page: 1, pageSize: 25 });
    const beyond = await as(app, viewer).get(`${V1}/events?page=99999&pageSize=100`);
    expect(beyond.body.data.items).toEqual([]);
    expect(beyond.body.data.total).toBeGreaterThan(0);
    for (const q of ['page=0', 'pageSize=0', 'pageSize=101', 'page=abc']) {
      expect((await as(app, viewer).get(`${V1}/events?${q}`)).status, q).toBe(422);
    }
    expect((await request(app).get(`${V1}/events?page=1`)).status).toBe(200);
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
