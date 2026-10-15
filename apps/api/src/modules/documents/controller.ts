import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { uuid } from '../../shared/validation/fields';
import { requestUploadBodySchema, reviewBodySchema, submitBodySchema } from './schema';
import type { DocumentService } from './service';

export interface DocumentController {
  requestUpload: RequestHandler;
  list: RequestHandler;
  complete: RequestHandler;
  submit: RequestHandler;
  review: RequestHandler;
  downloadUrl: RequestHandler;
}

const downloadQuerySchema = z.object({ inline: z.enum(['true', 'false']).optional() }).strict();

const caller = (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before these handlers
  return req.auth;
};

export function createDocumentController(service: DocumentService): DocumentController {
  return {
    requestUpload: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      const body = requestUploadBodySchema.parse(req.body);
      const data = await service.requestUpload(
        caller(req),
        registrationId,
        body,
        getRequestMeta(req),
      );
      // The response carries a signed URL: it must never be cached.
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ success: true, data });
    },

    list: async (req, res) => {
      const registrationId = uuid.parse(req.params.registrationId);
      res.json({ success: true, data: await service.list(caller(req), registrationId) });
    },

    complete: async (req, res) => {
      const id = uuid.parse(req.params.documentId);
      res.json({
        success: true,
        data: await service.complete(caller(req), id, getRequestMeta(req)),
      });
    },

    submit: async (req, res) => {
      const id = uuid.parse(req.params.documentId);
      const body = submitBodySchema.parse(req.body ?? {});
      res.json({
        success: true,
        data: await service.submit(caller(req), id, body, getRequestMeta(req)),
      });
    },

    review: async (req, res) => {
      const id = uuid.parse(req.params.documentId);
      const body = reviewBodySchema.parse(req.body);
      res.json({
        success: true,
        data: await service.review(caller(req), id, body, getRequestMeta(req)),
      });
    },

    downloadUrl: async (req, res) => {
      const id = uuid.parse(req.params.documentId);
      // ?inline=true asks for a link that shows the file in the browser (the admin preview) instead of downloading it.
      const { inline } = downloadQuerySchema.parse(req.query);
      const data = await service.downloadUrl(caller(req), id, getRequestMeta(req), {
        inline: inline === 'true',
      });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data });
    },
  };
}
