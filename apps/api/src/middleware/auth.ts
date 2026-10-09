import type { RequestHandler } from 'express';
import { AppError } from '../shared/errors/app-error';
import { eventIdParamSchema } from '../modules/auth/schema';
import type { AuthService } from '../modules/auth/service';
import type { EventAccessService } from '../modules/events/access-service';
import type { EventAccessLevel } from '../modules/events/types';
import type { Role } from '../modules/users';

export interface AuthMiddleware {
  /** 401 unless a valid access token is presented; sets req.auth. */
  requireAuth: RequestHandler;
  /** 403 unless the caller holds at least one of `roles`. Use after requireAuth. */
  requireRole: (...roles: Role[]) => RequestHandler;
  /**
   * 403 unless the caller may act on the event in `req.params[param]` (default `eventId`); sets req.eventAccess.
   * `allow` limits which access levels qualify (default: ADMIN and approved coach/staff). Use after requireAuth.
   * A role alone never grants event access.
   */
  requireEventAccess: (options?: { param?: string; allow?: EventAccessLevel[] }) => RequestHandler;
}

export function createAuthMiddleware(
  auth: Pick<AuthService, 'authenticate'>,
  eventAccess: EventAccessService,
): AuthMiddleware {
  const requireAuth: RequestHandler = async (req, _res, next) => {
    req.auth = await auth.authenticate(req.headers.authorization);
    next();
  };

  const requireRole =
    (...roles: Role[]): RequestHandler =>
    (req, _res, next) => {
      // Reaching here without requireAuth is a wiring bug; fail closed rather than allow.
      if (!req.auth) throw AppError.unauthorized();
      if (!roles.some((r) => req.auth!.roles.includes(r))) {
        throw AppError.forbidden('You do not have the required role', 'INSUFFICIENT_ROLE');
      }
      next();
    };

  const requireEventAccess =
    (options: { param?: string; allow?: EventAccessLevel[] } = {}): RequestHandler =>
    async (req, _res, next) => {
      if (!req.auth) throw AppError.unauthorized();
      const eventId = eventIdParamSchema.parse(req.params[options.param ?? 'eventId']);
      req.eventAccess = await eventAccess.resolveEventAccess(
        req.auth,
        eventId,
        options.allow ?? ['ADMIN', 'PERSONNEL'],
      );
      next();
    };

  return { requireAuth, requireRole, requireEventAccess };
}
