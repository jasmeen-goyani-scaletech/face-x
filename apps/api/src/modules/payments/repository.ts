import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { ownsPlayerSql } from '../players';
import { evaluateReadinessIn } from '../readiness/repository';
import type { PaymentDto, PaymentStatus } from './types';

export interface RegistrationForPayment {
  id: string;
  status: string;
  isOwner: boolean;
  /** Organization that owns the registration's event (admin check; never returned). */
  eventOrganizationId: string;
  feeCents: number;
  currency: string;
  registrationNumber: string;
  eventName: string;
}

export interface PaymentRecord {
  id: string;
  registrationId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  /** Provider references. Internal: never part of an API response. */
  sessionId: string | null;
  paymentIntentId: string | null;
}

export type WebhookOutcome = 'APPLIED' | 'NOOP' | 'IGNORED' | 'REJECTED';

export interface PaymentRepository {
  /** Runs `fn` with a repository bound to one database transaction. */
  transaction<T>(fn: (repo: PaymentRepository) => Promise<T>): Promise<T>;

  findRegistration(registrationId: string, userId: string): Promise<RegistrationForPayment | null>;
  listPayments(registrationId: string): Promise<PaymentDto[]>;

  /**
   * Serializes checkout creation for one registration for the rest of the transaction, without locking the
   * registration row (documents and consent keep working during the provider call).
   */
  lockCheckoutCreation(registrationId: string): Promise<void>;
  findPaid(registrationId: string): Promise<PaymentRecord | null>;
  lockPending(registrationId: string): Promise<PaymentRecord | null>;
  /** False when the payment is no longer pending (e.g. a webhook just confirmed it). */
  cancelPending(paymentId: string, reason: string): Promise<boolean>;
  /** Null when the registration already has an open payment (unique pending per registration). */
  insertPending(input: {
    registrationId: string;
    amountCents: number;
    currency: string;
    createdBy: string;
  }): Promise<string | null>;
  attachSession(paymentId: string, sessionId: string, expiresAt: Date): Promise<void>;
  /** Moves the registration one step along its workflow. False if it was no longer in `from`. */
  transitionRegistration(input: {
    registrationId: string;
    from: string;
    to: string;
    changedBy: string | null;
    reason: string;
  }): Promise<boolean>;
  lockRegistrationStatus(registrationId: string): Promise<string | null>;
  /** Advances the registration as far as readiness allows, inside this transaction (see modules/readiness). */
  evaluateReadiness(registrationId: string): Promise<boolean>;

  /** True when this event id is new. False when it was already applied (the primary key is the guard). */
  recordWebhookEvent(input: { eventId: string; eventType: string }): Promise<boolean>;
  setWebhookOutcome(input: {
    eventId: string;
    paymentId: string | null;
    outcome: WebhookOutcome;
    detail: string | null;
  }): Promise<void>;
  lockPaymentBySession(sessionId: string): Promise<PaymentRecord | null>;
  lockPaymentById(paymentId: string): Promise<PaymentRecord | null>;
  findOtherPaid(registrationId: string, exceptPaymentId: string): Promise<boolean>;
  markPaid(paymentId: string, paymentIntentId: string | null): Promise<void>;
  markFailed(paymentId: string, code: string): Promise<void>;
  markCancelled(paymentId: string, code: string): Promise<void>;
  recordAttemptFailure(paymentId: string, code: string): Promise<void>;
  /** Cancels the registration's other open payments; returns their provider sessions so they can be closed. */
  cancelOtherPending(
    registrationId: string,
    exceptPaymentId: string,
    reason: string,
  ): Promise<string[]>;

  audit(entry: {
    action: AuditAction;
    actorUserId: string | null;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

interface PaymentRow {
  id: string;
  registration_id: string;
  status: PaymentStatus;
  amount_cents: number;
  currency: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
}

const toRecord = (r: PaymentRow): PaymentRecord => ({
  id: r.id,
  registrationId: r.registration_id,
  status: r.status,
  amountCents: r.amount_cents,
  currency: r.currency,
  sessionId: r.stripe_checkout_session_id,
  paymentIntentId: r.stripe_payment_intent_id,
});

const RECORD_COLUMNS =
  'id, registration_id, status, amount_cents, currency, stripe_checkout_session_id, stripe_payment_intent_id';

function build(q: Queryable, run: PaymentRepository['transaction']): PaymentRepository {
  return {
    transaction: run,

    async findRegistration(registrationId, userId) {
      const { rows } = await q.query<{
        id: string;
        status: string;
        is_owner: boolean;
        org: string;
        fee_cents: number;
        currency: string;
        registration_number: string;
        event_name: string;
      }>(
        `select r.id, r.status, ${ownsPlayerSql('pl', '$2')} as is_owner, e.organization_id as org,
                r.fee_cents, r.currency, r.registration_number, e.name as event_name
           from public.registrations r
           join public.players pl on pl.id = r.player_id
           join public.events e on e.id = r.event_id
          where r.id = $1 and r.registrant_type = 'PLAYER'`,
        [registrationId, userId],
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            status: r.status,
            isOwner: r.is_owner,
            eventOrganizationId: r.org,
            feeCents: r.fee_cents,
            currency: r.currency,
            registrationNumber: r.registration_number,
            eventName: r.event_name,
          }
        : null;
    },

    async listPayments(registrationId) {
      const { rows } = await q.query<{
        id: string;
        status: PaymentStatus;
        amount_cents: number;
        currency: string;
        failure_reason: string | null;
        checkout_expires_at: Date | null;
        paid_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `select id, status, amount_cents, currency, failure_reason, checkout_expires_at, paid_at, created_at, updated_at
           from public.payments where registration_id = $1 order by created_at desc, id`,
        [registrationId],
      );
      return rows.map((p) => ({
        id: p.id,
        status: p.status,
        amountCents: p.amount_cents,
        currency: p.currency,
        failureReason: p.failure_reason,
        checkoutExpiresAt: p.checkout_expires_at?.toISOString() ?? null,
        paidAt: p.paid_at?.toISOString() ?? null,
        createdAt: p.created_at.toISOString(),
        updatedAt: p.updated_at.toISOString(),
      }));
    },

    async lockCheckoutCreation(registrationId) {
      await q.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `checkout:${registrationId}`,
      ]);
    },

    async findPaid(registrationId) {
      const { rows } = await q.query<PaymentRow>(
        `select ${RECORD_COLUMNS} from public.payments where registration_id = $1 and status = 'PAID'`,
        [registrationId],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async lockPending(registrationId) {
      const { rows } = await q.query<PaymentRow>(
        `select ${RECORD_COLUMNS} from public.payments
          where registration_id = $1 and status = 'PAYMENT_PENDING' for update`,
        [registrationId],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async cancelPending(paymentId, reason) {
      const { rowCount } = await q.query(
        `update public.payments set status = 'CANCELLED', failure_reason = $2
          where id = $1 and status = 'PAYMENT_PENDING'`,
        [paymentId, reason],
      );
      return (rowCount ?? 0) > 0;
    },

    async insertPending(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.payments (registration_id, status, amount_cents, currency, created_by)
         values ($1, 'PAYMENT_PENDING', $2, $3, $4)
         on conflict (registration_id) where status = 'PAYMENT_PENDING' do nothing
         returning id`,
        [i.registrationId, i.amountCents, i.currency, i.createdBy],
      );
      return rows[0]?.id ?? null;
    },

    async attachSession(paymentId, sessionId, expiresAt) {
      await q.query(
        `update public.payments set stripe_checkout_session_id = $2, checkout_expires_at = $3 where id = $1`,
        [paymentId, sessionId, expiresAt],
      );
    },

    async transitionRegistration(i) {
      const { rowCount } = await q.query(
        'update public.registrations set status = $3 where id = $1 and status = $2',
        [i.registrationId, i.from, i.to],
      );
      if ((rowCount ?? 0) === 0) return false;
      await q.query(
        `insert into public.registration_status_history (registration_id, from_status, to_status, changed_by, reason)
         values ($1, $2, $3, $4, $5)`,
        [i.registrationId, i.from, i.to, i.changedBy, i.reason],
      );
      return true;
    },

    async evaluateReadiness(registrationId) {
      const result = await evaluateReadinessIn(q, registrationId);
      return result?.steps.some((s) => s.to === 'READY_FOR_EVENT') ?? false;
    },

    async lockRegistrationStatus(registrationId) {
      const { rows } = await q.query<{ status: string }>(
        'select status from public.registrations where id = $1 for update',
        [registrationId],
      );
      return rows[0]?.status ?? null;
    },

    async recordWebhookEvent({ eventId, eventType }) {
      const { rowCount } = await q.query(
        `insert into public.payment_webhook_events (provider, event_id, event_type, outcome)
         values ('STRIPE', $1, $2, 'NOOP')
         on conflict (provider, event_id) do nothing`,
        [eventId, eventType],
      );
      return (rowCount ?? 0) > 0;
    },

    async setWebhookOutcome({ eventId, paymentId, outcome, detail }) {
      await q.query(
        `update public.payment_webhook_events set payment_id = $2, outcome = $3, detail = $4
          where provider = 'STRIPE' and event_id = $1`,
        [eventId, paymentId, outcome, detail],
      );
    },

    async lockPaymentBySession(sessionId) {
      const { rows } = await q.query<PaymentRow>(
        `select ${RECORD_COLUMNS} from public.payments where stripe_checkout_session_id = $1 for update`,
        [sessionId],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async lockPaymentById(paymentId) {
      const { rows } = await q.query<PaymentRow>(
        `select ${RECORD_COLUMNS} from public.payments where id = $1 for update`,
        [paymentId],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async findOtherPaid(registrationId, exceptPaymentId) {
      const { rows } = await q.query(
        `select 1 from public.payments where registration_id = $1 and status = 'PAID' and id <> $2`,
        [registrationId, exceptPaymentId],
      );
      return rows.length > 0;
    },

    async markPaid(paymentId, paymentIntentId) {
      await q.query(
        `update public.payments
            set status = 'PAID', paid_at = now(), failure_reason = null,
                stripe_payment_intent_id = coalesce($2, stripe_payment_intent_id)
          where id = $1`,
        [paymentId, paymentIntentId],
      );
    },

    async markFailed(paymentId, code) {
      await q.query(
        `update public.payments set status = 'FAILED', failure_reason = $2 where id = $1`,
        [paymentId, code],
      );
    },

    async markCancelled(paymentId, code) {
      await q.query(
        `update public.payments set status = 'CANCELLED', failure_reason = $2 where id = $1`,
        [paymentId, code],
      );
    },

    async recordAttemptFailure(paymentId, code) {
      await q.query(
        `update public.payments set failure_reason = $2 where id = $1 and status = 'PAYMENT_PENDING'`,
        [paymentId, code],
      );
    },

    async cancelOtherPending(registrationId, exceptPaymentId, reason) {
      const { rows } = await q.query<{ stripe_checkout_session_id: string | null }>(
        `update public.payments set status = 'CANCELLED', failure_reason = $3
          where registration_id = $1 and id <> $2 and status = 'PAYMENT_PENDING'
          returning stripe_checkout_session_id`,
        [registrationId, exceptPaymentId, reason],
      );
      return rows.flatMap((r) =>
        r.stripe_checkout_session_id ? [r.stripe_checkout_session_id] : [],
      );
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: 'payment',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createPaymentRepository(db: Database): PaymentRepository {
  const inTransaction: PaymentRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
