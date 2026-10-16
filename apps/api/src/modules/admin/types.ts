import type { RegistrantType, RegistrationStatus } from '../registrations/transitions';
import type { StaffRole } from '../staff/types';

/** An event the admin's organization runs, in any status (families only ever see PUBLISHED ones). */
export interface AdminEvent {
  id: string;
  name: string;
  description: string | null;
  location: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  /** What a player pays to register. Coaches and staff never pay. */
  fee: { amountCents: number; currency: string };
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
}

/** A team of an event, with the invite code only an admin may see (it lets a coach join the team). */
export interface AdminTeam {
  id: string;
  eventId: string;
  name: string;
  club: string;
  division: string;
  inviteCode: string;
  status: 'ACTIVE' | 'DISABLED';
  /** Registrations (any status except draft / cancelled) attached to the team, by kind. */
  registrations: { players: number; coaches: number; staff: number };
  /**
   * Registration limits per kind (null max = unlimited, the default). `used` counts the registrations that hold a place:
   * every status except draft, cancelled and rejected. A limit below `used` blocks new registrations only.
   */
  limits: { players: TeamLimit; coaches: TeamLimit; staff: TeamLimit };
}

export interface TeamLimit {
  max: number | null;
  used: number;
}

/** A team a coach or staff member has been assigned to. */
export interface TeamAssignment {
  teamId: string;
  name: string;
  club: string;
  division: string;
  status: 'ACTIVE' | 'DISABLED';
  assignedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  /** All matching rows, across every page. */
  total: number;
}

/** The counts of an admin list row's documents: newest version per type. */
export interface AdminDocumentCounts {
  /** Submitted and waiting for a decision. */
  inReview: number;
  approved: number;
  rejected: number;
  /** Uploaded by the registrant but not yet sent for review. */
  notSubmitted: number;
  /** Documents the AI check turned down twice before the registrant sent them on: look at these by eye. */
  aiRejected: number;
}

/** What an admin sees for one player registration in a list. Documents are counted by their newest version per type. */
export interface AdminPlayerRow {
  registrantType: 'PLAYER';
  id: string;
  registrationNumber: string;
  status: RegistrationStatus;
  submittedAt: string | null;
  createdAt: string;
  player: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    ageDivision: 'U12' | 'U14' | 'U16' | null;
  };
  team: { id: string; name: string } | null;
  /** NOT_STARTED when no payment attempt exists. */
  paymentStatus: 'NOT_STARTED' | 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  documents: AdminDocumentCounts;
  eventAccessDisabled: boolean;
}

/** The same row for a coach or staff member: their profile in place of the player, and no payment. */
export interface AdminPersonnelRow {
  registrantType: Exclude<RegistrantType, 'PLAYER'>;
  id: string;
  registrationNumber: string;
  status: RegistrationStatus;
  submittedAt: string | null;
  createdAt: string;
  staffProfile: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    staffRole: StaffRole | null;
  };
  team: { id: string; name: string } | null;
  documents: AdminDocumentCounts;
  eventAccessDisabled: boolean;
}

export type AdminRegistrationRow = AdminPlayerRow | AdminPersonnelRow;

/**
 * One person on an event's day-of roster: everything the door needs to identify, clear and check someone in. Built from the
 * registration's own state, so it can never disagree with what check-in itself will decide.
 */
export interface EventRosterEntry {
  registrationId: string;
  registrationNumber: string;
  registrantType: RegistrantType;
  firstName: string;
  lastName: string;
  /** Players only (`YYYY-MM-DD`). */
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  /** A minor player's primary guardian. */
  guardianName: string | null;
  guardianPhone: string | null;
  team: { id: string; name: string; division: string } | null;
  status: RegistrationStatus;
  /** READY_FOR_EVENT: the only status check-in accepts. */
  approved: boolean;
  eventAccessDisabled: boolean;
  paymentComplete: boolean;
  /** Open problems in plain words (what still blocks this person), empty when nothing does. */
  flags: string[];
  /** The newest profile photo, when one has been uploaded: ask `GET /documents/:id/download-url` for a viewing link. */
  photoDocumentId: string | null;
  checkedInAt: string | null;
  checkedInMethod: 'FACE' | 'MANUAL' | null;
}

export interface ReviewQueueItem {
  documentId: string;
  documentType: string;
  fileName: string;
  submittedAt: string;
  registration: { id: string; registrationNumber: string; status: RegistrationStatus };
  player: { id: string; firstName: string; lastName: string };
  team: { id: string; name: string } | null;
}

export interface EventSummary {
  eventId: string;
  /** Player registrations by status (every status appears, with 0 when empty). */
  registrationsByStatus: Record<RegistrationStatus, number>;
  documentsAwaitingReview: number;
  payments: { paidCount: number; paidAmountCents: number; refundedCount: number };
  eventAccessDisabled: number;
}

export interface EventAccessState {
  id: string;
  registrationNumber: string;
  eventAccessDisabled: boolean;
  /** Why it was switched off (admin-only note); null when enabled or when no reason was given. */
  eventAccessDisabledReason: string | null;
}

export interface RejectedRegistration {
  id: string;
  registrationNumber: string;
  status: 'REJECTED';
}
