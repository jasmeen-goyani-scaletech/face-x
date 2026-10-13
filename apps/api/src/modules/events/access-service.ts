import { AppError } from '../../shared/errors/app-error';
import type { AuthContext } from '../auth/types';
import type { Role } from '../users';
import type { EventAccessRepository } from './repository';
import type { EventAccess, EventAccessLevel, PersonnelRegistration } from './types';

/**
 * Registration statuses that count as "approved" for a coach/staff member. Coaches and staff have no
 * payment step (payment is players-only), so VERIFIED (admin approved) is their approved state.
 * The per-type status path itself is defined in Phase 5.
 */
export const APPROVED_PERSONNEL_STATUSES: readonly string[] = ['VERIFIED', 'READY_FOR_EVENT'];

/** Authorization for event-scoped resources. Knows nothing about how the caller authenticated. */
export interface EventAccessService {
  /** Throws 404 for an unknown event, 403 when the caller has no valid access to it. */
  resolveEventAccess(
    ctx: AuthContext,
    eventId: string,
    allow: readonly EventAccessLevel[],
  ): Promise<EventAccess>;
}

export function createEventAccessService(repository: EventAccessRepository): EventAccessService {
  return {
    async resolveEventAccess(ctx, eventId, allow) {
      const event = await repository.findEvent(eventId);
      if (!event) throw AppError.notFound('EVENT_NOT_FOUND', 'Event not found');

      const grant = (level: EventAccessLevel): EventAccess => ({
        eventId: event.id,
        organizationId: event.organizationId,
        level,
      });

      // Admin of the organization that owns the event.
      if (
        allow.includes('ADMIN') &&
        ctx.roles.includes('ADMIN') &&
        ctx.organizationId !== null &&
        ctx.organizationId === event.organizationId
      ) {
        return grant('ADMIN');
      }

      // Coach/staff: holding the role is not enough; they need an approved registration for THIS event
      // of the matching type (a COACH role matches a COACH registration, STAFF matches STAFF).
      if (allow.includes('PERSONNEL')) {
        const personnelRoles = ctx.roles.filter(
          (r): r is 'COACH' | 'STAFF' => r === 'COACH' || r === 'STAFF',
        );
        if (personnelRoles.length > 0) {
          const regs = await repository.findPersonnelRegistrations(ctx.userId, event.id);
          if (regs.some((r) => isValidPersonnelRegistration(r, personnelRoles))) {
            return grant('PERSONNEL');
          }
        }
      }

      throw AppError.forbidden('You do not have access to this event', 'EVENT_ACCESS_DENIED');
    },
  };
}

function isValidPersonnelRegistration(reg: PersonnelRegistration, roles: Role[]): boolean {
  return roles.includes(reg.registrantType) && APPROVED_PERSONNEL_STATUSES.includes(reg.status);
}
