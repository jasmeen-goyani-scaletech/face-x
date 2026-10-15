/**
 * Request and response shapes of the Face-X API (apps/api). The API is a separate package with its own build, so
 * these are kept in step with its DTOs by hand: when a DTO changes there, change it here.
 */

// ---------------- Envelope ----------------

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: ApiErrorDetail[] };
}

// ---------------- Auth ----------------

export type Role = 'ADMIN' | 'COACH' | 'STAFF' | 'PARENT' | 'PLAYER';
export type SelfAssignableRole = 'PARENT' | 'PLAYER' | 'COACH' | 'STAFF';

export interface ApiUser {
  id: string;
  email: string;
  fullName: string | null;
  organizationId: string | null;
  roles: Role[];
}

export interface SessionResponse {
  tokenType: 'Bearer';
  accessToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: ApiUser;
}

// ---------------- Events and teams ----------------

export interface ApiEvent {
  id: string;
  name: string;
  description: string | null;
  location: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  fee: { amountCents: number; currency: string };
  status: 'PUBLISHED' | 'CLOSED';
  registrationOpen: boolean;
}

export interface ApiTeam {
  id: string;
  eventId: string;
  name: string;
  club: string;
  division: string;
  /** Whether the team has reached its registration limit for each kind of registrant. */
  full: { player: boolean; coach: boolean; staff: boolean };
}

export interface ApiTeamWithEvent {
  team: ApiTeam;
  event: ApiEvent;
}

// ---------------- Players ----------------

export interface ApiGuardian {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  relationship: string;
  isPrimary: boolean;
}

export interface ApiPlayer {
  id: string;
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD` */
  dateOfBirth: string;
  email: string | null;
  phone: string | null;
  schoolId: string | null;
  /** Null only for a player registered before the division was asked for. */
  ageDivision: ApiAgeDivision | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPlayerDetail extends ApiPlayer {
  guardians: ApiGuardian[];
}

/** The brackets a player may be registered in. */
export const AGE_DIVISIONS = ['U12', 'U14', 'U16'] as const;
export type ApiAgeDivision = (typeof AGE_DIVISIONS)[number];

export interface CreatePlayerInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email?: string;
  phone?: string;
  /** true: the signed-in account IS the player (PLAYER role). Otherwise a child registered by a PARENT. */
  forSelf?: boolean;
  guardian?: { relationship: string; firstName?: string; lastName?: string; phone?: string };
}

export type UpdatePlayerInput = Partial<{
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  ageDivision: ApiAgeDivision;
  email: string | null;
  phone: string | null;
}>;

// ---------------- Coach and staff profiles ----------------

export type ApiStaffProfileType = 'COACH' | 'STAFF';
export type ApiStaffRole = 'TEAM_MANAGER' | 'ATHLETIC_TRAINER' | 'EQUIPMENT_MANAGER' | 'SAFETY_OFFICER';

export interface ApiStaffProfile {
  id: string;
  profileType: ApiStaffProfileType;
  /** Set for STAFF, null for COACH. */
  staffRole: ApiStaffRole | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffProfileInput {
  profileType: ApiStaffProfileType;
  staffRole?: ApiStaffRole;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

export type UpdateStaffProfileInput = Partial<{
  staffRole: ApiStaffRole;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}>;

// ---------------- Registrations ----------------

export type ApiRegistrationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_COMPLETED'
  | 'DOCUMENT_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'READY_FOR_EVENT'
  | 'CANCELLED';

export interface ApiRegistration {
  id: string;
  registrationNumber: string;
  status: ApiRegistrationStatus;
  registrantType: 'PLAYER';
  guestCount: number;
  /** An admin switched this person's event-day access off. */
  eventAccessDisabled: boolean;
  fee: { amountCents: number; currency: string };
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  event: { id: string; name: string; startsAt: string; timezone: string; status: string };
  team: { id: string; name: string; club: string; division: string } | null;
  player: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string | null;
    phone: string | null;
    schoolId: string | null;
    ageDivision: ApiAgeDivision | null;
  };
  guardians: ApiGuardian[];
}

/** A coach's or staff member's registration: the same shape as a player's, with their profile in place of the player. */
export interface ApiPersonnelRegistration extends Omit<ApiRegistration, 'registrantType' | 'player' | 'guardians'> {
  registrantType: ApiStaffProfileType;
  staffProfile: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    staffRole: ApiStaffRole | null;
  };
}

export interface ApiStatusHistoryEntry {
  from: ApiRegistrationStatus | null;
  to: ApiRegistrationStatus;
  at: string;
  /** Why: set by an admin's rejection, or by the system ("System: ..."). */
  reason: string | null;
  actor: 'SYSTEM' | 'FAMILY' | 'STAFF';
}

export interface ApiRegistrationStatusDto {
  registrationId: string;
  status: ApiRegistrationStatus;
  history: ApiStatusHistoryEntry[];
}

export interface ApiRegistrationSummary {
  /** Absent on responses from before coaches and staff could register; the list without a type filter is players only. */
  registrantType?: 'PLAYER';
  id: string;
  registrationNumber: string;
  status: ApiRegistrationStatus;
  submittedAt: string | null;
  createdAt: string;
  event: { id: string; name: string; startsAt: string };
  team: { id: string; name: string } | null;
  player: { id: string; firstName: string; lastName: string };
}

export interface ApiPersonnelRegistrationSummary extends Omit<ApiRegistrationSummary, 'player' | 'registrantType'> {
  registrantType: ApiStaffProfileType;
  staffProfile: { id: string; firstName: string; lastName: string };
}

export interface CreateRegistrationInput {
  eventId: string;
  playerId: string;
  teamId?: string;
  guestCount?: number;
}

export interface CreatePersonnelRegistrationInput {
  eventId: string;
  staffProfileId: string;
  teamId?: string;
}

export interface UpdateRegistrationInput {
  teamId?: string | null;
  guestCount?: number;
}

// ---------------- Documents ----------------

/** PROFILE_PHOTO is shared by player, coach and staff registrations; the rest belong to one kind each. */
export const API_PLAYER_DOCUMENT_TYPES = ['PROFILE_PHOTO', 'BIRTH_CERTIFICATE', 'SCHOOL_ID', 'SCHOOL_TRANSCRIPT', 'CALIFORNIA_KID_ID'] as const;
export type ApiPlayerDocumentType = (typeof API_PLAYER_DOCUMENT_TYPES)[number];
export const API_PERSONNEL_DOCUMENT_TYPES = ['FIRST_AID_CPR', 'YALF_TACKLE', 'BACKGROUND_CHECK', 'SAFESPORT'] as const;
export type ApiPersonnelDocumentType = (typeof API_PERSONNEL_DOCUMENT_TYPES)[number];
export type ApiDocumentType = ApiPlayerDocumentType | ApiPersonnelDocumentType;

export type ApiDocumentState = 'AWAITING_UPLOAD' | 'UPLOADED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface ApiDocument {
  id: string;
  registrationId: string;
  documentType: ApiDocumentType;
  /** Only on the answer to confirming a profile photo's upload: what happened to its face enrollment. */
  faceEnrollment?: { outcome: 'ENROLLED' | 'SKIPPED' | 'FAILED'; problem?: string };
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  state: ApiDocumentState;
  uploadedAt: string | null;
  submittedAt: string | null;
  /** The AI check turned this document down twice and the family sent it on anyway. Only the reviewer is told. */
  aiRejected: boolean;
  review: {
    decision: 'APPROVED' | 'REJECTED';
    reasonCode: 'UNREADABLE' | 'WRONG_TYPE' | 'NAME_MISMATCH' | 'EXPIRED' | 'CUSTOM' | null;
    reason: string | null;
    reviewedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiDocumentCompleteness {
  required: { documentType: ApiDocumentType; state: 'MISSING' | ApiDocumentState }[];
  allRequiredApproved: boolean;
}

export interface ApiDocumentList {
  documents: ApiDocument[];
  completeness: ApiDocumentCompleteness;
}

export interface ApiUploadInstructions {
  url: string;
  method: 'PUT';
  /** Headers the browser must send unchanged. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface RequestUploadInput {
  documentType: ApiDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

// ---------------- Consent ----------------

export interface ApiConsentVersion {
  id: string;
  code: string;
  version: number;
  title: string;
  body: string;
  effectiveAt: string;
}

export interface ApiConsentRequirement {
  code: string;
  required: boolean;
  /** Null until the league has published the wording. */
  current: ApiConsentVersion | null;
  accepted: boolean;
}

export interface ApiConsentRecord {
  id: string;
  consentId: string;
  code: string;
  version: number;
  acceptedAt: string;
  signedName: string;
  signedBy: 'GUARDIAN' | 'PLAYER' | 'SELF';
  currentVersion: boolean;
}

export interface ApiConsentStatus {
  registrationId: string;
  requirements: ApiConsentRequirement[];
  records: ApiConsentRecord[];
}

export interface RecordConsentInput {
  consentId: string;
  signedName: string;
  accepted: true;
}

// ---------------- Payment ----------------

export type ApiPaymentStatus = 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface ApiPayment {
  id: string;
  status: ApiPaymentStatus;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  checkoutExpiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPaymentSummary {
  registrationId: string;
  amountDue: { amountCents: number; currency: string };
  paymentStatus: 'NOT_STARTED' | ApiPaymentStatus;
  canStartCheckout: boolean;
  payments: ApiPayment[];
}

export interface ApiCheckout {
  paymentId: string;
  checkoutUrl: string;
  expiresAt: string;
}

// ---------------- Readiness ----------------

export type ApiBlocker =
  | 'REGISTRATION_NOT_SUBMITTED'
  | 'REGISTRATION_CANCELLED'
  | 'REGISTRATION_REJECTED'
  | 'PAYMENT_NOT_COMPLETED'
  | 'DOCUMENTS_NOT_SUBMITTED'
  | 'DOCUMENTS_NOT_APPROVED'
  | 'CONSENT_NOT_ACCEPTED';

export interface ApiReadinessReport {
  registrationId: string;
  status: ApiRegistrationStatus;
  ready: boolean;
  blockers: ApiBlocker[];
  payment: { required: boolean; satisfied: boolean };
  documents: ApiDocumentCompleteness & { submitted: boolean };
  consent: {
    satisfied: boolean;
    requirements: { code: string; required: boolean; accepted: boolean }[];
  };
}

export interface ApiEvaluationResult {
  previousStatus: ApiRegistrationStatus;
  steps: { from: ApiRegistrationStatus; to: ApiRegistrationStatus; reason: string }[];
  readiness: ApiReadinessReport;
}

// ---------------- Coach team ----------------

export interface ApiCoachTeam {
  id: string;
  name: string;
  club: string;
  division: string;
  /** The code players and staff use (with the team id) to register straight onto this team. */
  inviteCode: string;
  status: ApiTeamStatus;
}

export interface ApiCoachTeamView {
  registrationId: string;
  registrationStatus: ApiRegistrationStatus;
  eventAccessDisabled: boolean;
  event: { id: string; name: string; startsAt: string; endsAt: string; timezone: string };
  team: ApiCoachTeam | null;
  /** The coach is approved and has no team yet. */
  canCreateTeam: boolean;
  /** The coach is cleared for the event, so the team's roster is open to them. */
  rosterOpen: boolean;
}

export interface ApiTeamMember {
  registrationId: string;
  registrationNumber: string;
  registrantType: 'PLAYER' | 'STAFF';
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  approved: boolean;
  eventAccessDisabled: boolean;
  flags: string[];
  checkedInAt: string | null;
}

export interface CreateCoachTeamInput {
  name: string;
  club?: string;
  division?: string;
}

// ---------------- Admin ----------------

export type ApiEventStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

export interface ApiAdminEvent {
  id: string;
  name: string;
  description: string | null;
  location: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  /** What a player pays to register. Coaches and staff never pay. */
  fee: { amountCents: number; currency: string };
  status: ApiEventStatus;
}

export interface CreateEventInput {
  name: string;
  description?: string | null;
  location: string;
  timezone: string;
  /** ISO 8601 with an offset, e.g. 2026-11-14T17:30:00-08:00 */
  startsAt: string;
  endsAt: string;
  feeCents?: number;
  status?: ApiEventStatus;
}

export type UpdateEventInput = Partial<CreateEventInput>;

export type ApiTeamStatus = 'ACTIVE' | 'DISABLED';

/** A team as an admin sees it: with the invite code a coach joins by, and how many people are on it. */
export interface ApiAdminTeam {
  id: string;
  eventId: string;
  name: string;
  club: string;
  division: string;
  inviteCode: string;
  status: ApiTeamStatus;
  registrations: { players: number; coaches: number; staff: number };
  /** Registration limits per kind; `max` null = unlimited. `used` counts registrations holding a place (not draft, cancelled or rejected). */
  limits: { players: ApiTeamLimit; coaches: ApiTeamLimit; staff: ApiTeamLimit };
}

export interface ApiTeamLimit {
  max: number | null;
  used: number;
}

/** A team a coach or staff member was assigned to by an admin. */
export interface ApiTeamAssignment {
  teamId: string;
  name: string;
  club: string;
  division: string;
  status: ApiTeamStatus;
  assignedAt: string;
}

/** A team the signed-in coach / staff member may work with (GET /me/teams). */
export interface ApiAccessibleTeam {
  id: string;
  name: string;
  club: string;
  division: string;
  status: ApiTeamStatus;
  event: { id: string; name: string; startsAt: string; endsAt: string; timezone: string };
  via: 'ADMIN' | 'COACH' | 'STAFF';
  limits: { players: ApiTeamLimit; coaches: ApiTeamLimit; staff: ApiTeamLimit };
  /** Null for staff: only coaches and admins see how people join the team. */
  inviteCode: string | null;
}

export interface CreateTeamInput {
  name: string;
  club?: string;
  division: string;
}

/** A positive whole number sets a registration limit, null removes it (unlimited), leaving it out keeps it as it is. */
export type UpdateTeamInput = Partial<
  CreateTeamInput & { status: ApiTeamStatus; maxPlayers: number | null; maxCoaches: number | null; maxStaff: number | null }
>;

export interface ApiPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  /** Every matching row, across all pages. */
  total: number;
}

interface ApiAdminRowBase {
  id: string;
  registrationNumber: string;
  status: ApiRegistrationStatus;
  submittedAt: string | null;
  createdAt: string;
  team: { id: string; name: string } | null;
  documents: { inReview: number; approved: number; rejected: number; notSubmitted: number; aiRejected: number };
  eventAccessDisabled: boolean;
}

export interface ApiAdminPlayerRow extends ApiAdminRowBase {
  registrantType: 'PLAYER';
  player: { id: string; firstName: string; lastName: string; dateOfBirth: string; ageDivision: ApiAgeDivision | null };
  paymentStatus: 'NOT_STARTED' | ApiPaymentStatus;
}

export interface ApiAdminPersonnelRow extends ApiAdminRowBase {
  registrantType: ApiStaffProfileType;
  staffProfile: { id: string; firstName: string; lastName: string; email: string; phone: string | null; staffRole: ApiStaffRole | null };
}

export type ApiAdminRegistrationRow = ApiAdminPlayerRow | ApiAdminPersonnelRow;

/** One person on an event's day-of roster, with everything the door needs to clear and check them in. */
export interface ApiRosterEntry {
  registrationId: string;
  registrationNumber: string;
  registrantType: 'PLAYER' | ApiStaffProfileType;
  firstName: string;
  lastName: string;
  /** Players only, `YYYY-MM-DD`. */
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  team: { id: string; name: string; division: string } | null;
  status: ApiRegistrationStatus;
  /** READY_FOR_EVENT: the only status check-in accepts. */
  approved: boolean;
  eventAccessDisabled: boolean;
  paymentComplete: boolean;
  flags: string[];
  /** Ask `GET /documents/:id/download-url` for a link to view the photo. */
  photoDocumentId: string | null;
  checkedInAt: string | null;
  checkedInMethod: 'FACE' | 'MANUAL' | null;
}

export interface ApiCheckIn {
  checkInId: string;
  registrationId: string;
  registrationNumber: string;
  method: 'FACE' | 'MANUAL';
  checkedInAt: string;
}

/** A person a face scan could not settle alone: shown to staff, who confirm by comparing the on-file photo. */
export interface ApiFaceScanCandidate {
  registrationId: string;
  registrationNumber: string;
  /** A player, a coach or a staff member: all three are matched by face. */
  registrantType: 'PLAYER' | 'COACH' | 'STAFF';
  displayName: string;
}

/** What the server says about one photo of someone at the door. */
export type ApiFaceScan = (
  | { scanId: string; result: 'NO_MATCH' }
  | { scanId: string; result: 'REVIEW_REQUIRED'; reason: string; candidates: ApiFaceScanCandidate[]; eligibility?: string[] }
  | {
      scanId: string;
      result: 'MATCH';
      /** The scan can be used to check in until this time. */
      expiresAt: string;
      registration: {
        registrationId: string;
        registrationNumber: string;
        registrantType: 'PLAYER' | 'COACH' | 'STAFF';
        firstName: string;
        lastName: string;
      };
      alreadyCheckedIn: boolean;
    }
) & {
  /** The camera frame this scan was decided on, as a short-lived signed link. Absent when no frame was kept. */
  scanImageUrl?: string;
};

export interface ApiEventSummary {
  eventId: string;
  registrationsByStatus: Record<ApiRegistrationStatus, number>;
  documentsAwaitingReview: number;
  payments: { paidCount: number; paidAmountCents: number; refundedCount: number };
  eventAccessDisabled: number;
}

export type ApiRejectionReasonCode = 'UNREADABLE' | 'WRONG_TYPE' | 'NAME_MISMATCH' | 'EXPIRED' | 'CUSTOM';

export interface ListAdminRegistrationsQuery {
  /** A registration status, or FLAGGED: a document the AI check turned down or an admin rejected. */
  status?: ApiRegistrationStatus | 'FLAGGED';
  /** Only registrations with a document the AI check turned down. */
  aiRejected?: boolean;
  /** Only registrations whose event-day access an admin switched off. */
  eventAccessDisabled?: boolean;
  teamId?: string;
  search?: string;
  documentsPending?: boolean;
  page?: number;
  pageSize?: number;
  /** Whose registrations: players unless COACH or STAFF is asked for. */
  registrantType?: 'PLAYER' | ApiStaffProfileType;
}

/** A one-time sign-in link an admin hands to a coach or staff member. The token is shown once. */
export interface ApiSignInLink {
  token: string;
  expiresAt: string;
}
