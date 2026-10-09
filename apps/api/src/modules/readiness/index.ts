import type { Router } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import type { NotificationPublisher } from '../notifications';
import { createReadinessController } from './controller';
import { createReadinessRepository } from './repository';
import { createReadinessRouter } from './routes';
import { createReadinessService } from './service';

export type * from './types';

export interface ReadinessModule {
  router: Router;
  /** Handed to the documents and consent modules, which call it after their own change commits. */
  trigger: import('./types').ReadinessTrigger;
}

export function createReadinessModule(options: {
  db: Database;
  auth: AuthMiddleware;
  logger: Logger;
  notifications?: NotificationPublisher;
}): ReadinessModule {
  const service = createReadinessService(
    createReadinessRepository(options.db),
    options.logger,
    options.notifications,
  );
  return {
    router: createReadinessRouter(createReadinessController(service), options.auth.requireAuth),
    trigger: service,
  };
}
