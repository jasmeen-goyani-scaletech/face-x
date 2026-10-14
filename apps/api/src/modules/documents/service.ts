import { sniffContentType } from '../../infrastructure/storage/content-sniffing';
import type { FileStorage, StorageArea } from '../../infrastructure/storage/file-storage';
import type { ObjectInspector } from '../../infrastructure/storage/object-inspector';
import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import { safeCause } from '../../shared/utils/scrub';
import type { AuthContext } from '../auth/types';
import type { NotificationPublisher } from '../notifications';
import type { ReadinessTrigger } from '../readiness/types';
import { completenessOf } from './completeness';
import type { DocumentRecord, DocumentRepository } from './repository';
import type { RequestUploadBody, ReviewBody } from './schema';
import {
  ALLOWED_DOCUMENT_TYPES,
  type DocumentDto,
  type DocumentListDto,
  type DocumentType,
  type FaceEnrollmentResult,
  type UploadInstructions,
} from './types';

/**
 * Registration documents: request a signed upload, confirm it, submit it for review, review it, download it.
 *
 * Access follows the registration: the owner (the player or a linked guardian; the coach or staff member) uploads, submits and downloads;
 * an ADMIN of the organization that owns the registration's event can read, download and review documents that
 * have been SUBMITTED (not drafts a family is still preparing). Everyone else gets 404, so another family's
 * documents are not even confirmed to exist.
 *
 * Document state is its own thing: a document step never edits the registration's status. After a submission or review
 * commits, the readiness evaluator (modules/readiness) re-checks whether the registration can advance.
 */
export interface DocumentService {
  requestUpload(
    ctx: AuthContext,
    registrationId: string,
    body: RequestUploadBody,
    meta: RequestMeta,
  ): Promise<{ document: DocumentDto; upload: UploadInstructions }>;
  complete(ctx: AuthContext, documentId: string, meta: RequestMeta): Promise<DocumentDto>;
  submit(ctx: AuthContext, documentId: string, meta: RequestMeta): Promise<DocumentDto>;
  review(
    ctx: AuthContext,
    documentId: string,
    body: ReviewBody,
    meta: RequestMeta,
  ): Promise<DocumentDto>;
  list(ctx: AuthContext, registrationId: string): Promise<DocumentListDto>;
  downloadUrl(
    ctx: AuthContext,
    documentId: string,
    meta: RequestMeta,
    options?: { inline?: boolean },
  ): Promise<{ url: string; expiresAt: string }>;
}

export interface DocumentServiceDeps {
  repository: DocumentRepository;
  /** Re-evaluates registration readiness after a submission or review has committed. */
  readiness: ReadinessTrigger;
  /** Told about each review decision after it has committed. Absent: no notifications. */
  notifications?: NotificationPublisher;
  /** Told when an admin approves a player's profile photo, after the approval has committed. Absent: nothing is enrolled. */
  faceEnrollment?: PhotoApprovedHook;
  /** Absent when STORAGE_* is not configured: operations that touch files answer 503. */
  storage?: { files: FileStorage; inspector: ObjectInspector };
}

/** What happens to someone's face after their photo is approved (see FaceService.enrollApprovedPhoto). Must not throw. */
export interface PhotoApprovedHook {
  afterPhotoApproved(input: {
    /** Exactly one is set: the player, or the coach/staff member, the photo is of. */
    playerId: string | null;
    staffProfileId: string | null;
    documentId: string;
    actorUserId: string;
    meta: RequestMeta;
  }): Promise<unknown>;
  /** Told when a profile photo has just been uploaded. Enrolls the face at once; the answer reaches the family. Must not throw. */
  afterPhotoUploaded?(input: {
    playerId: string | null;
    staffProfileId: string | null;
    documentId: string;
    actorUserId: string;
    meta: RequestMeta;
  }): Promise<FaceEnrollmentResult>;
  /** Told when an admin rejects a profile photo, after the rejection has committed. Revokes the face made from it. Must not throw. */
  afterPhotoRejected?(input: {
    playerId: string | null;
    staffProfileId: string | null;
    documentId: string;
    actorUserId: string;
    meta: RequestMeta;
  }): Promise<unknown>;
}

/** Photos go to their own area (own size and type limits); everything else is a document. */
const AREA_BY_TYPE: Record<DocumentType, StorageArea> = {
  PROFILE_PHOTO: 'player-images',
  BIRTH_CERTIFICATE: 'registration-documents',
  SCHOOL_ID: 'registration-documents',
  SCHOOL_TRANSCRIPT: 'registration-documents',
  CALIFORNIA_KID_ID: 'registration-documents',
  FIRST_AID_CPR: 'registration-documents',
  YALF_TACKLE: 'registration-documents',
  BACKGROUND_CHECK: 'registration-documents',
  SAFESPORT: 'registration-documents',
};

/** Once a registration is cancelled or rejected, its documents are frozen. */
const FROZEN_REGISTRATION_STATUSES = ['CANCELLED', 'REJECTED'];
/** Stops unlimited re-uploads of a rejected document from piling up files. */
const MAX_REJECTED_ATTEMPTS = 10;

const regNotFound = () => AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');
const docNotFound = () => AppError.notFound('DOCUMENT_NOT_FOUND', 'Document not found');

function assertOpen(registrationStatus: string): void {
  if (FROZEN_REGISTRATION_STATUSES.includes(registrationStatus)) {
    throw AppError.conflict(
      'REGISTRATION_CLOSED',
      `Documents of a ${registrationStatus} registration can no longer be changed`,
    );
  }
}

/** Storage is an external system: its failures are reported as 503 and detailed only in the server log. */
function storageFailure(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  const err = AppError.unavailable('STORAGE_UNAVAILABLE', 'File storage is unavailable');
  (err as { cause?: unknown }).cause = safeCause(cause);
  return err;
}

const storageNotConfigured = () =>
  AppError.unavailable('STORAGE_NOT_CONFIGURED', 'File storage is not configured');

export function createDocumentService({
  repository,
  storage,
  readiness,
  notifications,
  faceEnrollment: faceEnrollment_,
}: DocumentServiceDeps): DocumentService {
  const requireStorage = () => {
    if (!storage) throw storageNotConfigured();
    return storage;
  };

  const isAdminOf = (ctx: AuthContext, organizationId: string) =>
    ctx.roles.includes('ADMIN') &&
    ctx.organizationId !== null &&
    ctx.organizationId === organizationId;

  /** Owner, or admin of the event's organization (who only sees documents that were submitted). */
  async function readableDocument(ctx: AuthContext, documentId: string) {
    const access = await repository.findDocument(documentId, ctx.userId);
    if (!access) throw docNotFound();
    const ownerView = access.isOwner;
    const adminView =
      isAdminOf(ctx, access.eventOrganizationId) && access.document.submittedAt !== null;
    if (!ownerView && !adminView) throw docNotFound();
    return access;
  }

  async function ownedDocument(ctx: AuthContext, documentId: string) {
    const access = await repository.findDocument(documentId, ctx.userId);
    if (!access || !access.isOwner) throw docNotFound();
    return access;
  }

  const dtoOrThrow = async (documentId: string) => {
    const dto = await repository.getDto(documentId);
    if (!dto) throw docNotFound();
    return dto;
  };

  return {
    async requestUpload(ctx, registrationId, body, meta) {
      const { files } = requireStorage();
      const registration = await repository.findRegistration(registrationId, ctx.userId);
      if (!registration || !registration.isOwner) throw regNotFound();
      // A player cannot upload a coach's certificate and vice versa: each kind of registration has its own set.
      if (!ALLOWED_DOCUMENT_TYPES[registration.registrantType].includes(body.documentType)) {
        throw new AppError(
          422,
          'DOCUMENT_TYPE_NOT_ALLOWED',
          'This document type does not apply to this registration',
          [{ path: 'documentType', message: 'is not accepted for this registration' }],
        );
      }

      const staleKeys: string[] = [];
      const { documentId, upload } = await repository.transaction(async (r) => {
        const status = await r.lockRegistrationStatus(registrationId);
        if (!status) throw regNotFound();
        assertOpen(status);

        // A few attempts: if a concurrent request creates the document between our read and insert, we
        // lock theirs on the next pass instead of failing.
        for (let attempt = 0; attempt < 3; attempt++) {
          const existing = await r.lockLiveDocument(registrationId, body.documentType);
          let rejectedBefore = 0;
          if (existing) {
            if (existing.status === 'APPROVED') {
              throw AppError.conflict(
                'DOCUMENT_ALREADY_APPROVED',
                'This document has already been approved',
              );
            }
            if (existing.submittedAt) {
              throw AppError.conflict(
                'DOCUMENT_IN_REVIEW',
                'This document is being reviewed and cannot be replaced',
              );
            }
          } else {
            rejectedBefore = await r.countRejected(registrationId, body.documentType);
            if (rejectedBefore >= MAX_REJECTED_ATTEMPTS) {
              throw AppError.conflict(
                'TOO_MANY_ATTEMPTS',
                'Too many rejected uploads for this document',
              );
            }
          }

          // The key is generated here, never taken from the client.
          const issued = await files
            .issueUpload({
              area: AREA_BY_TYPE[body.documentType],
              registrationId,
              mimeType: body.mimeType,
              sizeBytes: body.sizeBytes,
            })
            .catch((e: unknown) => {
              throw storageFailure(e);
            });
          const data = {
            storageKey: issued.key,
            fileName: body.fileName,
            mimeType: body.mimeType,
            sizeBytes: body.sizeBytes,
            uploadedBy: ctx.userId,
          };

          let id: string;
          let replacing: boolean;
          if (existing) {
            await r.reissueUpload(existing.id, data);
            staleKeys.push(existing.storageKey);
            id = existing.id;
            replacing = existing.uploadedAt !== null;
          } else {
            const created = await r.insertDocument({
              ...data,
              registrationId,
              type: body.documentType,
            });
            if (!created) continue; // lost a race: retry and lock the winner's row
            id = created.id;
            replacing = rejectedBefore > 0;
          }
          await r.audit({
            action: replacing ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOAD_REQUESTED',
            actorUserId: ctx.userId,
            entityId: id,
            metadata: { registrationId, documentType: body.documentType },
            meta,
          });
          return {
            documentId: id,
            upload: {
              url: issued.url,
              method: issued.method,
              headers: issued.headers,
              expiresAt: issued.expiresAt.toISOString(),
            },
          };
        }
        throw AppError.conflict(
          'DOCUMENT_BUSY',
          'Another upload for this document is in progress, try again',
        );
      });

      // The replaced file is no longer referenced by anything. Failing to delete it leaves an orphan, not a leak.
      await Promise.allSettled(staleKeys.map((key) => files.remove({ key, registrationId })));
      return { document: await dtoOrThrow(documentId), upload };
    },

    async complete(ctx, documentId, meta) {
      const { files, inspector } = requireStorage();
      const access = await ownedDocument(ctx, documentId);
      assertOpen(access.registrationStatus);
      const doc = access.document;
      if (doc.status === 'REJECTED') {
        throw AppError.conflict(
          'INVALID_DOCUMENT_STATE',
          'A rejected document must be replaced with a new upload',
        );
      }
      if (doc.uploadedAt) return dtoOrThrow(documentId); // confirming twice is harmless

      // Verify what is actually in storage instead of trusting the client's claim.
      const inspected = await inspector.inspect(doc.storageKey).catch((e: unknown) => {
        throw storageFailure(e);
      });
      if (!inspected.exists) {
        throw AppError.conflict('UPLOAD_NOT_COMPLETE', 'The file has not been uploaded yet');
      }
      const problem =
        inspected.sizeBytes !== doc.sizeBytes
          ? {
              code: 'FILE_SIZE_MISMATCH',
              message: 'The uploaded file size does not match the request',
            }
          : sniffContentType(inspected.header, doc.mimeType) !== doc.mimeType
            ? {
                code: 'FILE_CONTENT_MISMATCH',
                message: 'The file contents do not match the declared type',
              }
            : null;
      if (problem) {
        // Do not keep a file that failed verification.
        await files
          .remove({ key: doc.storageKey, registrationId: doc.registrationId })
          .catch(() => undefined);
        throw new AppError(422, problem.code, problem.message);
      }

      await repository.transaction(async (r) => {
        const locked = await r.lockDocument(documentId);
        if (!locked || locked.storageKey !== doc.storageKey) {
          throw AppError.conflict('UPLOAD_SUPERSEDED', 'A newer upload replaced this one');
        }
        if (locked.uploadedAt) return; // a concurrent confirm won
        const status = await r.lockRegistrationStatus(locked.registrationId);
        if (status) assertOpen(status);
        await r.markUploaded(documentId);
        await r.audit({
          action: 'DOCUMENT_UPLOADED',
          actorUserId: ctx.userId,
          entityId: documentId,
          metadata: { registrationId: locked.registrationId, documentType: locked.documentType },
          meta,
        });
      });
      const uploaded = await dtoOrThrow(documentId);
      // A profile photo becomes the person's face the moment it is uploaded; the upload stands whatever happens here.
      if (doc.documentType === 'PROFILE_PHOTO' && (access.playerId || access.staffProfileId)) {
        const faceEnrollment = await faceEnrollment_
          ?.afterPhotoUploaded?.({
            playerId: access.playerId,
            staffProfileId: access.staffProfileId,
            documentId,
            actorUserId: ctx.userId,
            meta,
          })
          .catch(() => undefined);
        if (faceEnrollment) return { ...uploaded, faceEnrollment };
      }
      return uploaded;
    },

    async submit(ctx, documentId, meta) {
      const owned = await ownedDocument(ctx, documentId);
      await repository.transaction(async (r) => {
        const doc = await r.lockDocument(documentId);
        if (!doc) throw docNotFound();
        const status = await r.lockRegistrationStatus(doc.registrationId);
        if (status) assertOpen(status);
        if (!doc.uploadedAt) {
          throw AppError.conflict(
            'DOCUMENT_NOT_UPLOADED',
            'The file must be uploaded before it can be submitted',
          );
        }
        if (doc.status !== 'PENDING') {
          throw AppError.conflict(
            'INVALID_DOCUMENT_STATE',
            `A ${doc.status} document cannot be submitted`,
          );
        }
        if (doc.submittedAt) {
          throw AppError.conflict(
            'DOCUMENT_ALREADY_SUBMITTED',
            'This document has already been submitted',
          );
        }
        await r.markSubmitted(documentId);
        await r.audit({
          action: 'DOCUMENT_SUBMITTED',
          actorUserId: ctx.userId,
          entityId: documentId,
          metadata: { registrationId: doc.registrationId, documentType: doc.documentType },
          meta,
        });
      });
      await readiness.afterChange(owned.document.registrationId);
      return dtoOrThrow(documentId);
    },

    async review(ctx, documentId, body, meta) {
      const access = await repository.findDocument(documentId, ctx.userId);
      // Only an admin of the organization that owns the event may review; anyone else cannot see it exists.
      if (!access || !isAdminOf(ctx, access.eventOrganizationId)) throw docNotFound();

      let reviewedType = '';
      await repository.transaction(async (r) => {
        const doc = await r.lockDocument(documentId);
        if (!doc) throw docNotFound();
        reviewedType = doc.documentType;
        const status = await r.lockRegistrationStatus(doc.registrationId);
        if (status) assertOpen(status);
        if (!doc.submittedAt) {
          throw AppError.conflict(
            'DOCUMENT_NOT_SUBMITTED',
            'This document has not been submitted for review',
          );
        }
        // The row lock makes simultaneous reviews take turns; the second sees the first decision.
        if (doc.status !== 'PENDING') {
          throw AppError.conflict(
            'DOCUMENT_ALREADY_REVIEWED',
            'This document has already been reviewed',
          );
        }
        const rejected = body.decision === 'REJECTED';
        await r.insertReview({
          documentId,
          reviewerId: ctx.userId,
          decision: body.decision,
          reasonCode: rejected ? body.reasonCode : null,
          reason: rejected ? body.reason : null,
          notes: body.notes ?? null,
        });
        await r.setReviewStatus(documentId, body.decision);
        await r.audit({
          action: rejected ? 'DOCUMENT_REJECTED' : 'DOCUMENT_APPROVED',
          actorUserId: ctx.userId,
          entityId: documentId,
          metadata: {
            registrationId: doc.registrationId,
            documentType: doc.documentType,
            reasonCode: rejected ? body.reasonCode : null,
          },
          meta,
        });
      });
      // After commit, and before readiness (which may add its own event-day notification). Never throws.
      await notifications?.documentReviewed({
        registrationId: access.document.registrationId,
        documentId,
        documentType: reviewedType,
        decision: body.decision,
        reason: body.decision === 'REJECTED' ? body.reason : null,
      });
      await readiness.afterChange(access.document.registrationId);
      // The approved photo becomes the player's face, if their guardian consented. The approval above stands whatever happens here.
      if (
        body.decision === 'APPROVED' &&
        reviewedType === 'PROFILE_PHOTO' &&
        (access.playerId || access.staffProfileId)
      ) {
        await faceEnrollment_
          ?.afterPhotoApproved({
            playerId: access.playerId,
            staffProfileId: access.staffProfileId,
            documentId,
            actorUserId: ctx.userId,
            meta,
          })
          .catch(() => undefined);
      }
      // A rejected photo can no longer stand for the person: their face profile is revoked (and removed at the face service).
      if (
        body.decision === 'REJECTED' &&
        reviewedType === 'PROFILE_PHOTO' &&
        (access.playerId || access.staffProfileId)
      ) {
        await faceEnrollment_
          ?.afterPhotoRejected?.({
            playerId: access.playerId,
            staffProfileId: access.staffProfileId,
            documentId,
            actorUserId: ctx.userId,
            meta,
          })
          .catch(() => undefined);
      }
      return dtoOrThrow(documentId);
    },

    async list(ctx, registrationId) {
      const registration = await repository.findRegistration(registrationId, ctx.userId);
      const admin = registration !== null && isAdminOf(ctx, registration.eventOrganizationId);
      if (!registration || !(registration.isOwner || admin)) throw regNotFound();
      const all = await repository.listDtos(registrationId);
      const visible = registration.isOwner ? all : all.filter((d) => d.submittedAt !== null);
      return {
        documents: visible,
        completeness: completenessOf(visible, registration.registrantType),
      };
    },

    async downloadUrl(ctx, documentId, meta, options = {}) {
      const { files } = requireStorage();
      const access = await readableDocument(ctx, documentId);
      const doc: DocumentRecord = access.document;
      if (!doc.uploadedAt) {
        throw AppError.conflict(
          'DOCUMENT_NOT_UPLOADED',
          'There is no uploaded file for this document',
        );
      }
      const signed = await files
        .issueDownload({
          key: doc.storageKey,
          registrationId: doc.registrationId,
          downloadFileName: doc.fileName,
          inline: options.inline,
        })
        .catch((e: unknown) => {
          throw storageFailure(e);
        });
      // Viewing identity documents is audited. The URL itself is never logged or stored.
      await repository.transaction((r) =>
        r.audit({
          action: 'DOCUMENT_DOWNLOAD_URL_ISSUED',
          actorUserId: ctx.userId,
          entityId: documentId,
          metadata: { registrationId: doc.registrationId, documentType: doc.documentType },
          meta,
        }),
      );
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    },
  };
}
