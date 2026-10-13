import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import { enrollBodySchema } from './schema';
import type { FaceService } from './service';

export interface FaceController {
  enroll: RequestHandler;
  get: RequestHandler;
  remove: RequestHandler;
  getStaff: RequestHandler;
  removeStaff: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createFaceController(service: FaceService): FaceController {
  return {
    enroll: async (req, res) => {
      const playerId = uuid.parse(req.params.playerId);
      const body = enrollBodySchema.parse(req.body);
      const data = await service.enroll(caller(req), playerId, body, getRequestMeta(req));
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ success: true, data });
    },

    get: async (req, res) => {
      const playerId = uuid.parse(req.params.playerId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.getStatus(caller(req), playerId) });
    },

    remove: async (req, res) => {
      const playerId = uuid.parse(req.params.playerId);
      const data = await service.remove(caller(req), playerId, getRequestMeta(req));
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data });
    },

    getStaff: async (req, res) => {
      const staffProfileId = uuid.parse(req.params.staffProfileId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.getStaffStatus(caller(req), staffProfileId) });
    },

    removeStaff: async (req, res) => {
      const staffProfileId = uuid.parse(req.params.staffProfileId);
      const data = await service.removeStaff(caller(req), staffProfileId, getRequestMeta(req));
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data });
    },
  };
}
