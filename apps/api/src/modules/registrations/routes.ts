import { Router, type RequestHandler } from 'express';
import type { RegistrationController } from './controller';

export interface RegistrationRouteMiddleware {
  requireAuth: RequestHandler;
  /**
   * PARENT, PLAYER, COACH or STAFF: the roles that register someone. The service then checks the role fits the
   * registrant (a COACH registers a coach profile, a family registers its players).
   */
  requireRegistrantRole: RequestHandler;
}

export function createRegistrationRouter(
  controller: RegistrationController,
  mw: RegistrationRouteMiddleware,
): Router {
  const router = Router();
  router.use(mw.requireAuth);
  router.post('/', mw.requireRegistrantRole, controller.create);
  router.get('/', mw.requireRegistrantRole, controller.list);
  // Reads are authorized per record in the service (owner, or admin of the event's organization).
  router.get('/:registrationId', controller.get);
  router.get('/:registrationId/status', controller.status);
  router.patch('/:registrationId', mw.requireRegistrantRole, controller.update);
  router.post('/:registrationId/submit', mw.requireRegistrantRole, controller.submit);
  return router;
}
