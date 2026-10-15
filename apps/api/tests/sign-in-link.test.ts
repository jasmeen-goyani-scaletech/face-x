import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { as, createEvent, createOrg } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/** An admin issues a one-time sign-in link for a coach/staff member who has no password; the link signs them in once. */
let db: Database;
let app: ReturnType<typeof buildApi>;
let orgId: string;
let eventId: string;
let adminId: string;

beforeAll(async () => {
  db = openTestDb();
  app = buildApi(db);
  orgId = await createOrg(db);
  eventId = await createEvent(db, orgId, { feeCents: 0 });
  adminId = (await createUser(db, { roles: ['ADMIN'], organizationId: orgId })).id;
});
afterAll(() => db.close());

const ISSUE = (regId: string) => `/api/v1/admin/registrations/${regId}/sign-in-link`;
const REDEEM = '/api/v1/auth/sign-in-link/redeem';

/** A passwordless coach (as the public registration form creates) with a registration, seeded directly. */
async function coach(type: 'COACH' | 'STAFF' = 'COACH', evId = eventId) {
  const user = await createUser(db, { roles: [type] });
  await db.query('delete from public.user_credentials where user_id = $1', [user.id]);
  const { rows: p } = await db.query<{ id: string }>(
    `insert into public.staff_profiles (user_id, profile_type, staff_role, first_name, last_name, email)
     values ($1, $2, $4, 'Cora', 'Coach', $3) returning id`,
    [user.id, type, user.email, type === 'STAFF' ? 'TEAM_MANAGER' : null],
  );
  const { rows: r } = await db.query<{ id: string }>(
    `insert into public.registrations (event_id, registrant_type, staff_profile_id, status)
     values ($1, $2, $3, 'DOCUMENT_REVIEW') returning id`,
    [evId, type, p[0]!.id],
  );
  return { user, regId: r[0]!.id };
}

describe('admin issues a sign-in link', () => {
  it('returns a token once, stores only its hash, and audits the issue without the token', async () => {
    const c = await coach();
    const res = await as(app, adminId).post(ISSUE(c.regId));
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const { token, expiresAt } = res.body.data as { token: string; expiresAt: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hours = (Date.parse(expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);

    const stored = await db.query('select token_hash, created_by from public.sign_in_links where user_id = $1', [
      c.user.id,
    ]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.token_hash).not.toContain(token);
    expect(stored.rows[0]!.created_by).toBe(adminId);

    const audit = await db.query(
      `select actor_user_id, metadata::text as m from public.audit_logs where entity_id = $1 and action = 'SIGN_IN_LINK_ISSUED'`,
      [c.regId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_user_id).toBe(adminId);
    expect(audit.rows[0]!.m).not.toContain(token);
  });

  it('is admin-only and limited to the admin’s own organization; players’ and unknown registrations are 404', async () => {
    const c = await coach();
    expect((await request(app).post(ISSUE(c.regId))).status).toBe(401);
    const coachUser = await createUser(db, { roles: ['COACH'] });
    expect((await as(app, coachUser.id).post(ISSUE(c.regId))).status).toBe(403);

    const otherOrg = await createOrg(db);
    const otherAdmin = await createUser(db, { roles: ['ADMIN'], organizationId: otherOrg });
    expect((await as(app, otherAdmin.id).post(ISSUE(c.regId))).status).toBe(404);
    expect((await as(app, adminId).post(ISSUE('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect((await as(app, adminId).post(ISSUE('not-a-uuid'))).status).toBe(422);
  });

  it('works for staff members too', async () => {
    const s = await coach('STAFF');
    expect((await as(app, adminId).post(ISSUE(s.regId))).status).toBe(201);
  });

  it('a newer link replaces the older one', async () => {
    const c = await coach();
    const first = (await as(app, adminId).post(ISSUE(c.regId))).body.data.token as string;
    const second = (await as(app, adminId).post(ISSUE(c.regId))).body.data.token as string;
    expect((await request(app).post(REDEEM).send({ token: first })).status).toBe(401);
    expect((await request(app).post(REDEEM).send({ token: second })).status).toBe(200);
  });
});

describe('POST /auth/sign-in-link/redeem', () => {
  it('signs the coach in: session cookie + access token that works, and the link is spent', async () => {
    const c = await coach();
    const { token } = (await as(app, adminId).post(ISSUE(c.regId))).body.data as { token: string };

    const res = await request(app).post(REDEEM).send({ token });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: c.user.id, email: c.user.email, roles: ['COACH'] });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((x) => x.startsWith('facex_refresh=') && x.includes('HttpOnly'))).toBe(true);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(c.user.id);

    const again = await request(app).post(REDEEM).send({ token });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('SIGN_IN_LINK_INVALID');
  });

  it('refuses unknown, malformed and expired tokens with the same error', async () => {
    const c = await coach();
    const { token } = (await as(app, adminId).post(ISSUE(c.regId))).body.data as { token: string };
    await db.query(`update public.sign_in_links set expires_at = now() - interval '1 minute' where user_id = $1`, [
      c.user.id,
    ]);
    for (const bad of [token, 'A'.repeat(43), 'short-but-twenty-chars-long!!']) {
      const res = await request(app).post(REDEEM).send({ token: bad });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SIGN_IN_LINK_INVALID');
    }
    expect((await request(app).post(REDEEM).send({})).status).toBe(422);
  });

  it('refuses a disabled account', async () => {
    const c = await coach();
    const { token } = (await as(app, adminId).post(ISSUE(c.regId))).body.data as { token: string };
    await db.query('update public.users set is_active = false where id = $1', [c.user.id]);
    const res = await request(app).post(REDEEM).send({ token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});
