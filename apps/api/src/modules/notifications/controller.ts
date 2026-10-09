import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { subscribeBodySchema, unsubscribeBodySchema } from './schema';
import type { NotificationService } from './service';

export interface NotificationController {
  publicKey: RequestHandler;
  subscribe: RequestHandler;
  unsubscribe: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createNotificationController(service: NotificationService): NotificationController {
  return {
    publicKey: (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: service.getPublicKey() });
    },

    subscribe: async (req, res) => {
      const body = subscribeBodySchema.parse(req.body);
      const result = await service.subscribe(
        caller(req),
        { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
        req.get('user-agent') ?? null,
      );
      res.status(result.created ? 201 : 200).json({ success: true, data: result });
    },

    unsubscribe: async (req, res) => {
      const body = unsubscribeBodySchema.parse(req.body);
      res.json({ success: true, data: await service.unsubscribe(caller(req), body.endpoint) });
    },
  };
}
