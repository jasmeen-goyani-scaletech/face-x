import type { AdminEvent } from './adminEvents';
import { DOCUMENT_LABELS } from './documentKinds';
import { PLAYER_DOCUMENTS, playerDocument } from './playerDocuments';
import type { CoachRegistration, PlayerRegistration, StaffRegistration, UploadedFile } from './types';

export type AuditTone = 'neutral' | 'success' | 'danger';

export interface AuditEvent {
  id: string;
  at: number;
  title: string;
  detail?: string;
  /** Who did it. */
  actor: 'Registrant' | 'Admin';
  tone: AuditTone;
}

const docName = (id?: string) => (id && DOCUMENT_LABELS[id]) || 'Document';

/** Admin actions recorded in the audit log. */
export function adminEventsToAudit(events: AdminEvent[]): AuditEvent[] {
  return events.map((e) => {
    const base = { id: e.id, at: e.at, actor: 'Admin' as const };
    switch (e.kind) {
      case 'document_approved':
        return { ...base, title: `${docName(e.documentId)} approved`, tone: 'success' as const };
      case 'document_rejected':
        return { ...base, title: `${docName(e.documentId)} rejected`, detail: e.detail, tone: 'danger' as const };
      case 'access_disabled':
        return { ...base, title: 'Event-day access disabled', tone: 'danger' as const };
      case 'access_enabled':
        return { ...base, title: 'Event-day access enabled', tone: 'success' as const };
      case 'registration_approved':
        return { ...base, title: 'Registration approved', tone: 'success' as const };
      default:
        return { ...base, title: 'Registration rejected', detail: e.detail, tone: 'danger' as const };
    }
  });
}

/** One "uploaded" moment per file that carries a timestamp. */
function uploadEvents(files: Record<string, UploadedFile | undefined>): AuditEvent[] {
  return Object.entries(files).flatMap(([id, f]) =>
    f?.uploaded && f.uploadedAt
      ? [{ id: `upload-${id}`, at: f.uploadedAt, title: `${docName(id)} uploaded`, detail: f.fileName || undefined, actor: 'Registrant' as const, tone: 'neutral' as const }]
      : []
  );
}

function submitted(at: number | null | undefined, title: string): AuditEvent[] {
  return at ? [{ id: 'submitted', at, title, actor: 'Registrant', tone: 'success' }] : [];
}

export function playerAuditEvents(reg: PlayerRegistration): AuditEvent[] {
  const docs: Record<string, UploadedFile | undefined> = { profilePhoto: reg.documents.profilePhoto };
  for (const d of PLAYER_DOCUMENTS) docs[d.id] = playerDocument(reg, d.id);
  return [
    ...submitted(reg.completedAt ?? reg.createdAt, 'Registration submitted'),
    ...uploadEvents(docs),
    ...(reg.consent.status === 'completed' && reg.consent.completedAt
      ? [{ id: 'consent', at: reg.consent.completedAt, title: 'Consent & liability waiver signed', detail: reg.consent.signedName ? `Signed by ${reg.consent.signedName}` : undefined, actor: 'Registrant' as const, tone: 'neutral' as const }]
      : []),
    ...(reg.payment.status === 'success' && reg.payment.paidAt
      ? [{ id: 'paid', at: reg.payment.paidAt, title: 'Payment received', detail: `$${reg.payment.amount.toFixed(2)}`, actor: 'Registrant' as const, tone: 'success' as const }]
      : [])
  ];
}

export function coachAuditEvents(reg: CoachRegistration): AuditEvent[] {
  return [
    ...submitted(reg.createdAt, 'Registration submitted'),
    ...uploadEvents({ livePhoto: reg.livePhoto, ...reg.certificates })
  ];
}

export function staffAuditEvents(reg: StaffRegistration): AuditEvent[] {
  return [
    ...submitted(reg.createdAt, 'Registration submitted'),
    ...uploadEvents({ livePhoto: reg.livePhoto, backgroundCheckRef: reg.backgroundCheckRef, safeSportUpload: reg.safeSportUpload })
  ];
}

/** Newest first. */
export function mergeAudit(...lists: AuditEvent[][]): AuditEvent[] {
  return lists.flat().sort((a, b) => b.at - a.at);
}
