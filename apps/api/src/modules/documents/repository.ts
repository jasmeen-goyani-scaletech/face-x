import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit, type AuditAction } from '../audit';
import { ownsRegistrantSql } from '../staff';
import { documentState } from './state';
import type {
  DocumentDto,
  DocumentRegistrantType,
  DocumentType,
  RejectionReasonCode,
} from './types';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Internal view of a document row. Contains the storage key, so it never leaves the service layer. */
export interface DocumentRecord {
  id: string;
  registrationId: string;
  documentType: DocumentType;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  status: ReviewStatus;
  uploadedAt: Date | null;
  submittedAt: Date | null;
  aiRejected: boolean;
}

export interface RegistrationAccess {
  registrationId: string;
  registrantType: DocumentRegistrantType;
  status: string;
  isOwner: boolean;
  /** Organization that owns the registration's event (admin check; never returned). */
  eventOrganizationId: string;
}

export interface DocumentAccess {
  document: DocumentRecord;
  registrantType: DocumentRegistrantType;
  registrationStatus: string;
  isOwner: boolean;
  eventOrganizationId: string;
  /** The player the registration is for (null for coach and staff registrations). */
  playerId: string | null;
  /** The coach or staff member the registration is for (null for player registrations). */
  staffProfileId: string | null;
}

export interface DocumentRepository {
  /** Runs `fn` with a repository bound to one database transaction. */
  transaction<T>(fn: (repo: DocumentRepository) => Promise<T>): Promise<T>;

  findRegistration(registrationId: string, userId: string): Promise<RegistrationAccess | null>;
  /** Share-locks the registration (so it cannot be cancelled mid-operation) and returns its status. */
  lockRegistrationStatus(registrationId: string): Promise<string | null>;

  /** The non-rejected document of this type, row-locked. */
  lockLiveDocument(registrationId: string, type: DocumentType): Promise<DocumentRecord | null>;
  countRejected(registrationId: string, type: DocumentType): Promise<number>;
  /** Null when another request created the live document first (unique per registration + type). */
  insertDocument(
    input: NewUpload & { registrationId: string; type: DocumentType },
  ): Promise<DocumentRecord | null>;
  /** Re-keys an unreviewed document with a fresh upload: back to "awaiting upload", review status PENDING. */
  reissueUpload(documentId: string, input: NewUpload): Promise<void>;

  findDocument(documentId: string, userId: string): Promise<DocumentAccess | null>;
  lockDocument(documentId: string): Promise<DocumentRecord | null>;
  markUploaded(documentId: string): Promise<void>;
  markSubmitted(documentId: string, aiRejected: boolean): Promise<void>;
  /** The newest document of each type of a registration, with what auto-approval needs to know. */
  listLatestForApproval(registrationId: string): Promise<ApprovalCandidate[]>;
  insertReview(input: {
    documentId: string;
    /** Null for an approval made by the AI check. */
    reviewerId: string | null;
    decision: 'APPROVED' | 'REJECTED';
    reasonCode: RejectionReasonCode | null;
    reason: string | null;
    notes: string | null;
  }): Promise<void>;
  setReviewStatus(documentId: string, status: 'APPROVED' | 'REJECTED'): Promise<void>;

  listDtos(registrationId: string): Promise<DocumentDto[]>;
  getDto(documentId: string): Promise<DocumentDto | null>;

  audit(entry: {
    action: AuditAction;
    actorUserId: string;
    entityId: string;
    metadata?: Record<string, string | number | boolean | null>;
    meta: RequestMeta;
  }): Promise<void>;
}

export interface ApprovalCandidate {
  id: string;
  documentType: DocumentType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  uploaded: boolean;
  submitted: boolean;
  aiAccepted: boolean;
  aiRejected: boolean;
}

export interface NewUpload {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}

interface DocRow {
  id: string;
  registration_id: string;
  document_type: DocumentType;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number | null; // bigint comes back as a string
  status: ReviewStatus;
  uploaded_at: Date | null;
  submitted_at: Date | null;
  ai_rejected: boolean;
  created_at: Date;
  updated_at: Date;
}

const toRecord = (r: DocRow): DocumentRecord => ({
  id: r.id,
  registrationId: r.registration_id,
  documentType: r.document_type,
  storageKey: r.storage_key,
  fileName: r.file_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  status: r.status,
  uploadedAt: r.uploaded_at,
  submittedAt: r.submitted_at,
  aiRejected: r.ai_rejected,
});

const DOC_COLUMNS = `d.id, d.registration_id, d.document_type, d.storage_key, d.file_name, d.mime_type,
  d.size_bytes, d.status, d.uploaded_at, d.submitted_at, d.ai_rejected, d.created_at, d.updated_at`;

/** Documents plus their latest review decision (reviews are append-only, so "latest" is the current one). */
const DTO_SELECT = `select ${DOC_COLUMNS},
    rv.decision, rv.reason_code, rv.reason, rv.created_at as reviewed_at
  from public.documents d
  left join lateral (
    select decision, reason_code, reason, created_at from public.document_reviews
     where document_id = d.id order by created_at desc, id limit 1) rv on true`;

interface DtoRow extends DocRow {
  decision: 'APPROVED' | 'REJECTED' | null;
  reason_code: RejectionReasonCode | null;
  reason: string | null;
  reviewed_at: Date | null;
}

const toDto = (r: DtoRow): DocumentDto => {
  const record = toRecord(r);
  return {
    id: r.id,
    registrationId: r.registration_id,
    documentType: r.document_type,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: record.sizeBytes,
    state: documentState(record),
    uploadedAt: r.uploaded_at?.toISOString() ?? null,
    submittedAt: r.submitted_at?.toISOString() ?? null,
    aiRejected: r.ai_rejected,
    review:
      r.decision && r.reviewed_at
        ? {
            decision: r.decision,
            reasonCode: r.reason_code,
            reason: r.reason,
            reviewedAt: r.reviewed_at.toISOString(),
          }
        : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
};

function build(q: Queryable, run: DocumentRepository['transaction']): DocumentRepository {
  return {
    transaction: run,

    async findRegistration(registrationId, userId) {
      const { rows } = await q.query<{
        id: string;
        registrant_type: DocumentRegistrantType;
        status: string;
        is_owner: boolean;
        org: string;
      }>(
        `select r.id, r.registrant_type, r.status, ${ownsRegistrantSql('pl', 'sp', '$2')} as is_owner,
                e.organization_id as org
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
            isOwner: r.is_owner,
            eventOrganizationId: r.org,
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

    async lockLiveDocument(registrationId, type) {
      const { rows } = await q.query<DocRow>(
        `select ${DOC_COLUMNS} from public.documents d
          where d.registration_id = $1 and d.document_type = $2 and d.status <> 'REJECTED'
            for update`,
        [registrationId, type],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async countRejected(registrationId, type) {
      const { rows } = await q.query<{ n: number }>(
        `select count(*)::int as n from public.documents
          where registration_id = $1 and document_type = $2 and status = 'REJECTED'`,
        [registrationId, type],
      );
      return rows[0]?.n ?? 0;
    },

    async insertDocument(i) {
      const { rows } = await q.query<DocRow>(
        `insert into public.documents
           (registration_id, document_type, storage_key, file_name, mime_type, size_bytes, uploaded_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (registration_id, document_type) where status <> 'REJECTED' do nothing
         returning ${DOC_COLUMNS.replace(/d\./g, '')}`,
        [i.registrationId, i.type, i.storageKey, i.fileName, i.mimeType, i.sizeBytes, i.uploadedBy],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async reissueUpload(documentId, i) {
      await q.query(
        `update public.documents
            set storage_key = $2, file_name = $3, mime_type = $4, size_bytes = $5, uploaded_by = $6,
                uploaded_at = null, submitted_at = null, ai_rejected = false, ai_accepted = false, status = 'PENDING'
          where id = $1 and status = 'PENDING' and submitted_at is null`,
        [documentId, i.storageKey, i.fileName, i.mimeType, i.sizeBytes, i.uploadedBy],
      );
    },

    async findDocument(documentId, userId) {
      const { rows } = await q.query<
        DocRow & {
          reg_status: string;
          registrant_type: DocumentRegistrantType;
          is_owner: boolean;
          org: string;
          player_id: string | null;
          staff_profile_id: string | null;
        }
      >(
        `select ${DOC_COLUMNS}, r.status as reg_status, r.registrant_type, r.player_id, r.staff_profile_id,
                ${ownsRegistrantSql('pl', 'sp', '$2')} as is_owner, e.organization_id as org
           from public.documents d
           join public.registrations r on r.id = d.registration_id
           left join public.players pl on pl.id = r.player_id
           left join public.staff_profiles sp on sp.id = r.staff_profile_id
           join public.events e on e.id = r.event_id
          where d.id = $1`,
        [documentId, userId],
      );
      const r = rows[0];
      return r
        ? {
            document: toRecord(r),
            registrantType: r.registrant_type,
            registrationStatus: r.reg_status,
            isOwner: r.is_owner,
            eventOrganizationId: r.org,
            playerId: r.player_id,
            staffProfileId: r.staff_profile_id,
          }
        : null;
    },

    async lockDocument(documentId) {
      const { rows } = await q.query<DocRow>(
        `select ${DOC_COLUMNS} from public.documents d where d.id = $1 for update`,
        [documentId],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async markUploaded(documentId) {
      await q.query('update public.documents set uploaded_at = now() where id = $1', [documentId]);
    },

    async markSubmitted(documentId, aiRejected) {
      await q.query(
        'update public.documents set submitted_at = now(), ai_rejected = $2 where id = $1',
        [documentId, aiRejected],
      );
    },

    async listLatestForApproval(registrationId) {
      const { rows } = await q.query<{
        id: string;
        document_type: DocumentType;
        status: 'PENDING' | 'APPROVED' | 'REJECTED';
        uploaded: boolean;
        submitted: boolean;
        ai_accepted: boolean;
        ai_rejected: boolean;
      }>(
        `select distinct on (document_type) id, document_type, status, uploaded_at is not null as uploaded,
                submitted_at is not null as submitted, ai_accepted, ai_rejected
           from public.documents where registration_id = $1
          order by document_type, created_at desc, id`,
        [registrationId],
      );
      return rows.map((r) => ({
        id: r.id,
        documentType: r.document_type,
        status: r.status,
        uploaded: r.uploaded,
        submitted: r.submitted,
        aiAccepted: r.ai_accepted,
        aiRejected: r.ai_rejected,
      }));
    },

    async insertReview(i) {
      await q.query(
        `insert into public.document_reviews (document_id, reviewer_id, decision, reason_code, reason, notes, automated)
         values ($1, $2::uuid, $3, $4, $5, $6, $2::uuid is null)`,
        [i.documentId, i.reviewerId, i.decision, i.reasonCode, i.reason, i.notes],
      );
    },

    async setReviewStatus(documentId, status) {
      await q.query('update public.documents set status = $2 where id = $1', [documentId, status]);
    },

    async listDtos(registrationId) {
      const { rows } = await q.query<DtoRow>(
        `${DTO_SELECT} where d.registration_id = $1 order by d.document_type, d.created_at desc, d.id`,
        [registrationId],
      );
      return rows.map(toDto);
    },

    async getDto(documentId) {
      const { rows } = await q.query<DtoRow>(`${DTO_SELECT} where d.id = $1`, [documentId]);
      return rows[0] ? toDto(rows[0]) : null;
    },

    audit: (entry) =>
      recordAudit(q, {
        action: entry.action,
        actorUserId: entry.actorUserId,
        entityType: 'document',
        entityId: entry.entityId,
        metadata: entry.metadata,
        meta: entry.meta,
      }),
  };
}

export function createDocumentRepository(db: Database): DocumentRepository {
  const inTransaction: DocumentRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
