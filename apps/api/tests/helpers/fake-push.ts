import type { PushSender, PushSendResult } from '../../src/infrastructure/push/push-sender';

export interface SentPush {
  endpoint: string;
  payload: Record<string, unknown> & { type: string; url: string; title: string; body: string };
}

/** In-memory Web Push service: records what would be delivered, and fails on demand per endpoint. */
export function createFakePush() {
  const sent: SentPush[] = [];
  const results = new Map<string, PushSendResult | 'throw'>();
  const sender: PushSender = {
    publicKey: 'BFakePublicKeyForTests',
    async send(target, payload) {
      const planned = results.get(target.endpoint);
      if (planned === 'throw') throw new Error('push service exploded');
      if (planned && !planned.ok) return planned;
      sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
      return { ok: true };
    },
  };
  return {
    sender,
    sent,
    sentTo: (endpoint: string) => sent.filter((s) => s.endpoint === endpoint),
    /** Make this endpoint answer 410 Gone (expired / permission revoked). */
    expire: (endpoint: string) => results.set(endpoint, { ok: false, gone: true, statusCode: 410 }),
    /** Make this endpoint fail transiently (push service 503). */
    fail: (endpoint: string) => results.set(endpoint, { ok: false, gone: false, statusCode: 503 }),
    explode: (endpoint: string) => results.set(endpoint, 'throw'),
    heal: (endpoint: string) => results.delete(endpoint),
    reset: () => {
      sent.length = 0;
      results.clear();
    },
  };
}
export type FakePush = ReturnType<typeof createFakePush>;
