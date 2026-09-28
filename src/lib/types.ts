export type ReviewStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';

export interface UploadedFile {
  uploaded: boolean;
  fileName: string;
  dataUrl?: string;
  review: ReviewStatus;
  reason?: string;
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
  guardianName: string;
  relationship: string;
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
    guardianName: '',
    relationship: '',
    signedName: '',
    agree: false,
    sentAt: null,
    completedAt: null
  };
}

export interface PaymentInfo {
  status: 'not_started' | 'processing' | 'success' | 'failed' | 'interrupted';
  amount: number;
  cardLast4: string;
  failReason: string;
  paidAt: number | null;
}

export function emptyPayment(amount: number): PaymentInfo {
  return { status: 'not_started', amount, cardLast4: '', failReason: '', paidAt: null };
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

export interface EmergencyContact {
  guardianName: string;
  relationship: string;
  guardianPhone: string;
  guardianEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

export interface PlayerDocuments {
  profilePhoto: UploadedFile; // FaceScan identification selfie — camera capture only
  birthCertificateOrPassport: UploadedFile;
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
  | 'emergency'
  | 'documents'
  | 'consent'
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
      emergencyContactName: '',
      emergencyContactPhone: ''
    },
    invite,
    teamId: invite?.teamId ?? '',
    documents: { profilePhoto: emptyFile(), birthCertificateOrPassport: emptyFile() },
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
  certificates: CoachCertificates;
  ab506Acknowledged: boolean;
  adminStatus: CoachAdminStatus;
  rejectionReason: string;
  team: CoachTeam | null;
  step: CoachStep;
}

export function freshCoachRegistration(): CoachRegistration {
  return {
    id: null,
    status: 'not_started',
    createdAt: null,
    basic: { firstName: '', lastName: '', email: '', phone: '' },
    certificates: {
      firstAidCpr: emptyFile(),
      yalfTackle: emptyFile(),
      backgroundCheckRef: emptyFile()
    },
    ab506Acknowledged: false,
    adminStatus: 'pending',
    rejectionReason: '',
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
  clubAffiliation: string;
  livePhoto: UploadedFile; // camera capture only
  backgroundCheckRef: UploadedFile;
  safeSportUpload: UploadedFile;
  adminStatus: CoachAdminStatus;
  rejectionReason: string;
  step: StaffStep;
}

export function freshStaffRegistration(): StaffRegistration {
  return {
    id: null,
    status: 'not_started',
    createdAt: null,
    basic: { firstName: '', lastName: '', email: '', phone: '' },
    role: null,
    clubAffiliation: '',
    livePhoto: emptyFile(),
    backgroundCheckRef: emptyFile(),
    safeSportUpload: emptyFile(),
    adminStatus: 'pending',
    rejectionReason: '',
    step: 'basic'
  };
}
