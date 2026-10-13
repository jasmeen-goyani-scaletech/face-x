import { Router, type RequestHandler } from 'express';
import type { DocumentController } from './controller';

export interface DocumentRouteMiddleware {
  requireAuth: RequestHandler;
  /** PARENT, PLAYER, COACH or STAFF: the roles that manage their own registrations' documents (ownership is checked per record). */
  requireRegistrantRole: RequestHandler;
  requireAdmin: RequestHandler;
}

/**
 * Mounted at /api/v1 (paths span /registrations/... and /documents/...), so authentication is applied
 * per route rather than with router.use, which would also cover unrelated /api/v1 paths.
 * Reads are authorized per record in the service (owner, or admin of the event's organization).
 */
export function createDocumentRouter(
  controller: DocumentController,
  mw: DocumentRouteMiddleware,
): Router {
  const router = Router();
  const { requireAuth, requireRegistrantRole, requireAdmin } = mw;

  router.post(
    '/registrations/:registrationId/documents/upload-url',
    requireAuth,
    requireRegistrantRole,
    controller.requestUpload,
  );
  router.get('/registrations/:registrationId/documents', requireAuth, controller.list);

  router.get('/documents/:documentId/download-url', requireAuth, controller.downloadUrl);
  router.post(
    '/documents/:documentId/complete',
    requireAuth,
    requireRegistrantRole,
    controller.complete,
  );
  router.post(
    '/documents/:documentId/submit',
    requireAuth,
    requireRegistrantRole,
    controller.submit,
  );
  router.patch('/documents/:documentId/review', requireAuth, requireAdmin, controller.review);
  return router;
}
