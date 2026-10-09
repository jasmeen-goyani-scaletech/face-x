export const ROLES = ['ADMIN', 'COACH', 'STAFF', 'PARENT', 'PLAYER'] as const;
export type Role = (typeof ROLES)[number];

/** The `public.users` row. Never contains credentials: those live in user_credentials. */
export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  organizationId: string | null;
  isActive: boolean;
}
