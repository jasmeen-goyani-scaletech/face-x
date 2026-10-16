/** The brackets a player may be registered in. */
export const AGE_DIVISIONS = ['U12', 'U14', 'U16'] as const;
export type AgeDivision = (typeof AGE_DIVISIONS)[number];

/** What the API returns about a player. Internal columns (user_id, created_by) are never exposed. */
export interface PlayerDto {
  id: string;
  firstName: string;
  lastName: string;
  /** Calendar date, `YYYY-MM-DD` (no time zone). */
  dateOfBirth: string;
  email: string | null;
  phone: string | null;
  schoolId: string | null;
  /** Null only for a player registered before the division was asked for. */
  ageDivision: AgeDivision | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuardianDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  relationship: string;
  isPrimary: boolean;
}

export interface PlayerDetail extends PlayerDto {
  guardians: GuardianDto[];
}

export interface GuardianInput {
  relationship: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}
