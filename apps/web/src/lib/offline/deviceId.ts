import { newUuid } from './db';

const KEY = 'facex-device-id';
let fallback: string | null = null;

/**
 * A random id for this browser, made once and kept, so the server's audit record can tell which door device made a check-in. It
 * names no person and nothing about the hardware. Where storage is unavailable it lasts for the page's life.
 */
export function getDeviceId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{1,64}$/.test(saved)) return saved;
    const made = `d-${newUuid()}`;
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    fallback ??= `d-${newUuid()}`;
    return fallback;
  }
}
