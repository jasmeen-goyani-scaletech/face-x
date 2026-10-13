import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import type { AuthContext } from '../auth/types';
import type { ReadinessTrigger } from '../readiness/types';
import { isMinorForEvent } from '../registrations';
import type { ConsentRegistration, ConsentRepository } from './repository';
import { consentRequirement } from './requirements';
import type { RecordConsentBody } from './schema';
import {
  ALL_REGISTRATION_CONSENT_CODES,
  BIOMETRIC_CONSENT,
  CONSENT_CODES_FOR,
  recordableConsentCodes,
  type ConsentRecordDto,
  type ConsentStatusDto,
  type ConsentVersionDto,
} from './types';

/**
 * Consent records for a registration: which published consent version was accepted, by whom, and when.
 *
 * The wording is never defined here: it comes from the `consents` table. A record is immutable once written
 * and a new version never edits an old record: the family accepts the new version as an additional record.
 * Recording consent does not itself edit the registration: once it has committed, the readiness evaluator re-checks whether
 * the registration can advance (modules/readiness).
 *
 * Access: the owner (a linked guardian, the player, or the coach/staff member) records and reads; an ADMIN of the organization that
 * owns the event can read. Everyone else gets 404. Anonymous / email-link guardian consent is NOT supported
 * (pending product decision): the signer must be a logged-in account.
 */
export interface ConsentService {
  /**
   * The wording a registrant would accept now, for every consent a registration can need. Lets the form show the
   * exact text BEFORE the registration exists (the registration is created from the same step). Codes with nothing
   * published yet are left out. It is reference data: no registration or personal data is involved.
   */
  listCurrent(): Promise<ConsentVersionDto[]>;
  getStatus(ctx: AuthContext, registrationId: string): Promise<ConsentStatusDto>;
  record(
    ctx: AuthContext,
    registrationId: string,
    body: RecordConsentBody,
    meta: RequestMeta,
  ): Promise<ConsentRecordDto>;
}

const FROZEN_REGISTRATION_STATUSES = ['CANCELLED', 'REJECTED'];
const regNotFound = () => AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');

/** The frontend compares signatures case-, spacing- and edge-whitespace-insensitively. */
const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Age only matters for a player; a coach or staff member is never treated as a minor here. */
const isMinor = (r: ConsentRegistration) =>
  r.playerDateOfBirth !== null &&
  isMinorForEvent(r.playerDateOfBirth, r.eventStartsAt, r.eventTimezone);

/** What happens to a player's face after their guardian accepts the face-scan consent (see FaceService.enrollAfterConsent). Must not throw. */
export interface BiometricConsentHook {
  afterBiometricConsent(input: {
    registrationId: string;
    actorUserId: string;
    meta: RequestMeta;
  }): Promise<unknown>;
}

export function createConsentService(
  repository: ConsentRepository,
  readiness: ReadinessTrigger,
  faceEnrollment?: BiometricConsentHook,
): ConsentService {
  return {
    async listCurrent() {
      const current: ConsentVersionDto[] = [];
      for (const code of ALL_REGISTRATION_CONSENT_CODES) {
        const version = await repository.findCurrent(code);
        if (version) current.push(version);
      }
      return current;
    },

    async getStatus(ctx, registrationId) {
      const reg = await repository.findRegistration(registrationId, ctx.userId);
      const admin =
        reg !== null &&
        ctx.roles.includes('ADMIN') &&
        ctx.organizationId !== null &&
        ctx.organizationId === reg.eventOrganizationId;
      if (!reg || !(reg.isOwner || admin)) throw regNotFound();

      const records = await repository.listRecords(registrationId);
      const requirements = [];
      for (const code of CONSENT_CODES_FOR[reg.registrantType]) {
        const current = await repository.findCurrent(code);
        requirements.push(consentRequirement(code, isMinor(reg), current, records));
      }
      return { registrationId, requirements, records };
    },

    async record(ctx, registrationId, body, meta) {
      const reg = await repository.findRegistration(registrationId, ctx.userId);
      if (!reg || !reg.isOwner) throw regNotFound();

      const consent = await repository.findEffectiveById(body.consentId);
      if (!consent) throw AppError.notFound('CONSENT_NOT_FOUND', 'Consent not found');
      if (!recordableConsentCodes(reg.registrantType).includes(consent.code)) {
        throw new AppError(
          422,
          'CONSENT_NOT_APPLICABLE',
          'This consent does not apply to this registration',
        );
      }
      const current = await repository.findCurrent(consent.code);
      if (!current || current.id !== consent.id) {
        // A newer version exists: accepting an old one would record agreement to superseded wording.
        throw AppError.conflict(
          'CONSENT_VERSION_OUTDATED',
          'A newer version of this consent is available',
        );
      }

      const recordId = await repository.transaction(async (r) => {
        const status = await r.lockRegistrationStatus(registrationId);
        if (!status) throw regNotFound();
        if (FROZEN_REGISTRATION_STATUSES.includes(status)) {
          throw AppError.conflict(
            'REGISTRATION_CLOSED',
            `A ${status} registration can no longer be changed`,
          );
        }

        // Only a player's registration has guardians; a coach or staff member signs for themself.
        const signer = reg.playerId ? await r.findSigner(reg.playerId, ctx.userId) : null;
        // A minor cannot consent for themself: a linked guardian with an account must (for their face as much as for the event).
        if (
          (consent.code === 'GUARDIAN_CONSENT' || consent.code === BIOMETRIC_CONSENT) &&
          isMinor(reg) &&
          !signer
        ) {
          throw AppError.forbidden(
            'A parent or guardian must accept this consent',
            'GUARDIAN_REQUIRED_TO_CONSENT',
          );
        }
        const expectedName = signer
          ? `${signer.firstName} ${signer.lastName}`
          : `${reg.registrantFirstName} ${reg.registrantLastName}`;
        if (normalizeName(body.signedName) !== normalizeName(expectedName)) {
          throw new AppError(
            422,
            'SIGNATURE_MISMATCH',
            'The signature must match the signer’s full name',
            [{ path: 'signedName', message: 'must match the full name on file' }],
          );
        }

        // Unique (consent version, registration): of any number of simultaneous requests one inserts.
        const id = await r.insertRecord({
          consentId: consent.id,
          registrationId,
          acceptedByUserId: ctx.userId,
          acceptedByParentId: signer?.parentId ?? null,
          signedName: body.signedName,
          meta,
        });
        if (!id) {
          throw AppError.conflict(
            'CONSENT_ALREADY_RECORDED',
            'This version of the consent was already accepted',
          );
        }
        await r.audit({
          action: 'CONSENT_RECORDED',
          actorUserId: ctx.userId,
          entityId: id,
          metadata: { registrationId, code: consent.code, version: consent.version },
          meta,
        });
        return id;
      });

      // Recording consent can complete the registration's requirements: re-evaluate after it has committed.
      await readiness.afterChange(registrationId);
      // A photo that was approved before the guardian consented has been waiting for this: enroll it now. The consent stands whatever happens.
      if (consent.code === BIOMETRIC_CONSENT) {
        await faceEnrollment
          ?.afterBiometricConsent({ registrationId, actorUserId: ctx.userId, meta })
          .catch(() => undefined);
      }

      const records = await repository.listRecords(registrationId);
      const created = records.find((x) => x.id === recordId);
      if (!created) throw regNotFound();
      return created;
    },
  };
}
