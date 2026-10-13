import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { checkInBodySchema, searchQuerySchema } from './schema';
import type { EventDayService } from './service';

export interface EventDayController {
  /** 503 before the image is read when no provider is configured. */
  requireScanAvailable: RequestHandler;
  scan: RequestHandler;
  checkIn: RequestHandler;
  search: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};
const eventOf = (req: Parameters<RequestHandler>[0]) => {
  if (!req.eventAccess) throw AppError.unauthorized(); // requireEventAccess is always mounted first
  return req.eventAccess.eventId;
};

export function createEventDayController(service: EventDayService): EventDayController {
  return {
    requireScanAvailable: (_req, _res, next) => {
      service.assertScanAvailable();
      next();
    },

    scan: async (req, res) => {
      // The raw image parser only fills req.body with a Buffer for image/jpeg|png|webp; anything else is rejected.
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError(
          422,
          'IMAGE_REQUIRED',
          'Send the image as the request body with Content-Type image/jpeg, image/png or image/webp',
        );
      }
      const data = await service.scan(caller(req), eventOf(req), req.body, getRequestMeta(req));
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data });
    },

    checkIn: async (req, res) => {
      const body = checkInBodySchema.parse(req.body);
      const { created, checkIn } = await service.checkIn(
        caller(req),
        eventOf(req),
        body,
        getRequestMeta(req),
      );
      res.set('Cache-Control', 'no-store');
      // 201 for the check-in this request made; 200 when an exact retry returned the one already made.
      res
        .status(created ? 201 : 200)
        .json({ success: true, data: { ...checkIn, idempotentReplay: !created } });
    },

    search: async (req, res) => {
      const { q } = searchQuerySchema.parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.search(caller(req), eventOf(req), q) });
    },
  };
}
