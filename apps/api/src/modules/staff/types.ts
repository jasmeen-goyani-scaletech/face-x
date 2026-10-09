export const STAFF_PROFILE_TYPES = ['COACH', 'STAFF'] as const;
export type StaffProfileType = (typeof STAFF_PROFILE_TYPES)[number];

/** The frontend's Staff roles (STAFF_ROLES in the web app's lib/types.ts), as stored in staff_profiles.staff_role. */
export const STAFF_ROLES = [
  'TEAM_MANAGER',
  'ATHLETIC_TRAINER',
  'EQUIPMENT_MANAGER',
  'SAFETY_OFFICER',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** What the API returns about a coach or staff member's profile. Internal columns (user_id) are never exposed. */
export interface StaffProfileDto {
  id: string;
  profileType: StaffProfileType;
  /** Set for STAFF, null for COACH. */
  staffRole: StaffRole | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}
