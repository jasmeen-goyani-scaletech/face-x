import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import { addGuardianBodySchema, createPlayerBodySchema, updatePlayerBodySchema } from './schema';
import type { PlayerService } from './service';

export interface PlayerController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  addGuardian: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createPlayerController(service: PlayerService): PlayerController {
  return {
    create: async (req, res) => {
      const body = createPlayerBodySchema.parse(req.body);
      const player = await service.create(caller(req), body, getRequestMeta(req));
      res.status(201).json({ success: true, data: player });
    },

    list: async (req, res) => {
      res.json({ success: true, data: await service.listMine(caller(req)) });
    },

    get: async (req, res) => {
      const id = uuid.parse(req.params.playerId);
      res.json({ success: true, data: await service.get(caller(req), id) });
    },

    update: async (req, res) => {
      const id = uuid.parse(req.params.playerId);
      const body = updatePlayerBodySchema.parse(req.body);
      res.json({ success: true, data: await service.update(caller(req), id, body) });
    },

    addGuardian: async (req, res) => {
      const id = uuid.parse(req.params.playerId);
      const body = addGuardianBodySchema.parse(req.body);
      res
        .status(201)
        .json({ success: true, data: await service.addGuardian(caller(req), id, body) });
    },
  };
}
