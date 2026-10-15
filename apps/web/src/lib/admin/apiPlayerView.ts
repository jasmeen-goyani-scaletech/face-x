import type { DetailSection } from '@/components/admin/AdminOverviewTab';
import type { PaymentState } from '@/components/admin/AccountStatusBar';
import type { RegistrationState } from '@/lib/accessCompliance';
import type { AuditEvent } from '@/lib/adminAudit';
import { calcAge } from '@/lib/age';
import { DOCUMENT_LABELS } from '@/lib/documentKinds';
import { formatDate, formatDateTime } from '@/lib/format';
import { PLAYER_DOCUMENTS } from '@/lib/playerDocuments';
import type {
  ApiBlocker,
  ApiConsentStatus,
  ApiDocument,
  ApiDocumentType,
  ApiPaymentSummary,
  ApiPersonnelRegistration,
  ApiRegistration,
  ApiRegistrationStatus,
  ApiStatusHistoryEntry
} from '@/lib/api/types';
import { DOCUMENT_TYPE_BY_KEY, KEY_BY_DOCUMENT_TYPE } from '@/lib/registration/documentMap';
import { STAFF_ROLE_FROM_API } from '@/lib/registration/personnel';

/** The statuses the API lets an admin reject from (see the registration status workflow). */
export const REJECTABLE: ApiRegistrationStatus[] = ['SUBMITTED', 'DOCUMENT_REVIEW', 'VERIFIED'];

export const STATUS_LABEL: Record<ApiRegistrationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PAYMENT_PENDING: 'Payment pending',
  PAYMENT_COMPLETED: 'Paid · documents due',
  DOCUMENT_REVIEW: 'Documents in review',
  VERIFIED: 'Verified',
  READY_FOR_EVENT: 'Ready for event',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled'
};

/** The header's "Registration" pill: approved once an admin has approved everything (VERIFIED or later). */
export function registrationState(status: ApiRegistrationStatus): RegistrationState {
  if (status === 'VERIFIED' || status === 'READY_FOR_EVENT') return 'approved';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'rejected';
  return 'pending';
}

/** `unavailable`: the payment lookup failed, so nothing is known (never shown as unpaid). */
export function paymentState(payment: ApiPaymentSummary | null, unavailable = false): PaymentState {
  if (unavailable) return 'unknown';
  if (!payment) return 'incomplete';
  if (payment.paymentStatus === 'PAID' || payment.amountDue.amountCents === 0) return 'complete';
  return payment.paymentStatus === 'FAILED' ? 'failed' : 'incomplete';
}

/** Open items beyond documents, worded like the existing compliance flags. Document and registration blockers are shown elsewhere. */
export function flagsFrom(blockers: ApiBlocker[], kind: 'PLAYER' | 'COACH' | 'STAFF' = 'PLAYER'): string[] {
  const out: string[] = [];
  if (blockers.includes('PAYMENT_NOT_COMPLETED')) out.push('Payment not completed');
  if (blockers.includes('CONSENT_NOT_ACCEPTED')) out.push(kind === 'COACH' ? 'AB 506 acknowledgement not accepted' : 'Guardian consent not accepted');
  return out;
}

/** A document the admin reviews: what the API calls it, what the screen calls it, and whether it is required. */
export interface ReviewRow {
  type: ApiDocumentType;
  /** The id the document has in the UI (drives its icon). */
  key: string;
  label: string;
  required: boolean;
}

const row = (type: ApiDocumentType, label: string, required: boolean): ReviewRow => ({ type, key: KEY_BY_DOCUMENT_TYPE[type], label, required });

/** The document rows an admin reviews for each kind of registration, in display order. */
export const REVIEW_ROWS_BY_KIND: Record<'PLAYER' | 'COACH' | 'STAFF', ReviewRow[]> = {
  PLAYER: [
    row('PROFILE_PHOTO', 'Face-X Identification Photo', true),
    ...PLAYER_DOCUMENTS.map((d) => row(DOCUMENT_TYPE_BY_KEY[d.id], d.label, d.required))
  ],
  COACH: [
    row('PROFILE_PHOTO', 'Live Coach Photo', true),
    row('FIRST_AID_CPR', 'First Aid / CPR Certificate', true),
    row('YALF_TACKLE', 'YALF Tackle Certificate', true),
    row('BACKGROUND_CHECK', 'Live Scan Background Check', true)
  ],
  STAFF: [
    row('PROFILE_PHOTO', 'Live Staff Photo', true),
    row('BACKGROUND_CHECK', 'Background-Check Reference / Proof', true),
    row('SAFESPORT', 'Safe-Sport Compliance Upload', false)
  ]
};

/** The newest document of a type (what the registrant currently has on file). */
export function documentFor(documents: ApiDocument[], type: ApiDocumentType): ApiDocument | undefined {
  return documents.filter((d) => d.documentType === type).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

/** The overview of a coach's or staff member's registration: who they are, and (coaches) the AB 506 acknowledgement. */
export function personnelSections(reg: ApiPersonnelRegistration, consents: ApiConsentStatus | null): DetailSection[] {
  const p = reg.staffProfile;
  const sections: DetailSection[] = [
    {
      title: 'Profile & account',
      items: [
        { label: 'Full name', value: fullName(p) },
        { label: 'Registration ID', value: reg.registrationNumber },
        { label: 'Event', value: reg.event.name },
        { label: 'Team', value: reg.team ? `${reg.team.name} · ${reg.team.club}` : 'No team assigned' },
        { label: 'Role', value: p.staffRole ? STAFF_ROLE_FROM_API[p.staffRole] : reg.registrantType === 'COACH' ? 'Coach' : 'Staff' },
        { label: 'Mobile', value: p.phone ?? '—' },
        { label: 'Email', value: p.email },
        { label: 'Submitted', value: reg.submittedAt ? formatDateTime(Date.parse(reg.submittedAt)) : 'Not submitted yet' }
      ]
    }
  ];
  if (reg.registrantType === 'COACH') {
    const record = consents?.records.find((r) => r.code === 'AB506_ACKNOWLEDGEMENT' && r.currentVersion) ?? consents?.records.find((r) => r.code === 'AB506_ACKNOWLEDGEMENT');
    sections.push({
      title: 'AB 506 acknowledgement',
      items: [
        { label: 'Acknowledged by', value: record?.signedName ?? 'Not acknowledged' },
        { label: 'Acknowledged', value: record ? formatDateTime(Date.parse(record.acceptedAt)) : '—' },
        ...(record ? [{ label: 'Wording version', value: `v${record.version}${record.currentVersion ? '' : ' (superseded)'}` }] : [])
      ]
    });
  }
  return sections;
}

export function overviewSections(reg: ApiRegistration, payment: ApiPaymentSummary | null, consents: ApiConsentStatus | null, paymentUnavailable = false): DetailSection[] {
  const age = calcAge(reg.player.dateOfBirth);
  const isMinor = age === null || age < 18;
  const sections: DetailSection[] = [
    {
      title: 'Profile & account',
      items: [
        { label: 'Full name', value: fullName(reg.player) },
        { label: 'Registration ID', value: reg.registrationNumber },
        { label: 'Event', value: reg.event.name },
        { label: 'Team', value: reg.team ? `${reg.team.name} · ${reg.team.club}` : 'No team assigned' },
        { label: 'Role', value: 'Player' },
        { label: 'Date of birth', value: formatDate(reg.player.dateOfBirth) },
        { label: 'Age · Division', value: `${age ?? '—'} · ${reg.player.ageDivision ?? reg.team?.division ?? '—'}` },
        { label: 'Mobile', value: reg.player.phone ?? '—' },
        { label: 'Email', value: reg.player.email ?? '—' },
        { label: 'Submitted', value: reg.submittedAt ? formatDateTime(Date.parse(reg.submittedAt)) : 'Not submitted yet' },
        { label: 'Guests attending', value: String(reg.guestCount) }
      ]
    }
  ];

  if (isMinor || reg.guardians.length > 0) {
    const g = reg.guardians.find((x) => x.isPrimary) ?? reg.guardians[0];
    const record = consents?.records.find((r) => r.code === 'GUARDIAN_CONSENT' && r.currentVersion) ?? consents?.records.find((r) => r.code === 'GUARDIAN_CONSENT');
    sections.push({
      title: 'Guardian & consent',
      items: [
        { label: 'Parent / guardian', value: g ? fullName(g) : '—' },
        { label: 'Relationship', value: g?.relationship ?? '—' },
        { label: 'Phone', value: g?.phone ?? '—' },
        { label: 'Email', value: g?.email ?? '—' },
        { label: 'Digital signature', value: record?.signedName ?? 'Not signed' },
        { label: 'Signed', value: record ? formatDateTime(Date.parse(record.acceptedAt)) : '—' },
        ...(record ? [{ label: 'Wording version', value: `v${record.version}${record.currentVersion ? '' : ' (superseded)'}` }] : [])
      ]
    });
  }

  const paidAt = payment?.payments.find((p) => p.status === 'PAID')?.paidAt ?? null;
  const failed = payment?.payments.find((p) => p.status === 'FAILED')?.failureReason;
  sections.push({
    title: 'Payment',
    items: [
      { label: 'Amount', value: money(payment?.amountDue.amountCents ?? reg.fee.amountCents) },
      { label: 'Status', value: paymentUnavailable ? 'unavailable (reload to retry)' : payment ? payment.paymentStatus.replace('_', ' ').toLowerCase() : 'not started' },
      { label: 'Paid', value: paidAt ? formatDateTime(Date.parse(paidAt)) : '—' },
      ...(failed ? [{ label: 'Failure reason', value: failed, wide: true }] : [])
    ],
    note: 'Card payments are taken by Stripe; card details and the transaction reference are not shown here.'
  });
  return sections;
}

const HISTORY_TITLE: Record<ApiRegistrationStatus, { title: string; tone: AuditEvent['tone'] }> = {
  DRAFT: { title: 'Registration started', tone: 'neutral' },
  SUBMITTED: { title: 'Registration submitted', tone: 'success' },
  PAYMENT_PENDING: { title: 'Payment started', tone: 'neutral' },
  PAYMENT_COMPLETED: { title: 'Payment received', tone: 'success' },
  DOCUMENT_REVIEW: { title: 'All required documents sent for review', tone: 'neutral' },
  VERIFIED: { title: 'All required documents approved', tone: 'success' },
  READY_FOR_EVENT: { title: 'Cleared for the event', tone: 'success' },
  REJECTED: { title: 'Registration rejected', tone: 'danger' },
  CANCELLED: { title: 'Registration cancelled', tone: 'danger' }
};
const ACTOR: Record<ApiStatusHistoryEntry['actor'], AuditEvent['actor']> = { SYSTEM: 'System', FAMILY: 'Registrant', STAFF: 'Admin' };

/** Everything that happened to this registration, newest first: status changes, uploads, decisions and the signed consent. */
export function auditEvents(history: ApiStatusHistoryEntry[], documents: ApiDocument[], consents: ApiConsentStatus | null): AuditEvent[] {
  const label = (d: ApiDocument) => DOCUMENT_LABELS[KEY_BY_DOCUMENT_TYPE[d.documentType]] ?? 'Document';
  const events: AuditEvent[] = [];

  history.forEach((h, i) => {
    const meta = HISTORY_TITLE[h.to];
    events.push({
      id: `status-${i}`,
      at: Date.parse(h.at),
      title: meta.title,
      detail: h.reason ? h.reason.replace(/^System:\s*/, '') : undefined,
      actor: ACTOR[h.actor],
      tone: meta.tone
    });
  });

  for (const d of documents) {
    const uploaded = ts(d.uploadedAt);
    if (uploaded) events.push({ id: `upload-${d.id}`, at: uploaded, title: `${label(d)} uploaded`, detail: d.fileName, actor: 'Registrant', tone: 'neutral' });
    const reviewed = ts(d.review?.reviewedAt);
    if (d.review && reviewed) {
      const approved = d.review.decision === 'APPROVED';
      events.push({
        id: `review-${d.id}`,
        at: reviewed,
        title: `${label(d)} ${approved ? 'approved' : 'rejected'}`,
        detail: approved ? undefined : d.review.reason ?? undefined,
        actor: 'Admin',
        tone: approved ? 'success' : 'danger'
      });
    }
  }

  for (const c of consents?.records ?? []) {
    const title = c.code === 'AB506_ACKNOWLEDGEMENT' ? 'AB 506 acknowledgement signed' : 'Consent & liability waiver signed';
    events.push({ id: `consent-${c.id}`, at: Date.parse(c.acceptedAt), title, detail: `Signed by ${c.signedName}`, actor: 'Registrant', tone: 'neutral' });
  }

  return events.sort((a, b) => b.at - a.at);
}
