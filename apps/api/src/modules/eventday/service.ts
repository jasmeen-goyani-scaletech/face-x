import type { Logger } from 'pino';
import { withDeadline } from '../../infrastructure/face/deadline';
import {
  FaceProviderError,
  IMAGE_PROBLEM_CODES,
  type FaceImageType,
  type FaceRecognitionProvider,
} from '../../infrastructure/face/face-provider';
import { sniffContentType } from '../../infrastructure/storage/content-sniffing';
import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import { safeCause } from '../../shared/utils/scrub';
import type { AuthContext } from '../auth/types';
import type { EligibilityReason } from './eligibility';
import { decideMatch, type FaceScanPolicy } from './matching';
import {
  SEARCH_RESULT_LIMIT,
  type CheckInRow,
  type EventDayRepo,
  type EventDayRepository,
  type ResolvedCandidate,
} from './repository';
import type { CheckInBody } from './schema';
import type { CheckInDto, FaceScanResultDto, SearchResultDto } from './types';

/**
 * Event-day backend: scan a face, check a player in, search a player.
 *
 * Trust model: the client never says who was recognized. A scan is recorded by the server; a FACE check-in names
 * only that scan, and the server derives the player from it. Every check-in re-runs eligibility against the
 * current database state, and the database (unique constraints + triggers) is the last line of defence.
 *
 * Privacy: the image lives in memory for one identify() call. It is never written, logged or audited, and the
 * provider's candidate list is not stored: only the outcome (and, for a MATCH, who) goes into face_scans.
 */
export interface EventDayService {
  scan(
    ctx: AuthContext,
    eventId: string,
    image: Uint8Array,
    meta: RequestMeta,
  ): Promise<FaceScanResultDto>;
  checkIn(
    ctx: AuthContext,
    eventId: string,
    body: CheckInBody,
    meta: RequestMeta,
  ): Promise<{ created: boolean; checkIn: CheckInDto }>;
  search(
    ctx: AuthContext,
    eventId: string,
    term: string,
  ): Promise<{ results: SearchResultDto[]; truncated: boolean; limit: number }>;
  /** Throws 503 when no face provider is configured. Called before the request body is read. */
  assertScanAvailable(): void;
}

export interface EventDayServiceDeps {
  repository: EventDayRepository;
  /** Absent: scanning answers 503; check-in by MANUAL and search keep working. Never a fabricated match. */
  provider?: FaceRecognitionProvider;
  policy: FaceScanPolicy;
  /** Signs the stored address of a scan's frame for the scanner screen. Absent, or null for a foreign address: the address is returned as is. */
  scanImageViewUrl?: (storedUrl: string) => Promise<string | null>;
  logger: Logger;
}

/** How long a MATCH scan can be turned into a check-in. A person who walked away should be scanned again. */
export const SCAN_MAX_AGE_SECONDS = 120;
/** Candidates requested from the provider's global index; the rest are filtered to this event. */
const MAX_CANDIDATES = 10;
const IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** A refused check-in: an AppError that the service also writes to the audit log (outside the rolled-back transaction). */
class CheckInRefused extends AppError {
  constructor(
    status: 404 | 409,
    code: string,
    message: string,
    public readonly refusal: { registrationId?: string; scanId?: string },
    reasons?: readonly string[],
    /** Plain facts the caller may use (e.g. when the winning check-in happened), sent as details next to the reasons. */
    facts?: Record<string, string>,
  ) {
    const details = [
      ...(reasons ?? []).map((r) => ({ path: 'reason', message: r })),
      ...Object.entries(facts ?? {}).map(([path, value]) => ({ path, message: value })),
    ];
    super(status, code, message, details.length > 0 ? details : undefined);
    this.name = 'CheckInRefused';
  }
}

const displayName = (c: { firstName: string; lastName: string }) =>
  `${c.firstName} ${c.lastName.slice(0, 1)}.`;

const scanProblems: Record<string, { status: 422 | 503; code: string; message: string }> = {
  NO_FACE_DETECTED: {
    status: 422,
    code: 'FACE_NOT_DETECTED',
    message: 'No face was found in the image',
  },
  MULTIPLE_FACES: {
    status: 422,
    code: 'FACE_MULTIPLE',
    message: 'More than one face was found in the image',
  },
  LOW_QUALITY: { status: 422, code: 'FACE_LOW_QUALITY', message: 'The image quality is too low' },
  IMAGE_REJECTED: { status: 422, code: 'FACE_IMAGE_REJECTED', message: 'The image cannot be used' },
  TIMEOUT: { status: 503, code: 'FACE_PROVIDER_TIMEOUT', message: 'Face recognition timed out' },
  UNAVAILABLE: {
    status: 503,
    code: 'FACE_PROVIDER_UNAVAILABLE',
    message: 'Face recognition is unavailable',
  },
};

/** The safe error for anything a provider throws. Its own text never reaches the client. */
function providerFailure(err: unknown): { app: AppError; code: string } {
  const code = err instanceof FaceProviderError ? err.code : 'UNAVAILABLE';
  const p = scanProblems[code] ?? scanProblems.UNAVAILABLE!;
  const app = new AppError(p.status, p.code, p.message);
  if (!(err instanceof FaceProviderError) || !IMAGE_PROBLEM_CODES.includes(err.code)) {
    (app as { cause?: unknown }).cause = safeCause(err); // server-side log only, scrubbed
  }
  return { app, code };
}

export function createEventDayService({
  repository,
  provider,
  policy,
  scanImageViewUrl,
  logger,
}: EventDayServiceDeps): EventDayService {
  const notConfigured = () =>
    AppError.unavailable('FACE_NOT_CONFIGURED', 'Face recognition is not configured');

  /** Records the outcome and the audit entry together. */
  async function recordScan(
    ctx: AuthContext,
    eventId: string,
    meta: RequestMeta,
    outcome: {
      result: 'MATCH' | 'NO_MATCH' | 'REVIEW_REQUIRED' | 'ERROR';
      reasonCode: string | null;
      matched?: ResolvedCandidate;
      score?: number;
      candidateCount?: number;
      scanImageUrl?: string | null;
    },
  ): Promise<string> {
    return repository.transaction(async (r) => {
      const scanId = await r.insertScan({
        eventId,
        scannedBy: ctx.userId,
        result: outcome.result,
        provider: provider!.name,
        matchedPlayerId: outcome.result === 'MATCH' ? outcome.matched!.playerId : null,
        matchedStaffProfileId: outcome.result === 'MATCH' ? outcome.matched!.staffProfileId : null,
        scanImageUrl: outcome.scanImageUrl ?? null,
        faceProfileId: outcome.result === 'MATCH' ? outcome.matched!.faceProfileId : null,
        score: outcome.score ?? null,
        reasonCode: outcome.reasonCode,
      });
      await r.audit({
        action: 'FACE_SCAN_PERFORMED',
        actorUserId: ctx.userId,
        entityType: 'face_scan',
        entityId: scanId,
        // Ids, the result and a reason code only: no image, no score, no provider data.
        metadata: {
          eventId,
          result: outcome.result,
          reasonCode: outcome.reasonCode,
          registrationId: outcome.matched?.registrationId ?? null,
          playerId: outcome.result === 'MATCH' ? outcome.matched!.playerId : null,
          // Only when a coach or staff member was matched, so a player's entry is exactly what it always was.
          ...(outcome.result === 'MATCH' && outcome.matched!.staffProfileId
            ? { staffProfileId: outcome.matched!.staffProfileId }
            : {}),
          candidateCount: outcome.candidateCount ?? null,
        },
        meta,
      });
      return scanId;
    });
  }

  function refuse(
    status: 404 | 409,
    code: string,
    message: string,
    refusal: { registrationId?: string; scanId?: string } = {},
    reasons?: readonly string[],
    facts?: Record<string, string>,
  ): never {
    throw new CheckInRefused(status, code, message, refusal, reasons, facts);
  }

  function notEligible(
    reasons: readonly EligibilityReason[],
    refusal: { registrationId?: string; scanId?: string },
  ): never {
    return refuse(409, 'PLAYER_NOT_ELIGIBLE', 'This player cannot be checked in', refusal, reasons);
  }

  /**
   * The frame's address as the scanner should receive it: signed if it can be, otherwise as stored. An object with the one
   * key, or nothing when no frame was kept, so a response without a frame is exactly what it was before frames existed.
   */
  async function viewable(stored: string | null): Promise<{ scanImageUrl?: string }> {
    if (!stored) return {};
    const signed = await scanImageViewUrl?.(stored).catch(() => null);
    return { scanImageUrl: signed ?? stored };
  }

  const toDto = (c: CheckInRow): CheckInDto => ({
    checkInId: c.checkInId,
    registrationId: c.registrationId,
    registrationNumber: c.registrationNumber,
    method: c.method,
    checkedInAt: c.checkedInAt,
  });

  /** The same request id may only ever be replayed for the exact same check-in by the same operator at the same event. */
  function replay(
    existing: CheckInRow,
    ctx: AuthContext,
    eventId: string,
    body: CheckInBody,
  ): { created: false; checkIn: CheckInDto } {
    const same =
      existing.eventId === eventId &&
      existing.checkedInBy === ctx.userId &&
      existing.method === body.method &&
      (body.method === 'FACE'
        ? existing.faceScanId === body.scanId
        : existing.registrationId === body.registrationId);
    if (!same) {
      refuse(
        409,
        'CLIENT_REQUEST_ID_REUSED',
        'This request id was already used for a different check-in',
      );
    }
    return { created: false, checkIn: toDto(existing) };
  }

  async function runCheckIn(
    r: EventDayRepo,
    ctx: AuthContext,
    eventId: string,
    body: CheckInBody,
    meta: RequestMeta,
  ): Promise<{ created: boolean; checkIn: CheckInDto }> {
    // A FACE check-in locks its scan first, until the end of the transaction: two requests cannot use one scan at the
    // same time, and a concurrent identical retry waits here and then finds the first request's check-in below.
    const scan = body.method === 'FACE' ? await r.lockScan(body.scanId) : null;

    // An exact retry of a check-in that already succeeded returns that check-in, before anything is re-validated
    // (the scan it used is consumed by now, and the player may have changed since: the check-in still happened).
    const prior = await r.findCheckInByRequestId(body.clientRequestId);
    if (prior) return replay(prior, ctx, eventId, body);

    let registrationId: string;
    let faceProfileId: string | null = null;
    let scanId: string | null = null;

    if (body.method === 'FACE') {
      // Another event's or another operator's scan is "not found": nothing is revealed about it.
      if (!scan || scan.eventId !== eventId || scan.scannedBy !== ctx.userId) {
        refuse(404, 'SCAN_NOT_FOUND', 'Scan not found');
      }
      scanId = scan.id;
      if (scan.result !== 'MATCH' || !(scan.matchedPlayerId || scan.matchedStaffProfileId)) {
        refuse(409, 'SCAN_NOT_A_MATCH', 'This scan did not identify anyone', { scanId });
      }
      if (scan.ageSeconds > SCAN_MAX_AGE_SECONDS) {
        refuse(409, 'SCAN_EXPIRED', 'This scan has expired; scan again', { scanId });
      }
      if (await r.findCheckInByScan(scan.id)) {
        refuse(409, 'SCAN_ALREADY_USED', 'This scan was already used', { scanId });
      }
      const found = scan.matchedPlayerId
        ? await r.findPlayerRegistrationId(eventId, scan.matchedPlayerId)
        : await r.findStaffRegistrationId(eventId, scan.matchedStaffProfileId!);
      if (!found) notEligible(['REGISTRATION_NOT_FOUND'], { scanId });
      registrationId = found;
      faceProfileId = scan.faceProfileId;
    } else {
      registrationId = body.registrationId;
    }

    // Eligibility is re-run NOW, holding the registration row so it cannot change before the insert.
    const eligibility = await r.eligibility(
      { eventId, registrationId, method: body.method, faceProfileId },
      { lock: true },
    );
    if (!eligibility.eligible) {
      if (!eligibility.registration) {
        refuse(404, 'REGISTRATION_NOT_FOUND', 'Registration not found for this event', {
          ...(scanId ? { scanId } : {}),
        });
      }
      notEligible(eligibility.reasons, { registrationId, ...(scanId ? { scanId } : {}) });
    }

    let inserted: string | null;
    try {
      inserted = await r.insertCheckIn({
        eventId,
        registrationId,
        method: body.method,
        faceScanId: scanId,
        checkedInBy: ctx.userId,
        clientRequestId: body.clientRequestId,
      });
    } catch (err) {
      // The database trigger is the final guard (not ready / access disabled / scan mismatch).
      if ((err as { code?: string }).code === '23514') {
        notEligible(['REGISTRATION_NOT_READY'], { registrationId, ...(scanId ? { scanId } : {}) });
      }
      throw err;
    }

    if (!inserted) {
      // A unique rule held. Which one decides the answer; a concurrent identical retry is a success, not an error.
      const sameRequest = await r.findCheckInByRequestId(body.clientRequestId);
      if (sameRequest) return replay(sameRequest, ctx, eventId, body);
      if (scanId && (await r.findCheckInByScan(scanId))) {
        refuse(409, 'SCAN_ALREADY_USED', 'This scan was already used', { registrationId, scanId });
      }
      // Who won is not revealed, only that and when it happened, so a device can show the person as checked in at the true time.
      const winner = await r.findCheckInByRegistration(registrationId);
      refuse(
        409,
        'ALREADY_CHECKED_IN',
        'This player is already checked in',
        { registrationId },
        undefined,
        winner ? { checkedInAt: winner.checkedInAt, method: winner.method } : undefined,
      );
    }

    await r.audit({
      action: 'CHECK_IN_COMPLETED',
      actorUserId: ctx.userId,
      entityType: 'check_in',
      entityId: inserted,
      metadata: {
        eventId,
        registrationId,
        playerId: eligibility.registration!.playerId,
        ...(eligibility.registration!.staffProfileId
          ? { staffProfileId: eligibility.registration!.staffProfileId }
          : {}),
        method: body.method,
        scanId,
        ...(body.deviceId ? { deviceId: body.deviceId } : {}),
        ...(body.deviceCheckedInAt ? { deviceCheckedInAt: body.deviceCheckedInAt } : {}),
      },
      meta,
    });
    const created = (await r.findCheckInByRequestId(body.clientRequestId))!;
    return { created: true, checkIn: toDto(created) };
  }

  return {
    assertScanAvailable() {
      if (!provider) throw notConfigured();
    },

    async scan(ctx, eventId, image, meta) {
      if (!provider) throw notConfigured();
      const mimeType = image.length > 0 ? sniffContentType(image) : null;
      if (!mimeType || !IMAGE_TYPES.includes(mimeType)) {
        throw new AppError(422, 'IMAGE_INVALID', 'Send a JPEG, PNG or WebP image');
      }

      let candidates: { reference: string; similarity: number }[];
      // Where the provider filed this frame, if it kept one. Only the address is recorded.
      let frameUrl: string | null = null;
      try {
        const found = await withDeadline(policy.timeoutMs, (signal) =>
          provider.identify({
            image: { bytes: image, mimeType: mimeType as FaceImageType },
            maxCandidates: MAX_CANDIDATES,
            eventId,
            signal,
          }),
        );
        candidates = found.candidates;
        frameUrl = found.scanImageUrl ?? null;
      } catch (err) {
        const { app, code } = providerFailure(err);
        if (err instanceof FaceProviderError && IMAGE_PROBLEM_CODES.includes(err.code)) {
          // The provider's own (already scrubbed) reason, so "image rejected" can be told apart from "no face" in the log.
          logger.warn({ eventId, code, bytes: image.length, mimeType, reason: err.message }, 'Face scan image refused');
        }
        // The failed attempt is recorded too (reason code only). Recording must never hide the real error.
        await recordScan(ctx, eventId, meta, { result: 'ERROR', reasonCode: code }).catch(
          (e: unknown) =>
            logger.error({ err: safeCause(e), eventId }, 'Could not record a failed face scan'),
        );
        throw app;
      }

      // Event scoping: the provider's index is global. Only ACTIVE profiles of players registered for THIS event
      // survive; everyone else is as if they did not exist (NO_MATCH), whatever their score.
      const resolved = await repository.resolveCandidates(eventId, provider.name, candidates);
      const decision = decideMatch(resolved, policy);

      if (decision.kind === 'NO_MATCH') {
        const scanId = await recordScan(ctx, eventId, meta, {
          result: 'NO_MATCH',
          reasonCode: null,
          scanImageUrl: frameUrl,
        });
        return { scanId, result: 'NO_MATCH', ...(await viewable(frameUrl)) };
      }

      if (decision.kind === 'REVIEW_REQUIRED') {
        const scanId = await recordScan(ctx, eventId, meta, {
          result: 'REVIEW_REQUIRED',
          reasonCode: decision.reason,
          candidateCount: decision.candidates.length,
          scanImageUrl: frameUrl,
        });
        return {
          scanId,
          result: 'REVIEW_REQUIRED',
          reason: decision.reason,
          candidates: decision.candidates.map((c) => ({
            registrationId: c.registrationId,
            registrationNumber: c.registrationNumber,
            registrantType: c.registrantType,
            displayName: displayName(c),
          })),
          ...(await viewable(frameUrl)),
        };
      }

      // One clear leader. It is a MATCH only if it is eligible right now (and its profile is the active one).
      const top = decision.top;
      const eligibility = await repository.eligibility({
        eventId,
        registrationId: top.registrationId,
        method: 'FACE',
        faceProfileId: top.faceProfileId,
      });
      if (!eligibility.eligible) {
        const scanId = await recordScan(ctx, eventId, meta, {
          result: 'REVIEW_REQUIRED',
          reasonCode: 'NOT_ELIGIBLE',
          candidateCount: 1,
          scanImageUrl: frameUrl,
        });
        return {
          scanId,
          result: 'REVIEW_REQUIRED',
          reason: 'NOT_ELIGIBLE',
          eligibility: eligibility.reasons,
          candidates: [
            {
              registrationId: top.registrationId,
              registrationNumber: top.registrationNumber,
              registrantType: top.registrantType,
              displayName: displayName(top),
            },
          ],
          ...(await viewable(frameUrl)),
        };
      }

      const scanId = await recordScan(ctx, eventId, meta, {
        result: 'MATCH',
        reasonCode: null,
        matched: top,
        score: top.similarity,
        scanImageUrl: frameUrl,
      });
      return {
        scanId,
        result: 'MATCH',
        expiresAt: new Date(Date.now() + SCAN_MAX_AGE_SECONDS * 1000).toISOString(),
        registration: {
          registrationId: top.registrationId,
          registrationNumber: top.registrationNumber,
          registrantType: top.registrantType,
          firstName: top.firstName,
          lastName: top.lastName,
        },
        alreadyCheckedIn: await repository.isCheckedIn(top.registrationId),
        ...(await viewable(frameUrl)),
      };
    },

    async checkIn(ctx, eventId, body, meta) {
      try {
        return await repository.transaction((r) => runCheckIn(r, ctx, eventId, body, meta));
      } catch (err) {
        if (err instanceof CheckInRefused) {
          // The transaction rolled back, so the refusal is written on its own. Ids and a reason code only.
          await repository
            .audit({
              action: 'CHECK_IN_REFUSED',
              actorUserId: ctx.userId,
              entityType: 'event',
              entityId: eventId,
              metadata: {
                eventId,
                method: body.method,
                reasonCode: err.code,
                registrationId: err.refusal.registrationId ?? null,
                scanId: err.refusal.scanId ?? null,
              },
              meta,
            })
            .catch((e: unknown) =>
              logger.error({ err: safeCause(e), eventId }, 'Could not audit a refused check-in'),
            );
        }
        throw err;
      }
    },

    async search(_ctx, eventId, term) {
      const found = await repository.search(eventId, term);
      return { ...found, limit: SEARCH_RESULT_LIMIT };
    },
  };
}
