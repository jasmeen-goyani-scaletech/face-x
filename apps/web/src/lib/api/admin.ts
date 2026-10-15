import { cachedRead, invalidateReads } from './cache';
import { loadAllPages } from './pages';
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
  ApiSignInLink,
  ApiTeamAssignment,
  CreateEventInput,
  CreateTeamInput,
  ListAdminRegistrationsQuery,
  UpdateEventInput,
  UpdateTeamInput
} from './types';

/** The most the API returns for one page of events. */
const EVENT_PAGE_SIZE = 100;

/**
 * EVERY event of the signed-in admin's organization, in every status, for the pickers that need the whole list. It reads all the
 * pages of the paged endpoint (the plain `GET /admin/events` stops at 100), so an organization with more events loses none.
 */
export const listAdminEvents = () =>
  cachedRead('events', () =>
    loadAllPages(
      (page) =>
        apiRequest<ApiPage<ApiAdminEvent>>('/admin/events', { query: { page: String(page), pageSize: String(EVENT_PAGE_SIZE) } }),
      EVENT_PAGE_SIZE
    )
  );

/** One page of the organization's events (the plain list above is for the pickers that need every event). */
export const listAdminEventsPage = (page: number, pageSize: number) =>
  cachedRead(`events:page:${page}:${pageSize}`, () =>
    apiRequest<ApiPage<ApiAdminEvent>>('/admin/events', { query: { page: String(page), pageSize: String(pageSize) } })
  );

export const getAdminEvent = (eventId: string) => apiRequest<ApiAdminEvent>(`/admin/events/${eventId}`);

/** Creates an event (a draft unless `status` says otherwise) for the admin's organization. */
export const createAdminEvent = (input: CreateEventInput) =>
  apiRequest<ApiAdminEvent>('/admin/events', { method: 'POST', body: input }).finally(() => invalidateReads('events'));

export const updateAdminEvent = (eventId: string, input: UpdateEventInput) =>
  apiRequest<ApiAdminEvent>(`/admin/events/${eventId}`, { method: 'PATCH', body: input }).finally(() => invalidateReads('events'));

export const listAdminTeams = (eventId: string) => cachedRead(`teams:${eventId}`, () => apiRequest<ApiAdminTeam[]>(`/admin/events/${eventId}/teams`));

/** One page of the teams of every event of the organization, in a single request. */
export const listAdminTeamsPage = (page: number, pageSize: number) =>
  cachedRead(`teams:page:${page}:${pageSize}`, () =>
    apiRequest<ApiPage<ApiAdminTeam>>('/admin/teams', { query: { page: String(page), pageSize: String(pageSize) } })
  );

export const createAdminTeam = (eventId: string, input: CreateTeamInput) =>
  apiRequest<ApiAdminTeam>(`/admin/events/${eventId}/teams`, { method: 'POST', body: input }).finally(() => invalidateReads('teams:'));

export const getAdminTeam = (teamId: string) => apiRequest<ApiAdminTeam>(`/admin/teams/${teamId}`);

export const updateAdminTeam = (teamId: string, input: UpdateTeamInput) =>
  apiRequest<ApiAdminTeam>(`/admin/teams/${teamId}`, { method: 'PATCH', body: input }).finally(() => invalidateReads('teams:'));

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
      aiRejected: q.aiRejected ? 'true' : undefined,
      eventAccessDisabled: q.eventAccessDisabled ? 'true' : undefined,
      page: q.page === undefined ? undefined : String(q.page),
      pageSize: q.pageSize === undefined ? undefined : String(q.pageSize)
    }
  });
}

/** Everyone on the event's day-of roster (registered and not turned down), with check-in state. */
export const getEventRoster = (eventId: string) =>
  loadAllPages(
    (page) =>
      apiRequest<ApiPage<ApiRosterEntry>>(`/admin/events/${eventId}/roster`, { query: { page: String(page), pageSize: String(ROSTER_PAGE_SIZE) } }),
    ROSTER_PAGE_SIZE,
    (entry) => entry.registrationId
  );

/** People per request when a device reads the whole roster (the API's most for one page). Read page by page, a roster is never cut short. */
const ROSTER_PAGE_SIZE = 500;

/**
 * Checks someone in by hand. `clientRequestId` makes a retry safe: the server records one check-in per id, so a check-in
 * resent after a dropped connection can never be counted twice (the offline queue sends its own uuid for this).
 */
export const checkInManually = (eventId: string, registrationId: string, clientRequestId: string, device?: { deviceId: string; deviceCheckedInAt: string }) =>
  apiRequest<ApiCheckIn>(`/events/${eventId}/check-ins`, { method: 'POST', body: { method: 'MANUAL', registrationId, clientRequestId, ...device } });

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

/** The teams of a coach or staff member (named by their registration id). Admin only. */
export const listTeamAssignments = (registrationId: string) =>
  apiRequest<ApiTeamAssignment[]>(`/admin/registrations/${registrationId}/teams`);

export const addTeamAssignment = (registrationId: string, teamId: string) =>
  apiRequest<ApiTeamAssignment[]>(`/admin/registrations/${registrationId}/teams`, { method: 'POST', body: { teamId } });

export const removeTeamAssignment = (registrationId: string, teamId: string) =>
  apiRequest<ApiTeamAssignment[]>(`/admin/registrations/${registrationId}/teams/${teamId}`, { method: 'DELETE' });

/** A one-time sign-in link for a coach or staff member (named by their registration) who has no password and lost their session. */
export const createSignInLink = (registrationId: string) =>
  apiRequest<ApiSignInLink>(`/admin/registrations/${registrationId}/sign-in-link`, { method: 'POST' });
