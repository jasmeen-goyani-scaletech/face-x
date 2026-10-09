import type { Logger } from 'pino';
import type { PushSender } from '../../infrastructure/push/push-sender';
import { AppError } from '../../shared/errors/app-error';
import type { AuthContext } from '../auth/types';
import type { NotificationRepository } from './repository';
import { DEFAULT_TEMPLATES } from './templates';
import type {
  NotificationContext,
  NotificationPayload,
  NotificationPublisher,
  NotificationTemplates,
  PushSubscriptionInput,
} from './types';

export interface NotificationService extends NotificationPublisher {
  /** The VAPID public key the browser subscribes with. 503 when push is not configured. */
  getPublicKey(): { publicKey: string };
  /** Stores (or refreshes) this device's subscription for the signed-in user. Idempotent per endpoint. */
  subscribe(
    ctx: AuthContext,
    input: PushSubscriptionInput,
    userAgent: string | null,
  ): Promise<{ created: boolean }>;
  /** Removes this user's subscription for the endpoint. Idempotent. */
  unsubscribe(ctx: AuthContext, endpoint: string): Promise<{ removed: boolean }>;
}

export interface NotificationServiceDeps {
  repository: NotificationRepository;
  /** Absent when VAPID keys are not configured: subscribing answers 503 and publishing does nothing. */
  sender?: PushSender;
  logger: Logger;
  /** Overrides for the wording/destination of any notification type. */
  templates?: Partial<NotificationTemplates>;
  /** Most subscriptions (devices) kept per user; the oldest are dropped beyond this. */
  maxSubscriptionsPerUser?: number;
  /** Consecutive transient failures after which a subscription is removed. */
  maxConsecutiveFailures?: number;
  /** How long a push service may hold an undelivered notification. */
  ttlSeconds?: number;
}

export function createNotificationService({
  repository,
  sender,
  logger,
  templates,
  maxSubscriptionsPerUser = 10,
  maxConsecutiveFailures = 5,
  ttlSeconds = 24 * 60 * 60,
}: NotificationServiceDeps): NotificationService {
  const textFor = { ...DEFAULT_TEMPLATES, ...templates };

  const notConfigured = () =>
    AppError.unavailable('PUSH_NOT_CONFIGURED', 'Push notifications are not configured');

  /** Sends one payload to every device of every listed user. Failures are counted per device and never thrown. */
  async function deliver(userIds: string[], payload: NotificationPayload): Promise<void> {
    if (!sender || userIds.length === 0) return;
    const body = JSON.stringify(payload);
    const subscriptions = await repository.listForUsers(userIds);
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const result = await sender.send(sub, body, { ttlSeconds, urgency: 'high' });
          if (result.ok) {
            await repository.markSuccess(sub.id);
          } else if (result.gone) {
            // Expired, or the user revoked permission: this endpoint will never work again.
            await repository.removeById(sub.id);
          } else {
            logger.warn(
              { subscriptionId: sub.id, statusCode: result.statusCode, type: payload.type },
              'Push delivery failed',
            );
            await repository.markFailure(sub.id, maxConsecutiveFailures);
          }
        } catch (err) {
          logger.error({ err, subscriptionId: sub.id }, 'Push delivery errored');
        }
      }),
    );
  }

  async function publish(
    registrationId: string,
    context: Omit<NotificationContext, 'registrantType' | 'registrationId'>,
    tag: string,
  ): Promise<void> {
    // Delivery is best effort and happens after the business change committed: nothing here may throw.
    try {
      if (!sender) return;
      const recipients = await repository.recipientsForRegistration(registrationId);
      if (!recipients) return;
      const full: NotificationContext = {
        ...context,
        registrationId,
        registrantType: recipients.registrantType,
      };
      const payload: NotificationPayload = {
        type: context.type,
        ...textFor[context.type](full),
        tag,
        data: {
          registrationId,
          ...(context.documentId ? { documentId: context.documentId } : {}),
        },
      };
      await deliver(recipients.userIds, payload);
    } catch (err) {
      logger.error({ err, registrationId, type: context.type }, 'Could not send notification');
    }
  }

  return {
    getPublicKey() {
      if (!sender) throw notConfigured();
      return { publicKey: sender.publicKey };
    },

    async subscribe(ctx, input, userAgent) {
      if (!sender) throw notConfigured();
      return repository.upsert(
        ctx.userId,
        input,
        userAgent ? userAgent.slice(0, 300) : null,
        maxSubscriptionsPerUser,
      );
    },

    async unsubscribe(ctx, endpoint) {
      return { removed: await repository.removeForUser(ctx.userId, endpoint) };
    },

    documentReviewed(event) {
      const accepted = event.decision === 'APPROVED';
      return publish(
        event.registrationId,
        {
          type: accepted ? 'DOCUMENT_ACCEPTED' : 'DOCUMENT_REJECTED',
          documentType: event.documentType,
          documentId: event.documentId,
          reason: accepted ? null : event.reason,
        },
        `document-${event.documentId}`,
      );
    },

    eventDayAccessGranted(registrationId) {
      return publish(
        registrationId,
        { type: 'EVENT_DAY_ACCESS_GRANTED' },
        `event-day-${registrationId}`,
      );
    },
  };
}

/** For modules built without push (and for tests of those modules): every call does nothing. */
export const NO_NOTIFICATIONS: NotificationPublisher = {
  documentReviewed: () => Promise.resolve(),
  eventDayAccessGranted: () => Promise.resolve(),
};
