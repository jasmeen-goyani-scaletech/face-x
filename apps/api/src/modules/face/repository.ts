import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { ownsPlayerSql } from '../players';
import { ownsStaffProfileSql } from '../staff';
import type { FaceProfileStatusDto } from './types';

/**
 * Who a face profile is for: a player, or a staff profile (which is a coach or a staff member: `staff_profiles` holds both).
 * Everything below works on either; the column and the registrations that apply differ, nothing else.
 */
export interface FaceSubject {
  kind: 'PLAYER' | 'STAFF';
  id: string;
}

export const playerSubject = (id: string): FaceSubject => ({ kind: 'PLAYER', id });
export const staffSubject = (id: string): FaceSubject => ({ kind: 'STAFF', id });

/** Column names chosen here from a closed set, never from input. */
const profileColumn = (s: FaceSubject) => (s.kind === 'PLAYER' ? 'player_id' : 'staff_profile_id');
/** The registration rows that belong to this subject. `$n` is the subject id. */
const registrationOf = (s: FaceSubject, param: string) =>
  s.kind === 'PLAYER'
    ? `r.player_id = ${param} and r.registrant_type = 'PLAYER'`
    : `r.staff_profile_id = ${param} and r.registrant_type in ('COACH', 'STAFF')`;

export interface FaceAccess {
  isOwner: boolean;
  /** The viewer's organization owns an event this person is registered for (admin read access). */
  inViewerOrganization: boolean;
}

export interface ProfileRecord {
  id: string;
  provider: string;
  /** The provider's opaque reference. Internal only: never part of an API response or a log line. */
  reference: string;
  /** The photo this profile was enrolled from. */
  sourceDocumentId: string | null;
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
  registrantType: 'PLAYER' | 'COACH' | 'STAFF';
}

export interface FaceRepository {
  /** Runs `fn` with a repository bound to one database transaction. */
  transaction<T>(fn: (repo: FaceRepository) => Promise<T>): Promise<T>;

  findPlayerAccess(
    playerId: string,
    viewer: { userId: string; organizationId: string | null },
  ): Promise<FaceAccess | null>;
  findStaffAccess(
    staffProfileId: string,
    viewer: { userId: string; organizationId: string | null },
  ): Promise<FaceAccess | null>;
  getStatus(subject: FaceSubject): Promise<FaceProfileStatusDto>;

  /** Serializes enrollment/removal for one person for the rest of the transaction. */
  lockFace(subject: FaceSubject): Promise<void>;
  findActive(subject: FaceSubject): Promise<ProfileRecord | null>;
  /** Row-locks the active profile. */
  lockActive(subject: FaceSubject): Promise<ProfileRecord | null>;
  /** How many profiles (any status) the person has had: makes each enrollment attempt's idempotency key distinct. */
  countProfiles(subject: FaceSubject): Promise<number>;

  findEnrollmentSource(subject: FaceSubject, documentId: string): Promise<EnrollmentSource | null>;
  /** The newest approved, uploaded profile photo of a registration, with the person it is for (null when there is none yet). */
  findApprovedPhotoOfRegistration(
    registrationId: string,
  ): Promise<{ subject: FaceSubject; documentId: string } | null>;
  /** The consent record for `code` at its CURRENT published version, for this registration. */
  findCurrentConsentRecord(registrationId: string, code: string): Promise<string | null>;

  /** Null when the provider reference or the person's active slot is already taken. */
  insertProfile(input: {
    subject: FaceSubject;
    provider: string;
    reference: string;
    sourceDocumentId: string;
    consentRecordId: string | null;
    enrolledBy: string;
  }): Promise<string | null>;
  revokeProfile(profileId: string, revokedBy: string, reason: string): Promise<void>;
  /** Records the enrolled photo's permanent object URL on the person. */
  setPhotoUrl(subject: FaceSubject, url: string): Promise<void>;

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
  provider: string;
  provider_profile_id: string;
  source_document_id: string | null;
}
const toProfile = (r: ProfileRow | undefined): ProfileRecord | null =>
  r
    ? {
        id: r.id,
        provider: r.provider,
        reference: r.provider_profile_id,
        sourceDocumentId: r.source_document_id,
      }
    : null;

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

    async findStaffAccess(staffProfileId, viewer) {
      const { rows } = await q.query<{ is_owner: boolean; in_org: boolean }>(
        `select ${ownsStaffProfileSql('sp', '$2')} as is_owner,
                exists (select 1 from public.registrations r join public.events e on e.id = r.event_id
                         where r.staff_profile_id = sp.id and e.organization_id = $3) as in_org
           from public.staff_profiles sp where sp.id = $1`,
        [staffProfileId, viewer.userId, viewer.organizationId],
      );
      const r = rows[0];
      return r ? { isOwner: r.is_owner, inViewerOrganization: r.in_org } : null;
    },

    async getStatus(subject) {
      // The active profile if any, otherwise the most recent (revoked) one.
      const { rows } = await q.query<{
        status: 'ACTIVE' | 'REVOKED';
        enrolled_at: Date;
        revoked_at: Date | null;
      }>(
        `select status, enrolled_at, revoked_at from public.face_profiles
          where ${profileColumn(subject)} = $1
          order by (status = 'ACTIVE') desc, enrolled_at desc, id
          limit 1`,
        [subject.id],
      );
      const p = rows[0];
      const who = subject.kind === 'PLAYER' ? { playerId: subject.id } : { staffProfileId: subject.id };
      return p
        ? {
            ...who,
            status: p.status,
            enrolledAt: p.enrolled_at.toISOString(),
            revokedAt: p.revoked_at?.toISOString() ?? null,
          }
        : { ...who, status: 'NOT_ENROLLED', enrolledAt: null, revokedAt: null };
    },

    async lockFace(subject) {
      // The key keeps the original "face:<id>" shape for players so a rolling deploy still serializes with older instances.
      const key = subject.kind === 'PLAYER' ? `face:${subject.id}` : `face:staff:${subject.id}`;
      await q.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    },

    async findActive(subject) {
      const { rows } = await q.query<ProfileRow>(
        `select id, provider, provider_profile_id, source_document_id from public.face_profiles
          where ${profileColumn(subject)} = $1 and status = 'ACTIVE'`,
        [subject.id],
      );
      return toProfile(rows[0]);
    },

    async lockActive(subject) {
      const { rows } = await q.query<ProfileRow>(
        `select id, provider, provider_profile_id, source_document_id from public.face_profiles
          where ${profileColumn(subject)} = $1 and status = 'ACTIVE' for update`,
        [subject.id],
      );
      return toProfile(rows[0]);
    },

    async countProfiles(subject) {
      const { rows } = await q.query<{ n: number }>(
        `select count(*)::int as n from public.face_profiles where ${profileColumn(subject)} = $1`,
        [subject.id],
      );
      return rows[0]?.n ?? 0;
    },

    async findApprovedPhotoOfRegistration(registrationId) {
      const { rows } = await q.query<{
        player_id: string | null;
        staff_profile_id: string | null;
        id: string;
      }>(
        `select r.player_id, r.staff_profile_id, d.id
           from public.documents d
           join public.registrations r on r.id = d.registration_id
          where r.id = $1 and (r.player_id is not null or r.staff_profile_id is not null)
            and d.document_type = 'PROFILE_PHOTO' and d.status = 'APPROVED' and d.uploaded_at is not null
          order by d.created_at desc
          limit 1`,
        [registrationId],
      );
      const r = rows[0];
      if (!r) return null;
      const subject = r.player_id
        ? playerSubject(r.player_id)
        : r.staff_profile_id
          ? staffSubject(r.staff_profile_id)
          : null;
      return subject ? { subject, documentId: r.id } : null;
    },

    async findEnrollmentSource(subject, documentId) {
      const { rows } = await q.query<{
        id: string;
        document_type: string;
        status: string;
        uploaded_at: Date | null;
        storage_key: string;
        registration_id: string;
        registration_status: string;
        registrant_type: 'PLAYER' | 'COACH' | 'STAFF';
      }>(
        `select d.id, d.document_type, d.status, d.uploaded_at, d.storage_key,
                r.id as registration_id, r.status as registration_status, r.registrant_type
           from public.documents d
           join public.registrations r on r.id = d.registration_id
          where d.id = $1 and ${registrationOf(subject, '$2')}`,
        [documentId, subject.id],
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
            registrantType: d.registrant_type,
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
           (${profileColumn(i.subject)}, provider, provider_profile_id, consent_record_id, source_document_id, enrolled_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict do nothing
         returning id`,
        [i.subject.id, i.provider, i.reference, i.consentRecordId, i.sourceDocumentId, i.enrolledBy],
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

    async setPhotoUrl(subject, url) {
      const table = subject.kind === 'PLAYER' ? 'players' : 'staff_profiles';
      await q.query(`update public.${table} set photo_url = $2 where id = $1`, [subject.id, url]);
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
