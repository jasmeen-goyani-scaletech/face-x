import type { RegistrantType } from '../registrations/transitions';
import type { NotificationContext, NotificationTemplates } from './types';

const MAX_REASON_CHARS = 140;

/** BIRTH_CERTIFICATE -> "Birth certificate". */
export function documentLabel(documentType: string | undefined): string {
  if (!documentType) return 'Document';
  const words = documentType.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where each kind of registrant manages their registration (documents, status). */
const REGISTRATION_PAGE: Record<RegistrantType, string> = {
  PLAYER: '/dashboard/player',
  COACH: '/register/coach',
  STAFF: '/register/staff',
};
/** Where each kind of registrant sees their event-day access. */
const EVENT_DAY_PAGE: Record<RegistrantType, string> = {
  PLAYER: '/dashboard/player',
  COACH: '/coach/my-team/event-day',
  STAFF: '/register/staff',
};

const truncate = (text: string) =>
  text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 1)}…` : text;

export const DEFAULT_TEMPLATES: NotificationTemplates = {
  DOCUMENT_ACCEPTED: (ctx: NotificationContext) => ({
    title: 'Document accepted',
    body: `${documentLabel(ctx.documentType)} was accepted.`,
    url: REGISTRATION_PAGE[ctx.registrantType],
  }),
  DOCUMENT_REJECTED: (ctx: NotificationContext) => ({
    title: 'Document needs attention',
    body: ctx.reason?.trim()
      ? `${documentLabel(ctx.documentType)} was rejected: ${truncate(ctx.reason.trim())}`
      : `${documentLabel(ctx.documentType)} was rejected. Open the app to see why and upload a new one.`,
    url: REGISTRATION_PAGE[ctx.registrantType],
  }),
  EVENT_DAY_ACCESS_GRANTED: (ctx: NotificationContext) => ({
    title: "You're approved for event day",
    body: 'Your registration is fully approved. Open the app to see your event-day access.',
    url: EVENT_DAY_PAGE[ctx.registrantType],
  }),
};
