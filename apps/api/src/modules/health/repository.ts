import type { Database } from '../../infrastructure/database/database';

export interface HealthRepository {
  /** Resolves true when the database answers a trivial query. */
  pingDatabase(): Promise<boolean>;
}

export function createHealthRepository(db: Database): HealthRepository {
  return {
    async pingDatabase() {
      try {
        await db.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
  };
}
