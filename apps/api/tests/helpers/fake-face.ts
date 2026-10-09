import { createHash, randomUUID } from 'node:crypto';
import {
  FaceProviderError,
  type FaceCandidate,
  type FaceImage,
  type FaceProviderErrorCode,
  type FaceRecognitionProvider,
} from '../../src/infrastructure/face/face-provider';
import { fileBytes } from './fake-storage';

/**
 * A fake face-recognition provider for tests. It never looks at a face: "identity" is a hash of the image bytes,
 * and markers inside the bytes trigger the image-problem errors. It is NOT a real recognizer and no real provider is
 * called anywhere in the test suite.
 */
export const PROVIDER_SECRET = 'sk_live_PROVIDERSECRET123456';

const ascii = (text: string) => Uint8Array.from(Buffer.from(text));

/** A JPEG-signature image whose "face" is identified by `label` (same label = same face). */
export function jpegOf(label: string, size = 3000): Uint8Array {
  const out = fileBytes.jpeg(size);
  out.set(ascii(`FACE:${label}:`), 8);
  return out;
}
export const noFaceJpeg = () => {
  const out = fileBytes.jpeg(3000);
  out.set(ascii('NOFACE'), 8);
  return out;
};
export const manyFacesJpeg = () => {
  const out = fileBytes.jpeg(3000);
  out.set(ascii('MULTIFACE'), 8);
  return out;
};
export const lowQualityJpeg = () => {
  const out = fileBytes.jpeg(3000);
  out.set(ascii('LOWQUALITY'), 8);
  return out;
};

const digest = (image: FaceImage) => createHash('sha256').update(image.bytes).digest('hex');
const contains = (image: FaceImage, marker: string) => Buffer.from(image.bytes).includes(marker);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

export function createFakeFaceProvider(options: { name?: string; referencePrefix?: string } = {}) {
  const name = options.name ?? 'fake';
  const prefix = options.referencePrefix ?? 'fake_face_';
  const identities = new Map<string, { subjectId: string; digest: string }>();
  const byIdempotencyKey = new Map<string, string>();
  const enrollCalls: {
    subjectId: string;
    byteLength: number;
    mimeType: string;
    idempotencyKey: string;
    digest: string;
  }[] = [];
  const removed: string[] = [];
  const failures = {
    enroll: false,
    remove: false,
    enrollDelayMs: 0,
    /** identify() throws a FaceProviderError with this code. */
    identify: null as FaceProviderErrorCode | null,
    /** identify() throws an untyped error whose text carries a secret (must never reach a client or a log). */
    identifyExplodes: false,
    identifyDelayMs: 0,
  };
  /** When set, identify() answers with exactly these candidates (scores chosen by the test), ignoring the image. */
  const script: { candidates: FaceCandidate[] | null } = { candidates: null };
  const identifyCalls: { byteLength: number; maxCandidates: number }[] = [];

  const provider: FaceRecognitionProvider = {
    name,
    async enroll(req) {
      enrollCalls.push({
        subjectId: req.subjectId,
        byteLength: req.image.bytes.length,
        mimeType: req.image.mimeType,
        idempotencyKey: req.idempotencyKey,
        digest: digest(req.image),
      });
      if (failures.enrollDelayMs) await sleep(failures.enrollDelayMs, req.signal);
      if (failures.enroll) throw new Error(`provider exploded (${PROVIDER_SECRET})`);
      if (contains(req.image, 'NOFACE')) throw new FaceProviderError('NO_FACE_DETECTED');
      if (contains(req.image, 'MULTIFACE')) throw new FaceProviderError('MULTIPLE_FACES');
      if (contains(req.image, 'LOWQUALITY')) throw new FaceProviderError('LOW_QUALITY');
      const existing = byIdempotencyKey.get(req.idempotencyKey);
      if (existing) return { reference: existing };
      const reference = `${prefix}${randomUUID()}`;
      identities.set(reference, { subjectId: req.subjectId, digest: digest(req.image) });
      byIdempotencyKey.set(req.idempotencyKey, reference);
      return { reference };
    },
    async remove(reference) {
      if (failures.remove) throw new Error(`provider exploded (${PROVIDER_SECRET})`);
      identities.delete(reference);
      removed.push(reference);
    },
    async identify(req) {
      identifyCalls.push({ byteLength: req.image.bytes.length, maxCandidates: req.maxCandidates });
      if (failures.identifyDelayMs) await sleep(failures.identifyDelayMs, req.signal);
      if (req.signal?.aborted) throw new Error('aborted');
      if (failures.identifyExplodes) throw new Error(`provider exploded (${PROVIDER_SECRET})`);
      if (failures.identify) throw new FaceProviderError(failures.identify);
      if (contains(req.image, 'NOFACE')) throw new FaceProviderError('NO_FACE_DETECTED');
      if (contains(req.image, 'MULTIFACE')) throw new FaceProviderError('MULTIPLE_FACES');
      if (contains(req.image, 'LOWQUALITY')) throw new FaceProviderError('LOW_QUALITY');
      if (script.candidates) return { candidates: script.candidates.slice(0, req.maxCandidates) };
      const d = digest(req.image);
      return {
        candidates: [...identities.entries()]
          .map(([reference, id]) => ({ reference, similarity: id.digest === d ? 0.99 : 0.1 }))
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, req.maxCandidates),
      };
    },
    async verify(req) {
      if (req.signal?.aborted) throw new Error('aborted');
      const id = identities.get(req.reference);
      return { similarity: id && id.digest === digest(req.image) ? 0.99 : 0.1 };
    },
  };

  return { provider, identities, enrollCalls, identifyCalls, removed, failures, script };
}
export type FakeFace = ReturnType<typeof createFakeFaceProvider>;
