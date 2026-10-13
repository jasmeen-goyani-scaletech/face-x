import webpush from 'web-push';
import type { PushSender } from './push-sender';

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: contact for the push services, per the VAPID spec. */
  subject: string;
}

/** Web Push over VAPID, using the `web-push` library. */
export function createWebPushSender(config: WebPushConfig): PushSender {
  const vapid = {
    subject: config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  };
  return {
    publicKey: config.publicKey,
    async send(target, payload, options) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          {
            vapidDetails: vapid,
            TTL: options.ttlSeconds,
            urgency: options.urgency,
            timeout: 10_000,
          },
        );
        return { ok: true };
      } catch (err) {
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : undefined;
        // 404 / 410: the subscription expired or the user revoked permission. Anything else may pass on its own.
        return { ok: false, gone: statusCode === 404 || statusCode === 410, statusCode };
      }
    },
  };
}
