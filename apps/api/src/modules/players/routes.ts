import { Router, type RequestHandler } from 'express';
import type { PlayerController } from './controller';

export interface PlayerRouteMiddleware {
  requireAuth: RequestHandler;
  /** PARENT or PLAYER: the roles that manage their own players. */
  requireFamilyRole: RequestHandler;
}

export function createPlayerRouter(
  controller: PlayerController,
  mw: PlayerRouteMiddleware,
): Router {
  const router = Router();
  router.use(mw.requireAuth);
  router.post('/', mw.requireFamilyRole, controller.create);
  router.get('/', mw.requireFamilyRole, controller.list);
  // Reads are authorized per record in the service (owner, or admin of the event's organization).
  router.get('/:playerId', controller.get);
  router.patch('/:playerId', mw.requireFamilyRole, controller.update);
  router.post('/:playerId/parents', mw.requireFamilyRole, controller.addGuardian);
  return router;
}
