import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../shared/errors/app-error';

interface Limit {
  windowMs: number;
  limit: number;
}

export interface AuthRateLimitConfig {
  loginPerIp: Limit;
  loginPerEmail: Limit;
  registerPerIp: Limit;
  refreshPerIp: Limit;
}

const MINUTE = 60_000;
export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimitConfig = {
  loginPerIp: { windowMs: 15 * MINUTE, limit: 200 },
  // Per target account regardless of source IP, so a distributed guessing attack on one account is capped.
  // Successful logins do not count.
  loginPerEmail: { windowMs: 15 * MINUTE, limit: 5 },
  registerPerIp: { windowMs: 60 * MINUTE, limit: 60 },
  refreshPerIp: { windowMs: 15 * MINUTE, limit: 120 },
};

const limiter = (
  { windowMs, limit }: Limit,
  key: (req: Request) => string,
  skipSuccessfulRequests = false,
): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: key,
    handler: (_req, _res, next) => next(AppError.tooManyRequests()),
  });

const byIp = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');
const byEmail = (req: Request) => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string'
    ? `email:${email.trim().toLowerCase().slice(0, 254)}`
    : 'email:none';
};

/** NOTE: counters are in process memory, so with several API instances use a shared store (e.g. Redis). */
export function createAuthRateLimiters(config: AuthRateLimitConfig = DEFAULT_AUTH_RATE_LIMITS) {
  return {
    login: [limiter(config.loginPerIp, byIp), limiter(config.loginPerEmail, byEmail, true)],
    register: [limiter(config.registerPerIp, byIp)],
    refresh: [limiter(config.refreshPerIp, byIp)],
  };
}

export type AuthRateLimiters = ReturnType<typeof createAuthRateLimiters>;

/**
 * A limit per signed-in user (not per IP: scanners at one venue share an address). Mount it AFTER requireAuth.
 * Counters are in process memory, like the auth limiters above.
 */
export function createUserRateLimiter(config: Limit): RequestHandler {
  return limiter(
    config,
    (req) => `user:${req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown')}`,
  );
}
