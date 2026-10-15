import type { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createAdminController } from './controller';
import { createAdminRepository } from './repository';
import { createAdminRouter } from './routes';
import { createAdminService } from './service';

export { createAdminRepository } from './repository';
export type { AdminRepository } from './repository';
export type * from './types';

export function createAdminModule(
  db: Database,
  auth: AuthMiddleware,
  issueSignInLink: (
    userId: string,
    createdBy: string,
  ) => Promise<{ token: string; expiresAt: Date }>,
): Router {
  return createAdminRouter(createAdminController(createAdminService(createAdminRepository(db), issueSignInLink)), {
    requireAuth: auth.requireAuth,
    requireEventAdmin: auth.requireEventAccess({ allow: ['ADMIN'] }),
    requireAdminRole: auth.requireRole('ADMIN'),
  });
}
