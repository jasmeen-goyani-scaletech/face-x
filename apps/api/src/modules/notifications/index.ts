import type { Router } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../infrastructure/database/database';
import type { PushSender } from '../../infrastructure/push/push-sender';
import type { AuthMiddleware } from '../../middleware/auth';
import { createNotificationController } from './controller';
import { createNotificationRepository } from './repository';
import { createNotificationRouter } from './routes';
import {
  createNotificationService,
  type NotificationService,
  type NotificationServiceDeps,
} from './service';

export type * from './types';
export { NO_NOTIFICATIONS } from './service';

export interface NotificationsModule {
  router: Router;
  /** Handed to the documents, readiness and payments modules, which call it after their own change commits. */
  publisher: NotificationService;
}

export function createNotificationsModule(options: {
  db: Database;
  auth: AuthMiddleware;
  logger: Logger;
  sender?: PushSender;
  overrides?: Pick<
    NotificationServiceDeps,
    'templates' | 'maxSubscriptionsPerUser' | 'maxConsecutiveFailures' | 'ttlSeconds'
  >;
}): NotificationsModule {
  const service = createNotificationService({
    repository: createNotificationRepository(options.db),
    sender: options.sender,
    logger: options.logger,
    ...options.overrides,
  });
  return {
    router: createNotificationRouter(
      createNotificationController(service),
      options.auth.requireAuth,
    ),
    publisher: service,
  };
}
