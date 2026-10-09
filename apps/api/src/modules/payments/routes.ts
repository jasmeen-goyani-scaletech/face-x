import { Router, type RequestHandler } from 'express';
import type { PaymentController } from './controller';

export interface PaymentRouteMiddleware {
  requireAuth: RequestHandler;
  /** PARENT or PLAYER: the roles that pay for their own registrations. */
  requireFamilyRole: RequestHandler;
  /** Caps how often a user can make us call the payment provider. */
  checkoutLimiter: RequestHandler;
}

/**
 * Mounted at /api/v1 (authentication is per route). The webhook is NOT here: it needs the raw body and is
 * mounted in app.ts before the JSON parser.
 */
export function createPaymentRouter(
  controller: PaymentController,
  mw: PaymentRouteMiddleware,
): Router {
  const router = Router();
  router.post(
    '/registrations/:registrationId/payment',
    mw.requireAuth,
    mw.requireFamilyRole,
    mw.checkoutLimiter,
    controller.createCheckout,
  );
  // Owner, or admin of the event's organization (checked per record in the service).
  router.get('/registrations/:registrationId/payment', mw.requireAuth, controller.get);
  return router;
}
