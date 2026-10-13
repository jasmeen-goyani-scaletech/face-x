import {
  isUniqueViolation,
  type Database,
  type Queryable,
} from '../../infrastructure/database/database';
import { toUserProfile } from '../users';
import type { UserProfile } from '../users';
import type { RotationResult } from './types';

export interface Credentials {
  userId: string;
  passwordHash: string;
  isActive: boolean;
}

export interface AuthRepository {
  /** Creates the user and its credentials atomically. Null when the email is already registered. */
  createUserWithPassword(input: {
    email: string;
    fullName: string | null;
    passwordHash: string;
  }): Promise<UserProfile | null>;
  findCredentialsByEmail(email: string): Promise<Credentials | null>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  createRefreshToken(input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /**
   * Atomically consumes `presentedHash` and issues `newHash` in the same family. Presenting a token
   * that was already rotated revokes the entire family (token theft / replay).
   */
  rotateRefreshToken(input: {
    presentedHash: string;
    newHash: string;
    newExpiresAt: Date;
  }): Promise<RotationResult>;
  /** Revokes the whole session (token family) that `tokenHash` belongs to. Idempotent. */
  revokeFamilyByTokenHash(tokenHash: string, reason: 'LOGOUT'): Promise<void>;
}

async function revokeFamily(tx: Queryable, familyId: string, reason: string): Promise<void> {
  await tx.query(
    `update public.refresh_tokens
        set revoked_at = now(), revoked_reason = $2
      where family_id = $1 and revoked_at is null`,
    [familyId, reason],
  );
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    async createUserWithPassword({ email, fullName, passwordHash }) {
      try {
        return await db.transaction(async (tx) => {
          const { rows } = await tx.query<{
            id: string;
            email: string;
            full_name: string | null;
            organization_id: string | null;
            is_active: boolean;
          }>(
            `insert into public.users (email, full_name) values ($1, $2)
             returning id, email, full_name, organization_id, is_active`,
            [email, fullName],
          );
          const row = rows[0]!;
          await tx.query(
            'insert into public.user_credentials (user_id, password_hash) values ($1, $2)',
            [row.id, passwordHash],
          );
          return toUserProfile(row);
        });
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_key')) return null;
        throw err;
      }
    },

    async findCredentialsByEmail(email) {
      const { rows } = await db.query<{ id: string; password_hash: string; is_active: boolean }>(
        `select u.id, c.password_hash, u.is_active
           from public.users u
           join public.user_credentials c on c.user_id = u.id
          where u.email = $1`,
        [email],
      );
      const row = rows[0];
      return row
        ? { userId: row.id, passwordHash: row.password_hash, isActive: row.is_active }
        : null;
    },

    async updatePasswordHash(userId, passwordHash) {
      await db.query('update public.user_credentials set password_hash = $2 where user_id = $1', [
        userId,
        passwordHash,
      ]);
    },

    async createRefreshToken({ userId, familyId, tokenHash, expiresAt }) {
      await db.query(
        `insert into public.refresh_tokens (user_id, family_id, token_hash, expires_at)
         values ($1, $2, $3, $4)`,
        [userId, familyId, tokenHash, expiresAt],
      );
    },

    rotateRefreshToken({ presentedHash, newHash, newExpiresAt }) {
      return db.transaction<RotationResult>(async (tx) => {
        // FOR UPDATE serialises concurrent refreshes of the same token: the loser sees it already rotated.
        const { rows } = await tx.query<{
          id: string;
          user_id: string;
          family_id: string;
          revoked_reason: string | null;
          expired: boolean;
          is_active: boolean;
        }>(
          `select t.id, t.user_id, t.family_id, t.revoked_reason,
                  (t.expires_at <= now()) as expired, u.is_active
             from public.refresh_tokens t
             join public.users u on u.id = t.user_id
            where t.token_hash = $1
              for update of t`,
          [presentedHash],
        );
        const old = rows[0];
        if (!old) return { kind: 'INVALID' };

        if (old.revoked_reason) {
          // A logged-out session stays dead. A token that was rotated (or whose family was already
          // revoked for reuse) being presented again means two parties hold it: kill the family.
          if (old.revoked_reason === 'LOGOUT' || old.revoked_reason === 'ACCOUNT_DISABLED') {
            return { kind: 'INVALID' };
          }
          await revokeFamily(tx, old.family_id, 'REUSE_DETECTED');
          return { kind: 'REUSED' };
        }
        if (old.expired) return { kind: 'EXPIRED' };
        if (!old.is_active) {
          await revokeFamily(tx, old.family_id, 'ACCOUNT_DISABLED');
          return { kind: 'INACTIVE' };
        }

        const inserted = await tx.query<{ id: string }>(
          `insert into public.refresh_tokens (user_id, family_id, token_hash, expires_at)
           values ($1, $2, $3, $4) returning id`,
          [old.user_id, old.family_id, newHash, newExpiresAt],
        );
        await tx.query(
          `update public.refresh_tokens
              set revoked_at = now(), revoked_reason = 'ROTATED', replaced_by = $2
            where id = $1`,
          [old.id, inserted.rows[0]!.id],
        );
        return { kind: 'ROTATED', userId: old.user_id };
      });
    },

    async revokeFamilyByTokenHash(tokenHash, reason) {
      await db.query(
        `update public.refresh_tokens
            set revoked_at = now(), revoked_reason = $2
          where revoked_at is null
            and family_id = (select family_id from public.refresh_tokens where token_hash = $1)`,
        [tokenHash, reason],
      );
    },
  };
}
