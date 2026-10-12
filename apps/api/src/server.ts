import { readFileSync } from 'node:fs';
import { createApp } from './app';
import { EnvValidationError, parseEnv } from './config/env';
import { createLogger } from './config/logger';
import { createDatabase } from './infrastructure/database/database';
import { createFaceProvider } from './infrastructure/face/provider-registry';
import { createWebPushSender } from './infrastructure/push/web-push-sender';
import { createStripePaymentProvider } from './infrastructure/payments/stripe-provider';
import { createStorageFromEnv } from './infrastructure/storage';
import { DEFAULT_AUTH_RATE_LIMITS } from './middleware/rate-limit';

function main(): void {
  let env;
  try {
    env = parseEnv(process.env);
  } catch (err) {
    // The logger needs a valid env, so a config failure is reported straight to stderr.
    console.error(err instanceof EnvValidationError ? err.message : err);
    process.exit(1);
  }

  const logger = createLogger(env);
  const db = createDatabase({
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    sslCa: env.DATABASE_SSL_CA_FILE ? readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8') : undefined,
    poolMax: env.DATABASE_POOL_MAX,
    onError: (err) => logger.error({ err }, 'Idle database client error'),
  });
  const storage = createStorageFromEnv(env);
  if (!storage)
    logger.warn('STORAGE_* is not configured: document upload and download are disabled');
  else if (storage.driver === 'local')
    logger.warn(
      'STORAGE_DRIVER=local: files are kept in a folder on this machine (development only)',
    );
  if (!env.STRIPE_SECRET_KEY) logger.warn('STRIPE_SECRET_KEY is not set: payments are disabled');
  else if (!env.STRIPE_WEBHOOK_SECRET)
    logger.warn('STRIPE_WEBHOOK_SECRET is not set: payments cannot be confirmed');
  const faceProvider = createFaceProvider(env.FACE_PROVIDER, env, { db });
  if (env.FACE_PROVIDER && !faceProvider) {
    logger.error(
      { provider: env.FACE_PROVIDER },
      'FACE_PROVIDER has no adapter: face enrollment is disabled',
    );
  } else if (!faceProvider) {
    logger.warn('FACE_PROVIDER is not set: face enrollment is disabled');
  } else if (!storage) {
    logger.error(
      'Face enrollment needs STORAGE_* (the photo is read from private storage): disabled',
    );
  } else if (env.FACE_CONSENT_CODE === undefined) {
    logger.warn(
      'FACE_CONSENT_CODE is not set: face enrollment stays disabled until the consent policy is decided',
    );
  } else if (env.FACE_CONSENT_CODE === 'NONE') {
    logger.warn('FACE_CONSENT_CODE=NONE: face enrollment does NOT require biometric consent');
  }
  const pushSender =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
      ? createWebPushSender({
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT,
        })
      : undefined;
  if (!pushSender) logger.warn('VAPID_* is not set: push notifications are disabled');
  const app = createApp({
    env,
    pushSender,
    logger,
    db,
    rateLimits: {
      ...DEFAULT_AUTH_RATE_LIMITS,
      loginPerIp: {
        ...DEFAULT_AUTH_RATE_LIMITS.loginPerIp,
        limit: env.RATE_LIMIT_LOGIN_PER_IP_15MIN ?? DEFAULT_AUTH_RATE_LIMITS.loginPerIp.limit,
      },
      registerPerIp: {
        ...DEFAULT_AUTH_RATE_LIMITS.registerPerIp,
        limit: env.RATE_LIMIT_REGISTER_PER_IP_HOUR ?? DEFAULT_AUTH_RATE_LIMITS.registerPerIp.limit,
      },
    },
    payments: env.STRIPE_SECRET_KEY
      ? createStripePaymentProvider({
          secretKey: env.STRIPE_SECRET_KEY,
          webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        })
      : undefined,
    faceScan: {
      matchThreshold: env.FACE_MATCH_THRESHOLD,
      reviewThreshold: env.FACE_REVIEW_THRESHOLD,
      ambiguityMargin: env.FACE_AMBIGUITY_MARGIN,
      timeoutMs: env.FACE_SCAN_TIMEOUT_MS,
    },
    faceRecognition:
      faceProvider && storage
        ? {
            provider: faceProvider,
            images: storage.reader,
            consentPolicy: env.FACE_CONSENT_CODE,
            timeoutMs: env.FACE_PROVIDER_TIMEOUT_MS,
          }
        : undefined,
    storage: storage
      ? { files: storage.files, inspector: storage.inspector, localRouter: storage.localRouter }
      : undefined,
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
