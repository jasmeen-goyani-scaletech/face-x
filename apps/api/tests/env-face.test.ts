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

describe('FACE_ENCRYPTION_KEY (node-native face templates)', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('is required when the node-native provider is configured, and only then', () => {
    expect(() => parseEnv({ ...valid, FACE_PROVIDER: 'node-native' })).toThrow(EnvValidationError);
    expect(
      parseEnv({ ...valid, FACE_PROVIDER: 'node-native', FACE_ENCRYPTION_KEY: key })
        .FACE_ENCRYPTION_KEY,
    ).toBe(key);
    expect(parseEnv(valid).FACE_ENCRYPTION_KEY).toBeUndefined();
    expect(parseEnv({ ...valid, FACE_ENCRYPTION_KEY: '' }).FACE_ENCRYPTION_KEY).toBeUndefined();
  });

  it('must be 32 bytes of base64, and its value is never echoed in the error', () => {
    for (const bad of [
      'short',
      Buffer.alloc(16).toString('base64'),
      Buffer.alloc(33).toString('base64'),
      'x'.repeat(44),
    ]) {
      let message = '';
      try {
        parseEnv({ ...valid, FACE_PROVIDER: 'node-native', FACE_ENCRYPTION_KEY: bad });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, bad).toContain('FACE_ENCRYPTION_KEY');
      expect(message).not.toContain(bad);
    }
  });
});
