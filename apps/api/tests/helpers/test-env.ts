import type { Env } from '../../src/config/env';

export const TEST_JWT_SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnop';
export const TEST_REFRESH_SECRET = 'test-refresh-secret-9876543210-qrstuvwxyz1234';
export const TEST_ORIGIN = 'http://localhost:3000';

export const testEnv: Pick<
  Env,
  | 'NODE_ENV'
  | 'FRONTEND_URL'
  | 'JWT_SECRET'
  | 'REFRESH_TOKEN_SECRET'
  | 'ACCESS_TOKEN_TTL_SECONDS'
  | 'REFRESH_TOKEN_TTL_DAYS'
  | 'COOKIE_SAME_SITE'
  | 'COOKIE_SECURE'
> = {
  NODE_ENV: 'test',
  FRONTEND_URL: [TEST_ORIGIN],
  JWT_SECRET: TEST_JWT_SECRET,
  REFRESH_TOKEN_SECRET: TEST_REFRESH_SECRET,
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SAME_SITE: 'lax',
  COOKIE_SECURE: true,
};
