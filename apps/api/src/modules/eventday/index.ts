import type { Router } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../infrastructure/database/database';
import type { FaceRecognitionProvider } from '../../infrastructure/face/face-provider';
import type { AuthMiddleware } from '../../middleware/auth';
import { createUserRateLimiter } from '../../middleware/rate-limit';
import { createEventDayController } from './controller';
import type { FaceScanPolicy } from './matching';
import { createEventDayRepository } from './repository';
import { createEventDayRouter } from './routes';
import { createEventDayService } from './service';

export { DEFAULT_FACE_SCAN_POLICY, type FaceScanPolicy } from './matching';
export type * from './types';

export interface EventDayRateLimits {
  scanPerMinute: number;
  searchPerMinute: number;
}
export const DEFAULT_EVENT_DAY_RATE_LIMITS: EventDayRateLimits = {
  scanPerMinute: 60,
  searchPerMinute: 60,
};

export function createEventDayModule(options: {
  db: Database;
  auth: AuthMiddleware;
  provider?: FaceRecognitionProvider;
  policy: FaceScanPolicy;
  scanImageViewUrl?: (storedUrl: string) => Promise<string | null>;
  rateLimits?: EventDayRateLimits;
  logger: Logger;
}): Router {
  const limits = options.rateLimits ?? DEFAULT_EVENT_DAY_RATE_LIMITS;
  const minute = 60_000;
  return createEventDayRouter(
    createEventDayController(
      createEventDayService({
        repository: createEventDayRepository(options.db),
        provider: options.provider,
        policy: options.policy,
        scanImageViewUrl: options.scanImageViewUrl,
        logger: options.logger,
      }),
    ),
    {
      requireAuth: options.auth.requireAuth,
      // Today only an ADMIN of the event's organization operates the scanner (see docs/architecture.md).
      requireOperator: options.auth.requireEventAccess({ allow: ['ADMIN'] }),
      scanLimiter: createUserRateLimiter({ windowMs: minute, limit: limits.scanPerMinute }),
      searchLimiter: createUserRateLimiter({ windowMs: minute, limit: limits.searchPerMinute }),
    },
  );
}
