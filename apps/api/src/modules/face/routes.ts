import { Router, type RequestHandler } from 'express';
import type { FaceController } from './controller';

export interface FaceRouteMiddleware {
  requireAuth: RequestHandler;
  /** PARENT or PLAYER: the roles that manage their own players. */
  requireFamilyRole: RequestHandler;
}

/**
 * Mounted at /api/v1; authentication is per route (see the documents router for why). There is no anonymous
 * face endpoint. The status read is authorized per record in the service (owner, or admin of an organization the
 * player is registered with); enrolling and removing are owner-only.
 */
export function createFaceRouter(controller: FaceController, mw: FaceRouteMiddleware): Router {
  const router = Router();
  router.post(
    '/players/:playerId/face-profile',
    mw.requireAuth,
    mw.requireFamilyRole,
    controller.enroll,
  );
  router.get('/players/:playerId/face-profile', mw.requireAuth, controller.get);
  router.delete(
    '/players/:playerId/face-profile',
    mw.requireAuth,
    mw.requireFamilyRole,
    controller.remove,
  );
  return router;
}
