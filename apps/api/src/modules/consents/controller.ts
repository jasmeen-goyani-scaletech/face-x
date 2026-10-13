import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import { recordConsentBodySchema } from './schema';
import type { ConsentService } from './service';

export interface ConsentController {
  listCurrent: RequestHandler;
  status: RequestHandler;
  record: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createConsentController(service: ConsentService): ConsentController {
  return {
    listCurrent: async (_req, res) => {
      res.json({ success: true, data: await service.listCurrent() });
    },

    status: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      res.json({ success: true, data: await service.getStatus(caller(req), registrationId) });
    },

    record: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      const body = recordConsentBodySchema.parse(req.body);
      const data = await service.record(caller(req), registrationId, body, getRequestMeta(req));
      res.status(201).json({ success: true, data });
    },
  };
}
