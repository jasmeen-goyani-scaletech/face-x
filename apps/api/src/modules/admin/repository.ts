import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { completenessOf } from '../documents/completeness';
import { documentState } from '../documents/state';
import type { DocumentType } from '../documents/types';
import { CONSENT_CODES_FOR } from '../consents/types';
import { isMinorForEvent } from '../registrations/rules';
import {
  REGISTRATION_STATUSES,
  type RegistrantType,
  type RegistrationStatus,
} from '../registrations/transitions';
import type { StaffRole } from '../staff/types';
import type {
  CreateEventBody,
  CreateTeamBody,
  ListRegistrationsQuery,
  ListTeamsQuery,
  ReviewQueueQuery,
  UpdateEventBody,
  UpdateTeamBody,
} from './schema';
import type {
  AdminEvent,
  AdminPlayerRow,
  AdminRegistrationRow,
  AdminTeam,
  EventAccessState,
  EventRosterEntry,
  EventSummary,
  Page,
  ReviewQueueItem,
} from './types';

export interface RegistrationForAdmin {
  id: string;
  registrationNumber: string;
  status: RegistrationStatus;
  registrantType: string;
  organizationId: string;
  eventAccessDisabled: boolean;
  eventAccessDisabledReason: string | null;
}

export interface AdminRepository {
  transaction<T>(fn: (repo: AdminRepository) => Promise<T>): Promise<T>;

  /** Events owned by an organization, newest first, every status. */
  listEvents(organizationId: string): Promise<AdminEvent[]>;
  /** One page of the organization's events, newest first (the same order as `listEvents`). */
  listEventsPage(
    organizationId: string,
    query: { page: number; pageSize: number },
  ): Promise<Page<AdminEvent>>;
  findEvent(eventId: string): Promise<AdminEvent | null>;
  insertEvent(
    organizationId: string,
    createdBy: string,
    body: CreateEventBody,
  ): Promise<AdminEvent>;
  /** Row-locks the event (so a status change and a registration cannot interleave). */
  lockEvent(
    eventId: string,
  ): Promise<{ status: AdminEvent['status']; startsAt: Date; endsAt: Date } | null>;
  updateEvent(eventId: string, patch: UpdateEventBody): Promise<AdminEvent>;
  /** Any registration, whatever its status, exists for the event. */
  eventHasRegistrations(eventId: string): Promise<boolean>;

  listTeams(eventId: string): Promise<AdminTeam[]>;
  /** One page of the teams of every event of the organization: by event (newest first), then division and name. */
  listOrganizationTeams(organizationId: string, query: ListTeamsQuery): Promise<Page<AdminTeam>>;
  /** Null when the event already has a team with this name and club. */
  insertTeam(eventId: string, body: CreateTeamBody): Promise<AdminTeam | null>;
  /** The team with the organization that owns its event (for the admin check). Optionally row-locked. */
  findTeam(
    teamId: string,
    lock?: boolean,
  ): Promise<{ team: AdminTeam; organizationId: string } | null>;
  /** Null when another team of the event already has this name and club. */
  updateTeam(teamId: string, patch: UpdateTeamBody): Promise<AdminTeam | null>;

  /** The event's day-of roster, or only one team's people when `teamId` is given. */
  roster(
    eventId: string,
    teamId?: string,
    window?: { limit: number; offset: number },
  ): Promise<EventRosterEntry[]>;
  /** How many people are on the event's day-of roster (the same people `roster` lists). */
  rosterCount(eventId: string): Promise<number>;
  summary(eventId: string, registrantType: RegistrantType): Promise<EventSummary>;
  listRegistrations(
    eventId: string,
    query: ListRegistrationsQuery,
  ): Promise<Page<AdminRegistrationRow>>;
  reviewQueue(eventId: string, query: ReviewQueueQuery): Promise<Page<ReviewQueueItem>>;

  /** Row-locks the registration and returns it with the organization that owns its event. */
  lockRegistration(registrationId: string): Promise<RegistrationForAdmin | null>;
  setRejected(registrationId: string): Promise<void>;
  setEventAccess(
    registrationId: string,
    disabled: boolean,
    reason: string | null,
  ): Promise<EventAccessState>;
  insertHistory(input: {
    registrationId: string;
    from: RegistrationStatus;
    to: RegistrationStatus;
    changedBy: string;
    reason: string;
  }): Promise<void>;
  audit(entry: {
    action: AuditAction;
    actorUserId: string;
    entityId: string;
    /** Defaults to 'registration'. */
    entityType?: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  location: string;
  timezone: string;
  starts_at: Date;
  ends_at: Date;
  registration_fee_cents: number;
  currency: string;
  status: AdminEvent['status'];
}
const EVENT_COLUMNS = `id, name, description, location, timezone, starts_at, ends_at,
  registration_fee_cents, currency, status`;
const toAdminEvent = (e: EventRow): AdminEvent => ({
  id: e.id,
  name: e.name,
  description: e.description,
  location: e.location,
  timezone: e.timezone,
  startsAt: e.starts_at.toISOString(),
  endsAt: e.ends_at.toISOString(),
  fee: { amountCents: e.registration_fee_cents, currency: e.currency },
  status: e.status,
});

interface TeamRow {
  id: string;
  event_id: string;
  name: string;
  club: string;
  division: string;
  invite_code: string;
  status: AdminTeam['status'];
  players: string;
  coaches: string;
  staff: string;
}
const TEAM_COLUMNS = `t.id, t.event_id, t.name, t.club, t.division, t.invite_code, t.status,
  (select count(*) from public.registrations r where r.team_id = t.id and r.registrant_type = 'PLAYER'
     and r.status not in ('DRAFT', 'CANCELLED')) as players,
  (select count(*) from public.registrations r where r.team_id = t.id and r.registrant_type = 'COACH'
     and r.status not in ('DRAFT', 'CANCELLED')) as coaches,
  (select count(*) from public.registrations r where r.team_id = t.id and r.registrant_type = 'STAFF'
     and r.status not in ('DRAFT', 'CANCELLED')) as staff`;
const toAdminTeam = (t: TeamRow): AdminTeam => ({
  id: t.id,
  eventId: t.event_id,
  name: t.name,
  club: t.club,
  division: t.division,
  inviteCode: t.invite_code,
  status: t.status,
  registrations: { players: Number(t.players), coaches: Number(t.coaches), staff: Number(t.staff) },
});

async function findTeamIn(
  q: Queryable,
  teamId: string,
  lock = false,
): Promise<{ team: AdminTeam; organizationId: string } | null> {
  const { rows } = await q.query<TeamRow & { organization_id: string }>(
    `select ${TEAM_COLUMNS}, e.organization_id
       from public.teams t join public.events e on e.id = t.event_id
      where t.id = $1 ${lock ? 'for update of t' : ''}`,
    [teamId],
  );
  const t = rows[0];
  return t ? { team: toAdminTeam(t), organizationId: t.organization_id } : null;
}

interface RosterRow {
  id: string;
  registration_number: string;
  registrant_type: RegistrantType;
  status: RegistrationStatus;
  event_access_disabled: boolean;
  fee_cents: number;
  first_name: string;
  last_name: string;
  dob: string | null;
  email: string | null;
  phone: string | null;
  team_id: string | null;
  team_name: string | null;
  team_division: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  paid: boolean;
  checked_in_at: Date | null;
  method: 'FACE' | 'MANUAL' | null;
}
/** Escapes LIKE wildcards so a search for "50%" or "a_b" matches those characters literally. */
const likeContains = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const iso = (d: Date) => d.toISOString();

function build(q: Queryable, run: AdminRepository['transaction']): AdminRepository {
  return {
    transaction: run,

    async listEvents(organizationId) {
      const { rows } = await q.query<EventRow>(
        `select ${EVENT_COLUMNS}
           from public.events where organization_id = $1
          order by starts_at desc, id limit 100`,
        [organizationId],
      );
      return rows.map(toAdminEvent);
    },

    async listEventsPage(organizationId, { page, pageSize }) {
      const total = await q.query<{ n: string }>(
        'select count(*) as n from public.events where organization_id = $1',
        [organizationId],
      );
      const { rows } = await q.query<EventRow>(
        `select ${EVENT_COLUMNS}
           from public.events where organization_id = $1
          order by starts_at desc, id limit $2 offset $3`,
        [organizationId, pageSize, (page - 1) * pageSize],
      );
      return {
        items: rows.map(toAdminEvent),
        page,
        pageSize,
        total: Number(total.rows[0]?.n ?? 0),
      };
    },

    async findEvent(eventId) {
      const { rows } = await q.query<EventRow>(
        `select ${EVENT_COLUMNS} from public.events where id = $1`,
        [eventId],
      );
      return rows[0] ? toAdminEvent(rows[0]) : null;
    },

    async insertEvent(organizationId, createdBy, b) {
      const { rows } = await q.query<EventRow>(
        `insert into public.events
           (organization_id, name, description, location, timezone, starts_at, ends_at, registration_fee_cents, status, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning ${EVENT_COLUMNS}`,
        [
          organizationId,
          b.name,
          b.description ?? null,
          b.location,
          b.timezone,
          b.startsAt,
          b.endsAt,
          b.feeCents ?? 0,
          b.status ?? 'DRAFT',
          createdBy,
        ],
      );
      return toAdminEvent(rows[0]!);
    },

    async lockEvent(eventId) {
      const { rows } = await q.query<{
        status: AdminEvent['status'];
        starts_at: Date;
        ends_at: Date;
      }>('select status, starts_at, ends_at from public.events where id = $1 for update', [
        eventId,
      ]);
      const e = rows[0];
      return e ? { status: e.status, startsAt: e.starts_at, endsAt: e.ends_at } : null;
    },

    async updateEvent(eventId, patch) {
      const columns: Record<keyof UpdateEventBody, string> = {
        name: 'name',
        description: 'description',
        location: 'location',
        timezone: 'timezone',
        startsAt: 'starts_at',
        endsAt: 'ends_at',
        feeCents: 'registration_fee_cents',
        status: 'status',
      };
      const sets: string[] = [];
      const values: unknown[] = [eventId];
      for (const key of Object.keys(columns) as (keyof UpdateEventBody)[]) {
        if (patch[key] !== undefined) {
          values.push(patch[key]);
          sets.push(`${columns[key]} = $${values.length}`);
        }
      }
      const { rows } = await q.query<EventRow>(
        `update public.events set ${sets.join(', ')} where id = $1 returning ${EVENT_COLUMNS}`,
        values,
      );
      return toAdminEvent(rows[0]!);
    },

    async eventHasRegistrations(eventId) {
      const { rows } = await q.query(
        'select 1 from public.registrations where event_id = $1 limit 1',
        [eventId],
      );
      return rows.length > 0;
    },

    async listTeams(eventId) {
      const { rows } = await q.query<TeamRow>(
        `select ${TEAM_COLUMNS} from public.teams t where t.event_id = $1
          order by t.division, lower(t.name), t.id`,
        [eventId],
      );
      return rows.map(toAdminTeam);
    },

    async listOrganizationTeams(organizationId, { page, pageSize }) {
      const total = await q.query<{ n: string }>(
        `select count(*) as n from public.teams t join public.events e on e.id = t.event_id
          where e.organization_id = $1`,
        [organizationId],
      );
      const { rows } = await q.query<TeamRow>(
        `select ${TEAM_COLUMNS} from public.teams t join public.events e on e.id = t.event_id
          where e.organization_id = $1
          order by e.starts_at desc, e.id, t.division, lower(t.name), t.id
          limit $2 offset $3`,
        [organizationId, pageSize, (page - 1) * pageSize],
      );
      return { items: rows.map(toAdminTeam), page, pageSize, total: Number(total.rows[0]?.n ?? 0) };
    },

    async insertTeam(eventId, b) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.teams (event_id, name, club, division)
         values ($1, $2, $3, $4)
         on conflict (event_id, name, club) do nothing
         returning id`,
        [eventId, b.name, b.club ?? '', b.division],
      );
      const id = rows[0]?.id;
      if (!id) return null;
      return (await findTeamIn(q, id))!.team;
    },

    findTeam: (teamId, lock = false) => findTeamIn(q, teamId, lock),

    async updateTeam(teamId, patch) {
      const columns: Record<keyof UpdateTeamBody, string> = {
        name: 'name',
        club: 'club',
        division: 'division',
        status: 'status',
      };
      const sets: string[] = [];
      const values: unknown[] = [teamId];
      for (const key of Object.keys(columns) as (keyof UpdateTeamBody)[]) {
        if (patch[key] !== undefined) {
          values.push(patch[key]);
          sets.push(`${columns[key]} = $${values.length}`);
        }
      }
      // A savepoint keeps the surrounding transaction usable after a duplicate (name, club) is refused.
      await q.query('savepoint team_update');
      try {
        await q.query(`update public.teams set ${sets.join(', ')} where id = $1`, values);
      } catch (err) {
        await q.query('rollback to savepoint team_update');
        if ((err as { code?: string }).code === '23505') return null; // unique (event, name, club)
        throw err;
      }
      await q.query('release savepoint team_update');
      return (await findTeamIn(q, teamId))!.team;
    },

    async rosterCount(eventId) {
      const { rows } = await q.query<{ n: string }>(
        `select count(*) as n from public.registrations r
          where r.event_id = $1 and r.status not in ('DRAFT', 'CANCELLED', 'REJECTED')`,
        [eventId],
      );
      return Number(rows[0]?.n ?? 0);
    },

    async roster(eventId, teamId, window) {
      const [{ rows: ev }, { rows }] = await Promise.all([
        q.query<{ starts_at: Date; timezone: string }>(
          'select starts_at, timezone from public.events where id = $1',
          [eventId],
        ),
        q.query<RosterRow>(
          `select r.id, r.registration_number, r.registrant_type, r.status, r.event_access_disabled, r.fee_cents,
                  coalesce(pl.first_name, sp.first_name) as first_name,
                  coalesce(pl.last_name, sp.last_name) as last_name,
                  pl.date_of_birth::text as dob, coalesce(pl.email, sp.email) as email,
                  coalesce(pl.phone, sp.phone) as phone,
                  t.id as team_id, t.name as team_name, t.division as team_division,
                  g.name as guardian_name, g.phone as guardian_phone,
                  exists (select 1 from public.payments p where p.registration_id = r.id and p.status = 'PAID') as paid,
                  c.checked_in_at, c.method
             from public.registrations r
             left join public.players pl on pl.id = r.player_id
             left join public.staff_profiles sp on sp.id = r.staff_profile_id
             left join public.teams t on t.id = r.team_id
             left join public.check_ins c on c.registration_id = r.id
             left join lateral (
               select pa.first_name || ' ' || pa.last_name as name, pa.phone
                 from public.player_parents pp join public.parents pa on pa.id = pp.parent_id
                where pp.player_id = pl.id order by pp.is_primary desc, pa.created_at limit 1) g on true
            where r.event_id = $1 and r.status not in ('DRAFT', 'CANCELLED', 'REJECTED')
              and ($2::uuid is null or r.team_id = $2::uuid)
            order by lower(coalesce(pl.last_name, sp.last_name)), lower(coalesce(pl.first_name, sp.first_name)),
                     r.registration_number
            limit $3 offset $4`,
          [eventId, teamId ?? null, window?.limit ?? null, window?.offset ?? 0],
        ),
      ]);
      // Documents and consents only for the people on this page (a roster is read page by page on the day).
      const ids = rows.map((r) => r.id);
      const [{ rows: docs }, { rows: consents }] = await Promise.all([
        q.query<{
          registration_id: string;
          id: string;
          document_type: DocumentType;
          status: 'PENDING' | 'APPROVED' | 'REJECTED';
          uploaded_at: Date | null;
          submitted_at: Date | null;
          created_at: Date;
        }>(
          `select d.registration_id, d.id, d.document_type, d.status, d.uploaded_at, d.submitted_at, d.created_at
             from public.documents d join public.registrations r on r.id = d.registration_id
            where d.registration_id = any($1::uuid[])`,
          [ids],
        ),
        q.query<{ registration_id: string; code: string }>(
          `select cr.registration_id, c.code
             from public.consent_records cr
             join public.consents c on c.id = cr.consent_id
            where cr.registration_id = any($1::uuid[])`,
          [ids],
        ),
      ]);
      const event = ev[0];
      const docsBy = new Map<string, typeof docs>();
      for (const d of docs)
        docsBy.set(d.registration_id, [...(docsBy.get(d.registration_id) ?? []), d]);
      const consentsBy = new Map<string, Set<string>>();
      for (const c of consents) {
        const set = consentsBy.get(c.registration_id) ?? new Set<string>();
        set.add(c.code);
        consentsBy.set(c.registration_id, set);
      }

      return rows.map((r): EventRosterEntry => {
        const mine = docsBy.get(r.id) ?? [];
        const withState = mine.map((d) => ({
          documentType: d.document_type,
          state: documentState({
            status: d.status,
            uploadedAt: d.uploaded_at,
            submittedAt: d.submitted_at,
          }),
          createdAt: d.created_at.toISOString(),
        }));
        const completeness = completenessOf(withState, r.registrant_type);
        const photo = mine
          .filter(
            (d) =>
              d.document_type === 'PROFILE_PHOTO' &&
              d.uploaded_at !== null &&
              d.status !== 'REJECTED',
          )
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];

        const flags: string[] = [];
        const paymentComplete = r.registrant_type !== 'PLAYER' || r.fee_cents === 0 || r.paid;
        if (!paymentComplete) flags.push('Payment Incomplete');
        if (completeness.required.some((x) => x.state === 'REJECTED'))
          flags.push('Document Rejected');
        else if (!completeness.allRequiredApproved) flags.push('Unverified Document');
        const isMinor =
          r.dob !== null &&
          event !== undefined &&
          isMinorForEvent(r.dob, event.starts_at, event.timezone);
        for (const code of CONSENT_CODES_FOR[r.registrant_type]) {
          const required = code === 'GUARDIAN_CONSENT' ? isMinor : true;
          if (required && !consentsBy.get(r.id)?.has(code)) {
            flags.push(
              code === 'GUARDIAN_CONSENT'
                ? 'Parent Consent Pending'
                : 'AB 506 Acknowledgement Pending',
            );
          }
        }
        const approved = r.status === 'READY_FOR_EVENT';
        return {
          registrationId: r.id,
          registrationNumber: r.registration_number,
          registrantType: r.registrant_type,
          firstName: r.first_name,
          lastName: r.last_name,
          dateOfBirth: r.dob,
          email: r.email,
          phone: r.phone,
          guardianName: r.guardian_name,
          guardianPhone: r.guardian_phone,
          team: r.team_id
            ? { id: r.team_id, name: r.team_name!, division: r.team_division! }
            : null,
          status: r.status,
          approved,
          eventAccessDisabled: r.event_access_disabled,
          paymentComplete,
          // Everything is in order once READY_FOR_EVENT: a leftover flag then would only be a stale reading.
          flags: approved ? [] : flags,
          photoDocumentId: photo?.id ?? null,
          checkedInAt: r.checked_in_at ? iso(r.checked_in_at) : null,
          checkedInMethod: r.method,
        };
      });
    },

    async summary(eventId, registrantType) {
      const [byStatus, awaiting, payments, disabled] = await Promise.all([
        q.query<{ status: RegistrationStatus; n: string }>(
          `select status, count(*) as n from public.registrations
            where event_id = $1 and registrant_type = $2 group by status`,
          [eventId, registrantType],
        ),
        q.query<{ n: string }>(
          // Frozen (cancelled / rejected) registrations are not waiting on anyone.
          `select count(*) as n
             from public.documents d join public.registrations r on r.id = d.registration_id
            where r.event_id = $1 and r.registrant_type = $2
              and r.status not in ('CANCELLED', 'REJECTED')
              and d.status = 'PENDING' and d.submitted_at is not null`,
          [eventId, registrantType],
        ),
        q.query<{ paid: string; paid_cents: string; refunded: string }>(
          `select count(*) filter (where p.status = 'PAID') as paid,
                  coalesce(sum(p.amount_cents) filter (where p.status = 'PAID'), 0) as paid_cents,
                  count(*) filter (where p.status = 'REFUNDED') as refunded
             from public.payments p join public.registrations r on r.id = p.registration_id
            where r.event_id = $1 and r.registrant_type = $2`,
          [eventId, registrantType],
        ),
        q.query<{ n: string }>(
          `select count(*) as n from public.registrations
            where event_id = $1 and registrant_type = $2 and event_access_disabled`,
          [eventId, registrantType],
        ),
      ]);
      const registrationsByStatus = Object.fromEntries(
        REGISTRATION_STATUSES.map((s) => [s, 0]),
      ) as Record<RegistrationStatus, number>;
      for (const row of byStatus.rows) registrationsByStatus[row.status] = Number(row.n);
      return {
        eventId,
        registrationsByStatus,
        documentsAwaitingReview: Number(awaiting.rows[0]?.n ?? 0),
        payments: {
          paidCount: Number(payments.rows[0]?.paid ?? 0),
          paidAmountCents: Number(payments.rows[0]?.paid_cents ?? 0),
          refundedCount: Number(payments.rows[0]?.refunded ?? 0),
        },
        eventAccessDisabled: Number(disabled.rows[0]?.n ?? 0),
      };
    },

    async listRegistrations(eventId, query) {
      const params: unknown[] = [eventId, query.registrantType];
      const where = [`r.event_id = $1`, `r.registrant_type = $2`];
      const add = (sql: (n: number) => string, value: unknown) => {
        params.push(value);
        where.push(sql(params.length));
      };
      // Drafts are the family's private work in progress: an admin sees them only when asking for DRAFT explicitly.
      if (query.status && query.status !== 'FLAGGED') {
        add((n) => `r.status = $${n}`, query.status);
      } else where.push(`r.status <> 'DRAFT'`);
      // A document counts by its newest version per type: one that was replaced is no longer a concern.
      const newestDocs = `(select distinct on (x.document_type) x.* from public.documents x
                              where x.registration_id = r.id
                              order by x.document_type, x.created_at desc, x.id)`;
      if (query.status === 'FLAGGED') {
        where.push(
          `exists (select 1 from ${newestDocs} nd where nd.ai_rejected or nd.status = 'REJECTED')`,
        );
      }
      if (query.eventAccessDisabled === 'true') where.push('r.event_access_disabled');
      if (query.aiRejected === 'true') {
        where.push(`exists (select 1 from ${newestDocs} nd where nd.ai_rejected)`);
      }
      if (query.teamId) add((n) => `r.team_id = $${n}`, query.teamId);
      if (query.search) {
        add(
          (n) =>
            `((coalesce(pl.first_name, sp.first_name) || ' ' || coalesce(pl.last_name, sp.last_name)) ilike $${n} escape '\\'
              or r.registration_number ilike $${n} escape '\\' or sp.email ilike $${n} escape '\\')`,
          likeContains(query.search),
        );
      }
      if (query.documentsPending === 'true') {
        where.push(
          // Frozen (cancelled / rejected) registrations are not waiting on anyone: their documents can no longer be decided.
          `(r.status not in ('CANCELLED', 'REJECTED') and exists (select 1 from public.documents d
                    where d.registration_id = r.id and d.status = 'PENDING' and d.submitted_at is not null))`,
        );
      }
      const whereSql = where.join(' and ');
      const from = `from public.registrations r
                    left join public.players pl on pl.id = r.player_id
                    left join public.staff_profiles sp on sp.id = r.staff_profile_id
                    left join public.teams t on t.id = r.team_id`;

      const total = await q.query<{ n: string }>(
        `select count(*) as n ${from} where ${whereSql}`,
        params,
      );

      const limit = query.pageSize;
      const offset = (query.page - 1) * query.pageSize;
      const { rows } = await q.query<{
        id: string;
        registration_number: string;
        status: RegistrationStatus;
        submitted_at: Date | null;
        created_at: Date;
        event_access_disabled: boolean;
        registrant_type: RegistrantType;
        player_id: string | null;
        first_name: string;
        last_name: string;
        date_of_birth: string | null;
        age_division: 'U12' | 'U14' | 'U16' | null;
        staff_id: string | null;
        staff_email: string | null;
        staff_phone: string | null;
        staff_role: StaffRole | null;
        team_id: string | null;
        team_name: string | null;
        payment_status: AdminPlayerRow['paymentStatus'] | null;
        in_review: string;
        approved: string;
        rejected: string;
        not_submitted: string;
        ai_rejected: string;
      }>(
        `select r.id, r.registration_number, r.status, r.submitted_at, r.created_at, r.event_access_disabled,
                r.registrant_type, pl.id as player_id,
                coalesce(pl.first_name, sp.first_name) as first_name,
                coalesce(pl.last_name, sp.last_name) as last_name,
                pl.date_of_birth::text as date_of_birth, pl.age_division,
                sp.id as staff_id, sp.email as staff_email, sp.phone as staff_phone, sp.staff_role as staff_role,
                t.id as team_id, t.name as team_name,
                (select p.status from public.payments p where p.registration_id = r.id
                  order by (p.status = 'PAID') desc, p.created_at desc limit 1) as payment_status,
                dc.in_review, dc.approved, dc.rejected, dc.not_submitted, dc.ai_rejected
           ${from}
           left join lateral (
             select count(*) filter (where nd.submitted_at is not null and nd.status = 'PENDING'
                                       and r.status not in ('CANCELLED', 'REJECTED')) as in_review,
                    count(*) filter (where nd.status = 'APPROVED') as approved,
                    count(*) filter (where nd.status = 'REJECTED') as rejected,
                    count(*) filter (where nd.uploaded_at is not null and nd.submitted_at is null) as not_submitted,
                    count(*) filter (where nd.ai_rejected) as ai_rejected
               from (select distinct on (x.document_type) x.*
                       from public.documents x where x.registration_id = r.id
                      order by x.document_type, x.created_at desc, x.id) nd
           ) dc on true
          where ${whereSql}
          order by r.submitted_at desc nulls last, r.created_at desc, r.id
          limit ${limit} offset ${offset}`,
        params,
      );
      return {
        items: rows.map((r): AdminRegistrationRow => {
          const base = {
            id: r.id,
            registrationNumber: r.registration_number,
            status: r.status,
            submittedAt: r.submitted_at ? iso(r.submitted_at) : null,
            createdAt: iso(r.created_at),
            team: r.team_id && r.team_name ? { id: r.team_id, name: r.team_name } : null,
            documents: {
              inReview: Number(r.in_review),
              approved: Number(r.approved),
              rejected: Number(r.rejected),
              notSubmitted: Number(r.not_submitted),
              aiRejected: Number(r.ai_rejected),
            },
            eventAccessDisabled: r.event_access_disabled,
          };
          return r.registrant_type === 'PLAYER'
            ? {
                ...base,
                registrantType: 'PLAYER',
                player: {
                  id: r.player_id!,
                  firstName: r.first_name,
                  lastName: r.last_name,
                  dateOfBirth: r.date_of_birth!,
                  ageDivision: r.age_division,
                },
                paymentStatus: r.payment_status ?? 'NOT_STARTED',
              }
            : {
                ...base,
                registrantType: r.registrant_type,
                staffProfile: {
                  id: r.staff_id!,
                  firstName: r.first_name,
                  lastName: r.last_name,
                  email: r.staff_email!,
                  phone: r.staff_phone,
                  staffRole: r.staff_role,
                },
              };
        }),
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total.rows[0]?.n ?? 0),
      };
    },

    async reviewQueue(eventId, query) {
      const base = `from public.documents d
                    join public.registrations r on r.id = d.registration_id
                    join public.players pl on pl.id = r.player_id
                    left join public.teams t on t.id = r.team_id
                   where r.event_id = $1 and r.registrant_type = 'PLAYER'
                     and r.status not in ('CANCELLED', 'REJECTED')
                     and d.status = 'PENDING' and d.submitted_at is not null`;
      const total = await q.query<{ n: string }>(`select count(*) as n ${base}`, [eventId]);
      const { rows } = await q.query<{
        document_id: string;
        document_type: string;
        file_name: string;
        submitted_at: Date;
        registration_id: string;
        registration_number: string;
        reg_status: RegistrationStatus;
        player_id: string;
        first_name: string;
        last_name: string;
        team_id: string | null;
        team_name: string | null;
      }>(
        `select d.id as document_id, d.document_type, d.file_name, d.submitted_at,
                r.id as registration_id, r.registration_number, r.status as reg_status,
                pl.id as player_id, pl.first_name, pl.last_name, t.id as team_id, t.name as team_name
           ${base}
          order by d.submitted_at, d.id
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`,
        [eventId],
      );
      return {
        items: rows.map((r) => ({
          documentId: r.document_id,
          documentType: r.document_type,
          fileName: r.file_name,
          submittedAt: iso(r.submitted_at),
          registration: {
            id: r.registration_id,
            registrationNumber: r.registration_number,
            status: r.reg_status,
          },
          player: { id: r.player_id, firstName: r.first_name, lastName: r.last_name },
          team: r.team_id && r.team_name ? { id: r.team_id, name: r.team_name } : null,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total.rows[0]?.n ?? 0),
      };
    },

    async lockRegistration(registrationId) {
      const { rows } = await q.query<{
        id: string;
        registration_number: string;
        status: RegistrationStatus;
        registrant_type: string;
        organization_id: string;
        event_access_disabled: boolean;
        event_access_disabled_reason: string | null;
      }>(
        `select r.id, r.registration_number, r.status, r.registrant_type, e.organization_id, r.event_access_disabled, r.event_access_disabled_reason
           from public.registrations r join public.events e on e.id = r.event_id
          where r.id = $1 for update of r`,
        [registrationId],
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            registrationNumber: r.registration_number,
            status: r.status,
            registrantType: r.registrant_type,
            organizationId: r.organization_id,
            eventAccessDisabled: r.event_access_disabled,
            eventAccessDisabledReason: r.event_access_disabled_reason,
          }
        : null;
    },

    async setRejected(registrationId) {
      await q.query(`update public.registrations set status = 'REJECTED' where id = $1`, [
        registrationId,
      ]);
    },

    async setEventAccess(registrationId, disabled, reason) {
      const { rows } = await q.query<{
        id: string;
        registration_number: string;
        event_access_disabled: boolean;
        event_access_disabled_reason: string | null;
      }>(
        `update public.registrations
            set event_access_disabled = $2, event_access_disabled_reason = $3
          where id = $1
      returning id, registration_number, event_access_disabled, event_access_disabled_reason`,
        [registrationId, disabled, disabled ? reason : null],
      );
      const r = rows[0]!;
      return {
        id: r.id,
        registrationNumber: r.registration_number,
        eventAccessDisabled: r.event_access_disabled,
        eventAccessDisabledReason: r.event_access_disabled_reason,
      };
    },

    async insertHistory(i) {
      await q.query(
        `insert into public.registration_status_history (registration_id, from_status, to_status, changed_by, reason)
         values ($1, $2, $3, $4, $5)`,
        [i.registrationId, i.from, i.to, i.changedBy, i.reason],
      );
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: entry.entityType ?? 'registration',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createAdminRepository(db: Database): AdminRepository {
  const inTransaction: AdminRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
