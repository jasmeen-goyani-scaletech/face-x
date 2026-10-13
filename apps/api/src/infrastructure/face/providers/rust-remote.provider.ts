import sharp from 'sharp';
import {
  FaceProviderError,
  type EnrollRequest,
  type EnrollResult,
  type FaceImage,
  type FaceRecognitionProvider,
  type IdentifyRequest,
  type IdentifyResult,
  type VerifyRequest,
  type VerifyResult,
} from '../face-provider';
import type { FaceProviderEnv } from '../provider-registry';

export const RUST_REMOTE_PROVIDER = 'rust-remote';

/**
 * Adapter for the external Rust face service (`face_z_BE`), reached over HTTP at RUST_FACE_SERVICE_URL (which already ends in
 * `/v1`). The service owns the biometric data: it detects the face, quality-gates it, computes and stores the embedding, and
 * searches its own gallery. This application keeps only the opaque `reference` (the service's member id).
 *
 * Mapping of this interface onto the service's routes:
 *  - enroll   -> POST   /auth/signup      (the service calls an enrolled person a "member")
 *  - identify -> POST   /kiosk/scan       (answers the single best match, or none)
 *  - verify   -> POST   /kiosk/scan       (matched, and matched to THIS reference)
 *  - remove   -> DELETE /admin/templates/{id}   (a HARD delete: the member, its photo, every embedding and the retained
 *                                                   scan frames of that person; needs RUST_FACE_SERVICE_TOKEN)
 *
 * Enroll and scan are open routes on the service and it has no idempotency key, so:
 *  - a retried enroll can create a second member (the service's own duplicate check then refuses the same face, which
 *    surfaces as IMAGE_REJECTED rather than a second identity);
 *  - the member's `name` is our person id, never a real name; the service also tags the template with the person's role.
 *
 * Every scan that names an event has its frame filed by the service under that event; the address comes back as
 * `scanImageUrl` so the caller can record it. This adapter never fetches or stores the image.
 */

/** The service accepts a match only at or above this cosine similarity (its `similarity_min`, thresholds.toml). */
export const RUST_ACCEPT_FLOOR = 0.45;
/** What a match right at the service's floor is worth on the application's 0..1 scale: the bottom of the default review band. */
const REVIEW_BAND_BOTTOM = 0.75;

/**
 * The service has already decided "granted" with its own calibrated floor and margin, so every candidate it returns is at least
 * a REVIEW (a person looks). The score then rises linearly to 1.0 at a perfect cosine of 1: with the default policy a cosine of
 * about 0.78 is the automatic-match line (0.9). Marginal grants (0.45 to 0.78) therefore go to a person; strong ones do not.
 */
export function cosineToSimilarity(cosine: number): number {
  const c = Math.min(1, Math.max(RUST_ACCEPT_FLOOR, cosine));
  return (
    REVIEW_BAND_BOTTOM +
    ((1 - REVIEW_BAND_BOTTOM) * (c - RUST_ACCEPT_FLOOR)) / (1 - RUST_ACCEPT_FLOOR)
  );
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RustRemoteDeps {
  /** Base URL including the version prefix, e.g. https://host/v1 */
  baseUrl: string;
  /** Bearer token for the service's /admin routes (the only way to hard-delete a template). */
  adminToken?: string;
  fetch?: FetchLike;
}

/** Identifies this API to the service in its audit log; not a person and not a device. */
const KIOSK_ID = 'facex-api';

/** The service decodes JPEG only. Anything else is converted; a JPEG is sent untouched (the service applies EXIF orientation). */
async function toJpegBase64(image: FaceImage): Promise<string> {
  const bytes =
    image.mimeType === 'image/jpeg'
      ? Buffer.from(image.bytes)
      : await sharp(image.bytes).jpeg({ quality: 92 }).toBuffer();
  return bytes.toString('base64');
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Enrollment refusals the service reports as machine codes, mapped onto the provider-independent error codes. */
function enrollRefusal(reasons: readonly string[]): FaceProviderError {
  if (reasons.includes('multiple_faces')) return new FaceProviderError('MULTIPLE_FACES');
  if (reasons.includes('already_enrolled')) {
    // Not a retake: this face is already in the service's gallery under another member.
    return new FaceProviderError('IMAGE_REJECTED', 'face already enrolled');
  }
  if (reasons.includes('no_face')) return new FaceProviderError('NO_FACE_DETECTED');
  return new FaceProviderError('LOW_QUALITY');
}

export function createRustRemoteProvider({
  baseUrl,
  adminToken,
  fetch: fetchImpl = (input, init) => fetch(input, init),
}: RustRemoteDeps): FaceRecognitionProvider {
  const base = baseUrl.replace(/\/+$/, '');

  /** One call. Only the status code ever goes into an error: never the body, the image or a reference. */
  async function call(
    method: 'POST' | 'DELETE',
    path: string,
    body: unknown,
    signal?: AbortSignal,
    admin = false,
  ): Promise<{ status: number; json: unknown }> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(admin && adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new FaceProviderError('TIMEOUT');
      }
      throw new FaceProviderError('UNAVAILABLE', 'the face service could not be reached');
    }
    const json: unknown = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  function unexpected(status: number): FaceProviderError {
    // 413: the photo is over the service's limits (an input problem); everything else, including its 503 "busy" shed, is an outage.
    if (status === 413) return new FaceProviderError('IMAGE_REJECTED', 'photo too large');
    return new FaceProviderError('UNAVAILABLE', `the face service answered ${status}`);
  }

  /** The service's errors are `{ isError: true, ... }`, sometimes with a 200. */
  const failed = (json: unknown) => isRecord(json) && json.isError === true;

  async function scan(image: FaceImage, signal?: AbortSignal, eventId?: string) {
    const { status, json } = await call(
      'POST',
      '/kiosk/scan',
      {
        avatar: await toJpegBase64(image),
        kioskId: KIOSK_ID,
        ...(eventId ? { eventId } : {}),
      },
      signal,
    );
    if (status < 200 || status >= 300) throw unexpected(status);
    if (!isRecord(json) || failed(json)) {
      throw new FaceProviderError('UNAVAILABLE', 'the face service sent an unusable answer');
    }
    const decision = typeof json.decision === 'string' ? json.decision : '';
    if (decision === 'denied_no_face') throw new FaceProviderError('NO_FACE_DETECTED');
    if (decision === 'denied_quality') throw new FaceProviderError('LOW_QUALITY');

    // Present whenever the service kept the frame, matched or not.
    const scanImageUrl =
      typeof json.scan_image_url === 'string' && json.scan_image_url.length > 0
        ? json.scan_image_url
        : null;
    const member = isRecord(json.member) ? json.member : null;
    const reference = member && typeof member.id === 'string' ? member.id : null;
    if (json.matched !== true || !reference) return { best: null, scanImageUrl };
    const cosine = typeof json.similarity === 'number' ? json.similarity : RUST_ACCEPT_FLOOR;
    return { best: { reference, similarity: cosineToSimilarity(cosine) }, scanImageUrl };
  }

  return {
    name: RUST_REMOTE_PROVIDER,

    async enroll(request: EnrollRequest): Promise<EnrollResult> {
      const { status, json } = await call(
        'POST',
        '/auth/signup',
        {
          // Our player id stands in for the name: the service is never given personal data.
          name: request.subjectId,
          avatar: await toJpegBase64(request.image),
          isNormalMember: true,
          isVipMember: false,
          allowDuplicate: false,
          ...(request.role ? { role: request.role } : {}),
        },
        request.signal,
      );
      if (status < 200 || status >= 300) throw unexpected(status);
      if (!isRecord(json) || failed(json)) {
        throw new FaceProviderError('UNAVAILABLE', 'the face service sent an unusable answer');
      }
      const data = isRecord(json.data) ? json.data : null;
      if (data && typeof data.id === 'string') return { reference: data.id };

      // HTTP 200 with an empty `data`: refused. With an `enrollment` report it says why; without one, no face was found.
      const report = isRecord(json.enrollment) ? json.enrollment : null;
      const reasons =
        report && Array.isArray(report.reasons)
          ? report.reasons.filter((r): r is string => typeof r === 'string')
          : ['no_face'];
      throw enrollRefusal(reasons);
    },

    async remove(reference: string, options): Promise<void> {
      if (!adminToken) {
        throw new FaceProviderError('UNAVAILABLE', 'no admin token is configured for the face service');
      }
      const { status, json } = await call(
        'DELETE',
        `/admin/templates/${encodeURIComponent(reference)}`,
        undefined,
        options?.signal,
        true,
      );
      // The service answers 200 with deleted:false when there is nothing to purge, and 404 is tolerated too: already
      // gone is success, so a removal can be retried.
      if (status === 404 || (status >= 200 && status < 300 && !failed(json))) return;
      if (status === 401 || status === 403) {
        throw new FaceProviderError('UNAVAILABLE', 'the face service refused the admin token');
      }
      throw unexpected(status);
    },

    async identify(request: IdentifyRequest): Promise<IdentifyResult> {
      const { best, scanImageUrl } = await scan(request.image, request.signal, request.eventId);
      // The service answers only its single best match; "nobody" is an empty list, not an error.
      return { candidates: best && request.maxCandidates > 0 ? [best] : [], scanImageUrl };
    },

    async verify(request: VerifyRequest): Promise<VerifyResult> {
      // The service has no 1:1 route. The best match counts only if it is this very identity.
      const { best } = await scan(request.image, request.signal);
      return { similarity: best && best.reference === request.reference ? best.similarity : 0 };
    },
  };
}

/** What the registry calls. */
export function createRustRemoteFromEnv(env: FaceProviderEnv): FaceRecognitionProvider {
  if (!env.RUST_FACE_SERVICE_URL) {
    throw new Error('RUST_FACE_SERVICE_URL is required for rust-remote');
  }
  return createRustRemoteProvider({
    baseUrl: env.RUST_FACE_SERVICE_URL,
    adminToken: env.RUST_FACE_SERVICE_TOKEN,
  });
}
