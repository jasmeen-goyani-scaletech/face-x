import type { Router } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createFaceController } from './controller';
import { createFaceRepository } from './repository';
import { createFaceRouter } from './routes';
import { createFaceService, type FaceRecognitionConfig } from './service';

export type { FaceRecognitionConfig } from './service';
export type * from './types';

export function createFaceModule(options: {
  db: Database;
  auth: AuthMiddleware;
  recognition?: FaceRecognitionConfig;
  logger: Logger;
}): Router {
  return createFaceRouter(
    createFaceController(
      createFaceService({
        repository: createFaceRepository(options.db),
        recognition: options.recognition,
        logger: options.logger,
      }),
    ),
    {
      requireAuth: options.auth.requireAuth,
      requireFamilyRole: options.auth.requireRole('PARENT', 'PLAYER'),
    },
  );
}
