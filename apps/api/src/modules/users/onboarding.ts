import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../../infrastructure/database/database';
import type { AuthMiddleware } from '../../middleware/auth';
import { AppError } from '../../shared/errors/app-error';
import { getRequestMeta } from '../../shared/http/request-meta';
import { recordAudit } from '../audit';
import { createUserRepository } from './repository';
import type { Role } from './types';

/**
 * Onboarding: a signed-in family account picks how it will use Face-X.
 *
 * PARENT, PLAYER, COACH and STAFF can be chosen here. PARENT and PLAYER unlock nothing beyond the caller's OWN players and
 * registrations. COACH and STAFF unlock only the caller's OWN coach/staff profile and registration: they grant no access to
 * any event by themselves, because event access (modules/events/access-service.ts) additionally needs an APPROVED
 * registration for that event, which only an admin's document review can produce. ADMIN is privileged and is granted by an
 * operator in SQL, so it is rejected here, never silently ignored.
 */
export const SELF_ASSIGNABLE_ROLES = [
  'PARENT',
  'PLAYER',
  'COACH',
  'STAFF',
] as const satisfies readonly Role[];

const assignRoleBodySchema = z
  .object({
    role: z
      .string()
      .refine(
        (r): r is (typeof SELF_ASSIGNABLE_ROLES)[number] =>
          (SELF_ASSIGNABLE_ROLES as readonly string[]).includes(r),
        `must be one of ${SELF_ASSIGNABLE_ROLES.join(', ')}`,
      ),
  })
  .strict();

export function createOnboardingRouter(db: Database, auth: AuthMiddleware): Router {
  const users = createUserRepository(db);

  const assign: RequestHandler = async (req, res) => {
    if (!req.auth) throw AppError.unauthorized(); // requireAuth is mounted before this handler
    const { userId } = req.auth;
    const { role } = assignRoleBodySchema.parse(req.body);

    await db.transaction(async (tx) => {
      // Idempotent: asking for a role the account already has is a success that changes (and audits) nothing.
      const { rowCount } = await tx.query(
        `insert into public.user_roles (user_id, role, granted_by) values ($1, $2, $1)
         on conflict (user_id, role) do nothing`,
        [userId, role],
      );
      if (rowCount) {
        await recordAudit(tx, {
          action: 'USER_ROLE_ASSIGNED',
          actorUserId: userId,
          entityType: 'user',
          entityId: userId,
          metadata: { role, self: true },
          meta: getRequestMeta(req),
        });
      }
    });
    res.json({ success: true, data: { roles: await users.findRoles(userId) } });
  };

  const router = Router();
  router.post('/me/roles', auth.requireAuth, assign);
  return router;
}
