import express, { Router, type RequestHandler } from 'express';
import type { EventDayController } from './controller';

/** The largest scan image accepted (a camera frame; far below the 5 MiB enrollment photo). */
export const MAX_SCAN_IMAGE_BYTES = 2 * 1024 * 1024;

export interface EventDayRouteMiddleware {
  requireAuth: RequestHandler;
  /** ADMIN of the event's organization. COACH/STAFF scanner access is pending a product decision. */
  requireOperator: RequestHandler;
  scanLimiter: RequestHandler;
  searchLimiter: RequestHandler;
}

/**
 * Mounted at /api/v1. Order matters: authenticate and authorize BEFORE the body is read, then rate-limit per user,
 * then (scan only) refuse with 503 if there is no provider, and only then parse the bounded image body.
 */
export function createEventDayRouter(
  controller: EventDayController,
  mw: EventDayRouteMiddleware,
): Router {
  const router = Router();
  router.post(
    '/events/:eventId/face-scan',
    mw.requireAuth,
    mw.requireOperator,
    mw.scanLimiter,
    controller.requireScanAvailable,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_SCAN_IMAGE_BYTES }),
    controller.scan,
  );
  router.post('/events/:eventId/check-ins', mw.requireAuth, mw.requireOperator, controller.checkIn);
  router.get(
    '/events/:eventId/search-players',
    mw.requireAuth,
    mw.requireOperator,
    mw.searchLimiter,
    controller.search,
  );
  return router;
}
