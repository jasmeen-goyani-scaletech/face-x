import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import { createCoachTeamBodySchema } from './schema';
import type { CoachTeamService } from './service';

export interface CoachTeamController {
  get: RequestHandler;
  create: RequestHandler;
  roster: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createCoachTeamController(service: CoachTeamService): CoachTeamController {
  return {
    get: async (req, res) => {
      const id = uuid.parse(req.params.registrationId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.get(caller(req), id) });
    },

    create: async (req, res) => {
      const id = uuid.parse(req.params.registrationId);
      const body = createCoachTeamBodySchema.parse(req.body);
      const data = await service.create(caller(req), id, body, getRequestMeta(req));
      res.status(201).json({ success: true, data });
    },

    roster: async (req, res) => {
      const id = uuid.parse(req.params.registrationId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.roster(caller(req), id) });
    },
  };
}
