import { getPushPublicKey, removePushSubscription, savePushSubscription } from '@/lib/api/notifications';
import { createPushClient, type BrowserRegistration, type PushEnv } from './pushClient';

export type { PushState } from './pushClient';

const browserEnv: PushEnv = {
  supported: () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  // getRegistration (not .ready): .ready never settles when no service worker is registered, as in dev builds.
  registration: async () => ((await navigator.serviceWorker.getRegistration()) as unknown as BrowserRegistration | undefined) ?? null
};

export const pushClient = createPushClient(
  {
    getPublicKey: getPushPublicKey,
    save: savePushSubscription,
    remove: removePushSubscription
  },
  browserEnv
);

/**
 * Called just before signing out, while the session can still authorize it: this device stops receiving the signed-out
 * user's notifications (a shared phone must not show the previous person's alerts). Never throws and never delays sign-out long.
 */
export async function detachPushFromThisDevice(): Promise<void> {
  try {
    await Promise.race([pushClient.disable(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch {
    // Signing out must always succeed.
  }
}
