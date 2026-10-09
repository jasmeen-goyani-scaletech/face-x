import { Router, type RequestHandler } from 'express';
import type { NotificationController } from './controller';

/** Mounted at /api/v1. Every route needs a signed-in user; subscriptions are only ever read or changed for that user. */
export function createNotificationRouter(
  controller: NotificationController,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.get('/notifications/push/public-key', requireAuth, controller.publicKey);
  router.post('/notifications/push/subscriptions', requireAuth, controller.subscribe);
  router.delete('/notifications/push/subscriptions', requireAuth, controller.unsubscribe);
  return router;
}
