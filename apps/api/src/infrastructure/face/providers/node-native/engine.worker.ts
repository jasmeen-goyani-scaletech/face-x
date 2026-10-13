import { parentPort } from 'node:worker_threads';
import { FaceProviderError } from '../../face-provider';
import { createCoreEngine } from './engine-core';
import type { WorkerReply, WorkerRequest } from './worker-engine';

/**
 * The face engine's own thread. Inference takes most of a second and runs here, so the API's request handling never waits for
 * it. The thread analyses one image at a time; the others queue behind it.
 */
const port = parentPort;
if (!port) throw new Error('engine.worker must run as a worker thread');

const ready = createCoreEngine();
// A start-up failure is reported as UNAVAILABLE on every request, not as an unhandled rejection that kills the thread.
ready.catch(() => undefined);

port.on('message', (request: WorkerRequest) => {
  void (async () => {
    let reply: WorkerReply;
    try {
      const detect = await ready;
      const faces = await detect({ bytes: request.bytes, mimeType: request.mimeType });
      reply = { id: request.id, faces };
    } catch (err) {
      const code = err instanceof FaceProviderError ? err.code : 'UNAVAILABLE';
      reply = { id: request.id, error: code };
    }
    port.postMessage(reply);
  })();
});
