import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { ownsPlayerSql } from './ownership';
import type { AgeDivision, GuardianDto, PlayerDetail, PlayerDto } from './types';

export interface PlayerView {
  player: PlayerDetail;
  isOwner: boolean;
  /** The viewer's organization owns an event this player is registered for. */
  inViewerOrganization: boolean;
}

export interface PlayerPatch {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  email?: string | null;
  phone?: string | null;
  schoolId?: string | null;
  ageDivision?: AgeDivision;
}

export interface ExistingParent {
  id: string;
  userId: string | null;
  /** Already linked to a player the caller owns, i.e. the caller's own family record. */
  linkedToCallerFamily: boolean;
}

export interface NewPlayer {
  userId: string | null;
  createdBy: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string | null;
  phone: string | null;
  schoolId: string | null;
  ageDivision: AgeDivision;
}

export interface PlayerRepository {
  /** Runs `fn` with a repository bound to one database transaction. */
  transaction<T>(fn: (repo: PlayerRepository) => Promise<T>): Promise<T>;

  /** Null when `userId` is set and that user already has a player record. */
  insertPlayer(input: NewPlayer): Promise<string | null>;
  findOwnParentId(userId: string): Promise<string | null>;
  /** The caller's own guardian record. Null when the email is already used by another guardian record. */
  insertOwnParent(input: {
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  }): Promise<string | null>;
  /** Updates the caller's own guardian record with whatever the latest registration submitted (a field left out stays as it is). */
  updateOwnParent(
    parentId: string,
    input: { firstName?: string; lastName?: string; phone?: string },
  ): Promise<void>;
  /** A guardian record without an account. Null when the email is already taken (race). */
  insertParentWithoutAccount(input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  }): Promise<string | null>;
  findParentByEmail(email: string, callerId: string): Promise<ExistingParent | null>;
  /** False when the guardian is already linked to the player. */
  linkParent(input: {
    playerId: string;
    parentId: string;
    relationship: string;
    isPrimary: boolean;
  }): Promise<boolean>;

  findView(
    playerId: string,
    viewer: { userId: string; organizationId: string | null },
  ): Promise<PlayerView | null>;
  listOwned(userId: string): Promise<PlayerDto[]>;

  /** Row-locks the player if `userId` owns it. False when not found / not owned. */
  lockOwned(playerId: string, userId: string): Promise<boolean>;
  hasRegistrationPastDraft(playerId: string): Promise<boolean>;
  update(playerId: string, patch: PlayerPatch): Promise<void>;

  audit(entry: {
    action: AuditAction;
    actorUserId: string;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

interface PlayerRow {
  id: string;
  first_name: string;
  last_name: string;
  dob: string;
  email: string | null;
  phone: string | null;
  school_id: string | null;
  age_division: AgeDivision | null;
  created_at: Date;
  updated_at: Date;
}

const PLAYER_COLUMNS = `pl.id, pl.first_name, pl.last_name, pl.date_of_birth::text as dob,
  pl.email, pl.phone, pl.school_id, pl.age_division, pl.created_at, pl.updated_at`;

export const toPlayerDto = (r: PlayerRow): PlayerDto => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  dateOfBirth: r.dob,
  email: r.email,
  phone: r.phone,
  schoolId: r.school_id,
  ageDivision: r.age_division,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** Guardians of a player, primary first. Shared with the registrations module. */
export async function listGuardians(q: Queryable, playerId: string): Promise<GuardianDto[]> {
  const { rows } = await q.query<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    relationship: string;
    is_primary: boolean;
  }>(
    `select pa.id, pa.first_name, pa.last_name, pa.email, pa.phone, pp.relationship, pp.is_primary
       from public.player_parents pp join public.parents pa on pa.id = pp.parent_id
      where pp.player_id = $1
      order by pp.is_primary desc, pp.created_at, pa.id`,
    [playerId],
  );
  return rows.map((g) => ({
    id: g.id,
    firstName: g.first_name,
    lastName: g.last_name,
    email: g.email,
    phone: g.phone,
    relationship: g.relationship,
    isPrimary: g.is_primary,
  }));
}

// Maps patch keys to columns. Fixed here, so column names never come from user input.
const PATCH_COLUMNS: Record<keyof PlayerPatch, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  dateOfBirth: 'date_of_birth',
  email: 'email',
  phone: 'phone',
  schoolId: 'school_id',
  ageDivision: 'age_division',
};

function build(q: Queryable, run: PlayerRepository['transaction']): PlayerRepository {
  return {
    transaction: run,

    async insertPlayer(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.players (user_id, created_by, first_name, last_name, date_of_birth, email, phone, school_id, age_division)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (user_id) do nothing
         returning id`,
        [
          i.userId,
          i.createdBy,
          i.firstName,
          i.lastName,
          i.dateOfBirth,
          i.email,
          i.phone,
          i.schoolId,
          i.ageDivision,
        ],
      );
      return rows[0]?.id ?? null;
    },

    async findOwnParentId(userId) {
      const { rows } = await q.query<{ id: string }>(
        'select id from public.parents where user_id = $1',
        [userId],
      );
      return rows[0]?.id ?? null;
    },

    async insertOwnParent(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.parents (user_id, first_name, last_name, email, phone)
         values ($1, $2, $3, $4, $5)
         on conflict do nothing
         returning id`,
        [i.userId, i.firstName, i.lastName, i.email, i.phone],
      );
      return rows[0]?.id ?? null;
    },

    async updateOwnParent(parentId, i) {
      await q.query(
        `update public.parents
            set first_name = coalesce($2, first_name),
                last_name = coalesce($3, last_name),
                phone = coalesce($4, phone)
          where id = $1`,
        [parentId, i.firstName ?? null, i.lastName ?? null, i.phone ?? null],
      );
    },

    async insertParentWithoutAccount(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.parents (first_name, last_name, email, phone)
         values ($1, $2, $3, $4)
         on conflict do nothing
         returning id`,
        [i.firstName, i.lastName, i.email, i.phone],
      );
      return rows[0]?.id ?? null;
    },

    async findParentByEmail(email, callerId) {
      const { rows } = await q.query<{ id: string; user_id: string | null; family: boolean }>(
        `select pa.id, pa.user_id,
                exists (select 1 from public.player_parents pp
                          join public.players pl on pl.id = pp.player_id
                         where pp.parent_id = pa.id and ${ownsPlayerSql('pl', '$2')}) as family
           from public.parents pa
          where pa.email = $1`,
        [email, callerId],
      );
      const r = rows[0];
      return r ? { id: r.id, userId: r.user_id, linkedToCallerFamily: r.family } : null;
    },

    async linkParent(i) {
      const { rowCount } = await q.query(
        `insert into public.player_parents (player_id, parent_id, relationship, is_primary)
         values ($1, $2, $3, $4)
         on conflict (player_id, parent_id) do nothing`,
        [i.playerId, i.parentId, i.relationship, i.isPrimary],
      );
      return (rowCount ?? 0) > 0;
    },

    async findView(playerId, viewer) {
      const { rows } = await q.query<PlayerRow & { is_owner: boolean; in_org: boolean }>(
        `select ${PLAYER_COLUMNS},
                ${ownsPlayerSql('pl', '$2')} as is_owner,
                exists (select 1 from public.registrations r join public.events e on e.id = r.event_id
                         where r.player_id = pl.id and e.organization_id = $3) as in_org
           from public.players pl
          where pl.id = $1`,
        [playerId, viewer.userId, viewer.organizationId],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        player: { ...toPlayerDto(r), guardians: await listGuardians(q, playerId) },
        isOwner: r.is_owner,
        inViewerOrganization: r.in_org,
      };
    },

    async listOwned(userId) {
      const { rows } = await q.query<PlayerRow>(
        `select ${PLAYER_COLUMNS} from public.players pl
          where ${ownsPlayerSql('pl', '$1')}
          order by pl.last_name, pl.first_name, pl.id
          limit 200`,
        [userId],
      );
      return rows.map(toPlayerDto);
    },

    async lockOwned(playerId, userId) {
      const { rows } = await q.query(
        `select 1 from public.players pl
          where pl.id = $1 and ${ownsPlayerSql('pl', '$2')}
            for update of pl`,
        [playerId, userId],
      );
      return rows.length > 0;
    },

    async hasRegistrationPastDraft(playerId) {
      const { rows } = await q.query(
        `select 1 from public.registrations where player_id = $1 and status <> 'DRAFT' limit 1`,
        [playerId],
      );
      return rows.length > 0;
    },

    async update(playerId, patch) {
      const sets: string[] = [];
      const values: unknown[] = [playerId];
      for (const key of Object.keys(PATCH_COLUMNS) as (keyof PlayerPatch)[]) {
        if (patch[key] !== undefined) {
          values.push(patch[key]);
          sets.push(`${PATCH_COLUMNS[key]} = $${values.length}`);
        }
      }
      if (sets.length === 0) return;
      await q.query(`update public.players set ${sets.join(', ')} where id = $1`, values);
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: 'player',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createPlayerRepository(db: Database): PlayerRepository {
  const inTransaction: PlayerRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
