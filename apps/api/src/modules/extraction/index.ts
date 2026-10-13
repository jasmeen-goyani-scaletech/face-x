import type { Router } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../infrastructure/database/database';
import type { ObjectReader } from '../../infrastructure/storage/object-reader';
import type { AuthMiddleware } from '../../middleware/auth';
import { createUserRateLimiter } from '../../middleware/rate-limit';
import { createExtractionController } from './controller';
import { createExtractionRepository } from './repository';
import { createExtractionRouter } from './routes';
import { createExtractionService, type DocumentExtractionConfig } from './service';

export type { DocumentExtractionConfig } from './service';
export { EXTRACTION_FIELDS } from './fields';
export type * from './types';

/** Per-user extract calls per minute. Each one is a paid provider call, so this is what bounds the cost of repeats. */
export const DEFAULT_EXTRACTIONS_PER_MINUTE = 10;

export function createExtractionModule(options: {
  db: Database;
  auth: AuthMiddleware;
  config?: DocumentExtractionConfig;
  reader?: ObjectReader;
  logger: Logger;
  requestsPerMinute?: number;
}): Router {
  return createExtractionRouter(
    createExtractionController(
      createExtractionService({
        repository: createExtractionRepository(options.db),
        config: options.config,
        reader: options.reader,
        logger: options.logger,
      }),
    ),
    {
      requireAuth: options.auth.requireAuth,
      extractLimiter: createUserRateLimiter({
        windowMs: 60_000,
        limit: options.requestsPerMinute ?? DEFAULT_EXTRACTIONS_PER_MINUTE,
      }),
    },
  );
}
