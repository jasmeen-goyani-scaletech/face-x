import type { Router } from 'express';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { createPlayerController } from './controller';
import { createPlayerRepository } from './repository';
import { createPlayerRouter } from './routes';
import { createPlayerService } from './service';

export { listGuardians } from './repository';
export { ownsPlayerSql } from './ownership';
export type * from './types';

export function createPlayersModule(db: Database, auth: AuthMiddleware): Router {
  return createPlayerRouter(
    createPlayerController(createPlayerService(createPlayerRepository(db))),
    {
      requireAuth: auth.requireAuth,
      requireFamilyRole: auth.requireRole('PARENT', 'PLAYER'),
    },
  );
}
