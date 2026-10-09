import type { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createUserRateLimiter } from '../../middleware/rate-limit';
import { createCatalogController } from './controller';
import { createCatalogRepository } from './repository';
import { createCatalogRouter } from './routes';
import { createCatalogService } from './service';

export type * from './types';

export const DEFAULT_INVITE_LOOKUPS_PER_MINUTE = 20;

export function createCatalogModule(
  db: Database,
  auth: AuthMiddleware,
  inviteLookupsPerMinute = DEFAULT_INVITE_LOOKUPS_PER_MINUTE,
): Router {
  return createCatalogRouter(
    createCatalogController(createCatalogService(createCatalogRepository(db))),
    {
      requireAuth: auth.requireAuth,
      inviteLimiter: createUserRateLimiter({ windowMs: 60_000, limit: inviteLookupsPerMinute }),
    },
  );
}
