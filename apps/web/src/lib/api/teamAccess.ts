import { apiRequest } from './http';
import type { ApiAccessibleTeam, ApiTeamMember } from './types';

/** The teams the signed-in coach / staff member was assigned to (and is approved for). */
export const getMyTeams = () => apiRequest<ApiAccessibleTeam[]>('/me/teams');

/** One of those teams. A team outside the caller's scope answers 404 TEAM_NOT_FOUND. */
export const getAccessibleTeam = (teamId: string) => apiRequest<ApiAccessibleTeam>(`/team-access/teams/${teamId}`);

/** The players and staff on one of those teams. */
export const getAccessibleTeamRoster = (teamId: string) => apiRequest<ApiTeamMember[]>(`/team-access/teams/${teamId}/roster`);
