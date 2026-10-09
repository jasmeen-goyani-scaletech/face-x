import { apiRequest } from './http';
import type { ApiEvent, ApiTeam, ApiTeamWithEvent } from './types';

export const listEvents = () => apiRequest<ApiEvent[]>('/events');

export const listTeams = (eventId: string) => apiRequest<ApiTeam[]>(`/events/${eventId}/teams`);

/** Resolves a coach invite link's code (and the team it names) to the team and event. 404 INVITE_NOT_FOUND if invalid. */
export const resolveInvite = (input: { inviteCode: string; teamId?: string }) =>
  apiRequest<ApiTeamWithEvent>('/teams/resolve-invite', { method: 'POST', body: input });

export const getEvent = (eventId: string) => apiRequest<ApiEvent>(`/events/${eventId}`);
