import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, childBody, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** Registration lifecycle against the real Express app and a real PostgreSQL database. */
let db: Database;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let eventA: string;
let teamA: string;
let adminA: string;
let adminB: string;

beforeAll(async () => {
  db = openTestDb();
  app = buildApi(db);
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  eventA = await createEvent(db, orgA, { feeCents: 9500 });
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
});
afterAll(() => db.close());

const newParent = () => createUser(db, { roles: ['PARENT'] });
const R = '/api/v1/registrations';

/** A parent with one child and (optionally) a DRAFT registration for event A. */
async function family(
  options: { team?: boolean; event?: string; child?: Record<string, unknown> } = {},
) {
  const parent = await newParent();
  const playerId = await createChild(app, parent.id, options.child);
  const body: Record<string, unknown> = { eventId: options.event ?? eventA, playerId };
  if (options.team !== false) body.teamId = teamA;
  const res = await as(app, parent.id).post(R, body);
  if (res.status !== 201) throw new Error(`setup failed ${res.status} ${JSON.stringify(res.body)}`);
  return { parent, playerId, id: res.body.data.id as string, registration: res.body.data };
}

describe('POST /registrations: create a draft', () => {
  it('creates a DRAFT with history, fee snapshot, registration number and audit entry', async () => {
    const { registration, id, parent } = await family();
    expect(registration).toMatchObject({
      status: 'DRAFT',
      registrantType: 'PLAYER',
      guestCount: 0,
      submittedAt: null,
      fee: { amountCents: 9500, currency: 'usd' },
      event: { id: eventA, timezone: 'America/Los_Angeles', status: 'PUBLISHED' },
      team: { id: teamA },
      player: { firstName: 'Mateo', dateOfBirth: '2014-03-09' },
    });
    expect(registration.registrationNumber).toMatch(/^FX-\d{4}-\d{5}$/);
    expect(registration.guardians).toHaveLength(1);

    const { rows: history } = await db.query(
      'select from_status, to_status, changed_by from public.registration_status_history where registration_id = $1',
      [id],
    );
    expect(history).toEqual([{ from_status: null, to_status: 'DRAFT', changed_by: parent.id }]);
    const { rows: audit } = await db.query(
      'select action, actor_user_id from public.audit_logs where entity_id = $1',
      [id],
    );
    expect(audit).toEqual([{ action: 'REGISTRATION_CREATED', actor_user_id: parent.id }]);
  });

  it('works without a team or guests (a draft can be incomplete) and with guests', async () => {
    const parent = await newParent();
    const a = await createChild(app, parent.id);
    const b = await createChild(app, parent.id, { firstName: 'Lucia' });
    const noTeam = await as(app, parent.id).post(R, { eventId: eventA, playerId: a });
    expect(noTeam.status).toBe(201);
    expect(noTeam.body.data.team).toBeNull();
    const guests = await as(app, parent.id).post(R, {
      eventId: eventA,
      playerId: b,
      guestCount: 4,
    });
    expect(guests.body.data.guestCount).toBe(4);
  });

  it('rejects invalid input: ids, guests, unknown fields (no mass assignment)', async () => {
    const parent = await newParent();
    const playerId = await createChild(app, parent.id);
    const ok = { eventId: eventA, playerId };
    for (const bad of [
      {},
      { ...ok, eventId: 'nope' },
      { ...ok, playerId: 'nope' },
      { ...ok, teamId: 'nope' },
      { ...ok, guestCount: 11 },
      { ...ok, guestCount: -1 },
      { ...ok, guestCount: 1.5 },
      { ...ok, status: 'VERIFIED' },
      { ...ok, createdBy: parent.id },
      { ...ok, feeCents: 0 },
      { ...ok, registrantType: 'COACH' },
      { ...ok, eventId: "1' OR '1'='1" },
    ]) {
      const res = await as(app, parent.id).post(R, bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    const { rows } = await db.query('select 1 from public.registrations where player_id = $1', [
      playerId,
    ]);
    expect(rows).toEqual([]);
  });

  it('only allows PUBLISHED events: draft events are invisible, closed events are not open', async () => {
    const parent = await newParent();
    const playerId = await createChild(app, parent.id);
    const draftEvent = await createEvent(db, orgA, { status: 'DRAFT' });
    const closedEvent = await createEvent(db, orgA, { status: 'CLOSED' });
    const draft = await as(app, parent.id).post(R, { eventId: draftEvent, playerId });
    expect(draft.status).toBe(404);
    expect(draft.body.error.code).toBe('EVENT_NOT_FOUND');
    const closed = await as(app, parent.id).post(R, { eventId: closedEvent, playerId });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('EVENT_NOT_OPEN');
    expect(
      (
        await as(app, parent.id).post(R, {
          eventId: '11111111-1111-4111-8111-111111111111',
          playerId,
        })
      ).status,
    ).toBe(404);
  });

  it('validates the team: must belong to the same event and be active', async () => {
    const parent = await newParent();
    const playerId = await createChild(app, parent.id);
    const otherEvent = await createEvent(db, orgA);
    const foreignTeam = await createTeam(db, otherEvent);
    const disabledTeam = await createTeam(db, eventA, { status: 'DISABLED' });
    for (const teamId of [foreignTeam, disabledTeam, '11111111-1111-4111-8111-111111111111']) {
      const res = await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('TEAM_NOT_AVAILABLE');
    }
  });

  it("refuses to register someone else's player, or a player that does not exist", async () => {
    const owner = await newParent();
    const stranger = await newParent();
    const playerId = await createChild(app, owner.id);
    const res = await as(app, stranger.id).post(R, { eventId: eventA, playerId });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PLAYER_NOT_FOUND');
    expect(
      (
        await as(app, stranger.id).post(R, {
          eventId: eventA,
          playerId: '11111111-1111-4111-8111-111111111111',
        })
      ).status,
    ).toBe(404);
  });

  it('requires authentication and a registrant role', async () => {
    expect((await request(app).post(R).send({})).status).toBe(401);
    for (const roles of [[], ['ADMIN']] as const) {
      const u = await createUser(db, { roles: [...roles] });
      expect((await as(app, u.id).post(R, {})).status).toBe(403);
    }
    // A coach may register (their own profile), so an empty body is a validation problem, not a role problem.
    const coach = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, coach.id).post(R, {})).status).toBe(422);
  });
});

describe('duplicate and concurrent creation', () => {
  it('rejects a second registration of the same player for the same event', async () => {
    const { parent, playerId } = await family();
    const dup = await as(app, parent.id).post(R, { eventId: eventA, playerId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('REGISTRATION_ALREADY_EXISTS');
  });

  it('lets the same player register for a different event', async () => {
    const { parent, playerId } = await family();
    const second = await createEvent(db, orgA);
    expect((await as(app, parent.id).post(R, { eventId: second, playerId })).status).toBe(201);
  });

  it('creates exactly one registration (and one history row) when many requests race', async () => {
    const parent = await newParent();
    const playerId = await createChild(app, parent.id);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    for (const r of results.filter((r) => r.status === 409))
      expect(r.body.error.code).toBe('REGISTRATION_ALREADY_EXISTS');
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.registration_status_history h join public.registrations r on r.id = h.registration_id where r.player_id = $1`,
      [playerId],
    );
    expect(rows[0]!.n).toBe(1);
    const { rows: regs } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.registrations where player_id = $1',
      [playerId],
    );
    expect(regs[0]!.n).toBe(1);
  });
});

describe('PATCH /registrations/:id: edit / save the draft', () => {
  it('updates the team and guests, repeatedly, and can clear the team', async () => {
    const { parent, id } = await family({ team: false });
    const p = (b: unknown) => as(app, parent.id).patch(`${R}/${id}`, b);
    expect((await p({ teamId: teamA })).body.data.team.id).toBe(teamA);
    expect((await p({ guestCount: 3 })).body.data).toMatchObject({
      guestCount: 3,
      team: { id: teamA },
    }); // untouched field kept
    expect((await p({ teamId: null })).body.data.team).toBeNull();
    const res = await p({ guestCount: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
  });

  it('rejects an empty body, unknown or privileged fields, bad values and an unusable team', async () => {
    const { parent, id } = await family();
    const otherTeam = await createTeam(db, await createEvent(db, orgA));
    for (const bad of [
      {},
      { status: 'SUBMITTED' },
      { playerId: '11111111-1111-4111-8111-111111111111' },
      { eventId: eventA },
      { guestCount: 99 },
      { teamId: 'x' },
      { feeCents: 0 },
    ]) {
      expect((await as(app, parent.id).patch(`${R}/${id}`, bad)).status, JSON.stringify(bad)).toBe(
        422,
      );
    }
    const wrongTeam = await as(app, parent.id).patch(`${R}/${id}`, { teamId: otherTeam });
    expect(wrongTeam.status).toBe(422);
    expect(wrongTeam.body.error.code).toBe('TEAM_NOT_AVAILABLE');
  });

  it('cannot change a registration once it is submitted (409, nothing changes)', async () => {
    const { parent, id } = await family();
    expect((await as(app, parent.id).post(`${R}/${id}/submit`)).status).toBe(200);
    const res = await as(app, parent.id).patch(`${R}/${id}`, { guestCount: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTRATION_NOT_EDITABLE');
    const { rows } = await db.query<{ guest_count: number }>(
      'select guest_count from public.registrations where id = $1',
      [id],
    );
    expect(rows[0]!.guest_count).toBe(0);
  });
});

describe('POST /registrations/:id/submit', () => {
  it('moves DRAFT to SUBMITTED, with history, audit, timestamp and the fee fixed at submission', async () => {
    const { parent, id } = await family();
    await db.query('update public.events set registration_fee_cents = 12000 where id = $1', [
      eventA,
    ]);
    const res = await as(app, parent.id).post(`${R}/${id}/submit`);
    await db.query('update public.events set registration_fee_cents = 9500 where id = $1', [
      eventA,
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'SUBMITTED',
      fee: { amountCents: 12000, currency: 'usd' },
    });
    expect(res.body.data.submittedAt).toEqual(expect.any(String));

    const { rows } = await db.query(
      'select from_status, to_status from public.registration_status_history where registration_id = $1 order by created_at, to_status',
      [id],
    );
    expect(rows).toEqual([
      { from_status: null, to_status: 'DRAFT' },
      { from_status: 'DRAFT', to_status: 'SUBMITTED' },
    ]);
    const { rows: audit } = await db.query(
      'select action from public.audit_logs where entity_id = $1 order by action',
      [id],
    );
    expect(audit.map((a) => a.action)).toEqual(['REGISTRATION_CREATED', 'REGISTRATION_SUBMITTED']);
  });

  it('refuses an incomplete registration with 422 and a list of what is missing', async () => {
    const { parent, id } = await family({ team: false });
    const res = await as(app, parent.id).post(`${R}/${id}/submit`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REGISTRATION_INCOMPLETE');
    expect(res.body.error.details).toEqual([
      { path: 'teamId', message: 'a team must be selected' },
    ]);
    const { rows } = await db.query<{ status: string }>(
      'select status from public.registrations where id = $1',
      [id],
    );
    expect(rows[0]!.status).toBe('DRAFT');
  });

  it('requires a guardian for a minor but not for an adult, judged on the event-local date', async () => {
    const minor = await family();
    // simulate a player with no guardian on file (ownership kept through the player's own account)
    await db.query('update public.players set user_id = $2 where id = $1', [
      minor.playerId,
      minor.parent.id,
    ]);
    await db.query('delete from public.player_parents where player_id = $1', [minor.playerId]);
    const res = await as(app, minor.parent.id).post(`${R}/${minor.id}/submit`);
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { path: 'guardians', message: 'a parent or guardian is required for a player under 18' },
    ]);

    const adultParent = await createUser(db, { roles: ['PLAYER'] });
    const adult = await as(app, adultParent.id).post('/api/v1/players', {
      firstName: 'Ann',
      lastName: 'Adult',
      dateOfBirth: '1999-01-01',
      ageDivision: 'U16',
      forSelf: true,
    });
    const reg = await as(app, adultParent.id).post(R, {
      eventId: eventA,
      playerId: adult.body.data.id,
      teamId: teamA,
    });
    expect((await as(app, adultParent.id).post(`${R}/${reg.body.data.id}/submit`)).status).toBe(
      200,
    );

    // turns 18 the evening of the event in Los Angeles (UTC date is a day later, so a UTC check would say adult)
    const evening = await createEvent(db, orgA, {
      startsAt: new Date('2030-11-15T03:00:00Z'),
      timezone: 'America/Los_Angeles',
    });
    const eveningTeam = await createTeam(db, evening);
    const kid = await family({ event: evening, team: false, child: { dateOfBirth: '2012-11-15' } });
    await as(app, kid.parent.id).patch(`${R}/${kid.id}`, { teamId: eveningTeam });
    await db.query('update public.players set user_id = $2 where id = $1', [
      kid.playerId,
      kid.parent.id,
    ]);
    await db.query('delete from public.player_parents where player_id = $1', [kid.playerId]);
    expect((await as(app, kid.parent.id).post(`${R}/${kid.id}/submit`)).status).toBe(422); // still 17 locally
  });

  it('refuses to submit twice, or from any status other than DRAFT (409 INVALID_STATUS_TRANSITION)', async () => {
    const { parent, id } = await family();
    expect((await as(app, parent.id).post(`${R}/${id}/submit`)).status).toBe(200);
    for (const status of ['SUBMITTED', 'PAYMENT_PENDING', 'VERIFIED', 'REJECTED', 'CANCELLED']) {
      await db.query('update public.registrations set status = $1 where id = $2', [status, id]);
      const res = await as(app, parent.id).post(`${R}/${id}/submit`);
      expect(res.status, status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    }
    const { rows } = await db.query(
      'select 1 from public.registration_status_history where registration_id = $1 and to_status = $2',
      [id, 'SUBMITTED'],
    );
    expect(rows).toHaveLength(1); // no extra history from the refused attempts
  });

  it('refuses when the event is no longer open', async () => {
    const event = await createEvent(db, orgA);
    const team = await createTeam(db, event);
    const { parent, id } = await family({ event, team: false });
    await as(app, parent.id).patch(`${R}/${id}`, { teamId: team });
    await db.query(`update public.events set status = 'CLOSED' where id = $1`, [event]);
    const res = await as(app, parent.id).post(`${R}/${id}/submit`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_NOT_OPEN');
  });

  it('lets exactly one of several simultaneous submits win', async () => {
    const { parent, id } = await family();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => as(app, parent.id).post(`${R}/${id}/submit`)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    const { rows } = await db.query(
      'select 1 from public.registration_status_history where registration_id = $1 and to_status = $2',
      [id, 'SUBMITTED'],
    );
    expect(rows).toHaveLength(1);
  });

  it('does not touch payment, document, consent or check-in state', async () => {
    const { parent, id } = await family();
    await as(app, parent.id).post(`${R}/${id}/submit`);
    for (const table of ['payments', 'documents', 'consent_records', 'check_ins']) {
      const { rows } = await db.query(`select 1 from public.${table} where registration_id = $1`, [
        id,
      ]);
      expect(rows, table).toEqual([]);
    }
  });
});

describe('database guards behind the API', () => {
  it('cannot move a registration to another event or player, even with direct SQL', async () => {
    const { id } = await family();
    const other = await createEvent(db, orgA);
    const msg = await db
      .query('update public.registrations set event_id = $1 where id = $2', [other, id])
      .then(
        () => '',
        (e: Error) => e.message,
      );
    expect(msg).toMatch(/cannot be moved/);
  });

  it('rejects guest counts outside 0..10 at the database', async () => {
    const { id } = await family();
    const msg = await db
      .query('update public.registrations set guest_count = 11 where id = $1', [id])
      .then(
        () => '',
        (e: Error) => e.message,
      );
    expect(msg).toMatch(/registrations_guest_count_check/);
  });
});

describe('reading: GET /registrations, /registrations/:id, /registrations/:id/status', () => {
  it('shows an owner their registration, history and a list of only their own', async () => {
    const mine = await family();
    const theirs = await family();
    await as(app, mine.parent.id).post(`${R}/${mine.id}/submit`);

    const one = await as(app, mine.parent.id).get(`${R}/${mine.id}`);
    expect(one.status).toBe(200);
    expect(one.body.data.status).toBe('SUBMITTED');

    const status = await as(app, mine.parent.id).get(`${R}/${mine.id}/status`);
    expect(status.body.data).toMatchObject({ registrationId: mine.id, status: 'SUBMITTED' });
    expect(
      status.body.data.history.map((h: { from: string | null; to: string }) => [h.from, h.to]),
    ).toEqual([
      [null, 'DRAFT'],
      ['DRAFT', 'SUBMITTED'],
    ]);
    expect(Object.keys(status.body.data.history[0]).sort()).toEqual([
      'actor',
      'at',
      'from',
      'reason',
      'to',
    ]); // who acted as a category (SYSTEM / FAMILY / STAFF), never a user id

    const list = await as(app, mine.parent.id).get(R);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    expect(JSON.stringify(list.body)).not.toContain(theirs.id);
  });

  it("returns 404 for other families' registrations on every endpoint (unauthorized access)", async () => {
    const owner = await family();
    const stranger = await newParent();
    const s = as(app, stranger.id);
    expect((await s.get(`${R}/${owner.id}`)).status).toBe(404);
    expect((await s.get(`${R}/${owner.id}/status`)).status).toBe(404);
    const patch = await s.patch(`${R}/${owner.id}`, { guestCount: 2 });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe('REGISTRATION_NOT_FOUND');
    expect((await s.post(`${R}/${owner.id}/submit`)).status).toBe(404);
    const { rows } = await db.query<{ status: string; guest_count: number }>(
      'select status, guest_count from public.registrations where id = $1',
      [owner.id],
    );
    expect(rows[0]).toEqual({ status: 'DRAFT', guest_count: 0 });
    expect((await request(app).get(`${R}/${owner.id}`)).status).toBe(401);
  });

  it('lets an admin read registrations of their own organization only (cross-organization is 404)', async () => {
    const reg = await family();
    const a = as(app, adminA);
    const b = as(app, adminB);
    expect((await a.get(`${R}/${reg.id}`)).status).toBe(200);
    expect((await a.get(`${R}/${reg.id}/status`)).status).toBe(200);
    expect((await b.get(`${R}/${reg.id}`)).status).toBe(404);
    expect((await b.get(`${R}/${reg.id}/status`)).status).toBe(404);
    // an admin is not given edit or submit rights: no override exists
    expect((await a.patch(`${R}/${reg.id}`, { guestCount: 2 })).status).toBe(403);
    expect((await a.post(`${R}/${reg.id}/submit`)).status).toBe(403);
    // and an admin of org A cannot read a registration for an event of org B
    const eventB = await createEvent(db, orgB);
    const inB = await family({ event: eventB, team: false });
    expect((await a.get(`${R}/${inB.id}`)).status).toBe(404);
    expect((await b.get(`${R}/${inB.id}`)).status).toBe(200);
  });

  it('keeps events separate for one family (cross-event): each registration is reachable only as itself', async () => {
    const parent = await newParent();
    const playerId = await createChild(app, parent.id);
    const event2 = await createEvent(db, orgA);
    const r1 = await as(app, parent.id).post(R, { eventId: eventA, playerId });
    const r2 = await as(app, parent.id).post(R, { eventId: event2, playerId });
    expect(r1.body.data.event.id).toBe(eventA);
    expect(r2.body.data.event.id).toBe(event2);
    // a team of event 2 cannot be attached to the event A registration
    const t2 = await createTeam(db, event2);
    expect((await as(app, parent.id).patch(`${R}/${r1.body.data.id}`, { teamId: t2 })).status).toBe(
      422,
    );
    expect((await as(app, parent.id).patch(`${R}/${r2.body.data.id}`, { teamId: t2 })).status).toBe(
      200,
    );
    // coaches / staff of the organization get no access to family registrations in this phase
    const coach = await createUser(db, { roles: ['COACH'], organizationId: orgA });
    expect((await as(app, coach.id).get(`${R}/${r1.body.data.id}`)).status).toBe(404);
  });

  it('validates ids and is safe against SQL injection in paths', async () => {
    const parent = await newParent();
    for (const bad of [
      'nope',
      encodeURIComponent("1' OR '1'='1"),
      encodeURIComponent('1; DROP TABLE public.registrations;--'),
    ]) {
      for (const suffix of ['', '/status']) {
        expect((await as(app, parent.id).get(`${R}/${bad}${suffix}`)).status).toBe(422);
      }
      expect((await as(app, parent.id).post(`${R}/${bad}/submit`)).status).toBe(422);
    }
    const { rows } = await db.query('select 1 from public.registrations limit 1');
    expect(rows.length).toBe(1);
  });
});

describe('sensitive data exposure', () => {
  it('returns no internal ids, credentials or other accounts in registration responses', async () => {
    const reg = await family();
    const other = await family();
    const res = await as(app, reg.parent.id).get(`${R}/${reg.id}`);
    const text = JSON.stringify(res.body);
    for (const leak of [
      'created_by',
      'createdBy',
      'user_id',
      'userId',
      'password',
      'hash',
      'token',
      'organization',
    ]) {
      expect(text.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
    expect(text).not.toContain(reg.parent.id);
    expect(text).not.toContain(other.id);
    expect(Object.keys(res.body.data).sort()).toEqual(
      [
        'createdAt',
        'event',
        'eventAccessDisabled',
        'fee',
        'guardians',
        'guestCount',
        'id',
        'player',
        'registrantType',
        'registrationNumber',
        'status',
        'submittedAt',
        'team',
        'updatedAt',
      ].sort(),
    );
  });

  it('stores hostile text from the player literally (no SQL execution) through the whole flow', async () => {
    const parent = await newParent();
    const evil = "x'); DROP TABLE public.registrations;--";
    const playerId = await createChild(app, parent.id, { lastName: evil });
    const reg = await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA });
    expect(reg.status).toBe(201);
    expect(reg.body.data.player.lastName).toBe(evil);
    const { rows } = await db.query('select 1 from public.registrations where id = $1', [
      reg.body.data.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('keeps childBody sane (guards the fixtures themselves)', () => {
    expect(childBody().guardian.relationship).toBe('Mother');
  });
});
