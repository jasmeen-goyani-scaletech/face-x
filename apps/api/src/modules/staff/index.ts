import type { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createStaffProfileController } from './controller';
import { createStaffProfileRepository } from './repository';
import { createStaffProfileRouter } from './routes';
import { createStaffProfileService } from './service';

export { ownsRegistrantSql, ownsStaffProfileSql } from './ownership';
export { STAFF_PROFILE_TYPES, STAFF_ROLES } from './types';
export type * from './types';

export function createStaffModule(db: Database, auth: AuthMiddleware): Router {
  return createStaffProfileRouter(
    createStaffProfileController(createStaffProfileService(createStaffProfileRepository(db))),
    {
      requireAuth: auth.requireAuth,
      requirePersonnelRole: auth.requireRole('COACH', 'STAFF'),
    },
  );
}
