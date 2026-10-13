import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../database/database';
import {
  FaceProviderError,
  type EnrollRequest,
  type EnrollResult,
  type FaceCandidate,
  type FaceImage,
  type FaceRecognitionProvider,
  type IdentifyRequest,
  type IdentifyResult,
  type VerifyRequest,
  type VerifyResult,
} from '../face-provider';
import type { FaceProviderEnv } from '../provider-registry';
import type { DetectedFace, FaceEngine } from './node-native/face-engine';
import {
  KEY_VERSION,
  createTemplateCipher,
  type TemplateCipher,
} from './node-native/template-cipher';
import { createWorkerEngine } from './node-native/worker-engine';

/** Stored with each template: descriptors from different models cannot be compared. */
export const NODE_NATIVE_MODEL = 'face-api-resnet-128';
export const NODE_NATIVE_PROVIDER = 'node-native';

/**
 * face-api's own rule of thumb: two descriptors closer than this (Euclidean distance) are the same person. Turned into the
 * application's 0 to 1 "similarity" so the shared policy (FACE_MATCH_THRESHOLD / FACE_REVIEW_THRESHOLD) decides, as for any provider:
 * 0.4 maps to 0.90 (the default automatic-match line) and 0.6 to 0.75 (the default "a person must look" line).
 */
export const SAME_PERSON_DISTANCE = 0.6;
export const distanceToSimilarity = (distance: number): number =>
  Math.min(1, Math.max(0, 1.2 - 0.75 * distance));
/** Anything further than this is not offered as a candidate at all. */
const MAX_CANDIDATE_DISTANCE = 0.9;

/** The detector must be at least this sure of a face to enroll it, and the face must be at least this wide (pixels, after scaling). */
const ENROLL_MIN_SCORE = 0.7;
const MIN_FACE_WIDTH = 80;
/** At the door, a face this many times larger in area than every other face in the frame is the person being scanned. */
const DOMINANCE_RATIO = 4;

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

const area = (f: DetectedFace) => f.width * f.height;

/** Exactly one usable face, or the reason there is not. Enrollment is strict: a second face could be enrolled as the wrong person. */
function onlyFace(faces: DetectedFace[], minScore: number): DetectedFace {
  if (faces.length === 0) throw new FaceProviderError('NO_FACE_DETECTED');
  if (faces.length > 1) throw new FaceProviderError('MULTIPLE_FACES');
  const face = faces[0]!;
  if (face.score < minScore || face.width < MIN_FACE_WIDTH)
    throw new FaceProviderError('LOW_QUALITY');
  return face;
}

/** At the door: the one face, or the clearly nearest/largest one when people stand behind. Several similar faces are ambiguous. */
function scannedFace(faces: DetectedFace[]): DetectedFace {
  if (faces.length === 0) throw new FaceProviderError('NO_FACE_DETECTED');
  const sorted = [...faces].sort((a, b) => area(b) - area(a));
  const [first, second] = sorted;
  if (second && area(first!) < DOMINANCE_RATIO * area(second))
    throw new FaceProviderError('MULTIPLE_FACES');
  if (first!.width < MIN_FACE_WIDTH) throw new FaceProviderError('LOW_QUALITY');
  return first!;
}

export interface NodeNativeDeps {
  db: Queryable;
  engine: FaceEngine;
  cipher: TemplateCipher;
}

interface TemplateRow {
  reference: string;
  descriptor: Buffer;
}

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * A face provider that runs inside this API: face-api (WASM) finds the face and computes its 128-number descriptor, and the
 * descriptor is kept, encrypted, in `face_templates` behind an opaque reference. Nothing leaves the server. Matching is a
 * Euclidean-distance search over the enrolled templates that are still ACTIVE profiles; the application, not this adapter,
 * decides what a similarity is good enough for.
 */
export function createNodeNativeProvider({
  db,
  engine,
  cipher,
}: NodeNativeDeps): FaceRecognitionProvider {
  const describe = (image: FaceImage, signal?: AbortSignal) => engine.detect(image, signal);

  async function templateOf(reference: string): Promise<Float32Array | null> {
    if (!isUuid(reference)) return null;
    const { rows } = await db.query<TemplateRow>(
      'select reference, descriptor from public.face_templates where reference = $1 and model = $2',
      [reference, NODE_NATIVE_MODEL],
    );
    const row = rows[0];
    if (!row) return null;
    try {
      return cipher.open(row.descriptor, row.reference);
    } catch {
      throw new FaceProviderError('UNAVAILABLE', 'A stored face template could not be read');
    }
  }

  return {
    name: NODE_NATIVE_PROVIDER,

    async enroll(request: EnrollRequest): Promise<EnrollResult> {
      // A retried enrollment gets the identity it already made: nothing is analysed or stored twice.
      const existing = await db.query<{ reference: string }>(
        'select reference from public.face_templates where idempotency_key = $1',
        [request.idempotencyKey],
      );
      if (existing.rows[0]) return { reference: existing.rows[0].reference };

      const face = onlyFace(await describe(request.image, request.signal), ENROLL_MIN_SCORE);
      const reference = randomUUID();
      const sealed = cipher.seal(face.descriptor, reference);
      const inserted = await db.query<{ reference: string }>(
        `insert into public.face_templates (reference, subject_id, model, key_version, descriptor, idempotency_key)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (idempotency_key) do nothing
         returning reference`,
        [
          reference,
          request.subjectId,
          NODE_NATIVE_MODEL,
          KEY_VERSION,
          sealed,
          request.idempotencyKey,
        ],
      );
      if (inserted.rows[0]) return { reference };
      // Lost a race with an identical retry: that one's identity is the answer.
      const winner = await db.query<{ reference: string }>(
        'select reference from public.face_templates where idempotency_key = $1',
        [request.idempotencyKey],
      );
      return { reference: winner.rows[0]!.reference };
    },

    async remove(reference: string): Promise<void> {
      // Erases the biometric data. Already gone (or never a valid reference) is success, so a removal can be retried.
      if (!isUuid(reference)) return;
      await db.query('delete from public.face_templates where reference = $1', [reference]);
    },

    async identify(request: IdentifyRequest): Promise<IdentifyResult> {
      const probe = scannedFace(await describe(request.image, request.signal));
      // Only templates whose profile is still ACTIVE: a removed or replaced enrollment is never matched.
      const { rows } = await db.query<TemplateRow>(
        `select t.reference, t.descriptor
           from public.face_templates t
           join public.face_profiles p
             on p.provider = $1 and p.provider_profile_id = t.reference::text and p.status = 'ACTIVE'
          where t.model = $2`,
        [NODE_NATIVE_PROVIDER, NODE_NATIVE_MODEL],
      );
      const candidates: FaceCandidate[] = [];
      let unreadable = 0;
      for (const row of rows) {
        let enrolled: Float32Array;
        try {
          enrolled = cipher.open(row.descriptor, row.reference);
        } catch {
          unreadable += 1;
          continue;
        }
        const distance = euclideanDistance(probe.descriptor, enrolled);
        if (distance <= MAX_CANDIDATE_DISTANCE) {
          candidates.push({ reference: row.reference, similarity: distanceToSimilarity(distance) });
        }
      }
      // Every template unreadable is a wrong or missing key, not "nobody matched": say so instead of answering NO_MATCH to everyone.
      if (rows.length > 0 && unreadable === rows.length) {
        throw new FaceProviderError('UNAVAILABLE', 'The stored face templates could not be read');
      }
      candidates.sort((a, b) => b.similarity - a.similarity);
      return { candidates: candidates.slice(0, request.maxCandidates) };
    },

    async verify(request: VerifyRequest): Promise<VerifyResult> {
      const probe = scannedFace(await describe(request.image, request.signal));
      const enrolled = await templateOf(request.reference);
      return {
        similarity: enrolled
          ? distanceToSimilarity(euclideanDistance(probe.descriptor, enrolled))
          : 0,
      };
    },
  };
}

/** What the registry calls: reads the key from the environment and starts the worker-thread engine (on first use). */
export function createNodeNativeFromEnv(
  env: FaceProviderEnv,
  deps: { db: Queryable },
): FaceRecognitionProvider {
  if (!env.FACE_ENCRYPTION_KEY) throw new Error('FACE_ENCRYPTION_KEY is required for node-native');
  return createNodeNativeProvider({
    db: deps.db,
    engine: createWorkerEngine(),
    cipher: createTemplateCipher(env.FACE_ENCRYPTION_KEY),
  });
}
