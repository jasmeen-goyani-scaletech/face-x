import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, childBody, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, bearerFor, createUser, openTestDb, uniqueEmail } from './helpers/test-app';

/** Players, guardians and ownership against the real Express app and a real PostgreSQL database. */
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
  eventA = await createEvent(db, orgA);
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
});
afterAll(() => db.close());

const newParent = () => createUser(db, { roles: ['PARENT'] });

describe('POST /players: a parent registers a child', () => {
  it('creates the child with the parent as primary guardian, and returns no internal fields', async () => {
    const parent = await newParent();
    const res = await as(app, parent.id).post(
      '/api/v1/players',
      childBody({ email: 'Kid@Example.com', schoolId: 'S-1' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      firstName: 'Mateo',
      lastName: 'Rivera',
      dateOfBirth: '2014-03-09',
      email: 'kid@example.com',
      schoolId: 'S-1',
      guardians: [
        {
          firstName: 'Dana',
          lastName: 'Rivera',
          email: parent.email,
          relationship: 'Mother',
          isPrimary: true,
          phone: '555-019-2831',
        },
      ],
    });
    const text = JSON.stringify(res.body);
    for (const leak of ['user_id', 'userId', 'created_by', 'createdBy', 'password', 'hash'])
      expect(text).not.toContain(leak);
    expect(Object.keys(res.body.data).sort()).toEqual(
      [
        'ageDivision',
        'createdAt',
        'dateOfBirth',
        'email',
        'firstName',
        'guardians',
        'id',
        'lastName',
        'phone',
        'schoolId',
        'updatedAt',
      ].sort(),
    );
  });

  it('saves the age division and returns it; it can be changed until the registration is submitted', async () => {
    const parent = await newParent();
    const created = await as(app, parent.id).post(
      '/api/v1/players',
      childBody({ ageDivision: 'U14' }),
    );
    expect(created.status).toBe(201);
    expect(created.body.data.ageDivision).toBe('U14');
    const id = created.body.data.id as string;
    const patched = await as(app, parent.id).patch(`/api/v1/players/${id}`, {
      ageDivision: 'U16',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.ageDivision).toBe('U16');
    const bad = await as(app, parent.id).patch(`/api/v1/players/${id}`, { ageDivision: 'U18' });
    expect(bad.status).toBe(422);
  });

  it('uses the account email for the guardian record, never an email from the body', async () => {
    const parent = await newParent();
    const res = await as(app, parent.id).post(
      '/api/v1/players',
      childBody({
        guardian: {
          relationship: 'Father',
          firstName: 'A',
          lastName: 'B',
          email: 'someone-else@example.com',
        },
      }),
    );
    expect(res.status).toBe(422); // unknown field rejected
    const ok = await as(app, parent.id).post('/api/v1/players', childBody());
    expect(ok.body.data.guardians[0].email).toBe(parent.email);
  });

  it('reuses the same guardian record for siblings (no duplicated parent data)', async () => {
    const parent = await newParent();
    const a = await createChild(app, parent.id);
    const b = await createChild(app, parent.id, {
      firstName: 'Lucia',
      dateOfBirth: '2012-07-21',
      guardian: { relationship: 'Mother' },
    });
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.parents where user_id = $1',
      [parent.id],
    );
    expect(rows[0]!.n).toBe(1);
    const { rows: links } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.player_parents pp join public.parents pa on pa.id = pp.parent_id where pa.user_id = $1 and pp.player_id = any($2)',
      [parent.id, [a, b]],
    );
    expect(links[0]!.n).toBe(2);
  });

  it('survives two concurrent first-child requests from the same parent with one guardian record', async () => {
    const parent = await newParent();
    const results = await Promise.all([
      as(app, parent.id).post('/api/v1/players', childBody({ firstName: 'One' })),
      as(app, parent.id).post('/api/v1/players', childBody({ firstName: 'Two' })),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.parents where user_id = $1',
      [parent.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('updates the guardian record with the details sent for a later child', async () => {
    const parent = await newParent();
    await as(app, parent.id).post('/api/v1/players', childBody({ firstName: 'First' }));
    const second = await as(app, parent.id).post(
      '/api/v1/players',
      childBody({
        firstName: 'Second',
        guardian: { relationship: 'Aunt', firstName: 'Ema', lastName: 'Won', phone: '555-018-9999' },
      }),
    );
    expect(second.status).toBe(201);
    const { rows } = await db.query<{ first_name: string; last_name: string; phone: string }>(
      'select first_name, last_name, phone from public.parents where user_id = $1',
      [parent.id],
    );
    expect(rows).toEqual([{ first_name: 'Ema', last_name: 'Won', phone: '555-018-9999' }]);
    expect(second.body.data.guardians[0].relationship).toBe('Aunt');
  });

  it('requires guardian details the first time, and a guardian every time', async () => {
    const parent = await newParent();
    const noGuardian = await as(app, parent.id).post(
      '/api/v1/players',
      childBody({ guardian: undefined }),
    );
    expect(noGuardian.status).toBe(422);
    const noNames = await as(app, parent.id).post(
      '/api/v1/players',
      childBody({ guardian: { relationship: 'Mother' } }),
    );
    expect(noNames.status).toBe(422);
    expect(noNames.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'guardian.firstName',
      'guardian.lastName',
    ]);
  });

  it('records an audit entry in the same transaction', async () => {
    const parent = await newParent();
    const id = await createChild(app, parent.id);
    const { rows } = await db.query<{
      action: string;
      actor_user_id: string;
      ip_address: string | null;
    }>(
      `select action, actor_user_id, host(ip_address) as ip_address from public.audit_logs where entity_type = 'player' and entity_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      { action: 'PLAYER_CREATED', actor_user_id: parent.id, ip_address: expect.any(String) },
    ]);
  });
});

describe('POST /players: a player registers themself', () => {
  it('needs the PLAYER role and allows one player record per account', async () => {
    const player = await createUser(db, { roles: ['PLAYER'] });
    const body = { firstName: 'Sam', lastName: 'Self', dateOfBirth: '2005-05-05', ageDivision: 'U16', forSelf: true };
    const first = await as(app, player.id).post('/api/v1/players', body);
    expect(first.status).toBe(201);
    expect(first.body.data.guardians).toEqual([]);
    const again = await as(app, player.id).post('/api/v1/players', body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PLAYER_ALREADY_EXISTS');

    const parent = await newParent();
    const wrongRole = await as(app, parent.id).post('/api/v1/players', body);
    expect(wrongRole.status).toBe(403);
    expect(wrongRole.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('refuses a guardian in the same request, and a child without the PARENT role', async () => {
    const player = await createUser(db, { roles: ['PLAYER'] });
    const withGuardian = await as(app, player.id).post('/api/v1/players', {
      firstName: 'S',
      lastName: 'T',
      dateOfBirth: '2005-05-05',
      ageDivision: 'U16',
      forSelf: true,
      guardian: { relationship: 'Mother' },
    });
    expect(withGuardian.status).toBe(422);
    const asChild = await as(app, player.id).post('/api/v1/players', childBody());
    expect(asChild.status).toBe(403);
  });
});

describe('input validation (422) and role gates', () => {
  it.each([
    ['empty name', { firstName: ' ' }],
    ['missing last name', { lastName: undefined }],
    ['malformed date', { dateOfBirth: '09/03/2014' }],
    ['impossible date', { dateOfBirth: '2014-02-30' }],
    ['future date', { dateOfBirth: '2999-01-01' }],
    ['ancient date', { dateOfBirth: '1800-01-01' }],
    ['missing age division', { ageDivision: undefined }],
    ['unknown age division', { ageDivision: 'U10' }],
    ['lower-case age division', { ageDivision: 'u14' }],
    ['bad phone', { phone: '123' }],
    ['bad email', { email: 'nope' }],
    ['too-long name', { firstName: 'x'.repeat(81) }],
    ['unknown field userId', { userId: '11111111-1111-4111-8111-111111111111' }],
    ['unknown field createdBy', { createdBy: 'x' }],
    ['unknown field id', { id: '11111111-1111-4111-8111-111111111111' }],
    ['wrong type', { firstName: 123 }],
  ])('rejects %s', async (_name, override) => {
    const parent = await newParent();
    const res = await as(app, parent.id).post('/api/v1/players', childBody(override));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication and a family role', async () => {
    expect((await request(app).post('/api/v1/players').send(childBody())).status).toBe(401);
    for (const roles of [[], ['COACH'], ['STAFF'], ['ADMIN']] as const) {
      const u = await createUser(db, { roles: [...roles] });
      const res = await as(app, u.id).post('/api/v1/players', childBody());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    }
  });
});

describe('GET /players and ownership', () => {
  it('lets an owner read their player and lists only their own players', async () => {
    const mine = await newParent();
    const other = await newParent();
    const myChild = await createChild(app, mine.id);
    const otherChild = await createChild(app, other.id);
    expect((await as(app, mine.id).get(`/api/v1/players/${myChild}`)).status).toBe(200);
    const list = await as(app, mine.id).get('/api/v1/players');
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([myChild]);
    expect(JSON.stringify(list.body)).not.toContain(otherChild);
  });

  it("hides other families' players with 404 on read, edit and guardian add", async () => {
    const owner = await newParent();
    const stranger = await newParent();
    const child = await createChild(app, owner.id);
    expect((await as(app, stranger.id).get(`/api/v1/players/${child}`)).status).toBe(404);
    expect(
      (await as(app, stranger.id).patch(`/api/v1/players/${child}`, { firstName: 'Hacked' }))
        .status,
    ).toBe(404);
    const add = await as(app, stranger.id).post(`/api/v1/players/${child}/parents`, {
      firstName: 'E',
      lastName: 'V',
      email: uniqueEmail(),
      relationship: 'Uncle',
    });
    expect(add.status).toBe(404);
    const { rows } = await db.query<{ first_name: string }>(
      'select first_name from public.players where id = $1',
      [child],
    );
    expect(rows[0]!.first_name).toBe('Mateo');
  });

  it('requires authentication, and rejects malformed ids (including injection) with 422', async () => {
    const parent = await newParent();
    expect(
      (await request(app).get('/api/v1/players/11111111-1111-4111-8111-111111111111')).status,
    ).toBe(401);
    for (const bad of [
      'not-a-uuid',
      encodeURIComponent("1' OR '1'='1"),
      encodeURIComponent('1; DROP TABLE public.players;--'),
    ]) {
      expect((await as(app, parent.id).get(`/api/v1/players/${bad}`)).status).toBe(422);
    }
    const { rows } = await db.query('select 1 from public.players limit 1');
    expect(rows.length).toBe(1);
  });

  it('lets an admin read only players registered in their own organization', async () => {
    const parent = await newParent();
    const child = await createChild(app, parent.id);
    expect((await as(app, adminA).get(`/api/v1/players/${child}`)).status).toBe(404); // not registered anywhere yet
    expect(
      (
        await as(app, parent.id).post('/api/v1/registrations', {
          eventId: eventA,
          playerId: child,
          teamId: teamA,
        })
      ).status,
    ).toBe(201);
    expect((await as(app, adminA).get(`/api/v1/players/${child}`)).status).toBe(200);
    expect((await as(app, adminB).get(`/api/v1/players/${child}`)).status).toBe(404); // another organization
    // admins cannot edit or add guardians (no override)
    expect(
      (await as(app, adminA).patch(`/api/v1/players/${child}`, { firstName: 'X' })).status,
    ).toBe(403); // no family role
  });

  it('gives an admin no access through a role they lack, e.g. a coach of the organization', async () => {
    const parent = await newParent();
    const child = await createChild(app, parent.id);
    await as(app, parent.id).post('/api/v1/registrations', { eventId: eventA, playerId: child });
    const coach = await createUser(db, { roles: ['COACH'], organizationId: orgA });
    expect((await as(app, coach.id).get(`/api/v1/players/${child}`)).status).toBe(404);
  });
});

describe('PATCH /players/:id', () => {
  it('edits fields, can clear optional ones, and rejects empty or unknown input', async () => {
    const parent = await newParent();
    const child = await createChild(app, parent.id, {
      email: 'kid@example.com',
      phone: '555-019-2831',
    });
    const res = await as(app, parent.id).patch(`/api/v1/players/${child}`, {
      lastName: 'Rivera-Gomez',
      email: null,
      phone: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      lastName: 'Rivera-Gomez',
      email: null,
      phone: null,
      firstName: 'Mateo',
    });
    expect((await as(app, parent.id).patch(`/api/v1/players/${child}`, {})).status).toBe(422);
    expect(
      (await as(app, parent.id).patch(`/api/v1/players/${child}`, { userId: parent.id })).status,
    ).toBe(422);
    expect(
      (await as(app, parent.id).patch(`/api/v1/players/${child}`, { dateOfBirth: '2999-01-01' }))
        .status,
    ).toBe(422);
  });

  it('is locked once a registration for the player has been submitted', async () => {
    const parent = await newParent();
    const child = await createChild(app, parent.id);
    const reg = await as(app, parent.id).post('/api/v1/registrations', {
      eventId: eventA,
      playerId: child,
      teamId: teamA,
    });
    expect(
      (await as(app, parent.id).patch(`/api/v1/players/${child}`, { firstName: 'Still' })).status,
    ).toBe(200); // draft: fine
    expect(
      (await as(app, parent.id).post(`/api/v1/registrations/${reg.body.data.id}/submit`)).status,
    ).toBe(200);
    const locked = await as(app, parent.id).patch(`/api/v1/players/${child}`, {
      firstName: 'Changed',
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('PLAYER_LOCKED');
  });
});

describe('guardians: POST /players/:id/parents', () => {
  const guardian = (email = uniqueEmail('g')) => ({
    firstName: 'Gina',
    lastName: 'Guardian',
    email,
    relationship: 'Aunt',
    phone: '555-019-2831',
  });

  it('links an additional (non-primary) guardian without an account', async () => {
    const parent = await newParent();
    const child = await createChild(app, parent.id);
    const res = await as(app, parent.id).post(
      `/api/v1/players/${child}/parents`,
      guardian('gina@example.com'),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.guardians).toHaveLength(2);
    expect(res.body.data.guardians[0].isPrimary).toBe(true);
    expect(res.body.data.guardians[1]).toMatchObject({
      email: 'gina@example.com',
      relationship: 'Aunt',
      isPrimary: false,
    });
    const { rows } = await db.query(
      'select 1 from public.parents where email = $1 and user_id is null',
      ['gina@example.com'],
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects linking the same guardian twice', async () => {
    const parent = await newParent();
    const child = await createChild(app, parent.id);
    const g = guardian();
    await as(app, parent.id).post(`/api/v1/players/${child}/parents`, g);
    const again = await as(app, parent.id).post(`/api/v1/players/${child}/parents`, g);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('GUARDIAN_ALREADY_LINKED');
    const self = await as(app, parent.id).post(
      `/api/v1/players/${child}/parents`,
      guardian(parent.email),
    );
    expect(self.status).toBe(409);
  });

  it("reuses one guardian record for several of the same family's children", async () => {
    const parent = await newParent();
    const a = await createChild(app, parent.id);
    const b = await createChild(app, parent.id, {
      firstName: 'Lucia',
      guardian: { relationship: 'Mother' },
    });
    const g = guardian('shared@example.com');
    expect((await as(app, parent.id).post(`/api/v1/players/${a}/parents`, g)).status).toBe(201);
    expect((await as(app, parent.id).post(`/api/v1/players/${b}/parents`, g)).status).toBe(201);
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.parents where email = $1',
      ['shared@example.com'],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("will not attach another family's guardian record, nor link another account to a child", async () => {
    const familyOne = await newParent();
    const familyTwo = await newParent();
    const childOne = await createChild(app, familyOne.id);
    const childTwo = await createChild(app, familyTwo.id);
    await as(app, familyOne.id).post(
      `/api/v1/players/${childOne}/parents`,
      guardian('theirs@example.com'),
    );
    const taken = await as(app, familyTwo.id).post(
      `/api/v1/players/${childTwo}/parents`,
      guardian('theirs@example.com'),
    );
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('GUARDIAN_EMAIL_CONFLICT');
    expect(JSON.stringify(taken.body)).not.toContain('Gina'); // nothing about the existing record leaks

    const hasAccount = await as(app, familyTwo.id).post(
      `/api/v1/players/${childTwo}/parents`,
      guardian(familyOne.email),
    );
    expect(hasAccount.status).toBe(409);
    expect(hasAccount.body.error.code).toBe('PARENT_ACCOUNT_LINK_NOT_SUPPORTED');
    // and family one gained no access to family two's child
    expect((await as(app, familyOne.id).get(`/api/v1/players/${childTwo}`)).status).toBe(404);
  });

  it('validates the body strictly', async () => {
    const parent = await newParent();
    const child = await createChild(app, parent.id);
    for (const bad of [
      {},
      { ...guardian(), isPrimary: true },
      { ...guardian(), userId: parent.id },
      { ...guardian(), email: 'nope' },
    ]) {
      expect((await as(app, parent.id).post(`/api/v1/players/${child}/parents`, bad)).status).toBe(
        422,
      );
    }
  });
});

describe('SQL injection and sensitive data', () => {
  it('stores hostile text literally and never executes it', async () => {
    const parent = await newParent();
    const evil = "Robert'); DROP TABLE public.players;--";
    const res = await as(app, parent.id).post(
      '/api/v1/players',
      childBody({ firstName: evil, schoolId: "x' OR '1'='1" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.firstName).toBe(evil);
    const { rows } = await db.query('select 1 from public.players where id = $1', [
      res.body.data.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('never exposes another family or internal ids in a response', async () => {
    const a = await newParent();
    const b = await newParent();
    await createChild(app, b.id, { firstName: 'Secretname' });
    const res = await as(app, a.id).get('/api/v1/players');
    expect(JSON.stringify(res.body)).not.toContain('Secretname');
    expect(JSON.stringify(res.body)).not.toContain(b.email);
    const unauth = await request(app)
      .get('/api/v1/players')
      .set(await bearerFor('99999999-9999-4999-8999-999999999999'));
    expect(unauth.status).toBe(403); // valid token, no profile: never anonymous access
  });
});
