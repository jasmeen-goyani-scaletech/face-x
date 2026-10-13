import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../src/config/logger';
import { hashRefreshToken } from '../src/infrastructure/auth/tokens';
import type { Database } from '../src/infrastructure/database/database';
import {
  STRONG_PASSWORD,
  accessTokens,
  buildApi,
  bearerFor,
  createUser,
  openTestDb,
  uniqueEmail,
} from './helpers/test-app';
import { TEST_ORIGIN, TEST_REFRESH_SECRET } from './helpers/test-env';

/** HTTP tests of the authentication flow against the real Express app and a real PostgreSQL database. */
let db: Database;
let app: ReturnType<typeof buildApi>;
beforeAll(() => {
  db = openTestDb();
  app = buildApi(db);
});
afterAll(() => db.close());

const refreshCookieOf = (res: Response): string | undefined => {
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
    c.startsWith('facex_refresh='),
  );
  const value = raw?.split(';')[0]?.slice('facex_refresh='.length);
  return value || undefined;
};
const cookieHeader = (token: string) => ({ Cookie: `facex_refresh=${token}` });

async function signIn(email: string, password = STRONG_PASSWORD) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return { res, access: res.body?.data?.accessToken as string, refresh: refreshCookieOf(res)! };
}

describe('POST /auth/register (user creation)', () => {
  it('creates a user with no roles, an Argon2id hash in its own table, and no secrets in the response', async () => {
    const email = uniqueEmail('Reg');
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `  ${email.toUpperCase()} `,
        password: STRONG_PASSWORD,
        fullName: 'Pat Example',
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: email.toLowerCase(),
      fullName: 'Pat Example',
      roles: [],
    });
    const text = JSON.stringify(res.body).toLowerCase();
    expect(text).not.toContain('password');
    expect(text).not.toContain('hash');

    const { rows } = await db.query<{ password_hash: string }>(
      'select password_hash from public.user_credentials where user_id = $1',
      [res.body.data.id],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.password_hash).not.toContain(STRONG_PASSWORD);
    const { rows: roles } = await db.query('select 1 from public.user_roles where user_id = $1', [
      res.body.data.id,
    ]);
    expect(roles).toEqual([]);
  });

  it('rejects a duplicate email, case-insensitively, without creating a second account', async () => {
    const email = uniqueEmail();
    expect(
      (await request(app).post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD }))
        .status,
    ).toBe(201);
    const dup = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password: STRONG_PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    const { rows } = await db.query('select 1 from public.users where email = $1', [email]);
    expect(rows).toHaveLength(1);
  });

  it('validates input (422): bad email, short password, oversize password, extra junk types', async () => {
    for (const body of [
      { email: 'not-an-email', password: STRONG_PASSWORD },
      { email: uniqueEmail(), password: 'short' },
      { email: uniqueEmail(), password: 'x'.repeat(129) },
      { email: 123, password: STRONG_PASSWORD },
      { password: STRONG_PASSWORD },
    ]) {
      const res = await request(app).post('/api/v1/auth/register').send(body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('POST /auth/login', () => {
  it('returns a short-lived access token and puts the refresh token only in an HttpOnly cookie', async () => {
    const user = await createUser(db);
    const { res } = await signIn(user.email);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: user.id, email: user.email, roles: [] },
    });
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.headers['cache-control']).toBe('no-store');

    const refresh = refreshCookieOf(res)!;
    expect(refresh).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(refresh);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('facex_refresh='),
    )!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toMatch(/Expires=/);
  });

  it('rejects a wrong password and an unknown email with the identical response', async () => {
    const user = await createUser(db);
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'definitely-wrong-password' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: STRONG_PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(refreshCookieOf(wrong)).toBeUndefined();
  });

  it('rejects a disabled account only after the password is verified', async () => {
    const user = await createUser(db, { active: false });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: user.password })
      ).body.error.code,
    ).toBe('ACCOUNT_DISABLED');
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: 'wrong-wrong-wrong' })
      ).body.error.code,
    ).toBe('INVALID_CREDENTIALS');
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'nope', password: '' });
    expect(res.status).toBe(422);
  });
});

describe('access-token authentication (GET /auth/me)', () => {
  it('returns the caller with their roles for a real access token', async () => {
    const user = await createUser(db, { roles: ['COACH', 'PARENT'] });
    const { access } = await signIn(user.email);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: user.id,
      email: user.email,
      fullName: 'Test User',
      organizationId: null,
      roles: ['COACH', 'PARENT'],
    });
    expect(res.headers['cache-control']).toBe('no-store');
    const text = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ['password', 'hash', 'secret', 'token', 'argon2'])
      expect(text).not.toContain(forbidden);
    expect(Object.keys(res.body.data).sort()).toEqual([
      'email',
      'fullName',
      'id',
      'organizationId',
      'roles',
    ]);
  });

  it('returns 401 with WWW-Authenticate for a missing header', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['Basic dXNlcjpwYXNz'],
    ['Bearer'],
    ['Bearer '],
    ['Bearer a b'],
    ['just-a-token'],
    ['Bearer <script>'],
  ])('returns 401 for a malformed header: %s', async (header) => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', header);
    expect(res.status).toBe(401);
    expect(['AUTH_TOKEN_MALFORMED', 'AUTH_TOKEN_MISSING']).toContain(res.body.error.code);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('returns 401 AUTH_TOKEN_INVALID for a random or tampered token', async () => {
    const user = await createUser(db);
    const good = (await bearerFor(user.id)).Authorization;
    for (const header of ['Bearer not.a.jwt', `${good.slice(0, -3)}abc`]) {
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', header);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    }
  });

  it('returns 401 AUTH_TOKEN_EXPIRED for an expired token', async () => {
    const user = await createUser(db);
    const expired = await accessTokens().sign(user.id, {
      issuedAt: new Date(Date.now() - 2 * 3600_000),
    });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('returns 403 for a validly signed token whose user does not exist, and for a disabled user at once', async () => {
    const ghost = await request(app)
      .get('/api/v1/auth/me')
      .set(await bearerFor('99999999-9999-4999-8999-999999999999'));
    expect(ghost.status).toBe(403);
    expect(ghost.body.error.code).toBe('USER_PROFILE_MISSING');

    const user = await createUser(db);
    const { access } = await signIn(user.email);
    await db.query('update public.users set is_active = false where id = $1', [user.id]);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('sees role changes immediately (roles are read from the database, not the token)', async () => {
    const user = await createUser(db);
    const { access } = await signIn(user.email);
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'STAFF')`, [user.id]);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`);
    expect(res.body.data.roles).toEqual(['STAFF']);
  });
});

describe('refresh tokens: rotation, reuse detection, expiry', () => {
  it('rotates: a new refresh token and access token, and the old refresh token stops working', async () => {
    const user = await createUser(db);
    const first = await signIn(user.email);

    const res = await request(app).post('/api/v1/auth/refresh').set(cookieHeader(first.refresh));
    expect(res.status).toBe(200);
    const second = refreshCookieOf(res)!;
    expect(second).toBeTruthy();
    expect(second).not.toEqual(first.refresh);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.id).toBe(user.id);
    expect(JSON.stringify(res.body)).not.toContain(second);
    expect(
      (
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      ).status,
    ).toBe(200);

    const replay = await request(app).post('/api/v1/auth/refresh').set(cookieHeader(first.refresh));
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_REFRESH_REUSED');
  });

  it('treats reuse of a rotated token as theft: the whole session family is revoked', async () => {
    const user = await createUser(db);
    const first = await signIn(user.email);
    const second = refreshCookieOf(
      await request(app).post('/api/v1/auth/refresh').set(cookieHeader(first.refresh)),
    )!;
    // an attacker (or a stale tab) replays the first token...
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(cookieHeader(first.refresh))).status,
    ).toBe(401);
    // ...so even the legitimate newest token is now dead
    const legit = await request(app).post('/api/v1/auth/refresh').set(cookieHeader(second));
    expect(legit.status).toBe(401);
    const { rows } = await db.query<{ revoked_reason: string | null }>(
      'select revoked_reason from public.refresh_tokens where user_id = $1',
      [user.id],
    );
    expect(rows.every((r) => r.revoked_reason !== null)).toBe(true);
  });

  it('lets exactly one of two simultaneous refreshes of the same token succeed', async () => {
    const user = await createUser(db);
    const { refresh } = await signIn(user.email);
    const results = await Promise.all([
      request(app).post('/api/v1/auth/refresh').set(cookieHeader(refresh)),
      request(app).post('/api/v1/auth/refresh').set(cookieHeader(refresh)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('rejects a missing, malformed, unknown or SQL-injection refresh token with 401', async () => {
    const none = await request(app).post('/api/v1/auth/refresh');
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('AUTH_REFRESH_MISSING');
    for (const token of ['garbage', "' OR '1'='1", 'A'.repeat(43), '%00']) {
      const res = await request(app).post('/api/v1/auth/refresh').set(cookieHeader(token));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REFRESH_INVALID');
    }
  });

  it('rejects an expired refresh token', async () => {
    const user = await createUser(db);
    const { refresh } = await signIn(user.email);
    await db.query(
      `update public.refresh_tokens set expires_at = created_at + interval '1 millisecond' where token_hash = $1`,
      [hashRefreshToken(refresh, TEST_REFRESH_SECRET)],
    );
    const res = await request(app).post('/api/v1/auth/refresh').set(cookieHeader(refresh));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REFRESH_EXPIRED');
  });

  it('refuses to refresh for a disabled account and revokes the session', async () => {
    const user = await createUser(db);
    const { refresh } = await signIn(user.email);
    await db.query('update public.users set is_active = false where id = $1', [user.id]);
    const res = await request(app).post('/api/v1/auth/refresh').set(cookieHeader(refresh));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    await db.query('update public.users set is_active = true where id = $1', [user.id]);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(cookieHeader(refresh))).status,
    ).toBe(401);
  });

  it('stores only a keyed hash of the refresh token, never the token', async () => {
    const user = await createUser(db);
    const { refresh } = await signIn(user.email);
    const { rows } = await db.query<{ token_hash: string }>(
      'select token_hash from public.refresh_tokens where user_id = $1',
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toEqual(hashRefreshToken(refresh, TEST_REFRESH_SECRET));
    expect(rows[0]!.token_hash).not.toContain(refresh);
    const { rows: leak } = await db.query(
      'select 1 from public.refresh_tokens where token_hash = $1',
      [refresh],
    );
    expect(leak).toEqual([]);
  });

  it('refuses cookie-driven endpoints from a foreign Origin (CSRF) but allows the frontend origin', async () => {
    const user = await createUser(db);
    const { refresh } = await signIn(user.email);
    const evil = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set(cookieHeader(refresh));
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(
      (
        await request(app)
          .post('/api/v1/auth/logout')
          .set('Origin', 'https://evil.example')
          .set(cookieHeader(refresh))
      ).status,
    ).toBe(403);
    const ok = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_ORIGIN)
      .set(cookieHeader(refresh));
    expect(ok.status).toBe(200);
  });
});

describe('POST /auth/logout (revocation)', () => {
  it('revokes the whole session: its refresh tokens stop working and the cookie is cleared', async () => {
    const user = await createUser(db);
    const first = await signIn(user.email);
    const rotated = refreshCookieOf(
      await request(app).post('/api/v1/auth/refresh').set(cookieHeader(first.refresh)),
    )!;

    const out = await request(app).post('/api/v1/auth/logout').set(cookieHeader(rotated));
    expect(out.status).toBe(204);
    const cleared = (out.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('facex_refresh='),
    )!;
    expect(cleared).toMatch(/facex_refresh=;/);

    const after = await request(app).post('/api/v1/auth/refresh').set(cookieHeader(rotated));
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('AUTH_REFRESH_INVALID');
  });

  it('only ends the caller’s own session, not the user’s other devices', async () => {
    const user = await createUser(db);
    const phone = await signIn(user.email);
    const laptop = await signIn(user.email);
    await request(app).post('/api/v1/auth/logout').set(cookieHeader(phone.refresh));
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(cookieHeader(phone.refresh))).status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(cookieHeader(laptop.refresh))).status,
    ).toBe(200);
  });

  it('is idempotent and never errors for a missing or garbage cookie', async () => {
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(204);
    expect(
      (await request(app).post('/api/v1/auth/logout').set(cookieHeader('garbage'))).status,
    ).toBe(204);
  });
});

describe('SQL injection through the HTTP API', () => {
  it('rejects injection payloads in login and registration fields without a server error', async () => {
    const user = await createUser(db);
    const attempts = [
      { email: "' OR '1'='1' --", password: STRONG_PASSWORD },
      { email: user.email, password: "' OR '1'='1" },
      { email: `${user.email}' OR '1'='1`, password: STRONG_PASSWORD },
      { email: { $ne: null }, password: { $ne: null } },
    ];
    for (const body of attempts) {
      const res = await request(app).post('/api/v1/auth/login').send(body);
      expect([401, 422]).toContain(res.status);
      expect(res.body.data).toBeUndefined();
    }
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.users');
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it('stores an email containing a quote literally and logs in with it', async () => {
    const email = `o'brien-${Date.now()}@example.com`;
    expect(
      (
        await request(app)
          .post('/api/v1/auth/register')
          .send({ email, password: STRONG_PASSWORD, fullName: "Robert'); DROP TABLE users;--" })
      ).status,
    ).toBe(201);
    const { res } = await signIn(email);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
  });
});

describe('rate limiting', () => {
  const limits = {
    loginPerIp: { windowMs: 60_000, limit: 100 },
    loginPerEmail: { windowMs: 60_000, limit: 3 },
    registerPerIp: { windowMs: 60_000, limit: 2 },
    refreshPerIp: { windowMs: 60_000, limit: 2 },
  };

  it('blocks repeated failed logins for one account (429), even with the right password afterwards', async () => {
    const limited = buildApi(db, { rateLimits: limits });
    const user = await createUser(db);
    const bad = () =>
      request(limited)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-wrong-wrong' });
    for (let i = 0; i < 3; i++) expect((await bad()).status).toBe(401);
    const blocked = await request(limited)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['ratelimit']).toBeDefined();
    // another account is unaffected
    const other = await createUser(db);
    expect(
      (
        await request(limited)
          .post('/api/v1/auth/login')
          .send({ email: other.email, password: other.password })
      ).status,
    ).toBe(200);
  });

  it('does not count successful logins against the per-account limit', async () => {
    const limited = buildApi(db, { rateLimits: limits });
    const user = await createUser(db);
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await request(limited)
            .post('/api/v1/auth/login')
            .send({ email: user.email, password: user.password })
        ).status,
      ).toBe(200);
    }
  });

  it('limits registration and refresh per IP', async () => {
    const limited = buildApi(db, { rateLimits: limits });
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await request(limited)
            .post('/api/v1/auth/register')
            .send({ email: uniqueEmail(), password: STRONG_PASSWORD })
        ).status,
      ).toBe(201);
    }
    expect(
      (
        await request(limited)
          .post('/api/v1/auth/register')
          .send({ email: uniqueEmail(), password: STRONG_PASSWORD })
      ).status,
    ).toBe(429);
    for (let i = 0; i < 2; i++) await request(limited).post('/api/v1/auth/refresh');
    expect((await request(limited).post('/api/v1/auth/refresh')).status).toBe(429);
  });
});

describe('sensitive data protection', () => {
  it('never writes passwords, tokens, cookies or hashes to the logs', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = pino(
      { level: 'trace', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
      stream,
    );
    const logged = buildApi(db, { logger });

    const email = uniqueEmail('log');
    const password = 'a-very-unique-password-xyz-123';
    await request(logged).post('/api/v1/auth/register').send({ email, password });
    const login = await request(logged).post('/api/v1/auth/login').send({ email, password });
    await request(logged)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-unique-password-456' });
    const access = login.body.data.accessToken as string;
    const refresh = refreshCookieOf(login)!;
    await request(logged).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`);
    await request(logged).post('/api/v1/auth/refresh').set(cookieHeader(refresh));
    await request(logged).post('/api/v1/auth/logout').set(cookieHeader(refresh));

    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0); // requests were logged...
    for (const secret of [
      password,
      'wrong-unique-password-456',
      access,
      refresh,
      '$argon2',
      TEST_REFRESH_SECRET,
    ]) {
      expect(output).not.toContain(secret); // ...without any secret in them
    }
  });

  it('does not leak internals (stack traces, SQL) in error responses', async () => {
    const broken = buildApi({
      query: async () => {
        throw new Error(
          'relation "public.users" does not exist; password authentication failed for user "postgres"',
        );
      },
      transaction: async () => {
        throw new Error('pg internals');
      },
      close: async () => undefined,
    });
    const res = await request(broken)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: STRONG_PASSWORD });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });
});
