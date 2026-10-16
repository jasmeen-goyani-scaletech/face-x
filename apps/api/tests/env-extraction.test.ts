import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env';
import { createDocumentExtractor } from '../src/infrastructure/extraction/provider-registry';

const valid = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/facex',
  JWT_SECRET: 'a'.repeat(40),
  REFRESH_TOKEN_SECRET: 'b'.repeat(40),
  FRONTEND_URL: 'http://localhost:3000',
};

describe('document extraction configuration', () => {
  it('is off by default, with the documented defaults', () => {
    const env = parseEnv({ ...valid, EXTRACTION_PROVIDER: '', OPENAI_API_KEY: '' });
    expect(env).toMatchObject({
      EXTRACTION_PROVIDER: undefined,
      OPENAI_API_KEY: undefined,
      EXTRACTION_MODEL: 'gpt-5.6-luna',
      EXTRACTION_REASONING_EFFORT: 'none',
      EXTRACTION_TIMEOUT_MS: 20_000,
      DOCUMENT_MAX_BYTES: 5 * 1024 * 1024,
    });
    expect(createDocumentExtractor(env.EXTRACTION_PROVIDER, env)).toBeUndefined();
  });

  it('builds the openai extractor when the key is set', () => {
    const env = parseEnv({
      ...valid,
      EXTRACTION_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-key',
      EXTRACTION_MODEL: 'gpt-4.1-mini',
      EXTRACTION_REASONING_EFFORT: 'default',
      EXTRACTION_TIMEOUT_MS: '15000',
      DOCUMENT_MAX_BYTES: String(4 * 1024 * 1024),
    });
    expect(env).toMatchObject({
      EXTRACTION_MODEL: 'gpt-4.1-mini',
      EXTRACTION_REASONING_EFFORT: 'default',
      EXTRACTION_TIMEOUT_MS: 15_000,
      DOCUMENT_MAX_BYTES: 4 * 1024 * 1024,
    });
    expect(createDocumentExtractor(env.EXTRACTION_PROVIDER, env)?.name).toBe('openai');
    expect(createDocumentExtractor('unknown', env)).toBeUndefined();
  });

  it('refuses openai without a key, and out-of-range values, without echoing them', () => {
    for (const bad of [
      { EXTRACTION_PROVIDER: 'openai' },
      { EXTRACTION_PROVIDER: 'Open AI' },
      { EXTRACTION_REASONING_EFFORT: 'extreme' },
      { EXTRACTION_TIMEOUT_MS: '1000' },
      { EXTRACTION_TIMEOUT_MS: '600000' },
      { DOCUMENT_MAX_BYTES: String(5 * 1024 * 1024 + 1) },
      { DOCUMENT_MAX_BYTES: '1000' },
    ]) {
      expect(() => parseEnv({ ...valid, ...bad }), JSON.stringify(bad)).toThrow(EnvValidationError);
    }
    try {
      parseEnv({ ...valid, EXTRACTION_PROVIDER: 'openai', OPENAI_API_KEY: '' });
    } catch (e) {
      expect((e as Error).message).toContain('OPENAI_API_KEY');
    }
  });
});
