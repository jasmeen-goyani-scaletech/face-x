import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import { createStaffProfileBodySchema, updateStaffProfileBodySchema } from './schema';
import type { StaffProfileService } from './service';

export interface StaffProfileController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createStaffProfileController(service: StaffProfileService): StaffProfileController {
  return {
    create: async (req, res) => {
      const body = createStaffProfileBodySchema.parse(req.body);
      const data = await service.create(caller(req), body, getRequestMeta(req));
      res.status(201).json({ success: true, data });
    },

    list: async (req, res) => {
      res.json({ success: true, data: await service.listMine(caller(req)) });
    },

    get: async (req, res) => {
      const id = uuid.parse(req.params.profileId);
      res.json({ success: true, data: await service.get(caller(req), id) });
    },

    update: async (req, res) => {
      const id = uuid.parse(req.params.profileId);
      const body = updateStaffProfileBodySchema.parse(req.body);
      res.json({ success: true, data: await service.update(caller(req), id, body) });
    },
  };
}
