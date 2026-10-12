import { apiRequest } from './http';
import { clearSession, setSession, setSessionRoles } from './session';
import type { ApiUser, SelfAssignableRole, SessionResponse } from './types';

/** Creates an account. It has no roles and is not signed in: call `login` next. */
export function register(input: { email: string; password: string; fullName?: string }): Promise<ApiUser> {
  return apiRequest<ApiUser>('/auth/register', { method: 'POST', body: input, auth: false });
}

/** Signs in: the API sets the HttpOnly refresh cookie, and the access token is kept in memory. */
export async function login(input: { email: string; password: string }): Promise<ApiUser> {
  const data = await apiRequest<SessionResponse>('/auth/login', { method: 'POST', body: input, auth: false });
  setSession(data);
  return data.user;
}

/** Ends the session server-side (revokes the refresh token) and here. Always signs out locally, even if the call fails. */
export async function logout(): Promise<void> {
  // The event-day roster this device holds is people's details: it goes BEFORE the session ends, so there is never a moment when the
  // admin is signed out and it is still on the device. (Check-ins still waiting to be sent stay in their queue, for this same admin's
  // next sign-in.) Loaded on demand, so pages that never touch event-day work do not carry the offline database code.
  try {
    await import('../offline/rosterCache').then((m) => m.clearRosterCache());
  } catch {
    // nothing stored, or storage unavailable: there is nothing to remove
  }
  try {
    await apiRequest<void>('/auth/logout', { method: 'POST', auth: false });
  } finally {
    clearSession();
  }
}

export function fetchMe(): Promise<ApiUser> {
  return apiRequest<ApiUser>('/auth/me');
}

/** Picks PARENT, PLAYER, COACH or STAFF for this account (idempotent). Returns the account's roles afterwards. */
export async function assignRole(role: SelfAssignableRole): Promise<ApiUser['roles']> {
  const data = await apiRequest<{ roles: ApiUser['roles'] }>('/users/me/roles', { method: 'POST', body: { role } });
  setSessionRoles(data.roles);
  return data.roles;
}

/** The account can own players and registrations (it has picked PARENT or PLAYER). */
export const hasFamilyRole = (user: ApiUser | null): boolean => !!user && user.roles.some((r) => r === 'PARENT' || r === 'PLAYER');
