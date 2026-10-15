import { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createAdminRepository } from '../admin';
import { createTeamAccessController } from './controller';
import { createTeamAccessRepository } from './repository';
import { createTeamAccessService } from './service';

export type * from './types';

/**
 * Mounted at /api/v1: /me/teams and /team-access/teams/:teamId[/roster], for coaches and staff (and admins of the team's
 * organization). The role gate only keeps parents and players out early; WHICH teams a caller reaches is decided in the service.
 */
export function createTeamAccessModule(db: Database, auth: AuthMiddleware): Router {
  const controller = createTeamAccessController(
    createTeamAccessService(createTeamAccessRepository(db), createAdminRepository(db)),
  );
  const guard = [auth.requireAuth, auth.requireRole('ADMIN', 'COACH', 'STAFF')];
  const router = Router();
  router.get('/me/teams', ...guard, controller.listTeams);
  router.get('/team-access/teams/:teamId', ...guard, controller.getTeam);
  router.get('/team-access/teams/:teamId/roster', ...guard, controller.roster);
  return router;
}
