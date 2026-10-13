import { Router, type RequestHandler } from 'express';
import type { StaffProfileController } from './controller';

export interface StaffProfileRouteMiddleware {
  requireAuth: RequestHandler;
  /** COACH or STAFF: the roles that have a profile of their own. */
  requirePersonnelRole: RequestHandler;
}

export function createStaffProfileRouter(
  controller: StaffProfileController,
  mw: StaffProfileRouteMiddleware,
): Router {
  const router = Router();
  router.use(mw.requireAuth);
  router.post('/', mw.requirePersonnelRole, controller.create);
  router.get('/', mw.requirePersonnelRole, controller.list);
  // Reads are authorized per record in the service (owner, or admin of the event's organization).
  router.get('/:profileId', controller.get);
  router.patch('/:profileId', mw.requirePersonnelRole, controller.update);
  return router;
}
