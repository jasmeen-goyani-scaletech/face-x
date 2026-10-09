import type { RequestHandler } from 'express';
import type { HealthService } from './service';

export interface HealthController {
  liveness: RequestHandler;
  readiness: RequestHandler;
}

export function createHealthController(service: HealthService): HealthController {
  return {
    liveness: (_req, res) => {
      res.json({ success: true, data: service.liveness() });
    },
    readiness: async (_req, res) => {
      res.json({ success: true, data: await service.readiness() });
    },
  };
}
