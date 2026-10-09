import { apiRequest } from './http';
import type {
  ApiAdminEvent,
  ApiAdminRegistrationRow,
  ApiAdminTeam,
  ApiCheckIn,
  ApiEventSummary,
  ApiPage,
  ApiRegistrationStatus,
  ApiRosterEntry,
  CreateEventInput,
  CreateTeamInput,
  ListAdminRegistrationsQuery,
  UpdateEventInput,
  UpdateTeamInput
} from './types';

/** The events of the signed-in admin's organization, in every status. */
export const listAdminEvents = () => apiRequest<ApiAdminEvent[]>('/admin/events');

export const getAdminEvent = (eventId: string) => apiRequest<ApiAdminEvent>(`/admin/events/${eventId}`);

/** Creates an event (a draft unless `status` says otherwise) for the admin's organization. */
export const createAdminEvent = (input: CreateEventInput) => apiRequest<ApiAdminEvent>('/admin/events', { method: 'POST', body: input });

export const updateAdminEvent = (eventId: string, input: UpdateEventInput) =>
  apiRequest<ApiAdminEvent>(`/admin/events/${eventId}`, { method: 'PATCH', body: input });

export const listAdminTeams = (eventId: string) => apiRequest<ApiAdminTeam[]>(`/admin/events/${eventId}/teams`);

export const createAdminTeam = (eventId: string, input: CreateTeamInput) =>
  apiRequest<ApiAdminTeam>(`/admin/events/${eventId}/teams`, { method: 'POST', body: input });

export const getAdminTeam = (teamId: string) => apiRequest<ApiAdminTeam>(`/admin/teams/${teamId}`);

export const updateAdminTeam = (teamId: string, input: UpdateTeamInput) =>
  apiRequest<ApiAdminTeam>(`/admin/teams/${teamId}`, { method: 'PATCH', body: input });

/** Registration counts by status for one kind of registrant (players unless told otherwise). */
export const getEventSummary = (eventId: string, registrantType: 'PLAYER' | 'COACH' | 'STAFF' = 'PLAYER') =>
  apiRequest<ApiEventSummary>(`/admin/events/${eventId}/summary`, { query: { registrantType } });

export function listAdminRegistrations(eventId: string, q: ListAdminRegistrationsQuery = {}) {
  return apiRequest<ApiPage<ApiAdminRegistrationRow>>(`/admin/events/${eventId}/registrations`, {
    query: {
      registrantType: q.registrantType,
      status: q.status,
      teamId: q.teamId,
      search: q.search?.trim() || undefined,
      documentsPending: q.documentsPending ? 'true' : undefined,
      page: q.page === undefined ? undefined : String(q.page),
      pageSize: q.pageSize === undefined ? undefined : String(q.pageSize)
    }
  });
}

/** Everyone on the event's day-of roster (registered and not turned down), with check-in state. */
export const getEventRoster = (eventId: string) => apiRequest<ApiRosterEntry[]>(`/admin/events/${eventId}/roster`);

/**
 * Checks someone in by hand. `clientRequestId` makes a retry safe: the server records one check-in per id, so a check-in
 * resent after a dropped connection can never be counted twice (the offline queue sends its own uuid for this).
 */
export const checkInManually = (eventId: string, registrationId: string, clientRequestId: string) =>
  apiRequest<ApiCheckIn>(`/events/${eventId}/check-ins`, { method: 'POST', body: { method: 'MANUAL', registrationId, clientRequestId } });

/**
 * Switches a person's event-day access off or on. It never changes the registration's status, and switching on overrides
 * nothing: payment, documents and consent are still re-checked at the door. A reason (disabling only) is an admin-only note.
 */
export const setEventAccess = (registrationId: string, disabled: boolean, reason?: string) =>
  apiRequest<{ id: string; registrationNumber: string; eventAccessDisabled: boolean; eventAccessDisabledReason: string | null }>(
    `/admin/registrations/${registrationId}/event-access`,
    { method: 'PATCH', body: reason ? { disabled, reason } : { disabled } }
  );

/** Rejects a registration for good. The reason is shown to the registrant. */
export const rejectRegistration = (registrationId: string, reason: string) =>
  apiRequest<{ id: string; registrationNumber: string; status: Extract<ApiRegistrationStatus, 'REJECTED'> }>(
    `/admin/registrations/${registrationId}/reject`,
    { method: 'POST', body: { reason } }
  );
