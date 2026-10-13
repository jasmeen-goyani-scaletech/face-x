import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { createPushClient, urlBase64ToUint8Array } from '../src/lib/push/pushClient.ts';

/* ---------- the service worker (public/sw.js), run with a fake worker scope ---------- */

const ORIGIN = 'https://app.example.test';
const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function loadServiceWorker({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => (listeners[type] = fn),
    registration: { showNotification: (title, options) => (shown.push({ title, options }), Promise.resolve()) },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => (opened.push(url), { url }),
      claim: async () => undefined
    },
    skipWaiting: async () => undefined
  };
  vm.runInNewContext(swSource, { self, URL, caches: {}, fetch: () => undefined, console });
  /** Runs a handler and waits for whatever it passed to event.waitUntil. */
  async function dispatch(type, event) {
    let pending = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => (pending = Promise.resolve(p)) });
    await pending;
  }
  return { dispatch, shown, opened };
}

const pushEvent = (payload) => ({ data: { json: () => payload } });
const clickEvent = (url) => {
  const event = { notification: { data: url === undefined ? undefined : { url }, close: () => (event.closed = true) }, closed: false };
  return event;
};

describe('service worker: push', () => {
  it('shows the notification from the payload, tagged, with the target page stored for the click', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch(
      'push',
      pushEvent({ type: 'DOCUMENT_REJECTED', title: 'Document needs attention', body: 'Birth certificate was rejected: blurry', url: '/dashboard/player', tag: 'document-1', data: { registrationId: 'r1' } })
    );
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].title, 'Document needs attention');
    assert.equal(sw.shown[0].options.body, 'Birth certificate was rejected: blurry');
    assert.equal(sw.shown[0].options.tag, 'document-1');
    assert.equal(sw.shown[0].options.data.url, '/dashboard/player');
  });

  it('still shows something sensible for an empty or malformed payload', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch('push', { data: null });
    await sw.dispatch('push', { data: { json: () => { throw new SyntaxError('not json'); } } });
    assert.equal(sw.shown.length, 2);
    assert.equal(sw.shown[0].title, 'Face-X');
    assert.equal(sw.shown[0].options.data.url, '/');
  });
});

describe('service worker: clicking a notification', () => {
  it('closes it and opens the page it points to when the app is not open', async () => {
    const sw = loadServiceWorker();
    const event = clickEvent('/coach/my-team/event-day');
    await sw.dispatch('notificationclick', event);
    assert.equal(event.closed, true);
    assert.deepEqual(sw.opened, ['/coach/my-team/event-day']);
  });

  it('reuses an open window of the app: navigates it to the page and focuses it', async () => {
    const calls = [];
    const open = {
      url: `${ORIGIN}/register/player`,
      navigate: async (url) => (calls.push(['navigate', url]), { focus: async () => calls.push(['focus']) }),
      focus: async () => calls.push(['focus-original'])
    };
    const sw = loadServiceWorker({ windows: [{ url: 'https://other.example.test/', navigate: async () => null }, open] });
    await sw.dispatch('notificationclick', clickEvent('/dashboard/player'));
    assert.deepEqual(calls, [['navigate', '/dashboard/player'], ['focus']]);
    assert.deepEqual(sw.opened, []);
  });

  it('opens a new window if an open one cannot be navigated', async () => {
    const open = { url: `${ORIGIN}/`, navigate: async () => { throw new TypeError('uncontrolled client'); } };
    const sw = loadServiceWorker({ windows: [open] });
    await sw.dispatch('notificationclick', clickEvent('/dashboard/player'));
    assert.deepEqual(sw.opened, ['/dashboard/player']);
  });

  it('never opens another site, whatever the payload says', async () => {
    for (const evil of ['https://evil.example.test/phish', '//evil.example.test/x', 'javascript:alert(1)', 42, undefined]) {
      const sw = loadServiceWorker();
      await sw.dispatch('notificationclick', clickEvent(evil));
      assert.deepEqual(sw.opened, ['/'], `for ${String(evil)}`);
    }
  });

  it('keeps the query string of an in-app link', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch('notificationclick', clickEvent(`${ORIGIN}/register/player?new=1`));
    assert.deepEqual(sw.opened, ['/register/player?new=1']);
  });
});

/* ---------- the page-side push client ---------- */

function setup({ permission = 'default', answer = 'granted', existing = null, supported = true, hasRegistration = true, server = {} } = {}) {
  const log = { subscribeCalls: 0, saved: [], removed: [], prompts: 0, unsubscribed: 0 };
  let current = existing;
  const makeSubscription = (endpoint) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
    unsubscribe: async () => ((current = null), log.unsubscribed++, true)
  });
  if (existing) current = makeSubscription(existing);
  const env = {
    supported: () => supported,
    permission: () => permission,
    requestPermission: async () => ((log.prompts++, (permission = answer)), answer),
    registration: async () =>
      hasRegistration
        ? {
            pushManager: {
              getSubscription: async () => current,
              subscribe: async (options) => {
                log.subscribeCalls++;
                log.applicationServerKey = options.applicationServerKey;
                assert.equal(options.userVisibleOnly, true);
                current = makeSubscription('https://push.example.test/device-1');
                return current;
              }
            }
          }
        : null
  };
  const api = {
    getPublicKey: server.getPublicKey ?? (async () => ({ publicKey: 'AQAB' })),
    save: server.save ?? (async (s) => void log.saved.push(s)),
    remove: server.remove ?? (async (e) => void log.removed.push(e))
  };
  return { client: createPushClient(api, env), log };
}

describe('push client: permission', () => {
  it('granted: asks once, subscribes with the server key, saves the subscription', async () => {
    const { client, log } = setup();
    assert.equal(await client.getState(), 'off');
    assert.equal(await client.enable(), 'on');
    assert.equal(log.prompts, 1);
    assert.equal(log.subscribeCalls, 1);
    assert.deepEqual([...log.applicationServerKey], [1, 0, 1]);
    assert.deepEqual(log.saved, [{ endpoint: 'https://push.example.test/device-1', keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }]);
    assert.equal(await client.getState(), 'on');
  });

  it('denied at the prompt: no subscription, nothing sent to the server, state is "denied"', async () => {
    const { client, log } = setup({ answer: 'denied' });
    assert.equal(await client.enable(), 'denied');
    assert.equal(log.subscribeCalls, 0);
    assert.equal(log.saved.length, 0);
    assert.equal(await client.getState(), 'denied');
  });

  it('already blocked in the browser: does not prompt again', async () => {
    const { client, log } = setup({ permission: 'denied' });
    assert.equal(await client.enable(), 'denied');
    assert.equal(log.prompts, 0);
    assert.equal(log.saved.length, 0);
  });

  it('prompt dismissed without an answer: stays off so the user can try again', async () => {
    const { client, log } = setup({ answer: 'default' });
    assert.equal(await client.enable(), 'off');
    assert.equal(log.saved.length, 0);
  });

  it('unsupported browsers and builds without a service worker report "unsupported" and do nothing', async () => {
    assert.equal(await setup({ supported: false }).client.enable(), 'unsupported');
    const dev = setup({ hasRegistration: false });
    assert.equal(await dev.client.getState(), 'unsupported');
    assert.equal(await dev.client.enable(), 'unsupported');
    assert.equal(dev.log.prompts, 0);
  });
});

describe('push client: subscription lifecycle', () => {
  it('enabling twice reuses the browser subscription: one subscribe, same endpoint saved', async () => {
    const { client, log } = setup({ permission: 'granted' });
    await client.enable();
    await client.enable();
    assert.equal(log.subscribeCalls, 1);
    assert.equal(log.saved.length, 2);
    assert.equal(log.saved[0].endpoint, log.saved[1].endpoint);
  });

  it('sync re-registers an existing subscription without prompting, and never creates one', async () => {
    const withSub = setup({ permission: 'granted', existing: 'https://push.example.test/existing' });
    assert.equal(await withSub.client.sync(), 'on');
    assert.deepEqual(withSub.log.saved.map((s) => s.endpoint), ['https://push.example.test/existing']);
    assert.equal(withSub.log.prompts, 0);

    const noSub = setup({ permission: 'granted' });
    assert.equal(await noSub.client.sync(), 'off');
    assert.equal(noSub.log.subscribeCalls, 0);
    assert.equal(noSub.log.saved.length, 0);

    const notAsked = setup({ permission: 'default', existing: 'https://push.example.test/x' });
    await notAsked.client.sync();
    assert.equal(notAsked.log.saved.length, 0);
  });

  it('disable removes the subscription on the server, then in the browser', async () => {
    const { client, log } = setup({ permission: 'granted', existing: 'https://push.example.test/existing' });
    assert.equal(await client.disable(), 'off');
    assert.deepEqual(log.removed, ['https://push.example.test/existing']);
    assert.equal(log.unsubscribed, 1);
  });

  it('disable still drops the browser subscription when the server is unreachable', async () => {
    const { client, log } = setup({
      permission: 'granted',
      existing: 'https://push.example.test/existing',
      server: { remove: async () => { throw new Error('offline'); } }
    });
    assert.equal(await client.disable(), 'off');
    assert.equal(log.unsubscribed, 1);
  });

  it('disable with nothing subscribed is a no-op', async () => {
    const { client, log } = setup({ permission: 'granted' });
    assert.equal(await client.disable(), 'off');
    assert.equal(log.removed.length, 0);
  });
});

describe('push client: failures never throw or block', () => {
  it('server has push switched off: "unavailable" (button hidden)', async () => {
    const { client } = setup({
      server: { getPublicKey: async () => { throw Object.assign(new Error('off'), { code: 'PUSH_NOT_CONFIGURED' }); } }
    });
    assert.equal(await client.enable(), 'unavailable');
  });

  it('saving fails (network): resolves to the real state instead of throwing', async () => {
    const { client } = setup({ server: { save: async () => { throw new Error('network'); } } });
    const state = await client.enable();
    assert.equal(state, 'on'); // the browser did subscribe; the next sync() will retry the save
  });

  it('the browser refuses to subscribe (push service down): resolves, does not throw', async () => {
    const { log } = setup({ permission: 'granted' });
    const broken = createPushClient(
      { getPublicKey: async () => ({ publicKey: 'AQAB' }), save: async () => undefined, remove: async () => undefined },
      {
        supported: () => true,
        permission: () => 'granted',
        requestPermission: async () => 'granted',
        registration: async () => ({
          pushManager: { getSubscription: async () => null, subscribe: async () => { throw new DOMException('push service error', 'AbortError'); } }
        })
      }
    );
    assert.equal(await broken.enable(), 'off');
    assert.equal(log.saved.length, 0);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 with and without padding', () => {
    assert.deepEqual([...urlBase64ToUint8Array('AQAB')], [1, 0, 1]);
    assert.deepEqual([...urlBase64ToUint8Array('-_-_')], [251, 255, 191]);
    assert.deepEqual([...urlBase64ToUint8Array('YQ')], [97]);
  });
});
