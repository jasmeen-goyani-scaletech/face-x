import {
  InvalidWebhookSignatureError,
  PaymentProviderNotConfiguredError,
  type PaymentProvider,
  type ProviderEvent,
} from '../../infrastructure/payments/payment-provider';
import { AppError } from '../../shared/errors/app-error';
import type { NotificationPublisher } from '../notifications';
import type { RequestMeta } from '../../shared/http/request-meta';
import { safeCause } from '../../shared/utils/scrub';
import { uuid } from '../../shared/validation/fields';
import type { AuthContext } from '../auth/types';
import { assertTransition } from '../registrations';
import type { PaymentRecord, PaymentRepository, WebhookOutcome } from './repository';
import type { CheckoutDto, PaymentSummaryDto, WebhookResult } from './types';

/**
 * Stripe payments for registrations.
 *
 *   browser -> POST /registrations/:id/payment -> Stripe Checkout (hosted page) -> Stripe -> POST /webhooks/stripe
 *
 * The browser returning from Stripe proves nothing. A payment becomes PAID only from a webhook whose signature was
 * verified, and each webhook event is applied at most once (payment_webhook_events, in the same transaction).
 * The amount is always the registration's own fee, fixed at submission; nothing amount-related is accepted
 * from the client. Payment state is independent of document, consent and check-in state; the one coupling
 * is the registration's workflow step (SUBMITTED -> PAYMENT_PENDING -> PAYMENT_COMPLETED) defined in
 * registrations/transitions.ts. This code never makes a registration verified or ready for the event; the readiness
 * evaluator (modules/readiness), run in the same transaction, decides whether it can go further.
 */
export interface PaymentService {
  createCheckout(ctx: AuthContext, registrationId: string, meta: RequestMeta): Promise<CheckoutDto>;
  getPayment(ctx: AuthContext, registrationId: string): Promise<PaymentSummaryDto>;
  handleWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    meta: RequestMeta,
  ): Promise<WebhookResult>;
}

export interface PaymentServiceDeps {
  repository: PaymentRepository;
  /** Absent when STRIPE_SECRET_KEY is not configured: payment endpoints then answer 503. */
  provider?: PaymentProvider;
  /** Where the hosted page sends the customer back to (the existing frontend return page). */
  returnBaseUrl: string;
  /** Told when a confirmed payment completes a registration (READY_FOR_EVENT). Absent: no notifications. */
  notifications?: NotificationPublisher;
}

/** Registration statuses from which a payment can be started (the workflow's payment window). */
const PAYABLE_STATUSES = ['SUBMITTED', 'PAYMENT_PENDING'];
/** Stripe requires checkout sessions to live at least 30 minutes. */
const CHECKOUT_TTL_SECONDS = 31 * 60;
/** Where the existing frontend expects the customer (src/lib/payment.ts PAYMENT_RETURN_PATH). */
const RETURN_PATH = '/register/player/payment-return';

const regNotFound = () => AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');
const notConfigured = () =>
  AppError.unavailable('PAYMENT_NOT_CONFIGURED', 'Payments are not configured');

/** Provider failures are 503 with the cause only in the server log (never the provider's message to the client). */
function providerFailure(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  const err = AppError.unavailable(
    'PAYMENT_PROVIDER_UNAVAILABLE',
    'The payment provider is unavailable',
  );
  (err as { cause?: unknown }).cause = safeCause(cause);
  return err;
}

export function createPaymentService({
  repository,
  provider,
  returnBaseUrl,
  notifications,
}: PaymentServiceDeps): PaymentService {
  const isAdminOf = (ctx: AuthContext, organizationId: string) =>
    ctx.roles.includes('ADMIN') &&
    ctx.organizationId !== null &&
    ctx.organizationId === organizationId;

  const returnUrl = (status: 'success' | 'cancelled', registrationId: string) =>
    `${returnBaseUrl.replace(/\/$/, '')}${RETURN_PATH}?status=${status}&registrationId=${registrationId}`;

  return {
    async createCheckout(ctx, registrationId, meta) {
      if (!provider) throw notConfigured();
      const first = await repository.findRegistration(registrationId, ctx.userId);
      if (!first || !first.isOwner) throw regNotFound();

      return repository.transaction(async (r) => {
        // One checkout creation per registration at a time. Concurrent requests queue here; each then sees
        // what the previous one did.
        await r.lockCheckoutCreation(registrationId);
        const reg = await r.findRegistration(registrationId, ctx.userId);
        if (!reg || !reg.isOwner) throw regNotFound();

        if (await r.findPaid(registrationId)) {
          throw AppError.conflict(
            'PAYMENT_ALREADY_COMPLETED',
            'This registration has already been paid',
          );
        }
        if (!PAYABLE_STATUSES.includes(reg.status)) {
          throw AppError.conflict(
            'REGISTRATION_NOT_PAYABLE',
            reg.status === 'DRAFT'
              ? 'Submit the registration before paying'
              : `A ${reg.status} registration cannot be paid`,
          );
        }
        // The amount is the fee fixed at submission, read here on the server. There is no client input for it.
        if (reg.feeCents <= 0) {
          throw AppError.conflict(
            'PAYMENT_NOT_REQUIRED',
            'No payment is due for this registration',
          );
        }

        // Retry: close the earlier checkout at the provider FIRST, so it cannot be paid after we replace it.
        const open = await r.lockPending(registrationId);
        if (open) {
          if (open.sessionId) {
            const closed = await provider
              .expireCheckoutSession(open.sessionId)
              .catch((e: unknown) => {
                throw providerFailure(e);
              });
            if (closed === 'COMPLETE') {
              // Paid (or being paid) already: the webhook will confirm it. Never start a second charge.
              throw AppError.conflict(
                'PAYMENT_IN_PROGRESS',
                'A payment for this registration is being confirmed',
              );
            }
          }
          if (!(await r.cancelPending(open.id, 'SUPERSEDED'))) {
            throw AppError.conflict(
              'PAYMENT_IN_PROGRESS',
              'A payment for this registration is being confirmed',
            );
          }
          await r.audit({
            action: 'PAYMENT_CANCELLED',
            actorUserId: ctx.userId,
            entityId: open.id,
            metadata: { registrationId, reason: 'SUPERSEDED' },
            meta,
          });
        }

        const paymentId = await r.insertPending({
          registrationId,
          amountCents: reg.feeCents,
          currency: reg.currency,
          createdBy: ctx.userId,
        });
        if (!paymentId) {
          throw AppError.conflict(
            'PAYMENT_IN_PROGRESS',
            'A payment for this registration is already in progress',
          );
        }

        const session = await provider
          .createCheckoutSession({
            paymentId,
            registrationId,
            // No personal data (not the player's name) goes to the provider.
            description: `Registration ${reg.registrationNumber} - ${reg.eventName}`,
            amountCents: reg.feeCents,
            currency: reg.currency,
            successUrl: returnUrl('success', registrationId),
            cancelUrl: returnUrl('cancelled', registrationId),
            expiresInSeconds: CHECKOUT_TTL_SECONDS,
          })
          .catch((e: unknown) => {
            throw providerFailure(e);
          });
        await r.attachSession(paymentId, session.sessionId, session.expiresAt);

        if (reg.status === 'SUBMITTED') {
          assertTransition('SUBMITTED', 'PAYMENT_PENDING');
          const moved = await r.transitionRegistration({
            registrationId,
            from: 'SUBMITTED',
            to: 'PAYMENT_PENDING',
            changedBy: ctx.userId,
            reason: 'Checkout started',
          });
          if (!moved) {
            throw AppError.conflict(
              'INVALID_STATUS_TRANSITION',
              'The registration changed, try again',
            );
          }
        }
        await r.audit({
          action: 'PAYMENT_CHECKOUT_CREATED',
          actorUserId: ctx.userId,
          entityId: paymentId,
          metadata: { registrationId, amountCents: reg.feeCents, currency: reg.currency },
          meta,
        });
        return {
          paymentId,
          checkoutUrl: session.url,
          expiresAt: session.expiresAt.toISOString(),
        };
      });
    },

    async getPayment(ctx, registrationId) {
      const reg = await repository.findRegistration(registrationId, ctx.userId);
      if (!reg || !(reg.isOwner || isAdminOf(ctx, reg.eventOrganizationId))) throw regNotFound();
      const payments = await repository.listPayments(registrationId);
      const paid = payments.some((p) => p.status === 'PAID');
      return {
        registrationId,
        amountDue: { amountCents: reg.feeCents, currency: reg.currency },
        paymentStatus: paid ? 'PAID' : (payments[0]?.status ?? 'NOT_STARTED'),
        canStartCheckout: !paid && PAYABLE_STATUSES.includes(reg.status) && reg.feeCents > 0,
        payments,
      };
    },

    async handleWebhook(rawBody, signatureHeader, meta) {
      if (!provider) throw notConfigured();

      // 1. Verify BEFORE anything else: nothing in an unverified body is read, stored or acted on.
      let event: ProviderEvent;
      try {
        event = provider.verifyWebhook(rawBody, signatureHeader);
      } catch (err) {
        if (err instanceof InvalidWebhookSignatureError) {
          throw AppError.badRequest('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid');
        }
        if (err instanceof PaymentProviderNotConfiguredError) throw notConfigured();
        throw err;
      }
      if (event.kind === 'IGNORED') return { received: true, note: 'IGNORED' };

      // 2. Apply at most once. The event row and every change it causes commit or roll back together.
      const sessionsToClose: string[] = [];
      const nowReady: string[] = [];
      const result = await repository.transaction<WebhookResult>(async (r) => {
        if (!(await r.recordWebhookEvent({ eventId: event.id, eventType: event.type }))) {
          return { received: true, note: 'DUPLICATE' }; // already applied (also the loser of a simultaneous delivery)
        }
        const finish = async (
          payment: PaymentRecord | null,
          outcome: WebhookOutcome,
          detail: string | null,
        ): Promise<WebhookResult> => {
          await r.setWebhookOutcome({
            eventId: event.id,
            paymentId: payment?.id ?? null,
            outcome,
            detail,
          });
          return { received: true };
        };

        const ourId =
          event.paymentId && uuid.safeParse(event.paymentId).success ? event.paymentId : null;
        const payment =
          (event.sessionId ? await r.lockPaymentBySession(event.sessionId) : null) ??
          (ourId ? await r.lockPaymentById(ourId) : null);
        if (!payment) {
          // It carries our reference but we cannot find the payment yet: answer non-2xx so the provider
          // retries (and roll this event back). An event with no reference of ours is simply not for us.
          if (ourId)
            throw AppError.conflict('PAYMENT_NOT_FOUND_YET', 'Payment not found yet, retry later');
          return finish(null, 'IGNORED', 'NOT_OURS');
        }
        if (event.registrationId && event.registrationId !== payment.registrationId) {
          await r.audit({
            action: 'PAYMENT_WEBHOOK_REJECTED',
            actorUserId: null,
            entityId: payment.id,
            metadata: { eventType: event.type, detail: 'METADATA_MISMATCH' },
            meta,
          });
          return finish(payment, 'REJECTED', 'METADATA_MISMATCH');
        }

        switch (event.kind) {
          case 'PAID': {
            if (event.amountCents !== payment.amountCents || event.currency !== payment.currency) {
              // Money arrived but not the amount we asked for: never mark it paid. Needs a human.
              await r.audit({
                action: 'PAYMENT_WEBHOOK_REJECTED',
                actorUserId: null,
                entityId: payment.id,
                metadata: { eventType: event.type, detail: 'AMOUNT_MISMATCH' },
                meta,
              });
              return finish(payment, 'REJECTED', 'AMOUNT_MISMATCH');
            }
            if (payment.status === 'PAID' || payment.status === 'REFUNDED') {
              return finish(payment, 'NOOP', 'ALREADY_PAID');
            }
            if (await r.findOtherPaid(payment.registrationId, payment.id)) {
              // The registration was already paid through another checkout: this charge is a duplicate
              // and must be refunded (refunds are not automated yet).
              await r.markCancelled(payment.id, 'DUPLICATE_NEEDS_REFUND');
              await r.audit({
                action: 'PAYMENT_WEBHOOK_REJECTED',
                actorUserId: null,
                entityId: payment.id,
                metadata: { eventType: event.type, detail: 'DUPLICATE_PAYMENT' },
                meta,
              });
              return finish(payment, 'REJECTED', 'DUPLICATE_PAYMENT');
            }

            await r.markPaid(payment.id, event.paymentIntentId);
            // Any other open checkout of this registration must not be payable any more.
            sessionsToClose.push(
              ...(await r.cancelOtherPending(
                payment.registrationId,
                payment.id,
                'REGISTRATION_ALREADY_PAID',
              )),
            );

            // Payment itself only completes the payment step. Whatever the registration's documents and consent already
            // allow beyond that (verified, ready) is decided by the readiness evaluator below, never here.
            const status = await r.lockRegistrationStatus(payment.registrationId);
            if (status === 'PAYMENT_PENDING') {
              assertTransition('PAYMENT_PENDING', 'PAYMENT_COMPLETED');
              await r.transitionRegistration({
                registrationId: payment.registrationId,
                from: 'PAYMENT_PENDING',
                to: 'PAYMENT_COMPLETED',
                changedBy: null, // the system, on a verified provider event
                reason: 'Payment confirmed',
              });
            }
            // Same transaction: the payment and the workflow it unlocks commit together or not at all.
            if (await r.evaluateReadiness(payment.registrationId))
              nowReady.push(payment.registrationId);
            await r.audit({
              action: 'PAYMENT_CONFIRMED',
              actorUserId: null,
              entityId: payment.id,
              metadata: {
                registrationId: payment.registrationId,
                amountCents: payment.amountCents,
                registrationStatus: status,
              },
              meta,
            });
            return finish(payment, 'APPLIED', null);
          }

          case 'FAILED': {
            if (payment.status !== 'PAYMENT_PENDING' && payment.status !== 'FAILED') {
              return finish(payment, 'NOOP', `ALREADY_${payment.status}`);
            }
            await r.markFailed(payment.id, event.failureCode ?? 'payment_failed');
            await r.audit({
              action: 'PAYMENT_FAILED',
              actorUserId: null,
              entityId: payment.id,
              metadata: {
                registrationId: payment.registrationId,
                code: event.failureCode,
                final: true,
              },
              meta,
            });
            return finish(payment, 'APPLIED', null);
          }

          case 'EXPIRED': {
            if (payment.status !== 'PAYMENT_PENDING') {
              return finish(payment, 'NOOP', `ALREADY_${payment.status}`);
            }
            await r.markCancelled(payment.id, 'CHECKOUT_EXPIRED');
            await r.audit({
              action: 'PAYMENT_CANCELLED',
              actorUserId: null,
              entityId: payment.id,
              metadata: { registrationId: payment.registrationId, reason: 'CHECKOUT_EXPIRED' },
              meta,
            });
            return finish(payment, 'APPLIED', null);
          }

          case 'ATTEMPT_FAILED': {
            // One card attempt failed; the customer can retry on the same hosted page, so the payment stays open.
            if (payment.status !== 'PAYMENT_PENDING') {
              return finish(payment, 'NOOP', `ALREADY_${payment.status}`);
            }
            await r.recordAttemptFailure(payment.id, event.failureCode ?? 'payment_failed');
            await r.audit({
              action: 'PAYMENT_FAILED',
              actorUserId: null,
              entityId: payment.id,
              metadata: {
                registrationId: payment.registrationId,
                code: event.failureCode,
                final: false,
              },
              meta,
            });
            return finish(payment, 'APPLIED', 'ATTEMPT_FAILED');
          }

          default:
            // AWAITING_FUNDS: the checkout finished but the money has not arrived; a later event settles it.
            return finish(payment, 'NOOP', 'AWAITING_FUNDS');
        }
      });

      // After commit, best effort: close other checkouts of a registration that has just been paid.
      await Promise.allSettled(sessionsToClose.map((id) => provider.expireCheckoutSession(id)));
      for (const registrationId of nowReady)
        await notifications?.eventDayAccessGranted(registrationId);
      return result;
    },
  };
}
