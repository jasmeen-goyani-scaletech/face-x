import { apiRequest } from './http';
import { loadAllPages } from './pages';
import type { ApiEvent, ApiPage, ApiTeam, ApiTeamWithEvent } from './types';

/** The most the API returns for one page of events. */
const EVENT_PAGE_SIZE = 100;

/**
 * EVERY event open for registration, for the registration pickers. It reads all the pages of the paged endpoint (the plain
 * `GET /events` stops at 100), so none is out of reach however many there are; with 100 or fewer it is still one request.
 */
export const listEvents = () =>
  loadAllPages(
    (page) => apiRequest<ApiPage<ApiEvent>>('/events', { query: { page: String(page), pageSize: String(EVENT_PAGE_SIZE) } }),
    EVENT_PAGE_SIZE
  );

export const listTeams = (eventId: string) => apiRequest<ApiTeam[]>(`/events/${eventId}/teams`);

/** Resolves a coach invite link's code (and the team it names) to the team and event. 404 INVITE_NOT_FOUND if invalid. */
export const resolveInvite = (input: { inviteCode: string; teamId?: string }) =>
  apiRequest<ApiTeamWithEvent>('/teams/resolve-invite', { method: 'POST', body: input });

export const getEvent = (eventId: string) => apiRequest<ApiEvent>(`/events/${eventId}`);
