import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import {
  createEventBodySchema,
  createTeamBodySchema,
  eventAccessBodySchema,
  listEventsQuerySchema,
  listRegistrationsQuerySchema,
  listTeamsQuerySchema,
  rejectRegistrationBodySchema,
  reviewQueueQuerySchema,
  rosterQuerySchema,
  summaryQuerySchema,
  updateEventBodySchema,
  updateTeamBodySchema,
} from './schema';
import type { AdminService } from './service';

export interface AdminController {
  listEvents: RequestHandler;
  listOrganizationTeams: RequestHandler;
  summary: RequestHandler;
  listRegistrations: RequestHandler;
  reviewQueue: RequestHandler;
  rejectRegistration: RequestHandler;
  setEventAccess: RequestHandler;
  getEvent: RequestHandler;
  createEvent: RequestHandler;
  updateEvent: RequestHandler;
  listTeams: RequestHandler;
  createTeam: RequestHandler;
  getTeam: RequestHandler;
  updateTeam: RequestHandler;
  roster: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

/** The route's requireEventAccess has already checked the caller administers this event. */
const eventOf = (req: Parameters<RequestHandler>[0]) => {
  if (!req.eventAccess) throw AppError.unauthorized();
  return req.eventAccess.eventId;
};

export function createAdminController(service: AdminService): AdminController {
  return {
    listEvents: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { page, pageSize } = listEventsQuerySchema.parse(req.query);
      // The event pickers ask for no page and get every event; a listing that asks for one gets just that page.
      if (page === undefined && pageSize === undefined) {
        res.json({ success: true, data: await service.listEvents(caller(req)) });
        return;
      }
      const data = await service.listEventsPage(caller(req), { page: page ?? 1, pageSize: pageSize ?? 25 });
      res.json({ success: true, data });
    },

    listOrganizationTeams: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const query = listTeamsQuerySchema.parse(req.query);
      res.json({ success: true, data: await service.listOrganizationTeams(caller(req), query) });
    },

    summary: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { registrantType } = summaryQuerySchema.parse(req.query);
      res.json({ success: true, data: await service.summary(eventOf(req), registrantType) });
    },

    getEvent: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.getEvent(eventOf(req)) });
    },

    createEvent: async (req, res) => {
      const body = createEventBodySchema.parse(req.body);
      const data = await service.createEvent(caller(req), body, getRequestMeta(req));
      res.status(201).json({ success: true, data });
    },

    updateEvent: async (req, res) => {
      const body = updateEventBodySchema.parse(req.body);
      const data = await service.updateEvent(caller(req), eventOf(req), body, getRequestMeta(req));
      res.json({ success: true, data });
    },

    listTeams: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.listTeams(eventOf(req)) });
    },

    createTeam: async (req, res) => {
      const body = createTeamBodySchema.parse(req.body);
      const data = await service.createTeam(caller(req), eventOf(req), body, getRequestMeta(req));
      res.status(201).json({ success: true, data });
    },

    getTeam: async (req, res) => {
      const teamId = uuid.parse(req.params.teamId);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.getTeam(caller(req), teamId) });
    },

    updateTeam: async (req, res) => {
      const teamId = uuid.parse(req.params.teamId);
      const body = updateTeamBodySchema.parse(req.body);
      const data = await service.updateTeam(caller(req), teamId, body, getRequestMeta(req));
      res.json({ success: true, data });
    },

    roster: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { page, pageSize } = rosterQuerySchema.parse(req.query);
      if (page === undefined && pageSize === undefined) {
        res.json({ success: true, data: await service.roster(eventOf(req)) });
        return;
      }
      const data = await service.rosterPage(eventOf(req), { page: page ?? 1, pageSize: pageSize ?? 100 });
      res.json({ success: true, data });
    },

    listRegistrations: async (req, res) => {
      const query = listRegistrationsQuerySchema.parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.listRegistrations(eventOf(req), query) });
    },

    reviewQueue: async (req, res) => {
      const query = reviewQueueQuerySchema.parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await service.reviewQueue(eventOf(req), query) });
    },

    setEventAccess: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      const body = eventAccessBodySchema.parse(req.body);
      const data = await service.setEventAccess(
        caller(req),
        registrationId,
        body,
        getRequestMeta(req),
      );
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data });
    },

    rejectRegistration: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      const body = rejectRegistrationBodySchema.parse(req.body);
      const data = await service.rejectRegistration(
        caller(req),
        registrationId,
        body,
        getRequestMeta(req),
      );
      res.json({ success: true, data });
    },
  };
}
