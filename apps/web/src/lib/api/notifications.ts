import { apiRequest } from './http';

export const getPushPublicKey = () => apiRequest<{ publicKey: string }>('/notifications/push/public-key');

/** Stores this browser's push subscription for the signed-in user. Safe to repeat: the API keeps one row per endpoint. */
export const savePushSubscription = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
  apiRequest<{ created: boolean }>('/notifications/push/subscriptions', { method: 'POST', body: subscription });

export const removePushSubscription = (endpoint: string) =>
  apiRequest<{ removed: boolean }>('/notifications/push/subscriptions', { method: 'DELETE', body: { endpoint } });
