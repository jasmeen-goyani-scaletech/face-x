import { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createAdminRepository } from '../admin';
import { createCoachTeamController } from './controller';
import { createCoachTeamRepository } from './repository';
import { createCoachTeamService } from './service';

export type * from './types';

/**
 * Mounted at /api/v1; paths are under /registrations/:registrationId/team (authentication is per route, like the documents
 * router, because the path spans another module's prefix). COACH only; the service checks the registration is the caller's own.
 */
export function createCoachTeamModule(db: Database, auth: AuthMiddleware): Router {
  const controller = createCoachTeamController(
    createCoachTeamService(createCoachTeamRepository(db), createAdminRepository(db)),
  );
  const { requireAuth } = auth;
  const requireCoach = auth.requireRole('COACH');
  const router = Router();
  router.get('/registrations/:registrationId/team', requireAuth, requireCoach, controller.get);
  router.post('/registrations/:registrationId/team', requireAuth, requireCoach, controller.create);
  router.get(
    '/registrations/:registrationId/team/roster',
    requireAuth,
    requireCoach,
    controller.roster,
  );
  return router;
}
