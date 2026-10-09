import { FaceProviderError } from './face-provider';

/** Runs one provider call with a deadline; the call is told to stop (abort signal) when time runs out. */
export async function withDeadline<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FaceProviderError('TIMEOUT'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
