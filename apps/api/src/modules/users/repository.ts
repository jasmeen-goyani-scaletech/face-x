import type { Database } from '../../infrastructure/database/database';
import { ROLES, type Role, type UserProfile } from './types';

export interface UserRepository {
  findById(id: string): Promise<UserProfile | null>;
  findByEmail(email: string): Promise<UserProfile | null>;
  findRoles(userId: string): Promise<Role[]>;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  organization_id: string | null;
  is_active: boolean;
}

export const toUserProfile = (row: UserRow): UserProfile => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  organizationId: row.organization_id,
  isActive: row.is_active,
});

const COLUMNS = 'id, email, full_name, organization_id, is_active';

export function createUserRepository(db: Database): UserRepository {
  return {
    async findById(id) {
      const { rows } = await db.query<UserRow>(
        `select ${COLUMNS} from public.users where id = $1`,
        [id],
      );
      return rows[0] ? toUserProfile(rows[0]) : null;
    },

    async findByEmail(email) {
      const { rows } = await db.query<UserRow>(
        `select ${COLUMNS} from public.users where email = lower($1)`,
        [email],
      );
      return rows[0] ? toUserProfile(rows[0]) : null;
    },

    async findRoles(userId) {
      const { rows } = await db.query<{ role: string }>(
        'select role from public.user_roles where user_id = $1 order by role',
        [userId],
      );
      const known = new Set<string>(ROLES);
      return rows.map((r) => r.role).filter((r): r is Role => known.has(r));
    },
  };
}
