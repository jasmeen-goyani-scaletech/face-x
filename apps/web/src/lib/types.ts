export type ReviewStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';

export interface UploadedFile {
  uploaded: boolean;
  fileName: string;
  dataUrl?: string;
  review: ReviewStatus;
  reason?: string;
  size?: number; // bytes, as uploaded
  uploadedAt?: number; // epoch ms
}

export function emptyFile(): UploadedFile {
  return { uploaded: false, fileName: '', review: 'not_submitted' };
}

export type Division = 'U10' | 'U12' | 'U14' | 'U16' | 'U18';

export type RegistrationStatus = 'not_started' | 'draft' | 'submitted';

export interface ConsentInfo {
  required: boolean; // true when player is a minor
  method: 'inline' | 'link' | null;
  status: 'not_started' | 'sent' | 'completed';
  signedName: string;
  agree: boolean;
  sentAt: number | null;
  completedAt: number | null;
}

export function emptyConsent(required: boolean): ConsentInfo {
  return {
    required,
    method: null,
    status: 'not_started',
    signedName: '',
    agree: false,
    sentAt: null,
    completedAt: null
  };
}

export interface PaymentInfo {
  status: 'not_started' | 'processing' | 'success' | 'failed' | 'interrupted';
  amount: number;
  failReason: string;
  paidAt: number | null;
}

export function emptyPayment(amount: number): PaymentInfo {
  return { status: 'not_started', amount, failReason: '', paidAt: null };
}

export interface TeamInvite {
  teamId: string;
  inviteCode: string;
  teamName: string;
  club: string;
}

export interface PlayerBasic {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string; // yyyy-mm-dd
}

/** The one place guardian details live (key kept as `emergency` so saved drafts still load). */
export interface EmergencyContact {
  guardianName: string;
  relationship: string;
  guardianPhone: string;
  guardianEmail: string;
  /** Family members / guests attending alongside the player. Absent on drafts saved before this existed. */
  guestCount?: number;
}

export interface PlayerDocuments {
  profilePhoto: UploadedFile; // FaceScan identification selfie — camera capture only
  birthCertificate: UploadedFile; // required
  // Optional supporting documents. Registrations saved before these existed lack them — read via playerDocument().
  schoolId: UploadedFile;
  schoolTranscript: UploadedFile;
  californiaKidId: UploadedFile;
}

export interface PlayerRegistration {
  id: string | null;
  status: RegistrationStatus;
  createdAt: number | null;
  completedAt: number | null;
  basic: PlayerBasic;
  emergency: EmergencyContact;
  invite: TeamInvite | null;
  teamId: string;
  documents: PlayerDocuments;
  consent: ConsentInfo;
  payment: PaymentInfo;
  step: PlayerStep;
}

export type PlayerStep =
  | 'role'
  | 'basic'
  | 'documents'
  | 'guardianConsent'
  | 'payment'
  | 'complete';

export const REGISTRATION_FEE = 95;

export function freshPlayerRegistration(invite: TeamInvite | null): PlayerRegistration {
  return {
    id: null,
    status: 'not_started',
    createdAt: null,
    completedAt: null,
    basic: { firstName: '', lastName: '', email: '', phone: '', dob: '' },
    emergency: {
      guardianName: '',
      relationship: '',
      guardianPhone: '',
      guardianEmail: '',
      guestCount: 0
    },
    invite,
    teamId: invite?.teamId ?? '',
    documents: {
      profilePhoto: emptyFile(),
      birthCertificate: emptyFile(),
      schoolId: emptyFile(),
      schoolTranscript: emptyFile(),
      californiaKidId: emptyFile()
    },
    consent: emptyConsent(true),
    payment: emptyPayment(REGISTRATION_FEE),
    step: 'basic'
  };
}

// ---------------- Coach ----------------

export interface CoachCertificates {
  firstAidCpr: UploadedFile;
  yalfTackle: UploadedFile;
  backgroundCheckRef: UploadedFile;
}

export interface CoachTeam {
  teamId: string;
  teamName: string;
  club: string;
  inviteCode: string;
}

export type CoachAdminStatus = 'pending' | 'approved' | 'rejected';
export type CoachStep = 'basic' | 'certificates' | 'status';

export interface CoachRegistration {
  id: string | null;
  status: RegistrationStatus;
  createdAt: number | null;
  basic: { firstName: string; lastName: string; email: string; phone: string };
  /** Live selfie (camera capture only). Absent on registrations saved before coaches had a photo step. */
  livePhoto?: UploadedFile;
  certificates: CoachCertificates;
  ab506Acknowledged: boolean;
  adminStatus: CoachAdminStatus;
  rejectionReason: string;
  invite: TeamInvite | null; // the tournament team this coach registered under, via a team-specific link
  team: CoachTeam | null; // a team this coach creates post-approval, for players to join
  step: CoachStep;
}

export function freshCoachRegistration(invite: TeamInvite | null = null): CoachRegistration {
  return {
    id: null,
    status: 'not_started',
    createdAt: null,
    basic: { firstName: '', lastName: '', email: '', phone: '' },
    livePhoto: emptyFile(),
    certificates: {
      firstAidCpr: emptyFile(),
      yalfTackle: emptyFile(),
      backgroundCheckRef: emptyFile()
    },
    ab506Acknowledged: false,
    adminStatus: 'pending',
    rejectionReason: '',
    invite,
    team: null,
    step: 'basic'
  };
}

// ---------------- Staff ----------------

export type StaffRole = 'Team Manager' | 'Athletic Trainer' | 'Equipment Manager' | 'Safety Officer';

export const STAFF_ROLES: StaffRole[] = ['Team Manager', 'Athletic Trainer', 'Equipment Manager', 'Safety Officer'];

export type StaffStep = 'basic' | 'proof' | 'status';

export interface StaffRegistration {
  id: string | null;
  status: RegistrationStatus;
  createdAt: number | null;
  basic: { firstName: string; lastName: string; email: string; phone: string };
  role: StaffRole | null;
  invite: TeamInvite | null; // the tournament team this staff member registered under, via a team-specific link
  livePhoto: UploadedFile; // camera capture only
  backgroundCheckRef: UploadedFile;
  safeSportUpload: UploadedFile;
  adminStatus: CoachAdminStatus;
  rejectionReason: string;
  step: StaffStep;
}

export function freshStaffRegistration(invite: TeamInvite | null = null): StaffRegistration {
  return {
    id: null,
    status: 'not_started',
    createdAt: null,
    basic: { firstName: '', lastName: '', email: '', phone: '' },
    role: null,
    invite,
    livePhoto: emptyFile(),
    backgroundCheckRef: emptyFile(),
    safeSportUpload: emptyFile(),
    adminStatus: 'pending',
    rejectionReason: '',
    step: 'basic'
  };
}
