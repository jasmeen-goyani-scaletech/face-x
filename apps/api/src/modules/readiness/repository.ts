import type { Database, Queryable } from '../../infrastructure/database/database';
import { recordAudit } from '../audit';
import { completenessOf } from '../documents/completeness';
import { documentState } from '../documents/state';
import type { DocumentType } from '../documents/types';
import { consentRequirement, consentsSatisfied } from '../consents/requirements';
import { CONSENT_CODES_FOR } from '../consents/types';
import { isMinorForEvent } from '../registrations/rules';
import {
  assertTransition,
  type RegistrantType,
  type RegistrationStatus,
} from '../registrations/transitions';
import { ownsRegistrantSql } from '../staff';
import { blockersFor, documentsSubmitted, nextStep } from './rules';
import type { EvaluationResult, ReadinessFacts, ReadinessReport, ReadinessStep } from './types';

/**
 * Registration readiness, as functions over a Queryable so they can run inside the caller's transaction (the
 * payment webhook) or in their own (everything else). This file (and the leaf rule modules it imports) is the
 * ONLY place that moves a registration past PAYMENT_COMPLETED.
 *
 * Locking: the evaluator takes FOR UPDATE on the registration row first and holds nothing else, so concurrent
 * evaluations queue up and each sees the other's committed result (idempotent). Callers that hold a SHARE lock on
 * the same row (documents, consent) must NOT call it inside their own transaction (two of them upgrading at once
 * would deadlock); they call it after commit instead.
 */
interface RegistrationRow {
  id: string;
  status: RegistrationStatus;
  registrant_type: RegistrantType;
  fee_cents: number;
  starts_at: Date;
  timezone: string;
  /** Players only: the age rules (guardian consent) depend on it. */
  dob: string | null;
}

async function loadRegistration(
  q: Queryable,
  registrationId: string,
  lock: boolean,
): Promise<RegistrationRow | null> {
  const { rows } = await q.query<RegistrationRow>(
    `select r.id, r.status, r.registrant_type, r.fee_cents, e.starts_at, e.timezone,
            pl.date_of_birth::text as dob
       from public.registrations r
       join public.events e on e.id = r.event_id
       left join public.players pl on pl.id = r.player_id
      where r.id = $1 ${lock ? 'for update of r' : ''}`,
    [registrationId],
  );
  return rows[0] ?? null;
}

async function gatherFacts(
  q: Queryable,
  row: RegistrationRow,
): Promise<{ facts: ReadinessFacts; consentRows: ReadinessReport['consent']['requirements'] }> {
  const paymentRequired = row.fee_cents > 0;
  let paymentSatisfied = !paymentRequired; // a zero fee needs no payment record: nothing is faked
  if (paymentRequired) {
    const { rows } = await q.query(
      `select 1 from public.payments where registration_id = $1 and status = 'PAID' limit 1`,
      [row.id],
    );
    paymentSatisfied = rows.length > 0;
  }

  const { rows: docRows } = await q.query<{
    document_type: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    uploaded_at: Date | null;
    submitted_at: Date | null;
    created_at: Date;
  }>(
    `select document_type, status, uploaded_at, submitted_at, created_at
       from public.documents where registration_id = $1`,
    [row.id],
  );
  const documents = completenessOf(
    docRows.map((d) => ({
      documentType: d.document_type as DocumentType,
      state: documentState({
        status: d.status,
        uploadedAt: d.uploaded_at,
        submittedAt: d.submitted_at,
      }),
      createdAt: d.created_at.toISOString(),
    })),
    row.registrant_type,
  );

  const isMinor = row.dob !== null && isMinorForEvent(row.dob, row.starts_at, row.timezone);
  const { rows: recordRows } = await q.query<{ consent_id: string }>(
    'select consent_id from public.consent_records where registration_id = $1',
    [row.id],
  );
  const consentRows = [];
  const requirements = [];
  for (const code of CONSENT_CODES_FOR[row.registrant_type]) {
    const { rows } = await q.query<{ id: string }>(
      `select id from public.consents where code = $1 and effective_at <= now()
        order by version desc limit 1`,
      [code],
    );
    const requirement = consentRequirement(
      code,
      isMinor,
      rows[0] ?? null,
      recordRows.map((r) => ({ consentId: r.consent_id })),
    );
    requirements.push(requirement);
    consentRows.push({ code, required: requirement.required, accepted: requirement.accepted });
  }

  return {
    facts: {
      paymentRequired,
      paymentSatisfied,
      documents,
      consentSatisfied: consentsSatisfied(requirements),
    },
    consentRows,
  };
}

function reportFor(
  row: RegistrationRow,
  status: RegistrationStatus,
  facts: ReadinessFacts,
  consentRows: ReadinessReport['consent']['requirements'],
): ReadinessReport {
  return {
    registrationId: row.id,
    status,
    ready: status === 'READY_FOR_EVENT',
    blockers: blockersFor(status, facts),
    payment: { required: facts.paymentRequired, satisfied: facts.paymentSatisfied },
    documents: { ...facts.documents, submitted: documentsSubmitted(facts) },
    consent: { satisfied: facts.consentSatisfied, requirements: consentRows },
  };
}

/** Read-only: where the registration stands against the requirements. Changes nothing. */
export async function inspectReadinessIn(
  q: Queryable,
  registrationId: string,
): Promise<ReadinessReport | null> {
  const row = await loadRegistration(q, registrationId, false);
  if (!row) return null;
  const { facts, consentRows } = await gatherFacts(q, row);
  return reportFor(row, row.status, facts, consentRows);
}

/**
 * Moves the registration as far forward as the facts allow, one existing transition at a time, and records each
 * step in the status history as a SYSTEM action (changed_by is null, metadata names the source). Safe to call at
 * any time and any number of times: with nothing to do it changes and writes nothing.
 * Returns null when the registration does not exist.
 */
export async function evaluateReadinessIn(
  q: Queryable,
  registrationId: string,
): Promise<EvaluationResult | null> {
  const row = await loadRegistration(q, registrationId, true);
  if (!row) return null;
  const { facts, consentRows } = await gatherFacts(q, row);

  const steps: ReadinessStep[] = [];
  let status = row.status;
  // Bounded: the workflow has a handful of forward steps, so a runaway loop can only be a bug.
  for (let i = 0; i < 8; i++) {
    const step = nextStep(status, facts, row.registrant_type);
    if (!step) break;
    assertTransition(step.from, step.to, row.registrant_type); // the single definition of the workflow
    const moved = await q.query(
      'update public.registrations set status = $3 where id = $1 and status = $2',
      [registrationId, step.from, step.to],
    );
    if ((moved.rowCount ?? 0) === 0) break; // cannot happen while we hold the row lock; never force it
    await q.query(
      // clock_timestamp(), not now(): several steps can share one transaction, and the history must keep their order.
      `insert into public.registration_status_history
         (registration_id, from_status, to_status, changed_by, reason, metadata, created_at)
       values ($1, $2, $3, null, $4, $5, clock_timestamp())`,
      [
        registrationId,
        step.from,
        step.to,
        step.reason,
        JSON.stringify({ actor: 'SYSTEM', source: 'READINESS' }),
      ],
    );
    steps.push(step);
    status = step.to;
  }

  if (steps.length > 0) {
    await recordAudit(q, {
      action: 'REGISTRATION_READINESS_ADVANCED',
      actorUserId: null,
      entityType: 'registration',
      entityId: registrationId,
      metadata: { from: row.status, to: status, steps: steps.length },
      meta: { ip: null, userAgent: null },
    });
  }
  return { previousStatus: row.status, steps, report: reportFor(row, status, facts, consentRows) };
}

export interface ReadinessAccess {
  isOwner: boolean;
  /** Organization that owns the registration's event (admin check; never returned). */
  eventOrganizationId: string;
}

export interface ReadinessRepository {
  findAccess(registrationId: string, userId: string): Promise<ReadinessAccess | null>;
  inspect(registrationId: string): Promise<ReadinessReport | null>;
  /** Evaluates in its own transaction. */
  evaluate(registrationId: string): Promise<EvaluationResult | null>;
}

export function createReadinessRepository(db: Database): ReadinessRepository {
  return {
    async findAccess(registrationId, userId) {
      const { rows } = await db.query<{ is_owner: boolean; org: string }>(
        `select ${ownsRegistrantSql('pl', 'sp', '$2')} as is_owner, e.organization_id as org
           from public.registrations r
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
           join public.events e on e.id = r.event_id
          where r.id = $1`,
        [registrationId, userId],
      );
      const r = rows[0];
      return r ? { isOwner: r.is_owner, eventOrganizationId: r.org } : null;
    },
    inspect: (registrationId) => inspectReadinessIn(db, registrationId),
    evaluate: (registrationId) => db.transaction((tx) => evaluateReadinessIn(tx, registrationId)),
  };
}
