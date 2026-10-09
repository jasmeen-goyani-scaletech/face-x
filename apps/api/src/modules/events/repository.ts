import type { Database } from '../../infrastructure/database/database';
import type { EventRef, PersonnelRegistration } from './types';

export interface EventAccessRepository {
  findEvent(eventId: string): Promise<EventRef | null>;
  findPersonnelRegistrations(userId: string, eventId: string): Promise<PersonnelRegistration[]>;
}

export function createEventAccessRepository(db: Database): EventAccessRepository {
  return {
    async findEvent(eventId) {
      const { rows } = await db.query<{ id: string; organization_id: string }>(
        'select id, organization_id from public.events where id = $1',
        [eventId],
      );
      return rows[0] ? { id: rows[0].id, organizationId: rows[0].organization_id } : null;
    },

    async findPersonnelRegistrations(userId, eventId) {
      // Only registrations whose staff profile belongs to this user.
      const { rows } = await db.query<{ registrant_type: 'COACH' | 'STAFF'; status: string }>(
        `select r.registrant_type, r.status
           from public.registrations r
           join public.staff_profiles sp on sp.id = r.staff_profile_id
          where r.event_id = $1 and sp.user_id = $2`,
        [eventId, userId],
      );
      return rows.map((r) => ({ registrantType: r.registrant_type, status: r.status }));
    },
  };
}
