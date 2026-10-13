import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { FaceProviderError, type FaceImage, type FaceProviderErrorCode } from '../../face-provider';
import type { DetectedFace, FaceEngine } from './face-engine';

export interface WorkerRequest {
  id: number;
  bytes: Uint8Array;
  mimeType: FaceImage['mimeType'];
}
export type WorkerReply =
  { id: number; faces: DetectedFace[] } | { id: number; error: FaceProviderErrorCode };

/** More waiting images than this and new ones are refused as "busy" instead of piling up behind a slow worker. */
const MAX_WAITING = 16;

/** Runs the engine in a worker thread (started on first use, and again if it ever dies). */
export function createWorkerEngine(): FaceEngine {
  let worker: Worker | null = null;
  let nextId = 1;
  const waiting = new Map<
    number,
    { resolve: (faces: DetectedFace[]) => void; reject: (err: unknown) => void }
  >();

  function failAll(code: FaceProviderErrorCode) {
    for (const w of waiting.values()) w.reject(new FaceProviderError(code));
    waiting.clear();
  }

  function start(): Worker {
    // Compiled (dist/*.js) the worker is a plain file next to this one. Run from source by tsx (development), TypeScript has to be
    // readable inside the worker too: it registers tsx first.
    const file = path.join(__dirname, 'engine.worker');
    const w =
      path.extname(__filename) === '.ts'
        ? new Worker(`require('tsx/cjs'); require(${JSON.stringify(file + '.ts')});`, {
            eval: true,
          })
        : new Worker(file + '.js');
    w.on('message', (reply: WorkerReply) => {
      const pending = waiting.get(reply.id);
      if (!pending) return; // the caller gave up (deadline) before the answer came
      waiting.delete(reply.id);
      if ('error' in reply) pending.reject(new FaceProviderError(reply.error));
      else pending.resolve(reply.faces);
    });
    const died = () => {
      failAll('UNAVAILABLE');
      if (worker === w) worker = null;
    };
    w.on('error', died);
    w.on('exit', died);
    return w;
  }

  return {
    detect(image, signal) {
      if (waiting.size >= MAX_WAITING) {
        return Promise.reject(new FaceProviderError('UNAVAILABLE', 'Face analysis is busy'));
      }
      worker ??= start();
      const target = worker;
      const id = nextId++;
      return new Promise<DetectedFace[]>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        signal?.addEventListener(
          'abort',
          () => {
            waiting.delete(id);
            reject(new FaceProviderError('TIMEOUT'));
          },
          { once: true },
        );
        const request: WorkerRequest = { id, bytes: image.bytes, mimeType: image.mimeType };
        target.postMessage(request);
      });
    },

    async close() {
      const w = worker;
      worker = null;
      if (w) await w.terminate();
    },
  };
}
