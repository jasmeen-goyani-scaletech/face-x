import type { Logger } from 'pino';
import {
  FaceProviderError,
  IMAGE_PROBLEM_CODES,
  type FaceImageType,
  type FaceRecognitionProvider,
  type FaceSubjectRole,
} from '../../infrastructure/face/face-provider';
import { withDeadline } from '../../infrastructure/face/deadline';
import { sniffContentType } from '../../infrastructure/storage/content-sniffing';
import type { ObjectReader } from '../../infrastructure/storage/object-reader';
import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import { safeCause } from '../../shared/utils/scrub';
import type { AuthContext } from '../auth/types';
import {
  playerSubject,
  staffSubject,
  type FaceRepository,
  type FaceSubject,
} from './repository';
import type { EnrollBody } from './schema';
import { WAIVED_CONSENT, type BiometricConsentPolicy, type FaceProfileStatusDto } from './types';

/**
 * Face enrollment: link a player to an identity held by the face-recognition provider.
 *
 * This service only talks to the FaceRecognitionProvider interface. It stores the provider's opaque reference and
 * nothing biometric: the photo is read from private storage into memory for the provider call and is never copied,
 * logged or persisted by this application. Enrollment is independent of every other state: it does not verify or
 * ready a registration, complete a payment, approve a document or record consent.
 *
 * Access: the player, or a linked guardian, enrolls and removes. An ADMIN of an organization the player is
 * registered with can read the status (never change it). Everyone else gets 404. A coach or staff member is the
 * same with themself in place of the guardian: they remove their own face, an admin of their event reads it.
 *
 * Replacing a photo: when an admin approves a NEW photo for someone who already has a face profile, the old identity is
 * hard-deleted at the provider first (so its vectors are gone, not just hidden) and the new photo is enrolled in its place.
 */
export interface FaceService {
  enroll(
    ctx: AuthContext,
    playerId: string,
    body: EnrollBody,
    meta: RequestMeta,
  ): Promise<FaceProfileStatusDto>;
  /**
   * Enrolls the player's photo right after an admin approved it. Not an authorized request of a family member, so it skips
   * the ownership check but none of the others. It never throws: the answer says what happened.
   */
  enrollApprovedPhoto(input: {
    /** Exactly one is set, from the registration the photo belongs to. */
    playerId: string | null;
    staffProfileId: string | null;
    documentId: string;
    /** The admin who approved the photo. */
    actorUserId: string;
    meta: RequestMeta;
  }): Promise<'ENROLLED' | 'SKIPPED' | 'FAILED'>;
  /**
   * Enrolls a registration's approved photo right after the guardian accepted the face-scan consent (the photo was approved first and
   * enrollment was waiting for consent). Same checks and same "never throws" answer as enrollApprovedPhoto; the family member who
   * consented is recorded as the one who enrolled it.
   */
  enrollAfterConsent(input: {
    registrationId: string;
    actorUserId: string;
    meta: RequestMeta;
  }): Promise<'ENROLLED' | 'SKIPPED' | 'FAILED'>;
  getStatus(ctx: AuthContext, playerId: string): Promise<FaceProfileStatusDto>;
  remove(ctx: AuthContext, playerId: string, meta: RequestMeta): Promise<FaceProfileStatusDto>;
  getStaffStatus(ctx: AuthContext, staffProfileId: string): Promise<FaceProfileStatusDto>;
  removeStaff(
    ctx: AuthContext,
    staffProfileId: string,
    meta: RequestMeta,
  ): Promise<FaceProfileStatusDto>;
}

export interface FaceRecognitionConfig {
  provider: FaceRecognitionProvider;
  /** Reads the registration photo from private storage into memory. */
  images: ObjectReader;
  consentPolicy: BiometricConsentPolicy;
  /** A slow provider must not hold a database transaction (and the player's lock) open indefinitely. */
  timeoutMs: number;
  /** The permanent URL of a stored object, recorded as the person's `photo_url` once their photo is enrolled. Absent: not recorded. */
  objectUrl?: (storageKey: string) => string | null;
}

export interface FaceServiceDeps {
  repository: FaceRepository;
  /** Absent when no provider is configured: enrollment and removal then answer 503; reading status still works. */
  recognition?: FaceRecognitionConfig;
  logger: Logger;
}

/** Largest photo handed to a provider. Matches the player-images upload limit (5 MiB). */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const FACE_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
const FROZEN_REGISTRATION_STATUSES = ['CANCELLED', 'REJECTED'];

const playerNotFound = () => AppError.notFound('PLAYER_NOT_FOUND', 'Player not found');
const staffNotFound = () => AppError.notFound('STAFF_PROFILE_NOT_FOUND', 'Staff profile not found');
const notConfigured = () =>
  AppError.unavailable('FACE_NOT_CONFIGURED', 'Face recognition is not configured');

/** Turns anything a provider throws into a safe API error. The provider's own text never reaches the client. */
function providerError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof FaceProviderError) {
    if (IMAGE_PROBLEM_CODES.includes(err.code)) {
      return new AppError(
        422,
        'FACE_IMAGE_REJECTED',
        'The photo cannot be used for face enrollment',
        [{ path: 'documentId', message: err.code }],
      );
    }
    if (err.code === 'TIMEOUT') {
      return AppError.unavailable(
        'FACE_PROVIDER_TIMEOUT',
        'The face recognition provider timed out',
      );
    }
  }
  const out = AppError.unavailable(
    'FACE_PROVIDER_UNAVAILABLE',
    'The face recognition provider is unavailable',
  );
  (out as { cause?: unknown }).cause = safeCause(err);
  return out;
}

export function createFaceService({
  repository,
  recognition,
  logger,
}: FaceServiceDeps): FaceService {
  const requireRecognition = (): FaceRecognitionConfig => {
    if (!recognition) throw notConfigured();
    return recognition;
  };

  async function ownedPlayer(ctx: AuthContext, playerId: string) {
    const access = await repository.findPlayerAccess(playerId, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    });
    if (!access || !access.isOwner) throw playerNotFound();
  }

  async function ownedStaff(ctx: AuthContext, staffProfileId: string) {
    const access = await repository.findStaffAccess(staffProfileId, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    });
    if (!access || !access.isOwner) throw staffNotFound();
  }

  /** The provider's label for the person: what they are to the application. */
  const roleOf = (subject: FaceSubject, registrantType: 'PLAYER' | 'COACH' | 'STAFF'): FaceSubjectRole =>
    subject.kind === 'PLAYER' ? 'PLAYER' : registrantType === 'COACH' ? 'COACH' : 'STAFF';

  /** Ids only, for the audit trail: the key that applies (`playerId` as it has always been, or `staffProfileId`). */
  const whoIs = (subject: FaceSubject): Record<string, string> =>
    subject.kind === 'PLAYER' ? { playerId: subject.id } : { staffProfileId: subject.id };

  async function enrollCore(
    actorUserId: string,
    subject: FaceSubject,
    body: EnrollBody,
    meta: RequestMeta,
    /** Who may enroll this player: the owner for a request, nobody to ask for an admin's approval of the photo. */
    authorize: () => Promise<void>,
    automatic: boolean,
  ): Promise<FaceProfileStatusDto> {
    const cfg = requireRecognition();
    if (cfg.consentPolicy === undefined) {
      // Whether biometric consent is required is a product decision that has not been made: do not guess.
      throw AppError.unavailable(
        'FACE_CONSENT_POLICY_NOT_CONFIGURED',
        'Face enrollment is not enabled until the biometric consent policy is configured',
      );
    }
    const consentCode = cfg.consentPolicy;
    await authorize();

    // Set once the provider has created an identity, cleared once our database owns it. Whatever remains set when
    // something fails is an orphan at the provider that we remove again.
    let orphanReference: string | null = null;
    // Set when an old identity was deleted and the new one then failed: reported after the revocation has been committed.
    const afterCommit: { failure: AppError | null } = { failure: null };
    try {
      await repository.transaction(async (r) => {
        await r.lockFace(subject);
        // A person's own request never replaces an existing profile (they remove it first). An admin's approval of a photo
        // OTHER than the one the profile was made from does: it is a new photo of the same person (say, for a later event).
        // The replacement happens below, once every other check has passed, so a missing consent or an unreadable photo
        // can never cost someone the face they already have.
        const existing = await r.lockActive(subject);
        if (existing && !(automatic && existing.sourceDocumentId !== body.documentId)) {
          throw AppError.conflict(
            'FACE_PROFILE_ALREADY_EXISTS',
            'This person already has a face profile',
          );
        }

        const source = await r.findEnrollmentSource(subject, body.documentId);
        if (!source) throw AppError.notFound('DOCUMENT_NOT_FOUND', 'Photo not found');
        if (
          source.documentType !== 'PROFILE_PHOTO' ||
          !source.uploaded ||
          // An unreviewed photo could be anyone's face: only a photo an admin approved can become an identity.
          source.documentStatus !== 'APPROVED' ||
          FROZEN_REGISTRATION_STATUSES.includes(source.registrationStatus)
        ) {
          throw AppError.conflict(
            'FACE_PHOTO_NOT_ELIGIBLE',
            'Only an approved registration photo can be used for face enrollment',
          );
        }

        let consentRecordId: string | null = null;
        if (consentCode !== WAIVED_CONSENT) {
          consentRecordId = await r.findCurrentConsentRecord(source.registrationId, consentCode);
          if (!consentRecordId) {
            throw AppError.conflict(
              'BIOMETRIC_CONSENT_REQUIRED',
              'The current biometric consent must be accepted before face enrollment',
            );
          }
        }

        const stored = await cfg.images
          .read(source.storageKey, { maxBytes: MAX_PHOTO_BYTES })
          .catch((e: unknown) => {
            const err = AppError.unavailable('STORAGE_UNAVAILABLE', 'File storage is unavailable');
            (err as { cause?: unknown }).cause = safeCause(e);
            throw err;
          });
        if (!stored.exists) {
          throw AppError.conflict('FACE_PHOTO_NOT_ELIGIBLE', 'The photo file is not available');
        }
        const mimeType = stored.tooLarge ? null : sniffContentType(stored.bytes);
        if (stored.tooLarge || !mimeType || !FACE_IMAGE_TYPES.includes(mimeType)) {
          throw new AppError(422, 'FACE_IMAGE_INVALID', 'The photo is not a usable image');
        }

        // Replacing: the old identity is hard-deleted at the provider (its vectors are gone, not hidden) and its profile
        // revoked. If the provider cannot delete it nothing has changed: the old profile stays ACTIVE and this fails.
        if (existing) {
          await withDeadline(cfg.timeoutMs, (signal) =>
            cfg.provider.remove(existing.reference, { signal }),
          ).catch((e: unknown) => {
            throw providerError(e);
          });
          await r.revokeProfile(existing.id, actorUserId, 'PHOTO_REPLACED');
          await r.audit({
            action: 'FACE_PROFILE_REMOVED',
            actorUserId,
            entityId: existing.id,
            metadata: { ...whoIs(subject), reason: 'PHOTO_REPLACED' },
            meta,
          });
        }

        const attempt = (await r.countProfiles(subject)) + 1;
        let enrolled: { reference: string };
        try {
          enrolled = await withDeadline(cfg.timeoutMs, (signal) =>
            cfg.provider.enroll({
              subjectId: subject.id, // our id only: no name, date of birth or contact details go to the provider
              image: { bytes: stored.bytes, mimeType: mimeType as FaceImageType },
              idempotencyKey: `enroll:${subject.id}:${source.documentId}:${attempt}`,
              role: roleOf(subject, source.registrantType),
              signal,
            }),
          );
        } catch (e) {
          if (!existing) throw providerError(e);
          // The old identity is already gone at the provider, so the revocation must stand: commit it, then report the failure.
          afterCommit.failure = providerError(e);
          return;
        }
        orphanReference = enrolled.reference;

        const profileId = await r.insertProfile({
          subject,
          provider: cfg.provider.name,
          reference: enrolled.reference,
          sourceDocumentId: source.documentId,
          consentRecordId,
          enrolledBy: actorUserId,
        });
        if (!profileId) {
          if (await r.findActive(subject)) {
            // Lost a race despite the lock: our identity is redundant and ours alone, so it is removed (below).
            throw AppError.conflict(
              'FACE_PROFILE_ALREADY_EXISTS',
              'This person already has a face profile',
            );
          }
          // The provider handed back a reference another profile already owns. That identity is not ours to delete.
          orphanReference = null;
          throw AppError.conflict('FACE_PROFILE_CONFLICT', 'The face profile could not be created');
        }
        // The enrolled photo's permanent address, kept on the person. Only the address: the image stays in private storage.
        const photoUrl = cfg.objectUrl?.(source.storageKey) ?? null;
        if (photoUrl) await r.setPhotoUrl(subject, photoUrl);
        await r.audit({
          action: 'FACE_PROFILE_CREATED',
          actorUserId: actorUserId,
          entityId: profileId,
          // Ids and booleans only: no provider reference, no image, nothing biometric.
          metadata: {
            ...whoIs(subject),
            documentId: source.documentId,
            consentRecorded: consentRecordId !== null,
            automatic,
          },
          meta,
        });
      });
      orphanReference = null;
      if (afterCommit.failure) throw afterCommit.failure;
    } catch (err) {
      if (orphanReference) {
        const reference = orphanReference;
        await withDeadline(cfg.timeoutMs, (signal) =>
          cfg.provider.remove(reference, { signal }),
        ).catch(() =>
          // Never the reference or the error text: just that cleanup is needed.
          logger.error(
            { subjectId: subject.id },
            'Could not remove an unsaved face identity at the provider; manual cleanup needed',
          ),
        );
      }
      throw err;
    }
    return repository.getStatus(subject);
  }

  /** Removes a person's face: the provider first (a hard delete), then the profile is marked REVOKED. */
  async function removeCore(
    actorUserId: string,
    subject: FaceSubject,
    meta: RequestMeta,
  ): Promise<FaceProfileStatusDto> {
    const cfg = requireRecognition();
    await repository.transaction(async (r) => {
      await r.lockFace(subject);
      const active = await r.lockActive(subject);
      if (!active) throw AppError.notFound('FACE_PROFILE_NOT_FOUND', 'No active face profile');
      // The provider goes first: if it fails the profile stays ACTIVE and the user can retry, instead of us
      // claiming a deletion that did not happen. Provider remove() succeeds when the identity is already gone.
      await withDeadline(cfg.timeoutMs, (signal) =>
        cfg.provider.remove(active.reference, { signal }),
      ).catch((e: unknown) => {
        throw providerError(e);
      });
      await r.revokeProfile(active.id, actorUserId, 'USER_REQUEST');
      await r.audit({
        action: 'FACE_PROFILE_REMOVED',
        actorUserId,
        entityId: active.id,
        metadata: whoIs(subject),
        meta,
      });
    });
    return repository.getStatus(subject);
  }

  return {
    enroll(ctx, playerId, body, meta) {
      return enrollCore(
        ctx.userId,
        playerSubject(playerId),
        body,
        meta,
        () => ownedPlayer(ctx, playerId),
        false,
      );
    },

    async enrollApprovedPhoto({ playerId, staffProfileId, documentId, actorUserId, meta }) {
      const subject = playerId
        ? playerSubject(playerId)
        : staffProfileId
          ? staffSubject(staffProfileId)
          : null;
      if (!subject) return 'SKIPPED';
      // Enrolling is only ever a consequence of an admin approving the photo, never of the photo alone: what is checked is the
      // same as for a family's own request (approved photo, current biometric consent, one active profile), and an admin's
      // approval is not blocked by any of it. "Skipped" is a normal answer (no consent given, already enrolled, face
      // recognition off); a provider or image problem is logged for staff to see.
      if (!recognition || recognition.consentPolicy === undefined) return 'SKIPPED';
      try {
        await enrollCore(actorUserId, subject, { documentId }, meta, async () => undefined, true);
        return 'ENROLLED';
      } catch (err) {
        if (
          err instanceof AppError &&
          [
            'BIOMETRIC_CONSENT_REQUIRED',
            'FACE_PROFILE_ALREADY_EXISTS',
            'FACE_PHOTO_NOT_ELIGIBLE',
          ].includes(err.code)
        ) {
          return 'SKIPPED';
        }
        logger.warn(
          {
            subjectId: subject.id,
            code: err instanceof AppError ? err.code : 'UNEXPECTED',
            cause: safeCause(err),
          },
          'Automatic face enrollment after photo approval did not complete',
        );
        return 'FAILED';
      }
    },

    async enrollAfterConsent({ registrationId, actorUserId, meta }) {
      const found = await repository
        .findApprovedPhotoOfRegistration(registrationId)
        .catch(() => null);
      if (!found) return 'SKIPPED';
      return this.enrollApprovedPhoto({
        playerId: found.subject.kind === 'PLAYER' ? found.subject.id : null,
        staffProfileId: found.subject.kind === 'STAFF' ? found.subject.id : null,
        documentId: found.documentId,
        actorUserId,
        meta,
      });
    },

    async getStatus(ctx, playerId) {
      const access = await repository.findPlayerAccess(playerId, {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
      });
      const adminView =
        access?.inViewerOrganization === true &&
        ctx.roles.includes('ADMIN') &&
        ctx.organizationId !== null;
      if (!access || !(access.isOwner || adminView)) throw playerNotFound();
      return repository.getStatus(playerSubject(playerId));
    },

    async remove(ctx, playerId, meta) {
      requireRecognition();
      await ownedPlayer(ctx, playerId);
      return removeCore(ctx.userId, playerSubject(playerId), meta);
    },

    async getStaffStatus(ctx, staffProfileId) {
      const access = await repository.findStaffAccess(staffProfileId, {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
      });
      const adminView =
        access?.inViewerOrganization === true &&
        ctx.roles.includes('ADMIN') &&
        ctx.organizationId !== null;
      if (!access || !(access.isOwner || adminView)) throw staffNotFound();
      return repository.getStatus(staffSubject(staffProfileId));
    },

    async removeStaff(ctx, staffProfileId, meta) {
      requireRecognition();
      await ownedStaff(ctx, staffProfileId);
      return removeCore(ctx.userId, staffSubject(staffProfileId), meta);
    },
  };
}
