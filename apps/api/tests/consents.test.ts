import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, childBody, createChild, createEvent, createOrg, createTeam } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/**
 * Consent against the real Express app and real PostgreSQL. The consent TEXT below is test data written for
 * these tests: the code defines no wording, and the API only ever returns what is in the `consents` table.
 */
let db: Database;
let app: ReturnType<typeof buildApi>;
let orgA: string;
let orgB: string;
let eventA: string;
let teamA: string;
let adminA: string;
let adminB: string;
let v1: string;

const R = '/api/v1/registrations';
const V1_BODY = '[TEST CONSENT TEXT v1 - not legal wording]';

beforeAll(async () => {
  db = openTestDb();
  app = buildApi(db);
  orgA = await createOrg(db);
  orgB = await createOrg(db);
  eventA = await createEvent(db, orgA);
  teamA = await createTeam(db, eventA);
  adminA = (await createUser(db, { roles: ['ADMIN'], organizationId: orgA })).id;
  adminB = (await createUser(db, { roles: ['ADMIN'], organizationId: orgB })).id;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.consents (code, version, title, body, effective_at)
     values ('GUARDIAN_CONSENT', 1, 'Test guardian consent', $1, now() - interval '1 day') returning id`,
    [V1_BODY],
  );
  v1 = rows[0]!.id;
});
afterAll(() => db.close());

/** A parent (named Dana Rivera by childBody) with a minor child registered for the event. */
async function family(overrides: Record<string, unknown> = {}) {
  const parent = await createUser(db, { roles: ['PARENT'] });
  const playerId = await createChild(app, parent.id, overrides);
  const reg = await as(app, parent.id).post(R, { eventId: eventA, playerId, teamId: teamA });
  return { parent, playerId, regId: reg.body.data.id as string };
}
type Family = Awaited<ReturnType<typeof family>>;
const accept = (f: Family, over: Record<string, unknown> = {}) =>
  as(app, f.parent.id).post(`${R}/${f.regId}/consents`, {
    consentId: v1,
    signedName: 'Dana Rivera',
    accepted: true,
    ...over,
  });
const status = (userId: string, regId: string) => as(app, userId).get(`${R}/${regId}/consents`);

describe('reading consent status', () => {
  it('shows the requirement and the published wording from the database, and nothing accepted yet', async () => {
    const f = await family();
    const res = await status(f.parent.id, f.regId);
    expect(res.status).toBe(200);
    expect(res.body.data.registrationId).toBe(f.regId);
    expect(res.body.data.records).toEqual([]);
    expect(res.body.data.requirements).toEqual([
      {
        code: 'GUARDIAN_CONSENT',
        required: true,
        accepted: false,
        current: {
          id: v1,
          code: 'GUARDIAN_CONSENT',
          version: 1,
          title: 'Test guardian consent',
          body: V1_BODY,
          effectiveAt: expect.any(String),
        },
      },
    ]);
  });

  it('does not require guardian consent for an adult player', async () => {
    const player = await createUser(db, { roles: ['PLAYER'] });
    const p = await as(app, player.id).post('/api/v1/players', {
      firstName: 'Ann',
      lastName: 'Adult',
      dateOfBirth: '1999-01-01',
      forSelf: true,
    });
    const reg = await as(app, player.id).post(R, {
      eventId: eventA,
      playerId: p.body.data.id,
      teamId: teamA,
    });
    const res = await status(player.id, reg.body.data.id);
    expect(res.body.data.requirements[0].required).toBe(false);
  });
});

describe('recording consent', () => {
  it('records the accepted version with who, when, IP and user agent, plus an audit entry', async () => {
    const f = await family();
    const before = (await as(app, f.parent.id).get(`${R}/${f.regId}`)).body.data;
    const res = await accept(f);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      consentId: v1,
      code: 'GUARDIAN_CONSENT',
      version: 1,
      signedName: 'Dana Rivera',
      signedBy: 'GUARDIAN',
      currentVersion: true,
    });
    expect(Object.keys(res.body.data).sort()).toEqual(
      [
        'acceptedAt',
        'code',
        'consentId',
        'currentVersion',
        'id',
        'signedBy',
        'signedName',
        'version',
      ].sort(),
    );

    const { rows } = await db.query<{
      accepted_by_user_id: string;
      accepted_by_parent_id: string | null;
      ip: string | null;
      user_agent: string | null;
    }>(
      'select accepted_by_user_id, accepted_by_parent_id, host(ip_address) as ip, user_agent from public.consent_records where id = $1',
      [res.body.data.id],
    );
    expect(rows[0]).toMatchObject({
      accepted_by_user_id: f.parent.id,
      accepted_by_parent_id: expect.any(String),
      ip: expect.any(String),
    });
    const { rows: audit } = await db.query<{
      action: string;
      actor_user_id: string;
      metadata: Record<string, unknown>;
    }>('select action, actor_user_id, metadata from public.audit_logs where entity_id = $1', [
      res.body.data.id,
    ]);
    expect(audit).toEqual([
      {
        action: 'CONSENT_RECORDED',
        actor_user_id: f.parent.id,
        metadata: { registrationId: f.regId, code: 'GUARDIAN_CONSENT', version: 1 },
      },
    ]);

    // consent is separate state: the registration is unchanged
    const after = (await as(app, f.parent.id).get(`${R}/${f.regId}`)).body.data;
    expect({ status: after.status, updatedAt: after.updatedAt }).toEqual({
      status: before.status,
      updatedAt: before.updatedAt,
    });
    expect((await status(f.parent.id, f.regId)).body.data.requirements[0].accepted).toBe(true);
  });

  it('never returns the IP address or user agent', async () => {
    const f = await family();
    const res = await accept(f);
    const text = JSON.stringify([
      res.body,
      (await status(f.parent.id, f.regId)).body,
    ]).toLowerCase();
    for (const leak of [
      'ip_address',
      'ipaddress',
      'user_agent',
      'useragent',
      '127.0.0.1',
      'supertest',
    ])
      expect(text).not.toContain(leak);
  });

  it('accepts a signature regardless of case and spacing, and refuses one that does not match', async () => {
    const f = await family();
    for (const signedName of ['Someone Else', 'Dana', 'dana', 'Dana Rivera Jr']) {
      const res = await accept(f, { signedName });
      expect(res.status, signedName).toBe(422);
      expect(res.body.error.code).toBe('SIGNATURE_MISMATCH');
    }
    expect((await accept(f, { signedName: '  dana    RIVERA ' })).status).toBe(201);
  });

  it('rejects a duplicate for the same version, even when sent simultaneously', async () => {
    const f = await family();
    const results = await Promise.all(Array.from({ length: 6 }, () => accept(f)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CONSENT_ALREADY_RECORDED');
    }
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.consent_records where registration_id = $1',
      [f.regId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('validates the body strictly: no decline state, no client-supplied metadata', async () => {
    const f = await family();
    for (const bad of [
      { accepted: false },
      { accepted: 'true' },
      { accepted: undefined },
      { consentId: 'nope' },
      { consentId: undefined },
      { signedName: 'x' },
      { signedName: '' },
      { ip: '1.2.3.4' },
      { acceptedAt: '2020-01-01T00:00:00Z' },
      { version: 9 },
      { acceptedByUserId: f.parent.id },
    ]) {
      expect((await accept(f, bad)).status, JSON.stringify(bad)).toBe(422);
    }
    const { rows } = await db.query(
      'select 1 from public.consent_records where registration_id = $1',
      [f.regId],
    );
    expect(rows).toEqual([]);
  });

  it('refuses unknown, not-yet-effective and inapplicable consents', async () => {
    const f = await family();
    expect(
      (await accept(f, { consentId: '11111111-1111-4111-8111-111111111111' })).body.error.code,
    ).toBe('CONSENT_NOT_FOUND');
    const future = await db.query<{ id: string }>(
      `insert into public.consents (code, version, title, body, effective_at) values ('FUTURE_CONSENT', 1, 't', 'b', now() + interval '30 days') returning id`,
    );
    expect((await accept(f, { consentId: future.rows[0]!.id })).status).toBe(404);
    const other = await db.query<{ id: string }>(
      `insert into public.consents (code, version, title, body, effective_at) values ('NOT_A_REGISTRATION_CONSENT', 1, 't', 'b', now() - interval '1 day') returning id`,
    );
    const na = await accept(f, { consentId: other.rows[0]!.id });
    expect(na.status).toBe(422);
    expect(na.body.error.code).toBe('CONSENT_NOT_APPLICABLE');
  });

  it('requires a guardian to consent for a minor; the minor player cannot consent for themself', async () => {
    const minor = await createUser(db, { roles: ['PLAYER'] });
    const p = await as(app, minor.id).post('/api/v1/players', {
      firstName: 'Tim',
      lastName: 'Teen',
      dateOfBirth: '2012-05-05',
      forSelf: true,
    });
    const reg = await as(app, minor.id).post(R, {
      eventId: eventA,
      playerId: p.body.data.id,
      teamId: teamA,
    });
    const res = await as(app, minor.id).post(`${R}/${reg.body.data.id}/consents`, {
      consentId: v1,
      signedName: 'Tim Teen',
      accepted: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GUARDIAN_REQUIRED_TO_CONSENT');
    const { rows } = await db.query(
      'select 1 from public.consent_records where registration_id = $1',
      [reg.body.data.id],
    );
    expect(rows).toEqual([]);
  });

  it('lets an adult player accept for themself (signed by the player, no guardian)', async () => {
    const player = await createUser(db, { roles: ['PLAYER'] });
    const p = await as(app, player.id).post('/api/v1/players', {
      firstName: 'Ann',
      lastName: 'Adult',
      dateOfBirth: '1999-01-01',
      forSelf: true,
    });
    const reg = await as(app, player.id).post(R, {
      eventId: eventA,
      playerId: p.body.data.id,
      teamId: teamA,
    });
    const res = await as(app, player.id).post(`${R}/${reg.body.data.id}/consents`, {
      consentId: v1,
      signedName: 'Ann Adult',
      accepted: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.signedBy).toBe('PLAYER');
    const { rows } = await db.query(
      'select accepted_by_parent_id from public.consent_records where id = $1',
      [res.body.data.id],
    );
    expect(rows[0]).toEqual({ accepted_by_parent_id: null });
  });

  it('refuses to change a cancelled registration', async () => {
    const f = await family();
    await db.query("update public.registrations set status = 'CANCELLED' where id = $1", [f.regId]);
    const res = await accept(f);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
  });
});

describe('authorization and privacy', () => {
  it("hides another family's consent information with 404", async () => {
    const owner = await family();
    const stranger = await createUser(db, { roles: ['PARENT'] });
    await accept(owner);
    expect((await status(stranger.id, owner.regId)).status).toBe(404);
    const post = await as(app, stranger.id).post(`${R}/${owner.regId}/consents`, {
      consentId: v1,
      signedName: 'Dana Rivera',
      accepted: true,
    });
    expect(post.status).toBe(404);
    expect(post.body.error.code).toBe('REGISTRATION_NOT_FOUND');
    expect(JSON.stringify(post.body)).not.toContain('Dana');
  });

  it('requires authentication and a registrant role to record', async () => {
    const f = await family();
    expect((await request(app).get(`${R}/${f.regId}/consents`)).status).toBe(401);
    expect((await request(app).post(`${R}/${f.regId}/consents`).send({})).status).toBe(401);
    const record = (userId: string) =>
      as(app, userId).post(`${R}/${f.regId}/consents`, {
        consentId: v1,
        signedName: 'Dana Rivera',
        accepted: true,
      });
    for (const roles of [[], ['ADMIN']] as const) {
      const u = await createUser(db, { roles: [...roles], organizationId: orgA });
      expect((await record(u.id)).status).toBe(403);
    }
    // A coach or staff member may use consents for their OWN registration, but never see another family's.
    for (const roles of [['COACH'], ['STAFF']] as const) {
      const u = await createUser(db, { roles: [...roles], organizationId: orgA });
      expect((await record(u.id)).status).toBe(404);
    }
  });

  it('lets an admin of the event organization read, never write; another organization sees nothing (cross-organization)', async () => {
    const f = await family();
    await accept(f);
    const a = await status(adminA, f.regId);
    expect(a.status).toBe(200);
    expect(a.body.data.records).toHaveLength(1);
    expect((await status(adminB, f.regId)).status).toBe(404);
    expect(
      (
        await as(app, adminB).post(`${R}/${f.regId}/consents`, {
          consentId: v1,
          signedName: 'Dana Rivera',
          accepted: true,
        })
      ).status,
    ).toBe(403);
  });

  it('keeps events separate (cross-event): consent is per registration', async () => {
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    const event2 = await createEvent(db, orgA);
    const r1 = (await as(app, parent.id).post(R, { eventId: eventA, playerId })).body.data
      .id as string;
    const r2 = (await as(app, parent.id).post(R, { eventId: event2, playerId })).body.data
      .id as string;
    expect(
      (
        await as(app, parent.id).post(`${R}/${r1}/consents`, {
          consentId: v1,
          signedName: 'Dana Rivera',
          accepted: true,
        })
      ).status,
    ).toBe(201);
    expect((await status(parent.id, r2)).body.data.records).toEqual([]);
    expect((await status(parent.id, r2)).body.data.requirements[0].accepted).toBe(false);
    expect(
      (
        await as(app, parent.id).post(`${R}/${r2}/consents`, {
          consentId: v1,
          signedName: 'Dana Rivera',
          accepted: true,
        })
      ).status,
    ).toBe(201);
  });

  it('is safe against injection in ids and in the signature', async () => {
    const f = await family();
    for (const bad of ['nope', encodeURIComponent("1' OR '1'='1")]) {
      expect((await as(app, f.parent.id).get(`${R}/${bad}/consents`)).status).toBe(422);
    }
    const res = await accept(f, { signedName: "x'); DROP TABLE public.consent_records;--" });
    expect(res.status).toBe(422); // does not match the name on file; and nothing was executed
    const { rows } = await db.query('select 1 from public.consent_records limit 1');
    expect(rows.length).toBeGreaterThanOrEqual(0);
    await db.query('select count(*) from public.consent_records'); // the table still exists
  });
});

describe('immutability', () => {
  it('cannot edit, delete or backdate recorded consent or published wording', async () => {
    const f = await family();
    const rec = await accept(f);
    const run = (sql: string, params: unknown[] = []) =>
      db.query(sql, params).then(
        () => '',
        (e: Error) => e.message,
      );
    expect(
      await run('update public.consent_records set signed_name = $2 where id = $1', [
        rec.body.data.id,
        'Hacked',
      ]),
    ).toMatch(/append-only/);
    expect(
      await run(
        "update public.consent_records set accepted_at = now() - interval '1 year' where id = $1",
        [rec.body.data.id],
      ),
    ).toMatch(/append-only/);
    expect(
      await run('delete from public.consent_records where id = $1', [rec.body.data.id]),
    ).toMatch(/append-only/);
    expect(await run("update public.consents set body = 'edited' where id = $1", [v1])).toMatch(
      /immutable/,
    );
    expect(await run('delete from public.consents where id = $1', [v1])).toMatch(/immutable/);
  });
});

// Keep this block LAST: it publishes version 2, which becomes the current version for the whole file.
describe('versioning', () => {
  it('keeps old acceptances, refuses the outdated version, and accepts the new one as an additional record', async () => {
    const f = await family();
    const g = await family();
    expect((await accept(f)).status).toBe(201); // f accepts v1 while it is current

    const { rows } = await db.query<{ id: string }>(
      `insert into public.consents (code, version, title, body, effective_at)
       values ('GUARDIAN_CONSENT', 2, 'Test guardian consent v2', '[TEST CONSENT TEXT v2]', now() - interval '1 minute') returning id`,
    );
    const v2 = rows[0]!.id;

    // the requirement now points at v2; f has not accepted it yet
    const st = (await status(f.parent.id, f.regId)).body.data;
    expect(st.requirements[0]).toMatchObject({
      current: { id: v2, version: 2, body: '[TEST CONSENT TEXT v2]' },
      accepted: false,
    });
    expect(st.records).toHaveLength(1);
    expect(st.records[0]).toMatchObject({ version: 1, currentVersion: false }); // history is kept, marked as superseded

    // nobody can newly accept the superseded wording
    const outdated = await accept(g);
    expect(outdated.status).toBe(409);
    expect(outdated.body.error.code).toBe('CONSENT_VERSION_OUTDATED');

    // f accepts v2: a second record, the v1 record is untouched
    const second = await accept(f, { consentId: v2 });
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ version: 2, currentVersion: true });
    const after = (await status(f.parent.id, f.regId)).body.data;
    expect(after.records.map((r: { version: number }) => r.version)).toEqual([1, 2]);
    expect(after.requirements[0].accepted).toBe(true);
    const { rows: stored } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.consent_records where registration_id = $1',
      [f.regId],
    );
    expect(stored[0]!.n).toBe(2);
  });

  it('keeps childBody sane (guards the fixture the signature tests rely on)', () => {
    expect(childBody().guardian).toMatchObject({ firstName: 'Dana', lastName: 'Rivera' });
  });
});
