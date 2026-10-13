import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { uuid } from '../../shared/validation/fields';
import type { ExtractionService } from './service';

export interface ExtractionController {
  extract: RequestHandler;
}

export function createExtractionController(service: ExtractionService): ExtractionController {
  return {
    extract: async (req, res) => {
      if (!req.auth) throw AppError.unauthorized(); // requireAuth is always mounted before this handler
      const id = uuid.parse(req.params.documentId);
      const data = await service.extract(req.auth, id);
      // Names and dates of birth read off an identity document: never cached anywhere.
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data });
    },
  };
}
