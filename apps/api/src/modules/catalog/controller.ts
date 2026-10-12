import type { RequestHandler } from 'express';
import { uuid } from '../../shared/validation/fields';
import { listEventsQuerySchema, resolveInviteBodySchema } from './schema';
import type { CatalogService } from './service';

export interface CatalogController {
  listEvents: RequestHandler;
  getEvent: RequestHandler;
  listTeams: RequestHandler;
  resolveInvite: RequestHandler;
}

export function createCatalogController(service: CatalogService): CatalogController {
  return {
    listEvents: async (req, res) => {
      const { page, pageSize } = listEventsQuerySchema.parse(req.query);
      // No page asked for: the plain list, exactly as before. A picker that must reach every event asks for pages.
      if (page === undefined && pageSize === undefined) {
        res.json({ success: true, data: await service.listEvents() });
        return;
      }
      res.json({
        success: true,
        data: await service.listEventsPage({ page: page ?? 1, pageSize: pageSize ?? 25 }),
      });
    },
    getEvent: async (req, res) => {
      res.json({ success: true, data: await service.getEvent(uuid.parse(req.params.eventId)) });
    },
    listTeams: async (req, res) => {
      res.json({ success: true, data: await service.listTeams(uuid.parse(req.params.eventId)) });
    },
    resolveInvite: async (req, res) => {
      const body = resolveInviteBodySchema.parse(req.body);
      res.json({ success: true, data: await service.resolveInvite(body) });
    },
  };
}
