import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FaceProviderError, type FaceImage } from '../../face-provider';
import type { DetectedFace } from './face-engine';

/** Images are scaled down to fit this box before analysis: the cost is in the pixels, and a face needs far fewer than a phone camera gives. */
const MAX_SIDE = 1280;
/** The detector ignores anything it is less sure of than this. */
const MIN_DETECTION_SCORE = 0.5;

type FaceApi = typeof import('@vladmandic/face-api');

/**
 * face-api running on the pure-JS/WASM TensorFlow backend: no native module, no Python, nothing to compile. The model weights
 * ship inside the @vladmandic/face-api package. This runs inference on the thread that calls it (about 0.7 s for a photo):
 * the API runs it inside a worker thread (engine.worker.ts) so it never blocks requests.
 */
export async function createCoreEngine(): Promise<(image: FaceImage) => Promise<DetectedFace[]>> {
  // TensorFlow.js loads its .wasm file with fetch(), which in Node cannot read a local path: serve file paths from disk
  // (only while the backend starts) and leave http(s) alone.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const target = String(input);
    if (/^https?:/i.test(target)) return realFetch(input, init);
    return new Response(await readFile(target), {
      status: 200,
      headers: {
        'content-type': target.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
      },
    });
  }) as typeof fetch;

  try {
    await import('@tensorflow/tfjs');
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    const faceapi =
      (await import('@vladmandic/face-api/dist/face-api.node-wasm.js')) as unknown as FaceApi;
    const wasmDir =
      path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')) + '/dist/';
    wasm.setWasmPaths(wasmDir, true);
    const tf = faceapi.tf as unknown as {
      setBackend(name: string): Promise<boolean>;
      ready(): Promise<void>;
    };
    await tf.setBackend('wasm');
    await tf.ready();

    const modelDir = path.join(
      path.dirname(require.resolve('@vladmandic/face-api/package.json')),
      'model',
    );
    const load = (net: { loadFromWeightMap(map: never): void }, name: string) => {
      const manifest = JSON.parse(
        readFileSync(path.join(modelDir, `${name}-weights_manifest.json`), 'utf8'),
      ) as {
        paths: string[];
        weights: never[];
      }[];
      const bin = readFileSync(path.join(modelDir, manifest[0]!.paths[0]!));
      const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
      net.loadFromWeightMap(
        faceapi.tf.io.decodeWeights(
          buffer,
          manifest.flatMap((g) => g.weights),
        ) as never,
      );
    };
    load(faceapi.nets.ssdMobilenetv1 as never, 'ssd_mobilenetv1_model');
    load(faceapi.nets.faceLandmark68Net as never, 'face_landmark_68_model');
    load(faceapi.nets.faceRecognitionNet as never, 'face_recognition_model');

    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: MIN_DETECTION_SCORE,
      maxResults: 10,
    });

    return async (image) => {
      let decoded: { data: Buffer; info: { width: number; height: number } };
      try {
        decoded = await sharp(Buffer.from(image.bytes), {
          limitInputPixels: 80_000_000,
          failOn: 'error',
        })
          .rotate() // honour the phone's orientation flag
          .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
          .removeAlpha()
          .toColourspace('srgb')
          .raw()
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw new FaceProviderError('IMAGE_REJECTED', 'The image could not be read');
      }
      const tensor = faceapi.tf.tensor3d(
        new Uint8Array(decoded.data),
        [decoded.info.height, decoded.info.width, 3],
        'int32',
      );
      try {
        const found = await faceapi
          .detectAllFaces(tensor as never, options)
          .withFaceLandmarks()
          .withFaceDescriptors();
        return found.map((f) => ({
          descriptor: f.descriptor,
          score: f.detection.score,
          width: f.detection.box.width,
          height: f.detection.box.height,
        }));
      } finally {
        tensor.dispose();
      }
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}
