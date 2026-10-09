import { Router, type RequestHandler } from 'express';
import type { CatalogController } from './controller';

export interface CatalogRouteMiddleware {
  requireAuth: RequestHandler;
  /** Per-user limit on invite lookups, so invite codes cannot be guessed by brute force. */
  inviteLimiter: RequestHandler;
}

export function createCatalogRouter(
  controller: CatalogController,
  mw: CatalogRouteMiddleware,
): Router {
  const router = Router();
  router.get('/events', mw.requireAuth, controller.listEvents);
  router.get('/events/:eventId', mw.requireAuth, controller.getEvent);
  router.get('/events/:eventId/teams', mw.requireAuth, controller.listTeams);
  router.get('/teams/:teamId', mw.requireAuth, controller.getTeam);
  router.post('/teams/resolve-invite', mw.requireAuth, mw.inviteLimiter, controller.resolveInvite);
  return router;
}
