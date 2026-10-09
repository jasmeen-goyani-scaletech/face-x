import type { RegistrantType } from '../registrations/transitions';

export const NOTIFICATION_TYPES = [
  'DOCUMENT_ACCEPTED',
  'DOCUMENT_REJECTED',
  'EVENT_DAY_ACCESS_GRANTED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * What the service worker receives (JSON). The browser shows `title`/`body`, opens `url` when clicked, and uses `tag` so a
 * newer notification about the same thing replaces the older one. Nothing here is secret: it is shown on a lock screen,
 * so it carries no document contents, ids of other people, or tokens.
 */
export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Same-origin path the app opens on click, e.g. /dashboard/player. */
  url: string;
  tag: string;
  data: { registrationId: string; documentId?: string };
}

/** The facts a template turns into text. */
export interface NotificationContext {
  type: NotificationType;
  registrantType: RegistrantType;
  /** Document type code (e.g. BIRTH_CERTIFICATE), for the document notifications. */
  documentType?: string;
  /** The reviewer's rejection reason, when there is one. */
  reason?: string | null;
  registrationId: string;
  documentId?: string;
}

/** Wording and destination for each notification type. Replaceable as a whole or per type without touching the sender. */
export type NotificationTemplates = Record<
  NotificationType,
  (ctx: NotificationContext) => Pick<NotificationPayload, 'title' | 'body' | 'url'>
>;

/**
 * What business modules call AFTER their own change has committed. Implementations never throw and never block on
 * delivery failure: a notification problem must not fail a registration, a review or a payment.
 */
export interface NotificationPublisher {
  documentReviewed(event: {
    registrationId: string;
    documentId: string;
    documentType: string;
    decision: 'APPROVED' | 'REJECTED';
    reason: string | null;
  }): Promise<void>;
  eventDayAccessGranted(registrationId: string): Promise<void>;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}
