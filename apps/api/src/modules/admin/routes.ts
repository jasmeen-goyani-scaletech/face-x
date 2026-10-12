import { Router, type RequestHandler } from 'express';
import type { AdminController } from './controller';

export interface AdminRouteMiddleware {
  requireAuth: RequestHandler;
  /** ADMIN of the organization that owns the event in `:eventId` (404 unknown event, 403 otherwise). */
  requireEventAdmin: RequestHandler;
  /** ADMIN role; which registrations that admin may touch is decided per record in the service. */
  requireAdminRole: RequestHandler;
}

/** Mounted at /api/v1. */
export function createAdminRouter(controller: AdminController, mw: AdminRouteMiddleware): Router {
  const router = Router();
  router.get('/admin/events', mw.requireAuth, mw.requireAdminRole, controller.listEvents);
  router.post('/admin/events', mw.requireAuth, mw.requireAdminRole, controller.createEvent);
  router.get('/admin/events/:eventId', mw.requireAuth, mw.requireEventAdmin, controller.getEvent);
  router.patch(
    '/admin/events/:eventId',
    mw.requireAuth,
    mw.requireEventAdmin,
    controller.updateEvent,
  );
  router.get(
    '/admin/events/:eventId/teams',
    mw.requireAuth,
    mw.requireEventAdmin,
    controller.listTeams,
  );
  router.post(
    '/admin/events/:eventId/teams',
    mw.requireAuth,
    mw.requireEventAdmin,
    controller.createTeam,
  );
  router.get('/admin/teams', mw.requireAuth, mw.requireAdminRole, controller.listOrganizationTeams);
  // Team routes name only the team: the service checks the caller administers the event it belongs to.
  router.get('/admin/teams/:teamId', mw.requireAuth, mw.requireAdminRole, controller.getTeam);
  router.patch('/admin/teams/:teamId', mw.requireAuth, mw.requireAdminRole, controller.updateTeam);
  router.get(
    '/admin/events/:eventId/roster',
    mw.requireAuth,
    mw.requireEventAdmin,
    controller.roster,
  );
  router.get(
    '/admin/events/:eventId/summary',
    mw.requireAuth,
    mw.requireEventAdmin,
    controller.summary,
  );
  router.get(
    '/admin/events/:eventId/registrations',
    mw.requireAuth,
    mw.requireEventAdmin,
    controller.listRegistrations,
  );
  router.get(
    '/admin/events/:eventId/review-queue',
    mw.requireAuth,
    mw.requireEventAdmin,
    controller.reviewQueue,
  );
  router.patch(
    '/admin/registrations/:registrationId/event-access',
    mw.requireAuth,
    mw.requireAdminRole,
    controller.setEventAccess,
  );
  router.post(
    '/admin/registrations/:registrationId/reject',
    mw.requireAuth,
    mw.requireAdminRole,
    controller.rejectRegistration,
  );
  return router;
}
