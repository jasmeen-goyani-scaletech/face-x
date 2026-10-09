import { AppError } from '../../shared/errors/app-error';
import type { HealthRepository } from './repository';
import type { LivenessReport, ReadinessReport } from './types';

export interface HealthService {
  liveness(): LivenessReport;
  readiness(): Promise<ReadinessReport>;
}

export function createHealthService(repository: HealthRepository): HealthService {
  return {
    liveness() {
      return {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      };
    },

    async readiness() {
      let databaseOk = false;
      try {
        databaseOk = await repository.pingDatabase();
      } catch {
        databaseOk = false;
      }
      if (!databaseOk) {
        throw AppError.unavailable('DATABASE_UNAVAILABLE', 'Database is not reachable');
      }
      return { status: 'ok', checks: { database: 'ok' } };
    },
  };
}
