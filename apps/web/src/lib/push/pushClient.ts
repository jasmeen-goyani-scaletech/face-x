/**
 * Browser side of Web Push: ask permission, subscribe through the service worker, and keep the API's copy of the
 * subscription in step with the browser's.
 *
 * It is written against small interfaces (`PushApi`, `PushEnv`) rather than the real browser and HTTP client, and it
 * imports nothing at runtime, so the same code is exercised by plain `node --test` (see tests/pushClient.test.ts) and
 * wired to the real thing in ./index.ts. Nothing here is required for registration: every function resolves to a state
 * (it never throws), and a denied permission or a failing server simply leaves notifications off.
 */

export type PushState =
  /** This browser/install can't do push (no service worker in dev, iOS outside an installed app, old browser). Show nothing. */
  | 'unsupported'
  /** Permission not asked yet. */
  | 'off'
  /** Permission granted and this device is subscribed. */
  | 'on'
  /** The user blocked notifications in the browser. We cannot ask again; they must change it in browser settings. */
  | 'denied'
  /** The server has push switched off (no VAPID keys). Show nothing. */
  | 'unavailable';

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushApi {
  getPublicKey(): Promise<{ publicKey: string }>;
  save(subscription: PushSubscriptionJson): Promise<unknown>;
  remove(endpoint: string): Promise<unknown>;
}

/** The slice of the browser's push objects this module uses. */
export interface BrowserSubscription {
  endpoint: string;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}
export interface BrowserRegistration {
  pushManager: {
    getSubscription(): Promise<BrowserSubscription | null>;
    subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<BrowserSubscription>;
  };
}
export interface PushEnv {
  /** false when serviceWorker, PushManager or Notification is missing. */
  supported(): boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  /** The page's service worker registration, or null when none is registered (dev builds don't register one). */
  registration(): Promise<BrowserRegistration | null>;
}

/** The VAPID key is URL-safe base64; PushManager wants the raw bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function toJson(subscription: BrowserSubscription): PushSubscriptionJson | null {
  const json = subscription.toJSON();
  const { p256dh, auth } = json.keys ?? {};
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/** The API answers 503 PUSH_NOT_CONFIGURED when push is off on the server. */
const isNotConfigured = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'PUSH_NOT_CONFIGURED';

export function createPushClient(api: PushApi, env: PushEnv) {
  /** Current state, without prompting and without contacting the server. */
  async function getState(): Promise<PushState> {
    if (!env.supported()) return 'unsupported';
    const registration = await env.registration().catch(() => null);
    if (!registration) return 'unsupported';
    if (env.permission() === 'denied') return 'denied';
    if (env.permission() === 'granted') {
      const existing = await registration.pushManager.getSubscription().catch(() => null);
      return existing ? 'on' : 'off';
    }
    return 'off';
  }

  /** Makes sure this browser has a subscription and that the server knows it. Idempotent; the server de-duplicates by endpoint. */
  async function ensureSubscribed(registration: BrowserRegistration): Promise<PushState> {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { publicKey } = await api.getPublicKey();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
    const json = toJson(subscription);
    if (!json) throw new Error('The browser returned an incomplete push subscription');
    await api.save(json);
    return 'on';
  }

  /** The user chose "turn on notifications": ask permission (once), then subscribe. */
  async function enable(): Promise<PushState> {
    try {
      if (!env.supported()) return 'unsupported';
      const registration = await env.registration();
      if (!registration) return 'unsupported';
      if (env.permission() === 'denied') return 'denied';
      const permission = env.permission() === 'granted' ? 'granted' : await env.requestPermission();
      if (permission === 'denied') return 'denied';
      if (permission !== 'granted') return 'off'; // the prompt was dismissed: ask again next time
      return await ensureSubscribed(registration);
    } catch (err) {
      if (isNotConfigured(err)) return 'unavailable';
      return getState(); // a network or push-service hiccup: stay as we were, the user can try again
    }
  }

  /** Re-registers an existing subscription with the server (e.g. after signing in, or if the browser rotated it). No prompt. */
  async function sync(): Promise<PushState> {
    try {
      if (!env.supported() || env.permission() !== 'granted') return getState();
      const registration = await env.registration();
      if (!registration) return 'unsupported';
      // Only refresh a subscription that already exists: never create one the user did not ask for on this device.
      if (!(await registration.pushManager.getSubscription())) return 'off';
      return await ensureSubscribed(registration);
    } catch (err) {
      if (isNotConfigured(err)) return 'unavailable';
      return getState();
    }
  }

  /** Turns notifications off for this device: the server forgets it, then the browser drops it. */
  async function disable(): Promise<PushState> {
    try {
      const registration = await env.registration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        await api.remove(subscription.endpoint).catch(() => undefined); // the server also prunes dead endpoints itself
        await subscription.unsubscribe();
      }
    } catch {
      // Fall through: report whatever state the browser is actually in.
    }
    return getState();
  }

  return { getState, enable, sync, disable };
}

export type PushClient = ReturnType<typeof createPushClient>;
