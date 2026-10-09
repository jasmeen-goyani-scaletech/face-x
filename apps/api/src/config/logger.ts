import pino, { type Logger } from 'pino';
import type { Env } from './env';

/** Paths scrubbed from every log line: tokens, keys, credentials and anything biometric. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.refreshToken',
  '*.accessToken',
  '*.passwordHash',
  '*.password_hash',
  '*.apiKey',
  '*.secret',
  '*.image',
  '*.imageBase64',
  '*.embedding',
  '*.template',
];

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}
