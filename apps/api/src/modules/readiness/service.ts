import type { Logger } from 'pino';
import { AppError } from '../../shared/errors/app-error';
import type { NotificationPublisher } from '../notifications';
import type { AuthContext } from '../auth/types';
import type { ReadinessRepository } from './repository';
import type { EvaluationResult, ReadinessReport, ReadinessTrigger } from './types';

/**
 * Registration readiness: has the registration met every requirement to be READY_FOR_EVENT, and if so, advance it.
 *
 * It only ever moves a registration forward through the existing transition table, as the system (never as a user,
 * never as an override), and never requires a face profile. Payment, documents and consent stay separate states:
 * this reads them, it does not change them.
 *
 * Access mirrors the other registration reads: the owner, or an admin of the event's organization; everyone else
 * gets 404. Evaluating is allowed to both because it is deterministic and idempotent: it can only apply what the
 * rules already justify.
 */
export interface ReadinessService extends ReadinessTrigger {
  get(ctx: AuthContext, registrationId: string): Promise<ReadinessReport>;
  evaluate(ctx: AuthContext, registrationId: string): Promise<EvaluationResult>;
}

const notFound = () => AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');

export function createReadinessService(
  repository: ReadinessRepository,
  logger: Logger,
  notifications?: NotificationPublisher,
): ReadinessService {
  async function authorize(ctx: AuthContext, registrationId: string) {
    const access = await repository.findAccess(registrationId, ctx.userId);
    const admin =
      access !== null &&
      ctx.roles.includes('ADMIN') &&
      ctx.organizationId !== null &&
      ctx.organizationId === access.eventOrganizationId;
    if (!access || !(access.isOwner || admin)) throw notFound();
  }

  /** Event-day access is granted exactly when an evaluation moves the registration into READY_FOR_EVENT. */
  async function announce(registrationId: string, result: EvaluationResult | null) {
    if (result?.steps.some((s) => s.to === 'READY_FOR_EVENT')) {
      await notifications?.eventDayAccessGranted(registrationId);
    }
  }

  return {
    async get(ctx, registrationId) {
      await authorize(ctx, registrationId);
      const report = await repository.inspect(registrationId);
      if (!report) throw notFound();
      return report;
    },

    async evaluate(ctx, registrationId) {
      await authorize(ctx, registrationId);
      const result = await repository.evaluate(registrationId);
      if (!result) throw notFound();
      await announce(registrationId, result);
      return result;
    },

    async afterChange(registrationId) {
      // The change that called this has already committed and must not be reported as failed because a follow-up
      // evaluation hiccupped: log it (ids only) and rely on the next trigger or a manual evaluate to catch up.
      try {
        await announce(registrationId, await repository.evaluate(registrationId));
      } catch (err) {
        logger.error(
          { registrationId, err },
          'Readiness evaluation failed after a committed change; it will be retried by the next trigger',
        );
      }
    },
  };
}
