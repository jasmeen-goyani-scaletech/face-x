import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { listGuardians, ownsPlayerSql } from '../players';
import {
  ownsRegistrantSql,
  ownsStaffProfileSql,
  type StaffProfileType,
  type StaffRole,
} from '../staff';
import type { RegistrantType, RegistrationStatus } from './transitions';
import type { AgeDivision } from '../players/types';
import type { RegistrationDto, RegistrationSummary, StatusHistoryEntry } from './types';

export interface EventRow {
  id: string;
  status: string;
  organizationId: string;
  startsAt: Date;
  timezone: string;
  feeCents: number;
  currency: string;
}

export interface TeamRow {
  id: string;
  eventId: string;
  status: string;
}

export interface LockedRegistration {
  id: string;
  status: RegistrationStatus;
  registrantType: RegistrantType;
  eventId: string;
  /** Set for a player registration, null for coach/staff. */
  playerId: string | null;
  teamId: string | null;
}

export interface RegistrationView {
  registration: RegistrationDto;
  isOwner: boolean;
  /** Organization that owns the registration's event (used for the admin check, never returned). */
  eventOrganizationId: string;
}

export interface RegistrationRepository {
  /** Runs `fn` with a repository bound to one database transaction. */
  transaction<T>(fn: (repo: RegistrationRepository) => Promise<T>): Promise<T>;

  /** Share-locks the event so it cannot be changed under a registration being created or submitted. */
  lockEvent(eventId: string): Promise<EventRow | null>;
  findTeam(teamId: string): Promise<TeamRow | null>;
  /**
   * How full a team is for one kind of registrant. With `lock` the team row is locked first, so concurrent submissions to the
   * same team take turns and each one counts the places the previous ones took. `max` null = unlimited.
   */
  teamCapacity(
    teamId: string,
    registrantType: RegistrantType,
    lock: boolean,
  ): Promise<{ teamName: string; max: number | null; used: number } | null>;
  isPlayerOwner(playerId: string, userId: string): Promise<boolean>;
  /** The caller's own staff profile (its type decides COACH or STAFF), or null if it is not theirs. */
  findOwnedStaffProfile(
    staffProfileId: string,
    userId: string,
  ): Promise<{ profileType: StaffProfileType } | null>;

  /** Null when the person is already registered for the event (unique event + player / event + staff profile). */
  insert(input: {
    eventId: string;
    registrantType: RegistrantType;
    playerId: string | null;
    staffProfileId: string | null;
    teamId: string | null;
    guestCount: number;
    feeCents: number;
    currency: string;
    createdBy: string;
  }): Promise<string | null>;
  insertHistory(input: {
    registrationId: string;
    from: RegistrationStatus | null;
    to: RegistrationStatus;
    changedBy: string;
    reason?: string;
  }): Promise<void>;

  /** Row-locks the registration if `userId` owns its registrant (the player's family, or the coach/staff member). */
  lockOwned(registrationId: string, userId: string): Promise<LockedRegistration | null>;
  updateDraft(
    registrationId: string,
    patch: { teamId?: string | null; guestCount?: number },
  ): Promise<void>;
  markSubmitted(registrationId: string, fee: { feeCents: number; currency: string }): Promise<void>;
  /** Share-locks the player and returns the date of birth (`YYYY-MM-DD`). */
  lockPlayerDateOfBirth(playerId: string): Promise<string | null>;
  countGuardians(playerId: string): Promise<number>;

  findView(registrationId: string, userId: string): Promise<RegistrationView | null>;
  listOwned(
    userId: string,
    filter?: {
      eventId?: string;
      playerId?: string;
      staffProfileId?: string;
      registrantType?: RegistrantType;
    },
  ): Promise<RegistrationSummary[]>;
  listHistory(registrationId: string): Promise<StatusHistoryEntry[]>;

  audit(entry: {
    action: AuditAction;
    actorUserId: string;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

interface ViewRow {
  id: string;
  registration_number: string;
  status: RegistrationStatus;
  guest_count: number;
  event_access_disabled: boolean;
  fee_cents: number;
  currency: string;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  is_owner: boolean;
  event_id: string;
  event_name: string;
  event_starts_at: Date;
  event_timezone: string;
  event_status: string;
  event_org: string;
  team_id: string | null;
  team_name: string | null;
  team_club: string | null;
  team_division: string | null;
  registrant_type: RegistrantType;
  player_id: string | null;
  player_first_name: string | null;
  player_last_name: string | null;
  player_dob: string | null;
  player_email: string | null;
  player_phone: string | null;
  player_school_id: string | null;
  player_age_division: AgeDivision | null;
  staff_id: string | null;
  staff_first_name: string | null;
  staff_last_name: string | null;
  staff_email: string | null;
  staff_phone: string | null;
  staff_role: StaffRole | null;
}

function build(q: Queryable, run: RegistrationRepository['transaction']): RegistrationRepository {
  return {
    transaction: run,

    async lockEvent(eventId) {
      const { rows } = await q.query<{
        id: string;
        status: string;
        organization_id: string;
        starts_at: Date;
        timezone: string;
        registration_fee_cents: number;
        currency: string;
      }>(
        `select id, status, organization_id, starts_at, timezone, registration_fee_cents, currency
           from public.events where id = $1 for share`,
        [eventId],
      );
      const e = rows[0];
      return e
        ? {
            id: e.id,
            status: e.status,
            organizationId: e.organization_id,
            startsAt: e.starts_at,
            timezone: e.timezone,
            feeCents: e.registration_fee_cents,
            currency: e.currency,
          }
        : null;
    },

    async findTeam(teamId) {
      const { rows } = await q.query<{ id: string; event_id: string; status: string }>(
        'select id, event_id, status from public.teams where id = $1',
        [teamId],
      );
      const t = rows[0];
      return t ? { id: t.id, eventId: t.event_id, status: t.status } : null;
    },

    async teamCapacity(teamId, registrantType, lock) {
      // Two statements on purpose: the count must be taken after the lock is held, not before waiting for it.
      const { rows } = await q.query<{ name: string; max: number | null }>(
        `select name, case $2 when 'PLAYER' then max_players when 'COACH' then max_coaches else max_staff end as max
           from public.teams where id = $1 ${lock ? 'for update' : ''}`,
        [teamId, registrantType],
      );
      const team = rows[0];
      if (!team) return null;
      if (team.max === null) return { teamName: team.name, max: null, used: 0 };
      const { rows: counted } = await q.query<{ n: string }>(
        `select count(*) as n from public.registrations
          where team_id = $1 and registrant_type = $2 and status not in ('DRAFT', 'CANCELLED', 'REJECTED')`,
        [teamId, registrantType],
      );
      return { teamName: team.name, max: team.max, used: Number(counted[0]?.n ?? 0) };
    },

    async isPlayerOwner(playerId, userId) {
      const { rows } = await q.query(
        `select 1 from public.players pl where pl.id = $1 and ${ownsPlayerSql('pl', '$2')}`,
        [playerId, userId],
      );
      return rows.length > 0;
    },

    async findOwnedStaffProfile(staffProfileId, userId) {
      const { rows } = await q.query<{ profile_type: StaffProfileType }>(
        `select sp.profile_type from public.staff_profiles sp
          where sp.id = $1 and ${ownsStaffProfileSql('sp', '$2')}`,
        [staffProfileId, userId],
      );
      return rows[0] ? { profileType: rows[0].profile_type } : null;
    },

    async insert(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.registrations
           (event_id, registrant_type, player_id, staff_profile_id, team_id, guest_count, fee_cents, currency, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict do nothing
         returning id`,
        [
          i.eventId,
          i.registrantType,
          i.playerId,
          i.staffProfileId,
          i.teamId,
          i.guestCount,
          i.feeCents,
          i.currency,
          i.createdBy,
        ],
      );
      return rows[0]?.id ?? null;
    },

    async insertHistory(i) {
      await q.query(
        `insert into public.registration_status_history (registration_id, from_status, to_status, changed_by, reason)
         values ($1, $2, $3, $4, $5)`,
        [i.registrationId, i.from, i.to, i.changedBy, i.reason ?? null],
      );
    },

    async lockOwned(registrationId, userId) {
      const { rows } = await q.query<{
        id: string;
        status: RegistrationStatus;
        registrant_type: RegistrantType;
        event_id: string;
        player_id: string | null;
        team_id: string | null;
      }>(
        `select r.id, r.status, r.registrant_type, r.event_id, r.player_id, r.team_id
           from public.registrations r
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
          where r.id = $1 and ${ownsRegistrantSql('pl', 'sp', '$2')}
            for update of r`,
        [registrationId, userId],
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            status: r.status,
            registrantType: r.registrant_type,
            eventId: r.event_id,
            playerId: r.player_id,
            teamId: r.team_id,
          }
        : null;
    },

    async updateDraft(registrationId, patch) {
      await q.query(
        `update public.registrations
            set team_id = case when $2::boolean then $3::uuid else team_id end,
                guest_count = coalesce($4::integer, guest_count)
          where id = $1 and status = 'DRAFT'`,
        [
          registrationId,
          patch.teamId !== undefined,
          patch.teamId ?? null,
          patch.guestCount ?? null,
        ],
      );
    },

    async markSubmitted(registrationId, fee) {
      await q.query(
        `update public.registrations
            set status = 'SUBMITTED', submitted_at = now(), fee_cents = $2, currency = $3
          where id = $1 and status = 'DRAFT'`,
        [registrationId, fee.feeCents, fee.currency],
      );
    },

    async lockPlayerDateOfBirth(playerId) {
      const { rows } = await q.query<{ dob: string }>(
        'select date_of_birth::text as dob from public.players where id = $1 for share',
        [playerId],
      );
      return rows[0]?.dob ?? null;
    },

    async countGuardians(playerId) {
      const { rows } = await q.query<{ n: number }>(
        'select count(*)::int as n from public.player_parents where player_id = $1',
        [playerId],
      );
      return rows[0]?.n ?? 0;
    },

    async findView(registrationId, userId) {
      const { rows } = await q.query<ViewRow>(
        `select r.id, r.registration_number, r.registrant_type, r.status, r.guest_count, r.event_access_disabled, r.fee_cents,
                r.currency, r.submitted_at, r.created_at, r.updated_at,
                ${ownsRegistrantSql('pl', 'sp', '$2')} as is_owner,
                e.id as event_id, e.name as event_name, e.starts_at as event_starts_at,
                e.timezone as event_timezone, e.status as event_status, e.organization_id as event_org,
                t.id as team_id, t.name as team_name, t.club as team_club, t.division as team_division,
                pl.id as player_id, pl.first_name as player_first_name, pl.last_name as player_last_name,
                pl.date_of_birth::text as player_dob, pl.email as player_email, pl.phone as player_phone,
                pl.school_id as player_school_id, pl.age_division as player_age_division,
                sp.id as staff_id, sp.first_name as staff_first_name, sp.last_name as staff_last_name,
                sp.email as staff_email, sp.phone as staff_phone, sp.staff_role as staff_role
           from public.registrations r
           join public.events e on e.id = r.event_id
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
           left join public.teams t on t.id = r.team_id
          where r.id = $1`,
        [registrationId, userId],
      );
      const v = rows[0];
      if (!v) return null;
      const base = {
        id: v.id,
        registrationNumber: v.registration_number,
        status: v.status,
        guestCount: v.guest_count,
        eventAccessDisabled: v.event_access_disabled,
        fee: { amountCents: v.fee_cents, currency: v.currency },
        submittedAt: v.submitted_at?.toISOString() ?? null,
        createdAt: v.created_at.toISOString(),
        updatedAt: v.updated_at.toISOString(),
        event: {
          id: v.event_id,
          name: v.event_name,
          startsAt: v.event_starts_at.toISOString(),
          timezone: v.event_timezone,
          status: v.event_status,
        },
        team: v.team_id
          ? { id: v.team_id, name: v.team_name!, club: v.team_club!, division: v.team_division! }
          : null,
      };
      const registration: RegistrationDto =
        v.registrant_type === 'PLAYER'
          ? {
              ...base,
              registrantType: 'PLAYER',
              player: {
                id: v.player_id!,
                firstName: v.player_first_name!,
                lastName: v.player_last_name!,
                dateOfBirth: v.player_dob!,
                email: v.player_email,
                phone: v.player_phone,
                schoolId: v.player_school_id,
                ageDivision: v.player_age_division,
              },
              guardians: await listGuardians(q, v.player_id!),
            }
          : {
              ...base,
              registrantType: v.registrant_type,
              staffProfile: {
                id: v.staff_id!,
                firstName: v.staff_first_name!,
                lastName: v.staff_last_name!,
                email: v.staff_email!,
                phone: v.staff_phone,
                staffRole: v.staff_role,
              },
            };
      return { isOwner: v.is_owner, eventOrganizationId: v.event_org, registration };
    },

    async listOwned(userId, filter = {}) {
      const { rows } = await q.query<{
        id: string;
        registration_number: string;
        registrant_type: RegistrantType;
        status: RegistrationStatus;
        submitted_at: Date | null;
        created_at: Date;
        event_id: string;
        event_name: string;
        event_starts_at: Date;
        team_id: string | null;
        team_name: string | null;
        player_id: string | null;
        staff_id: string | null;
        first_name: string;
        last_name: string;
      }>(
        `select r.id, r.registration_number, r.registrant_type, r.status, r.submitted_at, r.created_at,
                e.id as event_id, e.name as event_name, e.starts_at as event_starts_at,
                t.id as team_id, t.name as team_name,
                pl.id as player_id, sp.id as staff_id,
                coalesce(pl.first_name, sp.first_name) as first_name,
                coalesce(pl.last_name, sp.last_name) as last_name
           from public.registrations r
           join public.events e on e.id = r.event_id
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
           left join public.teams t on t.id = r.team_id
          where r.registrant_type = $4 and ${ownsRegistrantSql('pl', 'sp', '$1')}
            and ($2::uuid is null or r.event_id = $2::uuid)
            and ($3::uuid is null or r.player_id = $3::uuid)
            and ($5::uuid is null or r.staff_profile_id = $5::uuid)
          order by r.created_at desc, r.id
          limit 100`,
        [
          userId,
          filter.eventId ?? null,
          filter.playerId ?? null,
          filter.registrantType ?? 'PLAYER',
          filter.staffProfileId ?? null,
        ],
      );
      return rows.map((r): RegistrationSummary => {
        const base = {
          id: r.id,
          registrationNumber: r.registration_number,
          status: r.status,
          submittedAt: r.submitted_at?.toISOString() ?? null,
          createdAt: r.created_at.toISOString(),
          event: { id: r.event_id, name: r.event_name, startsAt: r.event_starts_at.toISOString() },
          team: r.team_id ? { id: r.team_id, name: r.team_name! } : null,
        };
        return r.registrant_type === 'PLAYER'
          ? {
              ...base,
              registrantType: 'PLAYER',
              player: { id: r.player_id!, firstName: r.first_name, lastName: r.last_name },
            }
          : {
              ...base,
              registrantType: r.registrant_type,
              staffProfile: { id: r.staff_id!, firstName: r.first_name, lastName: r.last_name },
            };
      });
    },

    async listHistory(registrationId) {
      const { rows } = await q.query<{
        from_status: RegistrationStatus | null;
        to_status: RegistrationStatus;
        created_at: Date;
        reason: string | null;
        actor: 'SYSTEM' | 'FAMILY' | 'STAFF';
      }>(
        `select h.from_status, h.to_status, h.created_at, h.reason,
                case when h.changed_by is null then 'SYSTEM'
                     when h.changed_by is not distinct from r.created_by then 'FAMILY'
                     else 'STAFF' end as actor
           from public.registration_status_history h
           join public.registrations r on r.id = h.registration_id
          where h.registration_id = $1
          order by h.created_at, h.id`,
        [registrationId],
      );
      return rows.map((h) => ({
        from: h.from_status,
        to: h.to_status,
        at: h.created_at.toISOString(),
        reason: h.reason,
        actor: h.actor,
      }));
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: 'registration',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createRegistrationRepository(db: Database): RegistrationRepository {
  const inTransaction: RegistrationRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
