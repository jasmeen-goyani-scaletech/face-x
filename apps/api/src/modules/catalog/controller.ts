import type { RequestHandler } from 'express';
import { uuid } from '../../shared/validation/fields';
import { resolveInviteBodySchema } from './schema';
import type { CatalogService } from './service';

export interface CatalogController {
  listEvents: RequestHandler;
  getEvent: RequestHandler;
  listTeams: RequestHandler;
  getTeam: RequestHandler;
  resolveInvite: RequestHandler;
}

export function createCatalogController(service: CatalogService): CatalogController {
  return {
    listEvents: async (_req, res) => {
      res.json({ success: true, data: await service.listEvents() });
    },
    getEvent: async (req, res) => {
      res.json({ success: true, data: await service.getEvent(uuid.parse(req.params.eventId)) });
    },
    listTeams: async (req, res) => {
      res.json({ success: true, data: await service.listTeams(uuid.parse(req.params.eventId)) });
    },
    getTeam: async (req, res) => {
      res.json({ success: true, data: await service.getTeam(uuid.parse(req.params.teamId)) });
    },
    resolveInvite: async (req, res) => {
      const body = resolveInviteBodySchema.parse(req.body);
      res.json({ success: true, data: await service.resolveInvite(body) });
    },
  };
}
