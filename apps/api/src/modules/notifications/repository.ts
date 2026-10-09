import type { Database } from '../../infrastructure/database/database';
import type { RegistrantType } from '../registrations/transitions';
import type { PushSubscriptionInput } from './types';

export interface StoredSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface RegistrationRecipients {
  registrantType: RegistrantType;
  /** Active accounts that own the registration: the player's own login, their guardians, or the coach/staff member. */
  userIds: string[];
}

export interface NotificationRepository {
  /** Creates or refreshes the subscription for this endpoint (one row per endpoint). Returns whether a row was created. */
  upsert(
    userId: string,
    sub: PushSubscriptionInput,
    userAgent: string | null,
    maxPerUser: number,
  ): Promise<{ created: boolean }>;
  /** Removes this user's subscription for the endpoint. Another user's row for the same endpoint is never touched. */
  removeForUser(userId: string, endpoint: string): Promise<boolean>;
  removeById(id: string): Promise<void>;
  listForUsers(userIds: string[]): Promise<StoredSubscription[]>;
  markSuccess(id: string): Promise<void>;
  /** Counts a transient failure; deletes the subscription once it has failed `maxFailures` times in a row. */
  markFailure(id: string, maxFailures: number): Promise<void>;
  recipientsForRegistration(registrationId: string): Promise<RegistrationRecipients | null>;
}

export function createNotificationRepository(db: Database): NotificationRepository {
  return {
    async upsert(userId, sub, userAgent, maxPerUser) {
      return db.transaction(async (tx) => {
        const { rows } = await tx.query<{ created: boolean }>(
          `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
           values ($1, $2, $3, $4, $5)
           on conflict (endpoint) do update
             set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
                 user_agent = excluded.user_agent, failure_count = 0
           returning (xmax = 0) as created`,
          [userId, sub.endpoint, sub.p256dh, sub.auth, userAgent],
        );
        // A user never accumulates unbounded rows: keep the most recently refreshed ones.
        await tx.query(
          `delete from public.push_subscriptions
            where user_id = $1
              and id not in (select id from public.push_subscriptions
                              where user_id = $1 order by updated_at desc, id limit $2)`,
          [userId, maxPerUser],
        );
        return { created: rows[0]?.created ?? false };
      });
    },

    async removeForUser(userId, endpoint) {
      const { rowCount } = await db.query(
        'delete from public.push_subscriptions where user_id = $1 and endpoint = $2',
        [userId, endpoint],
      );
      return (rowCount ?? 0) > 0;
    },

    async removeById(id) {
      await db.query('delete from public.push_subscriptions where id = $1', [id]);
    },

    async listForUsers(userIds) {
      if (userIds.length === 0) return [];
      const { rows } = await db.query<{
        id: string;
        user_id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }>(
        `select id, user_id, endpoint, p256dh, auth
           from public.push_subscriptions where user_id = any($1::uuid[])`,
        [userIds],
      );
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        endpoint: r.endpoint,
        p256dh: r.p256dh,
        auth: r.auth,
      }));
    },

    async markSuccess(id) {
      await db.query(
        `update public.push_subscriptions
            set last_success_at = now(), failure_count = 0 where id = $1`,
        [id],
      );
    },

    async markFailure(id, maxFailures) {
      await db.query(
        `update public.push_subscriptions
            set failure_count = failure_count + 1, last_failure_at = now() where id = $1`,
        [id],
      );
      await db.query(
        'delete from public.push_subscriptions where id = $1 and failure_count >= $2',
        [id, maxFailures],
      );
    },

    async recipientsForRegistration(registrationId) {
      const { rows } = await db.query<{ registrant_type: RegistrantType; user_ids: string[] }>(
        `select r.registrant_type,
                coalesce(array(
                  select distinct u.id from public.users u
                   where u.is_active
                     and (u.id = sp.user_id
                       or u.id = pl.user_id
                       or u.id in (select pa.user_id from public.player_parents pp
                                     join public.parents pa on pa.id = pp.parent_id
                                    where pp.player_id = pl.id and pa.user_id is not null))
                ), '{}') as user_ids
           from public.registrations r
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
          where r.id = $1`,
        [registrationId],
      );
      const row = rows[0];
      return row ? { registrantType: row.registrant_type, userIds: row.user_ids } : null;
    },
  };
}
