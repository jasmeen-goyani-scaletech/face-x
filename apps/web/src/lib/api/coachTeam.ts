import { apiRequest } from './http';
import type { ApiCoachTeamView, ApiTeamMember, CreateCoachTeamInput } from './types';

/** The coach's team (if any) for one of their own coach registrations, and what they may do about it. */
export const getCoachTeam = (registrationId: string) => apiRequest<ApiCoachTeamView>(`/registrations/${registrationId}/team`);

/** Creates the coach's team (an approved coach with no team yet) and attaches it to their registration. */
export const createCoachTeam = (registrationId: string, input: CreateCoachTeamInput) =>
  apiRequest<ApiCoachTeamView>(`/registrations/${registrationId}/team`, { method: 'POST', body: input });

/** The players and staff registered to the coach's team. Open only while the coach is cleared for the event. */
export const getTeamRoster = (registrationId: string) => apiRequest<ApiTeamMember[]>(`/registrations/${registrationId}/team/roster`);
