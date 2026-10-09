import type { Router } from 'express';
import { createAuthMiddleware, type AuthMiddleware } from '../../middleware/auth';
import { createAuthRateLimiters, type AuthRateLimitConfig } from '../../middleware/rate-limit';
import { requireTrustedOrigin } from '../../middleware/trusted-origin';
import type { EventAccessService } from '../events';
import { createAuthController, type CookieConfig } from './controller';
import { createAuthRouter } from './routes';
import { createAuthService, type AuthServiceDeps } from './service';

export { createAuthRepository, type AuthRepository } from './repository';
export type * from './types';

export interface AuthModule {
  router: Router;
  /** Shared by every protected module: requireAuth, requireRole, requireEventAccess. */
  middleware: AuthMiddleware;
}

export function createAuthModule(options: {
  service: AuthServiceDeps;
  eventAccess: EventAccessService;
  cookies: CookieConfig;
  allowedOrigins: readonly string[];
  rateLimits?: AuthRateLimitConfig;
}): AuthModule {
  const service = createAuthService(options.service);
  const middleware = createAuthMiddleware(service, options.eventAccess);
  return {
    router: createAuthRouter(createAuthController(service, options.cookies), {
      requireAuth: middleware.requireAuth,
      trustedOrigin: requireTrustedOrigin(options.allowedOrigins),
      limiters: createAuthRateLimiters(options.rateLimits),
    }),
    middleware,
  };
}
