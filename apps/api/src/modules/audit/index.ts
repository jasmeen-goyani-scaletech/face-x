import type { Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';

export type AuditAction =
  | 'USER_ROLE_ASSIGNED'
  | 'PLAYER_CREATED'
  | 'STAFF_PROFILE_CREATED'
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'TEAM_CREATED'
  | 'TEAM_UPDATED'
  | 'REGISTRATION_CREATED'
  | 'REGISTRATION_SUBMITTED'
  | 'REGISTRATION_REJECTED'
  | 'EVENT_ACCESS_DISABLED'
  | 'EVENT_ACCESS_ENABLED'
  | 'DOCUMENT_UPLOAD_REQUESTED'
  | 'DOCUMENT_REPLACED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_SUBMITTED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_REJECTED'
  | 'DOCUMENT_DOWNLOAD_URL_ISSUED'
  | 'CONSENT_RECORDED'
  | 'PAYMENT_CHECKOUT_CREATED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_WEBHOOK_REJECTED'
  | 'FACE_PROFILE_CREATED'
  | 'FACE_PROFILE_REMOVED'
  | 'REGISTRATION_READINESS_ADVANCED'
  | 'FACE_SCAN_PERFORMED'
  | 'CHECK_IN_COMPLETED'
  | 'CHECK_IN_REFUSED';

/**
 * Appends one row to audit_logs. It takes the caller's transaction so the audit entry commits or rolls
 * back together with the change it describes. `metadata` must never hold tokens, passwords or biometric data.
 */
export async function recordAudit(
  q: Queryable,
  entry: {
    action: AuditAction;
    /** Null for system actions (e.g. a verified provider webhook). */
    actorUserId: string | null;
    entityType: string;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  },
): Promise<void> {
  await q.query(
    `insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId,
      JSON.stringify(entry.metadata ?? {}),
      entry.meta.ip,
      entry.meta.userAgent,
    ],
  );
}
