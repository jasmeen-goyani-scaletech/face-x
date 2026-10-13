import { apiRequest } from './http';
import type { ApiStaffProfile, CreateStaffProfileInput, UpdateStaffProfileInput } from './types';

/** The signed-in coach's or staff member's own profile(s): at most one of each type. */
export const listStaffProfiles = () => apiRequest<ApiStaffProfile[]>('/staff-profiles');

export const createStaffProfile = (input: CreateStaffProfileInput) => apiRequest<ApiStaffProfile>('/staff-profiles', { method: 'POST', body: input });

export const updateStaffProfile = (profileId: string, input: UpdateStaffProfileInput) =>
  apiRequest<ApiStaffProfile>(`/staff-profiles/${profileId}`, { method: 'PATCH', body: input });
