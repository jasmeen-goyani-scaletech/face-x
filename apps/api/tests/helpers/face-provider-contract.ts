import { describe, expect, it } from 'vitest';
import {
  FaceProviderError,
  type FaceImage,
  type FaceRecognitionProvider,
} from '../../src/infrastructure/face/face-provider';

/**
 * What ANY FaceRecognitionProvider adapter must do. It is run here against the test fakes; when a real adapter is
 * written it must pass the same suite (against the provider's sandbox) before it is registered. Behaviour the
 * application relies on: opaque references, idempotent enroll, idempotent remove, 0..1 similarity, and image
 * problems reported as FaceProviderError codes rather than generic failures.
 */
export interface ContractSamples {
  /** Two different photos of the SAME face, and one of a DIFFERENT face. */
  faceA1: FaceImage;
  faceA2: FaceImage;
  faceB: FaceImage;
  noFace: FaceImage;
}

export function runFaceProviderContract(
  label: string,
  makeProvider: () => FaceRecognitionProvider,
  samples: ContractSamples,
  options: { sameFaceMatchesAcrossPhotos: boolean },
) {
  describe(`FaceRecognitionProvider contract: ${label}`, () => {
    const enroll = (
      p: FaceRecognitionProvider,
      image: FaceImage,
      subjectId = 'player-1',
      key = `k-${Math.random()}`,
    ) => p.enroll({ subjectId, image, idempotencyKey: key });

    it('has a short stable name', () => {
      const p = makeProvider();
      expect(p.name).toMatch(/^[a-z0-9-]{1,40}$/);
    });

    it('enroll returns an opaque, distinct reference per identity', async () => {
      const p = makeProvider();
      const a = await enroll(p, samples.faceA1, 'p-a');
      const b = await enroll(p, samples.faceB, 'p-b');
      expect(typeof a.reference).toBe('string');
      expect(a.reference.length).toBeGreaterThan(0);
      expect(a.reference).not.toEqual(b.reference);
      expect(a.reference).not.toContain('p-a'); // no subject data baked into the reference
    });

    it('enroll is idempotent for the same key (a retry cannot create a second identity)', async () => {
      const p = makeProvider();
      const first = await enroll(p, samples.faceA1, 'p-a', 'same-key');
      const retry = await enroll(p, samples.faceA1, 'p-a', 'same-key');
      expect(retry.reference).toEqual(first.reference);
      const found = await p.identify({ image: samples.faceA1, maxCandidates: 5 });
      expect(found.candidates.filter((c) => c.reference === first.reference)).toHaveLength(1);
    });

    it('identify returns candidates best-first, bounded, with similarity in 0..1', async () => {
      const p = makeProvider();
      expect((await p.identify({ image: samples.faceA1, maxCandidates: 3 })).candidates).toEqual(
        [],
      );
      const a = await enroll(p, samples.faceA1, 'p-a');
      await enroll(p, samples.faceB, 'p-b');
      const { candidates } = await p.identify({ image: samples.faceA1, maxCandidates: 1 });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.reference).toBe(a.reference);
      const all = (await p.identify({ image: samples.faceA1, maxCandidates: 10 })).candidates;
      for (const c of all) {
        expect(c.similarity).toBeGreaterThanOrEqual(0);
        expect(c.similarity).toBeLessThanOrEqual(1);
      }
      expect([...all].sort((x, y) => y.similarity - x.similarity)).toEqual(all);
    });

    it('verify compares one identity against one image on the same 0..1 scale', async () => {
      const p = makeProvider();
      const a = await enroll(p, samples.faceA1, 'p-a');
      const same = await p.verify({
        reference: a.reference,
        image: options.sameFaceMatchesAcrossPhotos ? samples.faceA2 : samples.faceA1,
      });
      const other = await p.verify({ reference: a.reference, image: samples.faceB });
      for (const r of [same, other]) {
        expect(r.similarity).toBeGreaterThanOrEqual(0);
        expect(r.similarity).toBeLessThanOrEqual(1);
      }
      expect(same.similarity).toBeGreaterThan(other.similarity);
    });

    it('remove deletes the identity, and succeeds again when it is already gone', async () => {
      const p = makeProvider();
      const a = await enroll(p, samples.faceA1, 'p-a');
      await p.remove(a.reference);
      expect(
        (await p.identify({ image: samples.faceA1, maxCandidates: 5 })).candidates.map(
          (c) => c.reference,
        ),
      ).not.toContain(a.reference);
      await expect(p.remove(a.reference)).resolves.toBeUndefined();
      await expect(p.remove('never-existed')).resolves.toBeUndefined();
    });

    it('reports an image with no face as FaceProviderError NO_FACE_DETECTED, not a generic failure', async () => {
      const p = makeProvider();
      const err = await enroll(p, samples.noFace).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FaceProviderError);
      expect((err as FaceProviderError).code).toBe('NO_FACE_DETECTED');
    });

    it('stops when its abort signal fires', async () => {
      const p = makeProvider();
      const controller = new AbortController();
      controller.abort();
      await expect(
        p.identify({ image: samples.faceA1, maxCandidates: 1, signal: controller.signal }),
      ).rejects.toThrow();
    });
  });
}

/** Provider-specific type of every sample shares the application's FaceImage shape. */
export const asFaceImage = (bytes: Uint8Array): FaceImage => ({ bytes, mimeType: 'image/jpeg' });
