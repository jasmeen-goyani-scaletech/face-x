import type { Router } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createFaceController } from './controller';
import { createFaceRepository } from './repository';
import { createFaceRouter } from './routes';
import { createFaceService, type FaceRecognitionConfig, type FaceService } from './service';

export type { FaceRecognitionConfig, FaceService } from './service';

/** The face service on its own, for modules that act on a player's face without being the face API (photo approval). */
export function createFaceServiceFor(options: {
  db: Database;
  recognition?: FaceRecognitionConfig;
  logger: Logger;
}): FaceService {
  return createFaceService({
    repository: createFaceRepository(options.db),
    recognition: options.recognition,
    logger: options.logger,
  });
}
export type * from './types';

export function createFaceModule(options: {
  db: Database;
  auth: AuthMiddleware;
  recognition?: FaceRecognitionConfig;
  logger: Logger;
  /** The service to serve; made from the other options when absent. */
  service?: FaceService;
}): Router {
  return createFaceRouter(createFaceController(options.service ?? createFaceServiceFor(options)), {
    requireAuth: options.auth.requireAuth,
    requireFamilyRole: options.auth.requireRole('PARENT', 'PLAYER'),
    requireStaffRole: options.auth.requireRole('COACH', 'STAFF'),
  });
}
