/** One browser's push endpoint with the keys needed to encrypt a message for it. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendResult =
  | { ok: true }
  /** `gone`: the push service says this subscription no longer exists (404/410): delete it. Otherwise a transient failure. */
  | { ok: false; gone: boolean; statusCode?: number };

export interface PushSendOptions {
  /** Seconds the push service may hold the message while the device is offline. */
  ttlSeconds: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
}

/** The only thing the application knows about Web Push delivery. Implementations never throw: failures come back as results. */
export interface PushSender {
  /** The VAPID public key the browser needs to subscribe. */
  readonly publicKey: string;
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<PushSendResult>;
}
