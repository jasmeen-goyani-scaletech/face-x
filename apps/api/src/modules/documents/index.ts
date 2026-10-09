import type { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import type { NotificationPublisher } from '../notifications';
import type { ReadinessTrigger } from '../readiness/types';
import { createDocumentController } from './controller';
import { createDocumentRepository } from './repository';
import { createDocumentRouter } from './routes';
import { createDocumentService, type DocumentServiceDeps } from './service';

export type * from './types';

export function createDocumentsModule(
  db: Database,
  auth: AuthMiddleware,
  storage: DocumentServiceDeps['storage'],
  readiness: ReadinessTrigger,
  notifications?: NotificationPublisher,
): Router {
  return createDocumentRouter(
    createDocumentController(
      createDocumentService({
        repository: createDocumentRepository(db),
        storage,
        readiness,
        notifications,
      }),
    ),
    {
      requireAuth: auth.requireAuth,
      requireRegistrantRole: auth.requireRole('PARENT', 'PLAYER', 'COACH', 'STAFF'),
      requireAdmin: auth.requireRole('ADMIN'),
    },
  );
}
