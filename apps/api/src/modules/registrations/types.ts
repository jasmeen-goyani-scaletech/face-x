import type { AgeDivision, GuardianDto } from '../players/types';
import type { StaffProfileType, StaffRole } from '../staff/types';
import type { RegistrationStatus } from './transitions';

interface RegistrationBase {
  id: string;
  /** Human-readable id, e.g. FX-2026-00042. */
  registrationNumber: string;
  status: RegistrationStatus;
  /** Players only; always 0 for coach and staff. */
  guestCount: number;
  /** An admin switched this person's event-day access off. Check-in is refused while true, whatever the status. */
  eventAccessDisabled: boolean;
  /** Always 0 for coach and staff: they do not pay. */
  fee: { amountCents: number; currency: string };
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  event: { id: string; name: string; startsAt: string; timezone: string; status: string };
  team: { id: string; name: string; club: string; division: string } | null;
}

export interface PlayerRegistrationDto extends RegistrationBase {
  registrantType: 'PLAYER';
  player: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string | null;
    phone: string | null;
    schoolId: string | null;
    ageDivision: AgeDivision | null;
  };
  guardians: GuardianDto[];
}

/** A coach's or staff member's registration: the same shape, with their profile in place of a player. */
export interface PersonnelRegistrationDto extends RegistrationBase {
  registrantType: StaffProfileType;
  staffProfile: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    /** Set for STAFF, null for COACH. */
    staffRole: StaffRole | null;
  };
}

export type RegistrationDto = PlayerRegistrationDto | PersonnelRegistrationDto;

interface SummaryBase {
  id: string;
  registrationNumber: string;
  status: RegistrationStatus;
  submittedAt: string | null;
  createdAt: string;
  event: { id: string; name: string; startsAt: string };
  team: { id: string; name: string } | null;
}

export interface PlayerRegistrationSummary extends SummaryBase {
  registrantType: 'PLAYER';
  player: { id: string; firstName: string; lastName: string };
}

export interface PersonnelRegistrationSummary extends SummaryBase {
  registrantType: StaffProfileType;
  staffProfile: { id: string; firstName: string; lastName: string };
}

export type RegistrationSummary = PlayerRegistrationSummary | PersonnelRegistrationSummary;

export interface StatusHistoryEntry {
  from: RegistrationStatus | null;
  to: RegistrationStatus;
  at: string;
  reason: string | null;
  /** Who made the change: the system (e.g. a verified payment), the family, or event staff. */
  actor: 'SYSTEM' | 'FAMILY' | 'STAFF';
}

export interface RegistrationStatusDto {
  registrationId: string;
  status: RegistrationStatus;
  history: StatusHistoryEntry[];
}
