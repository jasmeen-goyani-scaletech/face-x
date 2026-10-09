import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import type { PaymentService } from './service';

/** Strict and empty: the client supplies no amount, currency, price or status. Anything extra is a 422. */
const checkoutBodySchema = z.object({}).strict();

export interface PaymentController {
  createCheckout: RequestHandler;
  get: RequestHandler;
  webhook: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createPaymentController(
  service: PaymentService,
  logger: Logger,
): PaymentController {
  return {
    createCheckout: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      checkoutBodySchema.parse(req.body ?? {});
      const data = await service.createCheckout(caller(req), registrationId, getRequestMeta(req));
      // The response carries the checkout link: never cache it.
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ success: true, data });
    },

    get: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.getPayment(caller(req), registrationId) });
    },

    webhook: async (req, res) => {
      // express.raw leaves the exact bytes the signature was computed over. Anything else is not a webhook.
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw AppError.badRequest('INVALID_WEBHOOK_BODY', 'Expected a raw application/json body');
      }
      const signature = req.headers['stripe-signature'];
      try {
        const result = await service.handleWebhook(
          req.body,
          typeof signature === 'string' ? signature : undefined,
          getRequestMeta(req),
        );
        res.status(200).json(result);
      } catch (err) {
        if (err instanceof AppError && err.code === 'INVALID_WEBHOOK_SIGNATURE') {
          // Logged (no body, no signature, no secrets) but not written to the audit table, which an
          // unauthenticated caller could otherwise flood.
          logger.warn(
            { ip: getRequestMeta(req).ip },
            'Rejected a webhook with an invalid signature',
          );
        }
        throw err;
      }
    },
  };
}
