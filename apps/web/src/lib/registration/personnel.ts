import { DOCUMENT_LABELS } from '@/lib/documentKinds';
import {
  emptyFile,
  freshCoachRegistration,
  freshStaffRegistration,
  type CoachAdminStatus,
  type CoachRegistration,
  type StaffRegistration,
  type StaffRole,
  type TeamInvite,
  type UploadedFile
} from '@/lib/types';
import type { ApiConsentStatus, ApiDocument, ApiDocumentType, ApiPersonnelRegistration, ApiStaffProfile, ApiStaffProfileType, ApiStaffRole } from '@/lib/api/types';
import { KEY_BY_DOCUMENT_TYPE, newestPerType, toUploadedFile } from './documentMap';

/** The staff roles as the form words them, and as the API stores them. */
export const STAFF_ROLE_TO_API: Record<StaffRole, ApiStaffRole> = {
  'Team Manager': 'TEAM_MANAGER',
  'Athletic Trainer': 'ATHLETIC_TRAINER',
  'Equipment Manager': 'EQUIPMENT_MANAGER',
  'Safety Officer': 'SAFETY_OFFICER'
};
export const STAFF_ROLE_FROM_API: Record<ApiStaffRole, StaffRole> = {
  TEAM_MANAGER: 'Team Manager',
  ATHLETIC_TRAINER: 'Athletic Trainer',
  EQUIPMENT_MANAGER: 'Equipment Manager',
  SAFETY_OFFICER: 'Safety Officer'
};

/** The consent a coach accepts with the certificates (the AB 506 checkbox). Staff have none. */
export const AB506_CONSENT = 'AB506_ACKNOWLEDGEMENT';

/** Statuses in which an admin has approved the person (they may be at the event). */
const APPROVED: string[] = ['VERIFIED', 'READY_FOR_EVENT'];
/** Statuses in which the registration itself was turned down or withdrawn: nothing more can be uploaded. */
export const CLOSED: string[] = ['REJECTED', 'CANCELLED'];

export interface PersonnelView {
  adminStatus: CoachAdminStatus;
  rejectionReason: string;
}

/**
 * What the registrant should be told, from the server's registration and its newest document of each type.
 * Approved = an admin approved every required document. Rejected = the registration was turned down, or a document was
 * rejected and needs replacing (the reason the admin gave is passed on).
 */
export function viewOf(registration: ApiPersonnelRegistration, documents: ApiDocument[]): PersonnelView {
  if (APPROVED.includes(registration.status)) return { adminStatus: 'approved', rejectionReason: '' };
  if (CLOSED.includes(registration.status)) return { adminStatus: 'rejected', rejectionReason: 'This registration was not approved.' };
  // A rejection stays open until its replacement has been sent for review: a new file that is stored but not yet submitted
  // (state UPLOADED) does not make the registration "submitted", or the family would never be offered the Submit button.
  const open = newestPerType(documents).flatMap((d) => {
    if (d.state === 'REJECTED') return [d];
    if (d.state !== 'UPLOADED' && d.state !== 'AWAITING_UPLOAD') return [];
    const earlier = documents.filter((x) => x.documentType === d.documentType && x.state === 'REJECTED').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return earlier ? [earlier] : [];
  });
  const reasons = open
    .map((d) => {
      const label = DOCUMENT_LABELS[KEY_BY_DOCUMENT_TYPE[d.documentType]] ?? 'A document';
      const why = toUploadedFile(d).reason;
      return why ? `${label}: ${why}` : label;
    });
  return reasons.length > 0 ? { adminStatus: 'rejected', rejectionReason: reasons.join('; ') } : { adminStatus: 'pending', rejectionReason: '' };
}

/** Everything the browser-side copy of a registration is refreshed from after each server round trip. */
export interface MirrorInput<K extends string> {
  registration: ApiPersonnelRegistration;
  profile: ApiStaffProfile | null;
  /** The newest stored file of each document, without a browser preview (a preview cannot outlive the page). */
  files: Record<K, UploadedFile>;
  invite: TeamInvite | null;
  consents: ApiConsentStatus | null;
  view: PersonnelView;
}

/**
 * The per-kind pieces of coach and staff registration: where the browser keeps its copy, how a document in the form maps to an
 * API document type, and how server state is written into that copy. The copy (localStorage, as before) is what the rest of
 * the app reads (header, role hub, coach team page, demo admin screens); the server is the source of truth for this wizard.
 */
export interface PersonnelKindConfig<K extends string, R extends CoachRegistration | StaffRegistration> {
  kind: ApiStaffProfileType;
  storageKey: string;
  fresh: (invite: TeamInvite | null) => R;
  /** Document ids used by the form -> API document type. `livePhoto` is the camera capture. */
  documentTypes: Record<K, ApiDocumentType>;
  /** The staff role chosen in the form, if the kind has one. */
  staffRole: (reg: R) => ApiStaffRole | undefined;
  /** Form values from an existing server profile (used when a person comes back before having a registration). */
  fromProfile: (prev: R, profile: ApiStaffProfile) => R;
  /** Form values (the details being edited) from the server's registration. Applied when loading, never while typing. */
  fromRegistration: (prev: R, registration: ApiPersonnelRegistration) => R;
  /** Everything else the server decides (id, status, files, review outcome). Safe to apply on every render. */
  mirror: (prev: R, input: MirrorInput<K>) => R;
}

const common = <R extends CoachRegistration | StaffRegistration>(prev: R, i: MirrorInput<string>): R => ({
  ...prev,
  id: i.registration.registrationNumber,
  status: i.registration.status === 'DRAFT' ? 'draft' : 'submitted',
  createdAt: Date.parse(i.registration.createdAt),
  adminStatus: i.view.adminStatus,
  rejectionReason: i.view.rejectionReason,
  invite: i.invite ?? (prev.invite && prev.invite.teamId === i.registration.team?.id ? prev.invite : teamAsInvite(i.registration))
});

const basicOf = (p: ApiPersonnelRegistration['staffProfile']) => ({ firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone ?? '' });

/** A team the registration is attached to, in the shape the form uses for an invite (the code is not known after a reload). */
function teamAsInvite(registration: ApiPersonnelRegistration): TeamInvite | null {
  const t = registration.team;
  return t ? { teamId: t.id, inviteCode: '', teamName: t.name, club: t.club } : null;
}

export type CoachDocKey = 'livePhoto' | 'firstAidCpr' | 'yalfTackle' | 'backgroundCheckRef';
export type StaffDocKey = 'livePhoto' | 'backgroundCheckRef' | 'safeSportUpload';

export const COACH_CONFIG: PersonnelKindConfig<CoachDocKey, CoachRegistration> = {
  kind: 'COACH',
  storageKey: 'facex-coach-registration',
  fresh: freshCoachRegistration,
  documentTypes: { livePhoto: 'PROFILE_PHOTO', firstAidCpr: 'FIRST_AID_CPR', yalfTackle: 'YALF_TACKLE', backgroundCheckRef: 'BACKGROUND_CHECK' },
  staffRole: () => undefined,
  fromProfile: (prev, p) => ({ ...prev, basic: { firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone ?? '' } }),
  fromRegistration: (prev, r) => ({ ...prev, basic: basicOf(r.staffProfile) }),
  mirror: (prev, i) => ({
    ...common(prev, i),
    livePhoto: i.files.livePhoto,
    certificates: { firstAidCpr: i.files.firstAidCpr, yalfTackle: i.files.yalfTackle, backgroundCheckRef: i.files.backgroundCheckRef },
    ab506Acknowledged: i.consents?.requirements.find((r) => r.code === AB506_CONSENT)?.accepted === true || prev.ab506Acknowledged
  })
};

export const STAFF_CONFIG: PersonnelKindConfig<StaffDocKey, StaffRegistration> = {
  kind: 'STAFF',
  storageKey: 'facex-staff-registration',
  fresh: freshStaffRegistration,
  documentTypes: { livePhoto: 'PROFILE_PHOTO', backgroundCheckRef: 'BACKGROUND_CHECK', safeSportUpload: 'SAFESPORT' },
  staffRole: (reg) => (reg.role ? STAFF_ROLE_TO_API[reg.role] : undefined),
  fromProfile: (prev, p) => ({
    ...prev,
    basic: { firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone ?? '' },
    role: p.staffRole ? STAFF_ROLE_FROM_API[p.staffRole] : prev.role
  }),
  fromRegistration: (prev, r) => ({
    ...prev,
    basic: basicOf(r.staffProfile),
    role: r.staffProfile.staffRole ? STAFF_ROLE_FROM_API[r.staffProfile.staffRole] : prev.role
  }),
  mirror: (prev, i) => ({
    ...common(prev, i),
    livePhoto: i.files.livePhoto,
    backgroundCheckRef: i.files.backgroundCheckRef,
    safeSportUpload: i.files.safeSportUpload
  })
};

export const emptyFiles = <K extends string>(keys: K[]): Record<K, UploadedFile> => Object.fromEntries(keys.map((k) => [k, emptyFile()])) as Record<K, UploadedFile>;
