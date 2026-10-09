import { Router, type RequestHandler } from 'express';
import type { ReadinessController } from './controller';

/** Mounted at /api/v1; authentication is per route (see the documents router for why). Access is checked per record in the service. */
export function createReadinessRouter(
  controller: ReadinessController,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.get('/registrations/:registrationId/readiness', requireAuth, controller.get);
  router.post(
    '/registrations/:registrationId/readiness/evaluate',
    requireAuth,
    controller.evaluate,
  );
  return router;
}
