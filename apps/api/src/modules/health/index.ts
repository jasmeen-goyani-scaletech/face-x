import type { Router } from 'express';
import { createHealthController } from './controller';
import type { HealthRepository } from './repository';
import { createHealthRouter } from './routes';
import { createHealthService } from './service';

export type { HealthRepository } from './repository';
export { createHealthRepository } from './repository';

export function createHealthModule(repository: HealthRepository): Router {
  return createHealthRouter(createHealthController(createHealthService(repository)));
}
