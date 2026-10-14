import { Router, type RequestHandler } from 'express';
import type { ConsentController } from './controller';

export interface ConsentRouteMiddleware {
  requireAuth: RequestHandler;
  /** PARENT, PLAYER, COACH or STAFF: the roles that manage their own registrations (ownership is checked per record). */
  requireRegistrantRole: RequestHandler;
}

/** Mounted at /api/v1; authentication is per route (see the documents router for why). */
export function createConsentRouter(
  controller: ConsentController,
  mw: ConsentRouteMiddleware,
): Router {
  const router = Router();
  // Public: the wording is shown on the registration form before a session exists.
  router.get('/consents/current', controller.listCurrent);
  router.get('/registrations/:registrationId/consents', mw.requireAuth, controller.status);
  router.post(
    '/registrations/:registrationId/consents',
    mw.requireAuth,
    mw.requireRegistrantRole,
    controller.record,
  );
  return router;
}
