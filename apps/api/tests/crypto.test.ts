import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createPasswordHasher } from '../src/infrastructure/auth/password';
import {
  createAccessTokenService,
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
} from '../src/infrastructure/auth/tokens';
import { TEST_JWT_SECRET } from './helpers/test-env';

const hasher = createPasswordHasher();

describe('password hashing (Argon2id)', () => {
  it('never stores the plaintext and uses argon2id with a per-hash salt', async () => {
    const [a, b] = await Promise.all([
      hasher.hash('hunter2-hunter2'),
      hasher.hash('hunter2-hunter2'),
    ]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toContain('hunter2');
    expect(a).not.toEqual(b);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hasher.hash('right-password-1');
    expect(await hasher.verify(hash, 'right-password-1')).toBe(true);
    expect(await hasher.verify(hash, 'wrong-password-1')).toBe(false);
    expect(await hasher.verify(hash, '')).toBe(false);
  });

  it('treats a corrupt hash as a failed verification, not an exception', async () => {
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    expect(await hasher.verify('', 'x')).toBe(false);
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    const argon2 = (await import('argon2')).default;
    const weak = await argon2.hash('pw', {
      type: argon2.argon2id,
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });
    expect(hasher.needsRehash(weak)).toBe(true);
    expect(hasher.needsRehash(await hasher.hash('pw'))).toBe(false);
  });

  it('burn() completes without throwing', async () => {
    await expect(hasher.burn('anything')).resolves.toBeUndefined();
  });
});

describe('access tokens', () => {
  const tokens = createAccessTokenService({ secret: TEST_JWT_SECRET, ttlSeconds: 900 });
  const userId = '11111111-1111-4111-8111-111111111111';

  it('round-trips a valid token and carries only the user id', async () => {
    const token = await tokens.sign(userId);
    expect(await tokens.verify(token)).toEqual({ ok: true, userId });
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'sub']);
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('reports an expired token as EXPIRED', async () => {
    const old = await tokens.sign(userId, { issuedAt: new Date(Date.now() - 3600_000) });
    expect(await tokens.verify(old)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects tampered, wrong-secret, wrong-audience, unsigned and garbage tokens as INVALID', async () => {
    const good = await tokens.sign(userId);
    const [h, p, s] = good.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(p!, 'base64url').toString()),
        sub: '22222222-2222-4222-8222-222222222222',
      }),
    ).toString('base64url');
    const other = createAccessTokenService({ secret: 'x'.repeat(40), ttlSeconds: 900 });
    const key = new TextEncoder().encode(TEST_JWT_SECRET);
    const wrongAudience = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('face-x-api')
      .setAudience('someone-else')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    const alg = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const unsigned = `${alg}.${p}.`;

    for (const bad of [
      `${h}.${forgedPayload}.${s}`,
      await other.sign(userId),
      wrongAudience,
      unsigned,
      'garbage',
      '',
      'a.b.c',
    ]) {
      expect(await tokens.verify(bad)).toEqual({ ok: false, reason: 'INVALID' });
    }
  });

  it('rejects a token whose subject is not a UUID', async () => {
    const key = new TextEncoder().encode(TEST_JWT_SECRET);
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject("1' OR '1'='1")
      .setIssuer('face-x-api')
      .setAudience('face-x-web')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expect(await tokens.verify(t)).toEqual({ ok: false, reason: 'INVALID' });
  });
});

describe('refresh tokens', () => {
  it('are 256-bit random, URL-safe and unique', () => {
    const a = generateRefreshToken();
    expect(isWellFormedRefreshToken(a)).toBe(true);
    expect(a).not.toEqual(generateRefreshToken());
    expect(isWellFormedRefreshToken("x' OR 1=1")).toBe(false);
    expect(isWellFormedRefreshToken('')).toBe(false);
  });

  it('are stored as a keyed hash that differs from the token and from other secrets', () => {
    const t = generateRefreshToken();
    const h = hashRefreshToken(t, 'secret-one-secret-one-secret-one-xx');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(h).toEqual(hashRefreshToken(t, 'secret-one-secret-one-secret-one-xx'));
    expect(h).not.toEqual(hashRefreshToken(t, 'secret-two-secret-two-secret-two-xx'));
  });
});
