import type { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createRegistrationController } from './controller';
import { createRegistrationRepository } from './repository';
import { createRegistrationRouter } from './routes';
import { createRegistrationService } from './service';

export {
  canTransition,
  assertTransition,
  allowedTransitions,
  REGISTRATION_STATUSES,
  REGISTRANT_TYPES,
} from './transitions';
export type { RegistrationStatus, RegistrantType } from './transitions';
export { isMinorForEvent } from './rules';
export type * from './types';

export function createRegistrationsModule(db: Database, auth: AuthMiddleware): Router {
  return createRegistrationRouter(
    createRegistrationController(createRegistrationService(createRegistrationRepository(db))),
    {
      requireAuth: auth.requireAuth,
      requireRegistrantRole: auth.requireRole('PARENT', 'PLAYER', 'COACH', 'STAFF'),
    },
  );
}
