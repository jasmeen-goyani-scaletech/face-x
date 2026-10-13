import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import type { UpdateStaffProfileBody } from './schema';
import type { StaffProfileDto, StaffProfileType, StaffRole } from './types';

export interface NewStaffProfile {
  userId: string;
  profileType: StaffProfileType;
  staffRole: StaffRole | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

export interface StaffProfileView {
  profile: StaffProfileDto;
  isOwner: boolean;
  /** The profile has a registration for an event of the viewer's organization (admin read access). */
  inViewerOrganization: boolean;
}

export interface StaffProfileRepository {
  transaction<T>(fn: (repo: StaffProfileRepository) => Promise<T>): Promise<T>;
  /** Null when this user already has a profile of this type (unique user + type). */
  insert(input: NewStaffProfile): Promise<string | null>;
  /** Row-locks the profile if `userId` owns it; returns its type. */
  lockOwned(profileId: string, userId: string): Promise<{ profileType: StaffProfileType } | null>;
  hasRegistrationPastDraft(profileId: string): Promise<boolean>;
  update(profileId: string, patch: UpdateStaffProfileBody): Promise<void>;
  findView(
    profileId: string,
    viewer: { userId: string; organizationId: string | null },
  ): Promise<StaffProfileView | null>;
  listOwned(userId: string): Promise<StaffProfileDto[]>;
  audit(entry: {
    action: AuditAction;
    actorUserId: string;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

interface ProfileRow {
  id: string;
  profile_type: StaffProfileType;
  staff_role: StaffRole | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `sp.id, sp.profile_type, sp.staff_role, sp.first_name, sp.last_name, sp.email, sp.phone,
  sp.created_at, sp.updated_at`;

const toDto = (r: ProfileRow): StaffProfileDto => ({
  id: r.id,
  profileType: r.profile_type,
  staffRole: r.staff_role,
  firstName: r.first_name,
  lastName: r.last_name,
  email: r.email,
  phone: r.phone,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const PATCH_COLUMNS: Record<keyof UpdateStaffProfileBody, string> = {
  staffRole: 'staff_role',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
};

function build(q: Queryable, run: StaffProfileRepository['transaction']): StaffProfileRepository {
  return {
    transaction: run,

    async insert(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.staff_profiles
           (user_id, profile_type, staff_role, first_name, last_name, email, phone)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (user_id, profile_type) do nothing
         returning id`,
        [i.userId, i.profileType, i.staffRole, i.firstName, i.lastName, i.email, i.phone],
      );
      return rows[0]?.id ?? null;
    },

    async lockOwned(profileId, userId) {
      const { rows } = await q.query<{ profile_type: StaffProfileType }>(
        `select profile_type from public.staff_profiles where id = $1 and user_id = $2 for update`,
        [profileId, userId],
      );
      return rows[0] ? { profileType: rows[0].profile_type } : null;
    },

    async hasRegistrationPastDraft(profileId) {
      const { rows } = await q.query(
        `select 1 from public.registrations where staff_profile_id = $1 and status <> 'DRAFT' limit 1`,
        [profileId],
      );
      return rows.length > 0;
    },

    async update(profileId, patch) {
      const sets: string[] = [];
      const values: unknown[] = [profileId];
      for (const key of Object.keys(PATCH_COLUMNS) as (keyof UpdateStaffProfileBody)[]) {
        if (patch[key] !== undefined) {
          values.push(patch[key]);
          sets.push(`${PATCH_COLUMNS[key]} = $${values.length}`);
        }
      }
      if (sets.length === 0) return;
      await q.query(`update public.staff_profiles set ${sets.join(', ')} where id = $1`, values);
    },

    async findView(profileId, viewer) {
      const { rows } = await q.query<ProfileRow & { is_owner: boolean; in_org: boolean }>(
        `select ${COLUMNS}, (sp.user_id = $2) as is_owner,
                exists (select 1 from public.registrations r join public.events e on e.id = r.event_id
                         where r.staff_profile_id = sp.id and e.organization_id = $3) as in_org
           from public.staff_profiles sp
          where sp.id = $1`,
        [profileId, viewer.userId, viewer.organizationId],
      );
      const r = rows[0];
      return r ? { profile: toDto(r), isOwner: r.is_owner, inViewerOrganization: r.in_org } : null;
    },

    async listOwned(userId) {
      const { rows } = await q.query<ProfileRow>(
        `select ${COLUMNS} from public.staff_profiles sp where sp.user_id = $1
          order by sp.profile_type, sp.id`,
        [userId],
      );
      return rows.map(toDto);
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: 'staff_profile',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createStaffProfileRepository(db: Database): StaffProfileRepository {
  const inTransaction: StaffProfileRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
