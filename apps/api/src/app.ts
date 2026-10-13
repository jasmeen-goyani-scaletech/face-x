import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express, type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { createPasswordHasher } from './infrastructure/auth/password';
import { createAccessTokenService } from './infrastructure/auth/tokens';
import type { Database } from './infrastructure/database/database';
import type { PushSender } from './infrastructure/push/push-sender';
import type { PaymentProvider } from './infrastructure/payments/payment-provider';
import type { FileStorage } from './infrastructure/storage/file-storage';
import type { ObjectInspector } from './infrastructure/storage/object-inspector';
import type { ObjectReader } from './infrastructure/storage/object-reader';
import type { AuthRateLimitConfig } from './middleware/rate-limit';
import { createAuthModule, createAuthRepository } from './modules/auth';
import { createCoachTeamModule } from './modules/coachteam';
import { createConsentsModule } from './modules/consents';
import { createDocumentsModule } from './modules/documents';
import { createFaceModule, createFaceServiceFor, type FaceRecognitionConfig } from './modules/face';
import {
  createEventDayModule,
  DEFAULT_EVENT_DAY_RATE_LIMITS,
  DEFAULT_FACE_SCAN_POLICY,
  type EventDayRateLimits,
  type FaceScanPolicy,
} from './modules/eventday';
import {
  createExtractionModule,
  DEFAULT_EXTRACTIONS_PER_MINUTE,
  type DocumentExtractionConfig,
} from './modules/extraction';
import { createEventAccessRepository, createEventAccessService } from './modules/events';
import { createHealthModule, createHealthRepository } from './modules/health';
import { createNotificationsModule } from './modules/notifications';
import { createPaymentsModule } from './modules/payments';
import { createReadinessModule } from './modules/readiness';
import { createPlayersModule } from './modules/players';
import { createRegistrationsModule } from './modules/registrations';
import { createStaffModule } from './modules/staff';
import { createAdminModule } from './modules/admin';
import { createCatalogModule, DEFAULT_INVITE_LOOKUPS_PER_MINUTE } from './modules/catalog';
import { createOnboardingRouter, createUserRepository } from './modules/users';

export interface AppDeps {
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'FRONTEND_URL'
    | 'JWT_SECRET'
    | 'REFRESH_TOKEN_SECRET'
    | 'ACCESS_TOKEN_TTL_SECONDS'
    | 'REFRESH_TOKEN_TTL_DAYS'
    | 'COOKIE_SAME_SITE'
    | 'COOKIE_SECURE'
  > &
    Partial<Pick<Env, 'TRUST_PROXY_HOPS'>>;
  logger: Logger;
  db: Database;
  /** Private object storage. Absent when STORAGE_* is not configured (file operations then answer 503). */
  storage?: {
    files: FileStorage;
    inspector: ObjectInspector;
    /** Server-side reads (document extraction). Absent: extraction answers 503. */
    reader?: ObjectReader;
    localRouter?: Router;
  };
  /** Face recognition provider and the image reader it needs. Absent: enrollment and removal answer 503. */
  faceRecognition?: FaceRecognitionConfig;
  /** Event-day matching policy (thresholds, margin, provider deadline). Defaults to the provisional values. */
  faceScan?: FaceScanPolicy;
  /** Turns the stored URL of a scan's frame into a short-lived signed link for the scanner screen. Absent: the stored URL is returned as is. */
  scanImageViewUrl?: (storedUrl: string) => Promise<string | null>;
  /** Per-user requests per minute for scanning and searching at the door. Raised only by tests. */
  eventDayRateLimits?: EventDayRateLimits;
  /** AI document field extraction (provider, deadline, size cap). Absent: the extract endpoint answers 503. */
  documentExtraction?: DocumentExtractionConfig;
  /** Per-user document extractions per minute (default 10). Raised only by tests. */
  extractionsPerMinute?: number;
  /** Stripe (or another provider). Absent when STRIPE_SECRET_KEY is not configured: payment endpoints answer 503. */
  payments?: PaymentProvider;
  /** Web Push delivery (VAPID). Absent when VAPID_* is not configured: subscribing answers 503 and nothing is sent. */
  pushSender?: PushSender;
  /** Per-IP requests per minute for starting a checkout (default 10). Raised only by tests. */
  checkoutRequestsPerMinute?: number;
  /** Per-IP requests per minute across the whole API (default 300). Raised only by tests. */
  globalRequestsPerMinute?: number;
  /** Per-user team-invite lookups per minute (default 20), so invite codes cannot be brute-forced. Raised only by tests. */
  inviteLookupsPerMinute?: number;
  /** Override the auth-endpoint rate limits (tests). */
  rateLimits?: AuthRateLimitConfig;
}

export function createApp({
  env,
  logger,
  db,
  rateLimits,
  storage,
  payments,
  pushSender,
  faceRecognition,
  documentExtraction,
  extractionsPerMinute = DEFAULT_EXTRACTIONS_PER_MINUTE,
  faceScan = DEFAULT_FACE_SCAN_POLICY,
  scanImageViewUrl,
  eventDayRateLimits = DEFAULT_EVENT_DAY_RATE_LIMITS,
  checkoutRequestsPerMinute = 10,
  inviteLookupsPerMinute = DEFAULT_INVITE_LOOKUPS_PER_MINUTE,
  globalRequestsPerMinute = 300,
}: AppDeps): Express {
  // Modules are built first: the payment webhook route has to be registered before the body parser below.
  const auth = createAuthModule({
    service: {
      repository: createAuthRepository(db),
      users: createUserRepository(db),
      hasher: createPasswordHasher(),
      accessTokens: createAccessTokenService({
        secret: env.JWT_SECRET,
        ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      }),
      refreshTokenSecret: env.REFRESH_TOKEN_SECRET,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    },
    eventAccess: createEventAccessService(createEventAccessRepository(db)),
    cookies: { secure: env.COOKIE_SECURE, sameSite: env.COOKIE_SAME_SITE },
    allowedOrigins: env.FRONTEND_URL,
    rateLimits,
  });
  const notifications = createNotificationsModule({
    db,
    auth: auth.middleware,
    logger,
    sender: pushSender,
  });
  const paymentsModule = createPaymentsModule({
    db,
    notifications: notifications.publisher,
    auth: auth.middleware,
    provider: payments,
    returnBaseUrl: env.FRONTEND_URL[0] ?? '',
    logger,
    checkoutRequestsPerMinute,
  });

  const readiness = createReadinessModule({
    db,
    auth: auth.middleware,
    logger,
    notifications: notifications.publisher,
  });

  // One face service for the face API and for what an admin's photo approval sets in motion.
  const faceService = createFaceServiceFor({ db, recognition: faceRecognition, logger });

  const app = express();

  // Behind a reverse proxy (a load balancer, Caddy, nginx) req.ip is the proxy unless this is set. The number is how many
  // proxies to trust; the rate limits depend on it being right (see docs/deployment.md).
  const proxyHops = env.TRUST_PROXY_HOPS ?? (env.NODE_ENV === 'production' ? 1 : 0);
  if (proxyHops > 0) app.set('trust proxy', proxyHops);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'];
        const requestId = typeof id === 'string' && id.length <= 100 ? id : randomUUID();
        res.setHeader('X-Request-Id', requestId);
        return requestId;
      },
      // Log method + path only: no headers, query strings or bodies (they can hold tokens or personal data).
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));

  // The payment webhook needs the exact raw bytes (the signature covers them), so it is mounted before the JSON
  // parser, and before the rate limiter so the provider's retries are never throttled. Its protection is the
  // signature check, which happens before anything in the body is read.
  app.post(
    '/api/v1/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    paymentsModule.webhook,
  );

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: globalRequestsPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );
  // Development-only signed upload/download links (STORAGE_DRIVER=local). It reads its own raw file bodies.
  if (storage?.localRouter) app.use(storage.localRouter);
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', createHealthModule(createHealthRepository(db)));
  app.use('/api/v1/auth', auth.router);
  app.use('/api/v1/users', createOnboardingRouter(db, auth.middleware));
  app.use('/api/v1', createCatalogModule(db, auth.middleware, inviteLookupsPerMinute));
  app.use('/api/v1/players', createPlayersModule(db, auth.middleware));
  app.use('/api/v1/staff-profiles', createStaffModule(db, auth.middleware));
  app.use('/api/v1/registrations', createRegistrationsModule(db, auth.middleware));
  // These span /registrations/:id/... and /documents/...: authentication is applied per route.
  app.use(
    '/api/v1',
    createDocumentsModule(
      db,
      auth.middleware,
      storage,
      readiness.trigger,
      notifications.publisher,
      {
        afterPhotoApproved: (input) => faceService.enrollApprovedPhoto(input),
      },
    ),
  );
  app.use(
    '/api/v1',
    createExtractionModule({
      db,
      auth: auth.middleware,
      config: documentExtraction,
      reader: storage?.reader,
      logger,
      requestsPerMinute: extractionsPerMinute,
    }),
  );
  app.use('/api/v1', createCoachTeamModule(db, auth.middleware));
  app.use(
    '/api/v1',
    createConsentsModule(db, auth.middleware, readiness.trigger, {
      afterBiometricConsent: (input) => faceService.enrollAfterConsent(input),
    }),
  );
  app.use('/api/v1', notifications.router);
  app.use('/api/v1', paymentsModule.router);
  app.use('/api/v1', createAdminModule(db, auth.middleware));
  app.use('/api/v1', readiness.router);
  app.use(
    '/api/v1',
    createFaceModule({
      db,
      auth: auth.middleware,
      recognition: faceRecognition,
      logger,
      service: faceService,
    }),
  );
  // Event-day scanner endpoints: ADMIN of the event's organization, authorized per route. Scanning needs only the
  // provider (no storage); without one it answers 503 and never invents a match.
  app.use(
    '/api/v1',
    createEventDayModule({
      db,
      auth: auth.middleware,
      provider: faceRecognition?.provider,
      scanImageViewUrl,
      policy: faceScan,
      rateLimits: eventDayRateLimits,
      logger,
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
