import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env';

const valid = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/facex',
  JWT_SECRET: 'a'.repeat(40),
  REFRESH_TOKEN_SECRET: 'b'.repeat(40),
  FRONTEND_URL: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('applies defaults and treats blank optional values as unset', () => {
    const env = parseEnv({
      ...valid,
      STRIPE_SECRET_KEY: '',
      FACE_PROVIDER_URL: '  ',
      COOKIE_SECURE: '',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.COOKIE_SECURE).toBe(false); // development
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('treats VAPID keys as all-or-nothing and the subject as mailto: or https', () => {
    expect(parseEnv(valid).VAPID_PUBLIC_KEY).toBeUndefined();
    const full = {
      ...valid,
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:ops@example.org',
    };
    expect(parseEnv(full).VAPID_SUBJECT).toBe('mailto:ops@example.org');
    expect(() => parseEnv({ ...full, VAPID_PRIVATE_KEY: '' })).toThrow(/VAPID_PUBLIC_KEY/);
    expect(() => parseEnv({ ...full, VAPID_SUBJECT: 'ops@example.org' })).toThrow(/VAPID_SUBJECT/);
  });

  it('makes cookies secure by default in production', () => {
    expect(parseEnv({ ...valid, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
  });

  it('splits FRONTEND_URL into origins and trims trailing slashes', () => {
    const env = parseEnv({
      ...valid,
      FRONTEND_URL: 'http://localhost:3000/, https://app.example.com',
    });
    expect(env.FRONTEND_URL).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('fails on missing required variables, naming them but not leaking values', () => {
    const attempt = () =>
      parseEnv({ ...valid, DATABASE_URL: undefined, JWT_SECRET: 'super-secret-but-too-short' });
    expect(attempt).toThrow(EnvValidationError);
    try {
      attempt();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_SECRET');
      expect(message).not.toContain('super-secret-but-too-short');
    }
  });

  it('rejects a non-postgres URL, bad port, and identical or weak secrets', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://x/y' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...valid, PORT: '70000' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...valid, REFRESH_TOKEN_SECRET: valid.JWT_SECRET })).toThrow(
      /must differ/,
    );
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(EnvValidationError);
  });

  it('requires secure cookies for SameSite=None', () => {
    expect(() => parseEnv({ ...valid, COOKIE_SAME_SITE: 'none' })).toThrow(/secure/);
    expect(
      parseEnv({ ...valid, COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'true' }).COOKIE_SAME_SITE,
    ).toBe('none');
  });

  it('requires the storage credentials as a group', () => {
    expect(parseEnv(valid).STORAGE_BUCKET).toBeUndefined();
    expect(() => parseEnv({ ...valid, STORAGE_ACCESS_KEY: 'k' })).toThrow(/set together/);
    const env = parseEnv({
      ...valid,
      STORAGE_ACCESS_KEY: 'k',
      STORAGE_SECRET_KEY: 's',
      STORAGE_BUCKET: 'b',
    });
    expect(env.STORAGE_BUCKET).toBe('b');
  });
});
