/**
 * Document verification decisions and the notifications they trigger.
 *
 * This app has no backend, so nothing here can actually deliver a push or email. Every decision goes
 * through `submitDocumentDecision`, which validates it, builds the notification, and hands it to a
 * `NotificationService`. Today's service (`outboxNotificationService`) only records it locally; swap
 * in an HTTP-backed one that calls the server described in docs/document-verification-api.md and no
 * screen needs to change.
 */

import { logAdminEvent } from './adminEvents';

export type DocumentSubjectType = 'player' | 'coach' | 'staff';
export type DocumentDecision = 'APPROVED' | 'REJECTED';

/** Body of `POST /api/documents/{documentId}/decision`. */
export interface DocumentDecisionPayload {
  documentId: string; // which document on the registration, e.g. 'birthCertificate'
  subjectType: DocumentSubjectType; // whose registration — needed to know who to notify
  subjectId: string;
  status: DocumentDecision;
  rejectionReasonCode?: RejectionReasonCode; // preset chosen in the dialog
  rejectionReason?: string; // required when REJECTED; the text the user is shown
  adminId: string;
}

export const REJECTION_REASONS = [
  { code: 'UNREADABLE', label: 'Unreadable / Blurry Image', template: 'The file is too blurry or dark to read.' },
  { code: 'WRONG_TYPE', label: 'Incorrect Document Type', template: 'This isn’t the document type we asked for.' },
  { code: 'NAME_MISMATCH', label: 'Name Mismatch', template: 'The name on the document doesn’t match the registration.' },
  { code: 'EXPIRED', label: 'Expired Document', template: 'This document has expired.' },
  { code: 'CUSTOM', label: 'Custom Reason', template: '' }
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASONS)[number]['code'];

/** No admin identity exists yet (the admin area uses a shared passcode); replace with the signed-in admin's id. */
export const CURRENT_ADMIN_ID = 'admin-passcode-session';

const ROLE_LABEL: Record<DocumentSubjectType, string> = { player: 'Player', coach: 'Coach', staff: 'Staff' };

export interface DocumentNotification {
  subjectType: DocumentSubjectType;
  subjectId: string;
  title: string;
  body: string;
  channels: ('push' | 'email')[];
  createdAt: number;
}

export function buildDecisionNotification(payload: DocumentDecisionPayload): DocumentNotification {
  const base = { subjectType: payload.subjectType, subjectId: payload.subjectId, channels: ['push', 'email'] as ('push' | 'email')[], createdAt: Date.now() };
  if (payload.status === 'APPROVED') {
    return {
      ...base,
      title: 'Document Approved',
      body: `Your uploaded document for ${ROLE_LABEL[payload.subjectType]} registration has been verified and approved.`
    };
  }
  return {
    ...base,
    title: 'Document Verification Action Required',
    body: `Your document was not approved. Reason: ${(payload.rejectionReason ?? '').replace(/[.!?\s]+$/, '')}. Please upload a valid document to complete your verification.`
  };
}

export interface NotificationService {
  send(notification: DocumentNotification): Promise<void>;
}

const OUTBOX_KEY = 'facex-notification-outbox';

/** Stand-in delivery: records the notification locally so the flow is testable. Nothing is sent to the user. */
export const outboxNotificationService: NotificationService = {
  async send(notification) {
    try {
      const raw = window.localStorage.getItem(OUTBOX_KEY);
      const outbox: DocumentNotification[] = raw ? JSON.parse(raw) : [];
      outbox.push(notification);
      window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox.slice(-50)));
    } catch {
      // Storage unavailable: the decision itself still proceeds.
    }
  }
};

export function clearNotificationOutbox() {
  try {
    window.localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // ignore
  }
}

let service: NotificationService = outboxNotificationService;
export function setNotificationService(next: NotificationService) {
  service = next;
}

/** Validates a decision and triggers its notification. Throws if the decision is invalid or delivery fails. */
export async function submitDocumentDecision(payload: DocumentDecisionPayload): Promise<DocumentNotification> {
  if (payload.status === 'REJECTED' && !payload.rejectionReason?.trim()) {
    throw new Error('A rejection reason is required.');
  }
  const notification = buildDecisionNotification({ ...payload, rejectionReason: payload.rejectionReason?.trim() });
  await service.send(notification);
  // Recorded only once the decision has actually gone through, so the audit trail never shows one that failed.
  logAdminEvent({
    subjectType: payload.subjectType,
    subjectId: payload.subjectId,
    kind: payload.status === 'APPROVED' ? 'document_approved' : 'document_rejected',
    documentId: payload.documentId,
    detail: payload.status === 'REJECTED' ? payload.rejectionReason?.trim() : undefined,
    adminId: payload.adminId
  });
  return notification;
}
