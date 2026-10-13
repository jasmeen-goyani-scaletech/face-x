import { randomUUID } from 'node:crypto';
import express, { type Router } from 'express';
import type { Logger } from 'pino';
import { inject } from 'vitest';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/config/logger';
import { createPasswordHasher } from '../../src/infrastructure/auth/password';
import { createAccessTokenService } from '../../src/infrastructure/auth/tokens';
import { createDatabase, type Database } from '../../src/infrastructure/database/database';
import type { FaceRecognitionConfig } from '../../src/modules/face';
import type { EventDayRateLimits, FaceScanPolicy } from '../../src/modules/eventday';
import type { PushSender } from '../../src/infrastructure/push/push-sender';
import type { PaymentProvider } from '../../src/infrastructure/payments/payment-provider';
import type { FileStorage } from '../../src/infrastructure/storage/file-storage';
import type { ObjectInspector } from '../../src/infrastructure/storage/object-inspector';
import type { ObjectReader } from '../../src/infrastructure/storage/object-reader';
import type { DocumentExtractionConfig } from '../../src/modules/extraction';
import { createAuthMiddleware } from '../../src/middleware/auth';
import { createErrorHandler, notFoundHandler } from '../../src/middleware/error-handler';
import type { AuthRateLimitConfig } from '../../src/middleware/rate-limit';
import { createAuthRepository } from '../../src/modules/auth';
import { createAuthService } from '../../src/modules/auth/service';
import { createEventAccessRepository, createEventAccessService } from '../../src/modules/events';
import { createUserRepository, type Role } from '../../src/modules/users';
import { TEST_JWT_SECRET, TEST_REFRESH_SECRET, testEnv } from './test-env';

export const silentLogger = () => createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

/** A connection pool to the real, migrated test database. Close it in afterAll. */
export const openTestDb = (): Database => createDatabase({ url: inject('databaseUrl') });

export const buildApi = (
  db: Database,
  options: {
    logger?: Logger;
    rateLimits?: AuthRateLimitConfig;
    storage?: {
      files: FileStorage;
      inspector: ObjectInspector;
      reader?: ObjectReader;
      localRouter?: Router;
    };
    documentExtraction?: DocumentExtractionConfig;
    extractionsPerMinute?: number;
    payments?: PaymentProvider;
    pushSender?: PushSender;
    faceRecognition?: FaceRecognitionConfig;
    faceScan?: FaceScanPolicy;
    scanImageViewUrl?: (storedUrl: string) => Promise<string | null>;
    eventDayRateLimits?: EventDayRateLimits;
    inviteLookupsPerMinute?: number;
  } = {},
) =>
  createApp({
    env: testEnv,
    logger: options.logger ?? silentLogger(),
    db,
    rateLimits: options.rateLimits,
    storage: options.storage,
    payments: options.payments,
    pushSender: options.pushSender,
    faceRecognition: options.faceRecognition,
    faceScan: options.faceScan,
    scanImageViewUrl: options.scanImageViewUrl,
    documentExtraction: options.documentExtraction,
    extractionsPerMinute: options.extractionsPerMinute ?? 1_000_000,
    // The door limits themselves are tested in their own app; everywhere else they must not interfere.
    eventDayRateLimits: options.eventDayRateLimits ?? {
      scanPerMinute: 1_000_000,
      searchPerMinute: 1_000_000,
    },
    checkoutRequestsPerMinute: 1_000_000,
    inviteLookupsPerMinute: options.inviteLookupsPerMinute ?? 1_000_000,
    // Tests make far more requests per minute than a real client; the limit itself is not under test here.
    globalRequestsPerMinute: 1_000_000,
  });

export const accessTokens = () =>
  createAccessTokenService({
    secret: TEST_JWT_SECRET,
    ttlSeconds: testEnv.ACCESS_TOKEN_TTL_SECONDS,
  });

export const unique = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
export const uniqueEmail = (prefix = 'user') => `${unique(prefix)}@example.com`;
export const STRONG_PASSWORD = 'correct horse battery staple';

/** Creates a user (real Argon2id hash) and grants roles by SQL, as an admin/onboarding step would. */
export async function createUser(
  db: Database,
  options: {
    email?: string;
    password?: string;
    roles?: Role[];
    organizationId?: string;
    active?: boolean;
  } = {},
) {
  const email = options.email ?? uniqueEmail();
  const password = options.password ?? STRONG_PASSWORD;
  const user = await createAuthRepository(db).createUserWithPassword({
    email,
    fullName: 'Test User',
    passwordHash: await createPasswordHasher().hash(password),
  });
  if (!user) throw new Error('user already exists');
  if (options.organizationId) {
    await db.query('update public.users set organization_id = $2 where id = $1', [
      user.id,
      options.organizationId,
    ]);
  }
  if (options.active === false) {
    await db.query('update public.users set is_active = false where id = $1', [user.id]);
  }
  for (const role of options.roles ?? []) {
    await db.query('insert into public.user_roles (user_id, role) values ($1, $2)', [
      user.id,
      role,
    ]);
  }
  return { id: user.id, email, password };
}

export const bearerFor = async (userId: string) => ({
  Authorization: `Bearer ${await accessTokens().sign(userId)}`,
});

/** Throwaway routes wired with the real middleware and real repositories, for authorization tests. */
export function buildGuardedApp(db: Database) {
  const auth = createAuthService({
    repository: createAuthRepository(db),
    users: createUserRepository(db),
    hasher: createPasswordHasher(),
    accessTokens: accessTokens(),
    refreshTokenSecret: TEST_REFRESH_SECRET,
    refreshTokenTtlDays: 30,
  });
  const mw = createAuthMiddleware(auth, createEventAccessService(createEventAccessRepository(db)));
  const app = express();
  app.get('/admin-only', mw.requireAuth, mw.requireRole('ADMIN'), (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/coach-or-staff', mw.requireAuth, mw.requireRole('COACH', 'STAFF'), (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/events/:eventId/data', mw.requireAuth, mw.requireEventAccess(), (req, res) => {
    res.json({ level: req.eventAccess?.level });
  });
  app.get(
    '/events/:eventId/manage',
    mw.requireAuth,
    mw.requireEventAccess({ allow: ['ADMIN'] }),
    (req, res) => {
      res.json({ level: req.eventAccess?.level });
    },
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler(silentLogger()));
  return app;
}
