import type { RequestHandler, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import type { Database } from '../../infrastructure/database/database';
import type { PaymentProvider } from '../../infrastructure/payments/payment-provider';
import type { AuthMiddleware } from '../../middleware/auth';
import { AppError } from '../../shared/errors/app-error';
import { createPaymentController } from './controller';
import type { NotificationPublisher } from '../notifications';
import { createPaymentRepository } from './repository';
import { createPaymentRouter } from './routes';
import { createPaymentService } from './service';

export type * from './types';

export interface PaymentsModule {
  router: Router;
  /** POST /webhooks/stripe handler: mount it with express.raw() BEFORE the JSON body parser. */
  webhook: RequestHandler;
}

export function createPaymentsModule(options: {
  db: Database;
  auth: AuthMiddleware;
  provider?: PaymentProvider;
  returnBaseUrl: string;
  paymentLinkUrl?: string;
  paymentLinkAmountCents?: number;
  logger: Logger;
  checkoutRequestsPerMinute: number;
  notifications?: NotificationPublisher;
}): PaymentsModule {
  const controller = createPaymentController(
    createPaymentService({
      repository: createPaymentRepository(options.db),
      provider: options.provider,
      returnBaseUrl: options.returnBaseUrl,
      paymentLinkUrl: options.paymentLinkUrl,
      paymentLinkAmountCents: options.paymentLinkAmountCents,
      notifications: options.notifications,
    }),
    options.logger,
  );
  return {
    router: createPaymentRouter(controller, {
      requireAuth: options.auth.requireAuth,
      requireFamilyRole: options.auth.requireRole('PARENT', 'PLAYER'),
      checkoutLimiter: rateLimit({
        windowMs: 60_000,
        limit: options.checkoutRequestsPerMinute,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) => next(AppError.tooManyRequests()),
      }),
    }),
    webhook: controller.webhook,
  };
}
