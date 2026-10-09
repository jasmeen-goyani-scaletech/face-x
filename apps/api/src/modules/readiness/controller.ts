import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { uuid } from '../../shared/validation/fields';
import type { ReadinessService } from './service';

/** Strict and empty: there is nothing a client can supply to influence readiness. */
const evaluateBodySchema = z.object({}).strict();

export interface ReadinessController {
  get: RequestHandler;
  evaluate: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createReadinessController(service: ReadinessService): ReadinessController {
  return {
    get: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.get(caller(req), registrationId) });
    },

    evaluate: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      evaluateBodySchema.parse(req.body ?? {});
      const { previousStatus, steps, report } = await service.evaluate(caller(req), registrationId);
      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        data: {
          previousStatus,
          steps: steps.map((s) => ({ from: s.from, to: s.to, reason: s.reason })),
          readiness: report,
        },
      });
    },
  };
}
