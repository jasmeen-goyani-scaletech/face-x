import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, errors, jwtVerify } from 'jose';
import { z } from 'zod';

const ISSUER = 'face-x-api';
const AUDIENCE = 'face-x-web';

export type AccessTokenCheck =
  { ok: true; userId: string } | { ok: false; reason: 'INVALID' | 'EXPIRED' };

export interface AccessTokenService {
  /** `issuedAt` exists so tests can mint an already-expired token; production callers omit it. */
  sign(userId: string, options?: { issuedAt?: Date }): Promise<string>;
  verify(token: string): Promise<AccessTokenCheck>;
  readonly ttlSeconds: number;
}

/**
 * Short-lived HS256 JWTs via `jose`. The token carries only the user id: roles, organization and
 * active status are read from the database on every request, so changes take effect immediately.
 */
export function createAccessTokenService(config: {
  secret: string;
  ttlSeconds: number;
}): AccessTokenService {
  const key = new TextEncoder().encode(config.secret);
  return {
    ttlSeconds: config.ttlSeconds,

    async sign(userId, options) {
      const iat = Math.floor((options?.issuedAt ?? new Date()).getTime() / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt(iat)
        .setExpirationTime(iat + config.ttlSeconds)
        .sign(key);
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUDIENCE,
          requiredClaims: ['sub', 'exp', 'iat'],
          clockTolerance: 5,
        });
        const sub = z.uuid().safeParse(payload.sub);
        return sub.success ? { ok: true, userId: sub.data } : { ok: false, reason: 'INVALID' };
      } catch (err) {
        return { ok: false, reason: err instanceof errors.JWTExpired ? 'EXPIRED' : 'INVALID' };
      }
    },
  };
}

const REFRESH_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** 256 bits from the OS CSPRNG. Opaque: it means nothing without the database row. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isWellFormedRefreshToken(token: string): boolean {
  return REFRESH_TOKEN_FORMAT.test(token);
}

/** What the database stores. Keyed, so a leaked database alone cannot be used to forge lookups. */
export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}
