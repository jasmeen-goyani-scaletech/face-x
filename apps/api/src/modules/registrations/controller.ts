import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import {
  createRegistrationBodySchema,
  listRegistrationsQuerySchema,
  updateRegistrationBodySchema,
} from './schema';
import type { RegistrationService } from './service';

export interface RegistrationController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  submit: RequestHandler;
  status: RequestHandler;
}

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createRegistrationController(service: RegistrationService): RegistrationController {
  return {
    create: async (req, res) => {
      const body = createRegistrationBodySchema.parse(req.body);
      const data = await service.create(caller(req), body, getRequestMeta(req));
      res.status(201).json({ success: true, data });
    },

    list: async (req, res) => {
      const filter = listRegistrationsQuerySchema.parse(req.query);
      res.json({ success: true, data: await service.listMine(caller(req), filter) });
    },

    get: async (req, res) => {
      const id = uuid.parse(req.params.registrationId);
      res.json({ success: true, data: await service.get(caller(req), id) });
    },

    update: async (req, res) => {
      const id = uuid.parse(req.params.registrationId);
      const body = updateRegistrationBodySchema.parse(req.body);
      res.json({ success: true, data: await service.update(caller(req), id, body) });
    },

    submit: async (req, res) => {
      const id = uuid.parse(req.params.registrationId);
      res.json({ success: true, data: await service.submit(caller(req), id, getRequestMeta(req)) });
    },

    status: async (req, res) => {
      const id = uuid.parse(req.params.registrationId);
      res.json({ success: true, data: await service.getStatus(caller(req), id) });
    },
  };
}
