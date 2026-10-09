import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env';

const valid = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/facex',
  JWT_SECRET: 'a'.repeat(40),
  REFRESH_TOKEN_SECRET: 'b'.repeat(40),
  FRONTEND_URL: 'http://localhost:3000',
};

describe('face recognition configuration', () => {
  it('is entirely optional and off by default: nothing is assumed', () => {
    const env = parseEnv(valid);
    expect(env.FACE_PROVIDER).toBeUndefined();
    expect(env.FACE_CONSENT_CODE).toBeUndefined();
    expect(env.FACE_PROVIDER_TIMEOUT_MS).toBe(15_000);
    expect(
      parseEnv({ ...valid, FACE_PROVIDER: '', FACE_CONSENT_CODE: '' }).FACE_PROVIDER,
    ).toBeUndefined();
  });

  it('accepts a provider name, a consent code or NONE, and a bounded timeout', () => {
    const env = parseEnv({
      ...valid,
      FACE_PROVIDER: 'rekognition',
      FACE_CONSENT_CODE: 'BIOMETRIC_CONSENT',
      FACE_PROVIDER_TIMEOUT_MS: '5000',
    });
    expect(env).toMatchObject({
      FACE_PROVIDER: 'rekognition',
      FACE_CONSENT_CODE: 'BIOMETRIC_CONSENT',
      FACE_PROVIDER_TIMEOUT_MS: 5000,
    });
    expect(parseEnv({ ...valid, FACE_CONSENT_CODE: 'NONE' }).FACE_CONSENT_CODE).toBe('NONE');
  });

  it('rejects malformed values (and does not echo them)', () => {
    for (const bad of [
      { FACE_PROVIDER: 'Rekognition!' },
      { FACE_PROVIDER: 'x'.repeat(41) },
      { FACE_CONSENT_CODE: 'lower_case' },
      { FACE_CONSENT_CODE: 'has space' },
      { FACE_PROVIDER_TIMEOUT_MS: '10' },
      { FACE_PROVIDER_TIMEOUT_MS: '999999' },
    ]) {
      expect(() => parseEnv({ ...valid, ...bad }), JSON.stringify(bad)).toThrow(EnvValidationError);
    }
  });
});
