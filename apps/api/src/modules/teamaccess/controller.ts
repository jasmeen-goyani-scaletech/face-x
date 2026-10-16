import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { uuid } from '../../shared/validation/fields';
import type { TeamAccessService } from './service';

export interface TeamAccessController {
  listTeams: RequestHandler;
  getTeam: RequestHandler;
  roster: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createTeamAccessController(service: TeamAccessService): TeamAccessController {
  return {
    listTeams: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.listTeams(caller(req)) });
    },
    getTeam: async (req, res) => {
      const teamId = uuid.parse(req.params.teamId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.getTeam(caller(req), teamId) });
    },
    roster: async (req, res) => {
      const teamId = uuid.parse(req.params.teamId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.roster(caller(req), teamId) });
    },
  };
}
