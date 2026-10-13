import { Router, type RequestHandler } from 'express';
import type { ExtractionController } from './controller';

export interface ExtractionRouteMiddleware {
  requireAuth: RequestHandler;
  /** Per user: every call is a paid call to the provider (nothing is cached). */
  extractLimiter: RequestHandler;
}

/**
 * Mounted at /api/v1; authentication is per route (see the documents router for why). Who may extract is decided per
 * record in the service: the document's owner, or an admin of the event's organization.
 */
export function createExtractionRouter(
  controller: ExtractionController,
  mw: ExtractionRouteMiddleware,
): Router {
  const router = Router();
  router.post(
    '/documents/:documentId/extract',
    mw.requireAuth,
    mw.extractLimiter,
    controller.extract,
  );
  return router;
}
