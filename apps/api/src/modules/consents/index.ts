import type { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import type { ReadinessTrigger } from '../readiness/types';
import { createConsentController } from './controller';
import { createConsentRepository } from './repository';
import { createConsentRouter } from './routes';
import { createConsentService, type BiometricConsentHook } from './service';

export type * from './types';

export function createConsentsModule(
  db: Database,
  auth: AuthMiddleware,
  readiness: ReadinessTrigger,
  faceEnrollment?: BiometricConsentHook,
): Router {
  return createConsentRouter(
    createConsentController(
      createConsentService(createConsentRepository(db), readiness, faceEnrollment),
    ),
    {
      requireAuth: auth.requireAuth,
      requireRegistrantRole: auth.requireRole('PARENT', 'PLAYER', 'COACH', 'STAFF'),
    },
  );
}
