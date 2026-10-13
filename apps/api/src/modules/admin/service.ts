import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import type { AuthContext } from '../auth/types';
import { assertTransition, type RegistrantType } from '../registrations/transitions';
import type { AdminRepository } from './repository';
import type {
  CreateEventBody,
  CreateTeamBody,
  EventAccessBody,
  ListRegistrationsQuery,
  ListTeamsQuery,
  RejectRegistrationBody,
  ReviewQueueQuery,
  UpdateEventBody,
  UpdateTeamBody,
} from './schema';
import type {
  AdminEvent,
  AdminRegistrationRow,
  AdminTeam,
  EventAccessState,
  EventRosterEntry,
  EventSummary,
  Page,
  RejectedRegistration,
  ReviewQueueItem,
} from './types';

/**
 * Admin management of one organization's events and teams, and review of their registrations (players, coaches, staff). Reads are authorized per event by the route (ADMIN of the
 * organization that owns it); the one write, rejecting a registration, is authorized here against the registration's
 * own event, and a registration the caller may not administer is "not found", never "forbidden".
 *
 * Document decisions are NOT here: approving or rejecting a document is PATCH /documents/:id/review (documents module),
 * which already lets the family replace a rejected file and re-triggers readiness.
 */
export interface AdminService {
  /** The events of the caller's organization (none for an admin who has no organization). */
  listEvents(ctx: AuthContext): Promise<AdminEvent[]>;
  listEventsPage(
    ctx: AuthContext,
    query: { page: number; pageSize: number },
  ): Promise<Page<AdminEvent>>;
  summary(eventId: string, registrantType: RegistrantType): Promise<EventSummary>;
  getEvent(eventId: string): Promise<AdminEvent>;
  createEvent(ctx: AuthContext, body: CreateEventBody, meta: RequestMeta): Promise<AdminEvent>;
  updateEvent(
    ctx: AuthContext,
    eventId: string,
    body: UpdateEventBody,
    meta: RequestMeta,
  ): Promise<AdminEvent>;
  listTeams(eventId: string): Promise<AdminTeam[]>;
  /** One page of the teams of all the caller's events (none for an admin who has no organization). */
  listOrganizationTeams(ctx: AuthContext, query: ListTeamsQuery): Promise<Page<AdminTeam>>;
  createTeam(
    ctx: AuthContext,
    eventId: string,
    body: CreateTeamBody,
    meta: RequestMeta,
  ): Promise<AdminTeam>;
  getTeam(ctx: AuthContext, teamId: string): Promise<AdminTeam>;
  updateTeam(
    ctx: AuthContext,
    teamId: string,
    body: UpdateTeamBody,
    meta: RequestMeta,
  ): Promise<AdminTeam>;
  /** Everyone on the event's day-of roster (registered and not turned down), with check-in state. */
  roster(eventId: string): Promise<EventRosterEntry[]>;
  /** One page of the same roster, with the size of the whole roster. */
  rosterPage(
    eventId: string,
    query: { page: number; pageSize: number },
  ): Promise<Page<EventRosterEntry>>;
  listRegistrations(
    eventId: string,
    query: ListRegistrationsQuery,
  ): Promise<Page<AdminRegistrationRow>>;
  reviewQueue(eventId: string, query: ReviewQueueQuery): Promise<Page<ReviewQueueItem>>;
  /**
   * Rejects a registration for good (REJECTED can only be cancelled afterwards: whether a family may resubmit is an open
   * product decision). Allowed only where the status workflow allows it. The reason is written into the status history,
   * which the family can read. Payment is not touched: a rejected, paid registration needs a manual refund for now.
   */
  /**
   * Switches a person's event-day access off or on, without touching the registration's status. While off, check-in is
   * refused whatever the status is (the check-in rules and a database trigger both enforce it). Switching ON overrides
   * nothing: payment, documents and consent are still re-checked at the door. Repeating the current setting succeeds and
   * changes (and audits) nothing.
   */
  setEventAccess(
    ctx: AuthContext,
    registrationId: string,
    body: EventAccessBody,
    meta: RequestMeta,
  ): Promise<EventAccessState>;
  rejectRegistration(
    ctx: AuthContext,
    registrationId: string,
    body: RejectRegistrationBody,
    meta: RequestMeta,
  ): Promise<RejectedRegistration>;
}

const teamNotFound = () => AppError.notFound('TEAM_NOT_FOUND', 'Team not found');
const administers = (ctx: AuthContext, organizationId: string) =>
  ctx.roles.includes('ADMIN') &&
  ctx.organizationId !== null &&
  ctx.organizationId === organizationId;

export function createAdminService(repository: AdminRepository): AdminService {
  return {
    listEvents: (ctx) =>
      ctx.organizationId ? repository.listEvents(ctx.organizationId) : Promise.resolve([]),
    listEventsPage: (ctx, query) =>
      ctx.organizationId
        ? repository.listEventsPage(ctx.organizationId, query)
        : Promise.resolve({ items: [], ...query, total: 0 }),
    listOrganizationTeams: (ctx, query) =>
      ctx.organizationId
        ? repository.listOrganizationTeams(ctx.organizationId, query)
        : Promise.resolve({ items: [], ...query, total: 0 }),
    summary: (eventId, registrantType) => repository.summary(eventId, registrantType),
    listTeams: (eventId) => repository.listTeams(eventId),
    roster: (eventId) => repository.roster(eventId),
    async rosterPage(eventId, { page, pageSize }) {
      const [items, total] = await Promise.all([
        repository.roster(eventId, undefined, { limit: pageSize, offset: (page - 1) * pageSize }),
        repository.rosterCount(eventId),
      ]);
      return { items, page, pageSize, total };
    },

    async getEvent(eventId) {
      const event = await repository.findEvent(eventId);
      if (!event) throw AppError.notFound('EVENT_NOT_FOUND', 'Event not found');
      return event;
    },

    async createEvent(ctx, body, meta) {
      if (!ctx.organizationId) {
        throw AppError.forbidden('Your account has no organization', 'NO_ORGANIZATION');
      }
      const organizationId = ctx.organizationId;
      return repository.transaction(async (r) => {
        const event = await r.insertEvent(organizationId, ctx.userId, body);
        await r.audit({
          action: 'EVENT_CREATED',
          entityType: 'event',
          actorUserId: ctx.userId,
          entityId: event.id,
          metadata: { status: event.status },
          meta,
        });
        return event;
      });
    },

    async updateEvent(ctx, eventId, body, meta) {
      return repository.transaction(async (r) => {
        const current = await r.lockEvent(eventId);
        if (!current) throw AppError.notFound('EVENT_NOT_FOUND', 'Event not found');
        // The end can never precede the start, whichever of the two is being changed.
        const startsAt = new Date(body.startsAt ?? current.startsAt);
        const endsAt = new Date(body.endsAt ?? current.endsAt);
        if (endsAt < startsAt) {
          throw new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', [
            { path: 'endsAt', message: 'cannot be before the start' },
          ]);
        }
        // A draft is invisible to families: once people have registered, the event cannot go back to being one.
        if (
          body.status === 'DRAFT' &&
          current.status !== 'DRAFT' &&
          (await r.eventHasRegistrations(eventId))
        ) {
          throw AppError.conflict(
            'EVENT_HAS_REGISTRATIONS',
            'An event that already has registrations cannot go back to draft',
          );
        }
        const event = await r.updateEvent(eventId, body);
        await r.audit({
          action: 'EVENT_UPDATED',
          entityType: 'event',
          actorUserId: ctx.userId,
          entityId: eventId,
          metadata: { fields: Object.keys(body).join(','), status: event.status },
          meta,
        });
        return event;
      });
    },

    async createTeam(ctx, eventId, body, meta) {
      return repository.transaction(async (r) => {
        const event = await r.lockEvent(eventId);
        if (!event) throw AppError.notFound('EVENT_NOT_FOUND', 'Event not found');
        const team = await r.insertTeam(eventId, body);
        if (!team) {
          throw AppError.conflict(
            'TEAM_ALREADY_EXISTS',
            'This event already has a team with that name and club',
          );
        }
        await r.audit({
          action: 'TEAM_CREATED',
          entityType: 'team',
          actorUserId: ctx.userId,
          entityId: team.id,
          metadata: { eventId },
          meta,
        });
        return team;
      });
    },

    async getTeam(ctx, teamId) {
      const found = await repository.findTeam(teamId);
      if (!found || !administers(ctx, found.organizationId)) throw teamNotFound();
      return found.team;
    },

    async updateTeam(ctx, teamId, body, meta) {
      return repository.transaction(async (r) => {
        const found = await r.findTeam(teamId, true);
        if (!found || !administers(ctx, found.organizationId)) throw teamNotFound();
        const team = await r.updateTeam(teamId, body);
        if (!team) {
          throw AppError.conflict(
            'TEAM_ALREADY_EXISTS',
            'This event already has a team with that name and club',
          );
        }
        await r.audit({
          action: 'TEAM_UPDATED',
          entityType: 'team',
          actorUserId: ctx.userId,
          entityId: teamId,
          metadata: { fields: Object.keys(body).join(','), status: team.status },
          meta,
        });
        return team;
      });
    },

    listRegistrations: (eventId, query) => repository.listRegistrations(eventId, query),
    reviewQueue: (eventId, query) => repository.reviewQueue(eventId, query),

    async setEventAccess(ctx, registrationId, body, meta) {
      return repository.transaction(async (r) => {
        const reg = await r.lockRegistration(registrationId);
        const administers =
          reg !== null &&
          ctx.roles.includes('ADMIN') &&
          ctx.organizationId !== null &&
          ctx.organizationId === reg.organizationId;
        if (!reg || !administers) {
          throw AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');
        }
        const reason = body.disabled ? (body.reason ?? null) : null;
        // Repeating the current setting (without a new reason) writes nothing, so it can't wipe a saved reason or add noise.
        if (reg.eventAccessDisabled === body.disabled && reason === null) {
          return {
            id: reg.id,
            registrationNumber: reg.registrationNumber,
            eventAccessDisabled: reg.eventAccessDisabled,
            eventAccessDisabledReason: reg.eventAccessDisabledReason,
          };
        }
        const state = await r.setEventAccess(reg.id, body.disabled, reason);
        await r.audit({
          action: body.disabled ? 'EVENT_ACCESS_DISABLED' : 'EVENT_ACCESS_ENABLED',
          actorUserId: ctx.userId,
          entityId: reg.id,
          metadata: { hadReason: reason !== null },
          meta,
        });
        return state;
      });
    },

    async rejectRegistration(ctx, registrationId, body, meta) {
      return repository.transaction(async (r) => {
        const reg = await r.lockRegistration(registrationId);
        const administers =
          reg !== null &&
          ctx.roles.includes('ADMIN') &&
          ctx.organizationId !== null &&
          ctx.organizationId === reg.organizationId;
        if (!reg || !administers) {
          throw AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');
        }
        assertTransition(reg.status, 'REJECTED', reg.registrantType as RegistrantType);

        await r.setRejected(reg.id);
        await r.insertHistory({
          registrationId: reg.id,
          from: reg.status,
          to: 'REJECTED',
          changedBy: ctx.userId,
          reason: body.reason,
        });
        await r.audit({
          action: 'REGISTRATION_REJECTED',
          actorUserId: ctx.userId,
          entityId: reg.id,
          metadata: { from: reg.status },
          meta,
        });
        return {
          id: reg.id,
          registrationNumber: reg.registrationNumber,
          status: 'REJECTED' as const,
        };
      });
    },
  };
}
