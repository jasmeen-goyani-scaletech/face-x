import { hasCode } from './errors';
import { apiRequest } from './http';
import type {
  ApiPersonnelRegistration,
  ApiPersonnelRegistrationSummary,
  ApiPlayer,
  ApiPlayerDetail,
  ApiRegistration,
  ApiRegistrationStatusDto,
  ApiRegistrationSummary,
  ApiStaffProfileType,
  CreatePersonnelRegistrationInput,
  CreatePlayerInput,
  CreateRegistrationInput,
  UpdatePlayerInput,
  UpdateRegistrationInput
} from './types';

// ---- players ----
export const createPlayer = (input: CreatePlayerInput) => apiRequest<ApiPlayerDetail>('/players', { method: 'POST', body: input });
/** The caller's own players (their children, or themself). */
export const listPlayers = () => apiRequest<ApiPlayer[]>('/players');
export const getPlayer = (playerId: string) => apiRequest<ApiPlayerDetail>(`/players/${playerId}`);
export const updatePlayer = (playerId: string, input: UpdatePlayerInput) =>
  apiRequest<ApiPlayerDetail>(`/players/${playerId}`, { method: 'PATCH', body: input });

// ---- registrations ----
/** The caller's registrations, optionally narrowed. This is how the wizard finds out a player is already registered. */
export async function listRegistrations(filter: { eventId?: string; playerId?: string } = {}): Promise<ApiRegistrationSummary[]> {
  try {
    return await apiRequest<ApiRegistrationSummary[]>('/registrations', { query: filter });
  } catch (e) {
    // A brand-new account has no role yet (it picks PARENT or PLAYER when it creates its first player), and the API
    // answers 403 INSUFFICIENT_ROLE for the list. An account that can't own registrations simply has none.
    if (hasCode(e, 'INSUFFICIENT_ROLE')) return [];
    throw e;
  }
}

export const getRegistration = (registrationId: string) => apiRequest<ApiRegistration>(`/registrations/${registrationId}`);

export const createRegistration = (input: CreateRegistrationInput) =>
  apiRequest<ApiRegistration>('/registrations', { method: 'POST', body: input });

export const updateRegistration = (registrationId: string, input: UpdateRegistrationInput) =>
  apiRequest<ApiRegistration>(`/registrations/${registrationId}`, { method: 'PATCH', body: input });

export const submitRegistration = (registrationId: string) =>
  apiRequest<ApiRegistration>(`/registrations/${registrationId}/submit`, { method: 'POST', body: {} });

/** The registration's status and its full history (who changed it, when, and why). */
export const getRegistrationStatus = (registrationId: string) => apiRequest<ApiRegistrationStatusDto>(`/registrations/${registrationId}/status`);

// ---- coach and staff registrations (the same endpoints, with a staff profile in place of a player) ----

/** The caller's own coach or staff registrations, optionally narrowed. */
export function listPersonnelRegistrations(
  registrantType: ApiStaffProfileType,
  filter: { eventId?: string; staffProfileId?: string } = {}
): Promise<ApiPersonnelRegistrationSummary[]> {
  return apiRequest<ApiPersonnelRegistrationSummary[]>('/registrations', { query: { registrantType, ...filter } });
}

export const getPersonnelRegistration = (registrationId: string) => apiRequest<ApiPersonnelRegistration>(`/registrations/${registrationId}`);

export const createPersonnelRegistration = (input: CreatePersonnelRegistrationInput) =>
  apiRequest<ApiPersonnelRegistration>('/registrations', { method: 'POST', body: input });

export const updatePersonnelRegistration = (registrationId: string, input: { teamId?: string | null }) =>
  apiRequest<ApiPersonnelRegistration>(`/registrations/${registrationId}`, { method: 'PATCH', body: input });

export const submitPersonnelRegistration = (registrationId: string) =>
  apiRequest<ApiPersonnelRegistration>(`/registrations/${registrationId}/submit`, { method: 'POST', body: {} });
