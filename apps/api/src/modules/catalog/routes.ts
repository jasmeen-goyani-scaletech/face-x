import { Router, type RequestHandler } from 'express';
import type { CatalogController } from './controller';

export interface CatalogRouteMiddleware {
  /** Identifies a signed-in caller (without requiring one) so the limiter below can key on the user. */
  optionalAuth: RequestHandler;
  /** Per-user (per-IP while signed out) limit on invite lookups, so invite codes cannot be guessed by brute force. */
  inviteLimiter: RequestHandler;
}

export function createCatalogRouter(
  controller: CatalogController,
  mw: CatalogRouteMiddleware,
): Router {
  const router = Router();
  // Public: a registration form needs the published events, their teams and the invite check before it has a session.
  router.get('/events', controller.listEvents);
  router.get('/events/:eventId', controller.getEvent);
  router.get('/events/:eventId/teams', controller.listTeams);
  router.post('/teams/resolve-invite', mw.optionalAuth, mw.inviteLimiter, controller.resolveInvite);
  return router;
}
