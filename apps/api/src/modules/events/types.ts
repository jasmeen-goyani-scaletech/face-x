export interface EventRef {
  id: string;
  organizationId: string;
}

/** A coach/staff registration of the user for one event (registrations joined to staff_profiles). */
export interface PersonnelRegistration {
  registrantType: 'COACH' | 'STAFF';
  status: string;
}

/**
 * ADMIN     = admin of the organization that owns the event.
 * PERSONNEL = coach/staff with an approved registration for that event.
 * PLAYER / PARENT have no event-level access; they reach only their own registrations (Phase 5).
 */
export type EventAccessLevel = 'ADMIN' | 'PERSONNEL';

export interface EventAccess {
  eventId: string;
  organizationId: string;
  level: EventAccessLevel;
}
