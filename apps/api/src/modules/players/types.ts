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
