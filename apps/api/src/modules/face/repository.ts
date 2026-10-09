import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { ownsPlayerSql } from '../players';
import type { FaceProfileStatusDto } from './types';

export interface PlayerFaceAccess {
  isOwner: boolean;
  /** The viewer's organization owns an event this player is registered for (admin read access). */
  inViewerOrganization: boolean;
}

export interface ProfileRecord {
  id: string;
  provider: string;
  /** The provider's opaque reference. Internal only: never part of an API response or a log line. */
  reference: string;
}

export interface EnrollmentSource {
  documentId: string;
  documentType: string;
  documentStatus: string;
  uploaded: boolean;
  /** Internal storage key of the photo. Never returned. */
  storageKey: string;
  registrationId: string;
  registrationStatus: string;
}

export interface FaceRepository {
  /** Runs `fn` with a repository bound to one database transaction. */
  transaction<T>(fn: (repo: FaceRepository) => Promise<T>): Promise<T>;

  findPlayerAccess(
    playerId: string,
    viewer: { userId: string; organizationId: string | null },
  ): Promise<PlayerFaceAccess | null>;
  getStatus(playerId: string): Promise<FaceProfileStatusDto>;

  /** Serializes enrollment/removal for one player for the rest of the transaction. */
  lockPlayerFace(playerId: string): Promise<void>;
  findActive(playerId: string): Promise<ProfileRecord | null>;
  /** Row-locks the active profile. */
  lockActive(playerId: string): Promise<ProfileRecord | null>;
  /** How many profiles (any status) the player has had: makes each enrollment attempt's idempotency key distinct. */
  countProfiles(playerId: string): Promise<number>;

  findEnrollmentSource(playerId: string, documentId: string): Promise<EnrollmentSource | null>;
  /** The consent record for `code` at its CURRENT published version, for this registration. */
  findCurrentConsentRecord(registrationId: string, code: string): Promise<string | null>;

  /** Null when the provider reference or the player's active slot is already taken. */
  insertProfile(input: {
    playerId: string;
    provider: string;
    reference: string;
    sourceDocumentId: string;
    consentRecordId: string | null;
    enrolledBy: string;
  }): Promise<string | null>;
  revokeProfile(profileId: string, revokedBy: string, reason: string): Promise<void>;

  audit(entry: {
    action: AuditAction;
    actorUserId: string;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

function build(q: Queryable, run: FaceRepository['transaction']): FaceRepository {
  return {
    transaction: run,

    async findPlayerAccess(playerId, viewer) {
      const { rows } = await q.query<{ is_owner: boolean; in_org: boolean }>(
        `select ${ownsPlayerSql('pl', '$2')} as is_owner,
                exists (select 1 from public.registrations r join public.events e on e.id = r.event_id
                         where r.player_id = pl.id and e.organization_id = $3) as in_org
           from public.players pl where pl.id = $1`,
        [playerId, viewer.userId, viewer.organizationId],
      );
      const r = rows[0];
      return r ? { isOwner: r.is_owner, inViewerOrganization: r.in_org } : null;
    },

    async getStatus(playerId) {
      // The active profile if any, otherwise the most recent (revoked) one.
      const { rows } = await q.query<{
        status: 'ACTIVE' | 'REVOKED';
        enrolled_at: Date;
        revoked_at: Date | null;
      }>(
        `select status, enrolled_at, revoked_at from public.face_profiles
          where player_id = $1
          order by (status = 'ACTIVE') desc, enrolled_at desc, id
          limit 1`,
        [playerId],
      );
      const p = rows[0];
      return p
        ? {
            playerId,
            status: p.status,
            enrolledAt: p.enrolled_at.toISOString(),
            revokedAt: p.revoked_at?.toISOString() ?? null,
          }
        : { playerId, status: 'NOT_ENROLLED', enrolledAt: null, revokedAt: null };
    },

    async lockPlayerFace(playerId) {
      await q.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`face:${playerId}`]);
    },

    async findActive(playerId) {
      const { rows } = await q.query<{ id: string; provider: string; provider_profile_id: string }>(
        `select id, provider, provider_profile_id from public.face_profiles
          where player_id = $1 and status = 'ACTIVE'`,
        [playerId],
      );
      const r = rows[0];
      return r ? { id: r.id, provider: r.provider, reference: r.provider_profile_id } : null;
    },

    async lockActive(playerId) {
      const { rows } = await q.query<{ id: string; provider: string; provider_profile_id: string }>(
        `select id, provider, provider_profile_id from public.face_profiles
          where player_id = $1 and status = 'ACTIVE' for update`,
        [playerId],
      );
      const r = rows[0];
      return r ? { id: r.id, provider: r.provider, reference: r.provider_profile_id } : null;
    },

    async countProfiles(playerId) {
      const { rows } = await q.query<{ n: number }>(
        'select count(*)::int as n from public.face_profiles where player_id = $1',
        [playerId],
      );
      return rows[0]?.n ?? 0;
    },

    async findEnrollmentSource(playerId, documentId) {
      const { rows } = await q.query<{
        id: string;
        document_type: string;
        status: string;
        uploaded_at: Date | null;
        storage_key: string;
        registration_id: string;
        registration_status: string;
      }>(
        `select d.id, d.document_type, d.status, d.uploaded_at, d.storage_key,
                r.id as registration_id, r.status as registration_status
           from public.documents d
           join public.registrations r on r.id = d.registration_id
          where d.id = $1 and r.player_id = $2 and r.registrant_type = 'PLAYER'`,
        [documentId, playerId],
      );
      const d = rows[0];
      return d
        ? {
            documentId: d.id,
            documentType: d.document_type,
            documentStatus: d.status,
            uploaded: d.uploaded_at !== null,
            storageKey: d.storage_key,
            registrationId: d.registration_id,
            registrationStatus: d.registration_status,
          }
        : null;
    },

    async findCurrentConsentRecord(registrationId, code) {
      const { rows } = await q.query<{ id: string }>(
        `select cr.id
           from public.consent_records cr join public.consents c on c.id = cr.consent_id
          where cr.registration_id = $1 and c.code = $2
            and c.version = (select max(c2.version) from public.consents c2
                              where c2.code = $2 and c2.effective_at <= now())
          limit 1`,
        [registrationId, code],
      );
      return rows[0]?.id ?? null;
    },

    async insertProfile(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.face_profiles
           (player_id, provider, provider_profile_id, consent_record_id, source_document_id, enrolled_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict do nothing
         returning id`,
        [i.playerId, i.provider, i.reference, i.consentRecordId, i.sourceDocumentId, i.enrolledBy],
      );
      return rows[0]?.id ?? null;
    },

    async revokeProfile(profileId, revokedBy, reason) {
      await q.query(
        `update public.face_profiles
            set status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_reason = $3
          where id = $1 and status = 'ACTIVE'`,
        [profileId, revokedBy, reason],
      );
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: 'face_profile',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createFaceRepository(db: Database): FaceRepository {
  const inTransaction: FaceRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
