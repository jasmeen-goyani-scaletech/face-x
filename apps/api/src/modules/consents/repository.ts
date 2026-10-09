import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { ownsRegistrantSql } from '../staff';
import type { ConsentRecordDto, ConsentRegistrantType, ConsentVersionDto } from './types';

export interface ConsentRegistration {
  registrationId: string;
  registrantType: ConsentRegistrantType;
  status: string;
  /** Null for a coach/staff registration. */
  playerId: string | null;
  /** The registrant's own name (the player's, or the coach/staff member's): what a signature must match. */
  registrantFirstName: string;
  registrantLastName: string;
  /** Null for a coach/staff registration (age does not matter for them). */
  playerDateOfBirth: string | null;
  /** The registrant's own account, when the player manages their own registration or for a coach/staff member. */
  playerUserId: string | null;
  isOwner: boolean;
  eventOrganizationId: string;
  eventStartsAt: Date;
  eventTimezone: string;
}

export interface Signer {
  parentId: string;
  firstName: string;
  lastName: string;
}

export interface ConsentRepository {
  transaction<T>(fn: (repo: ConsentRepository) => Promise<T>): Promise<T>;

  findRegistration(registrationId: string, userId: string): Promise<ConsentRegistration | null>;
  /** Share-locks the registration and returns its status. */
  lockRegistrationStatus(registrationId: string): Promise<string | null>;

  /** The newest published version of a consent (effective now or earlier). */
  findCurrent(code: string): Promise<ConsentVersionDto | null>;
  /** A specific version, if it is already effective. */
  findEffectiveById(consentId: string): Promise<ConsentVersionDto | null>;
  /** The caller's guardian record, if they are a linked guardian of the player. */
  findSigner(playerId: string, userId: string): Promise<Signer | null>;

  /** Null when this version was already recorded for the registration (unique consent + registration). */
  insertRecord(input: {
    consentId: string;
    registrationId: string;
    acceptedByUserId: string;
    acceptedByParentId: string | null;
    signedName: string;
    meta: RequestMeta;
  }): Promise<string | null>;
  listRecords(registrationId: string): Promise<ConsentRecordDto[]>;

  audit(entry: {
    action: AuditAction;
    actorUserId: string;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

interface ConsentRow {
  id: string;
  code: string;
  version: number;
  title: string;
  body: string;
  effective_at: Date;
}

const toVersion = (r: ConsentRow): ConsentVersionDto => ({
  id: r.id,
  code: r.code,
  version: r.version,
  title: r.title,
  body: r.body,
  effectiveAt: r.effective_at.toISOString(),
});

const CONSENT_COLUMNS = 'id, code, version, title, body, effective_at';

function build(q: Queryable, run: ConsentRepository['transaction']): ConsentRepository {
  return {
    transaction: run,

    async findRegistration(registrationId, userId) {
      const { rows } = await q.query<{
        id: string;
        registrant_type: ConsentRegistrantType;
        status: string;
        player_id: string | null;
        first_name: string;
        last_name: string;
        dob: string | null;
        player_user: string | null;
        is_owner: boolean;
        org: string;
        starts_at: Date;
        timezone: string;
      }>(
        `select r.id, r.registrant_type, r.status, pl.id as player_id,
                coalesce(pl.first_name, sp.first_name) as first_name,
                coalesce(pl.last_name, sp.last_name) as last_name,
                pl.date_of_birth::text as dob, coalesce(pl.user_id, sp.user_id) as player_user,
                ${ownsRegistrantSql('pl', 'sp', '$2')} as is_owner,
                e.organization_id as org, e.starts_at, e.timezone
           from public.registrations r
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
           join public.events e on e.id = r.event_id
          where r.id = $1`,
        [registrationId, userId],
      );
      const r = rows[0];
      return r
        ? {
            registrationId: r.id,
            registrantType: r.registrant_type,
            status: r.status,
            playerId: r.player_id,
            registrantFirstName: r.first_name,
            registrantLastName: r.last_name,
            playerDateOfBirth: r.dob,
            playerUserId: r.player_user,
            isOwner: r.is_owner,
            eventOrganizationId: r.org,
            eventStartsAt: r.starts_at,
            eventTimezone: r.timezone,
          }
        : null;
    },

    async lockRegistrationStatus(registrationId) {
      const { rows } = await q.query<{ status: string }>(
        'select status from public.registrations where id = $1 for share',
        [registrationId],
      );
      return rows[0]?.status ?? null;
    },

    async findCurrent(code) {
      const { rows } = await q.query<ConsentRow>(
        `select ${CONSENT_COLUMNS} from public.consents
          where code = $1 and effective_at <= now()
          order by version desc limit 1`,
        [code],
      );
      return rows[0] ? toVersion(rows[0]) : null;
    },

    async findEffectiveById(consentId) {
      const { rows } = await q.query<ConsentRow>(
        `select ${CONSENT_COLUMNS} from public.consents where id = $1 and effective_at <= now()`,
        [consentId],
      );
      return rows[0] ? toVersion(rows[0]) : null;
    },

    async findSigner(playerId, userId) {
      const { rows } = await q.query<{ id: string; first_name: string; last_name: string }>(
        `select pa.id, pa.first_name, pa.last_name
           from public.player_parents pp join public.parents pa on pa.id = pp.parent_id
          where pp.player_id = $1 and pa.user_id = $2`,
        [playerId, userId],
      );
      const r = rows[0];
      return r ? { parentId: r.id, firstName: r.first_name, lastName: r.last_name } : null;
    },

    async insertRecord(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.consent_records
           (consent_id, registration_id, accepted_by_user_id, accepted_by_parent_id, signed_name, ip_address, user_agent)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (consent_id, registration_id) do nothing
         returning id`,
        [
          i.consentId,
          i.registrationId,
          i.acceptedByUserId,
          i.acceptedByParentId,
          i.signedName,
          i.meta.ip,
          i.meta.userAgent,
        ],
      );
      return rows[0]?.id ?? null;
    },

    async listRecords(registrationId) {
      // ip_address and user_agent are kept for the audit trail but never returned by the API.
      const { rows } = await q.query<{
        id: string;
        consent_id: string;
        code: string;
        version: number;
        accepted_at: Date;
        signed_name: string;
        by_parent: boolean;
        registrant_type: ConsentRegistrantType;
        is_current: boolean;
      }>(
        `select cr.id, cr.consent_id, c.code, c.version, cr.accepted_at, cr.signed_name,
                (cr.accepted_by_parent_id is not null) as by_parent, r.registrant_type,
                (c.version = (select max(c2.version) from public.consents c2
                               where c2.code = c.code and c2.effective_at <= now())) as is_current
           from public.consent_records cr
          join public.consents c on c.id = cr.consent_id
          join public.registrations r on r.id = cr.registration_id
          where cr.registration_id = $1
          order by cr.accepted_at, cr.id`,
        [registrationId],
      );
      return rows.map((r) => ({
        id: r.id,
        consentId: r.consent_id,
        code: r.code,
        version: r.version,
        acceptedAt: r.accepted_at.toISOString(),
        signedName: r.signed_name,
        signedBy: r.by_parent ? 'GUARDIAN' : r.registrant_type === 'PLAYER' ? 'PLAYER' : 'SELF',
        currentVersion: r.is_current,
      }));
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: 'consent_record',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createConsentRepository(db: Database): ConsentRepository {
  const inTransaction: ConsentRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
