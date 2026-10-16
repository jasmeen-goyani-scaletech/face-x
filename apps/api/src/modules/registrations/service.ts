import { AppError, type ErrorDetail } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import type { AuthContext } from '../auth/types';
import type { EventRow, RegistrationRepository, TeamRow } from './repository';
import { isMinorForEvent } from './rules';
import type {
  CreateRegistrationBody,
  ListRegistrationsQuery,
  UpdateRegistrationBody,
} from './schema';
import { assertTransition, type RegistrantType } from './transitions';
import type { RegistrationDto, RegistrationStatusDto, RegistrationSummary } from './types';

/**
 * Registrations for players, coaches and staff: one registration per person per event, one set of endpoints.
 *
 * Access: the owner of the registration's registrant (the player themself or a linked guardian; the coach or staff
 * member themself) can read and edit their registration. An ADMIN can READ registrations of events owned by their organization. Everyone else gets
 * 404 (not 403) so other families' registrations are not even confirmed to exist. There is no admin edit or
 * override here.
 */
export interface RegistrationService {
  create(
    ctx: AuthContext,
    body: CreateRegistrationBody,
    meta: RequestMeta,
  ): Promise<RegistrationDto>;
  listMine(ctx: AuthContext, filter?: ListRegistrationsQuery): Promise<RegistrationSummary[]>;
  get(ctx: AuthContext, registrationId: string): Promise<RegistrationDto>;
  /** Edits a DRAFT. Calling it repeatedly is "save as draft". */
  update(
    ctx: AuthContext,
    registrationId: string,
    body: UpdateRegistrationBody,
  ): Promise<RegistrationDto>;
  /** DRAFT -> SUBMITTED, after checking the registration is complete. */
  submit(ctx: AuthContext, registrationId: string, meta: RequestMeta): Promise<RegistrationDto>;
  getStatus(ctx: AuthContext, registrationId: string): Promise<RegistrationStatusDto>;
}

const notFound = () => AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');

/** The role a caller needs to act on a registration of this type (a player's family: PARENT or PLAYER). */
const ROLES_FOR: Record<RegistrantType, readonly string[]> = {
  PLAYER: ['PARENT', 'PLAYER'],
  COACH: ['COACH'],
  STAFF: ['STAFF'],
};

function assertRoleFor(ctx: AuthContext, type: RegistrantType): void {
  if (!ROLES_FOR[type].some((role) => (ctx.roles as readonly string[]).includes(role))) {
    throw AppError.forbidden('You do not have the required role', 'INSUFFICIENT_ROLE');
  }
}

/** Why a team cannot be used for an event, or null if it can. */
function teamProblem(team: TeamRow | null, event: EventRow): ErrorDetail | null {
  if (!team || team.eventId !== event.id) {
    return { path: 'teamId', message: 'is not a team of this event' };
  }
  if (team.status !== 'ACTIVE') return { path: 'teamId', message: 'is not accepting players' };
  return null;
}

const KIND_LABEL: Record<RegistrantType, string> = {
  PLAYER: 'players',
  COACH: 'coaches',
  STAFF: 'staff members',
};

/**
 * 409 TEAM_REGISTRATION_FULL when the team's limit for this kind of registrant is reached. A registration holds a place from
 * submission on (every status except draft, cancelled and rejected), so lowering a limit never touches anyone already
 * registered; it only stops new submissions until the count drops below it. `lock` must be true where the decision is final.
 */
async function assertTeamHasRoom(
  r: RegistrationRepository,
  teamId: string,
  type: RegistrantType,
  lock: boolean,
): Promise<void> {
  const cap = await r.teamCapacity(teamId, type, lock);
  if (cap && cap.max !== null && cap.used >= cap.max) {
    const message = `Registration for ${cap.teamName} is full: it cannot accept any more ${KIND_LABEL[type]}.`;
    throw new AppError(409, 'TEAM_REGISTRATION_FULL', message, [{ path: 'teamId', message }]);
  }
}

export function createRegistrationService(repository: RegistrationRepository): RegistrationService {
  async function view(ctx: AuthContext, registrationId: string): Promise<RegistrationDto> {
    const found = await repository.findView(registrationId, ctx.userId);
    const adminOfEvent =
      found !== null &&
      ctx.roles.includes('ADMIN') &&
      ctx.organizationId !== null &&
      ctx.organizationId === found.eventOrganizationId;
    if (!found || !(found.isOwner || adminOfEvent)) throw notFound();
    return found.registration;
  }

  return {
    async create(ctx, body, meta) {
      const registrationId = await repository.transaction(async (r) => {
        const event = await r.lockEvent(body.eventId);
        // Events that are not published yet are not visible to families at all.
        if (!event || event.status === 'DRAFT') {
          throw AppError.notFound('EVENT_NOT_FOUND', 'Event not found');
        }
        if (event.status !== 'PUBLISHED') {
          throw AppError.conflict('EVENT_NOT_OPEN', 'This event is not open for registration');
        }
        // Who is being registered: a player of the caller's family, or the caller's own coach/staff profile.
        let registrantType: RegistrantType = 'PLAYER';
        if (body.playerId) {
          assertRoleFor(ctx, 'PLAYER');
          if (!(await r.isPlayerOwner(body.playerId, ctx.userId))) {
            throw AppError.notFound('PLAYER_NOT_FOUND', 'Player not found');
          }
        } else {
          const profile = await r.findOwnedStaffProfile(body.staffProfileId!, ctx.userId);
          if (!profile)
            throw AppError.notFound('STAFF_PROFILE_NOT_FOUND', 'Staff profile not found');
          registrantType = profile.profileType;
          assertRoleFor(ctx, registrantType);
        }
        if (body.teamId) {
          const problem = teamProblem(await r.findTeam(body.teamId), event);
          if (problem) {
            throw new AppError(422, 'TEAM_NOT_AVAILABLE', 'The selected team cannot be used', [
              problem,
            ]);
          }
        }

        // Early, friendly refusal; the binding check (under a team lock) happens at submit.
        if (body.teamId) await assertTeamHasRoom(r, body.teamId, registrantType, false);

        // ON CONFLICT DO NOTHING on (event, person): of any number of concurrent requests exactly one inserts.
        // Coaches and staff do not pay, so their fee is fixed at zero whatever the event charges players.
        const id = await r.insert({
          eventId: event.id,
          registrantType,
          playerId: body.playerId ?? null,
          staffProfileId: body.staffProfileId ?? null,
          teamId: body.teamId ?? null,
          guestCount: body.guestCount ?? 0,
          feeCents: registrantType === 'PLAYER' ? event.feeCents : 0,
          currency: event.currency,
          createdBy: ctx.userId,
        });
        if (!id) {
          throw AppError.conflict(
            'REGISTRATION_ALREADY_EXISTS',
            registrantType === 'PLAYER'
              ? 'This player is already registered for this event'
              : 'This person is already registered for this event',
          );
        }
        await r.insertHistory({
          registrationId: id,
          from: null,
          to: 'DRAFT',
          changedBy: ctx.userId,
        });
        await r.audit({
          action: 'REGISTRATION_CREATED',
          actorUserId: ctx.userId,
          entityId: id,
          metadata: { eventId: event.id, registrantType },
          meta,
        });
        return id;
      });
      return view(ctx, registrationId);
    },

    listMine: (ctx, filter = {}) => repository.listOwned(ctx.userId, filter),

    get: view,

    async update(ctx, registrationId, body) {
      await repository.transaction(async (r) => {
        const reg = await r.lockOwned(registrationId, ctx.userId);
        if (!reg) throw notFound();
        assertRoleFor(ctx, reg.registrantType);
        if (reg.registrantType !== 'PLAYER' && body.guestCount !== undefined) {
          throw new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', [
            { path: 'guestCount', message: 'is only for player registrations' },
          ]);
        }
        if (reg.status !== 'DRAFT') {
          throw AppError.conflict(
            'REGISTRATION_NOT_EDITABLE',
            `A ${reg.status} registration can no longer be edited`,
          );
        }
        if (body.teamId) {
          const event = await r.lockEvent(reg.eventId);
          const problem = event ? teamProblem(await r.findTeam(body.teamId), event) : null;
          if (!event || problem) {
            throw new AppError(422, 'TEAM_NOT_AVAILABLE', 'The selected team cannot be used', [
              problem ?? { path: 'teamId', message: 'is not a team of this event' },
            ]);
          }
        }
        // Re-saving the team the draft already has is not a new claim on a place.
        if (body.teamId && body.teamId !== reg.teamId) {
          await assertTeamHasRoom(r, body.teamId, reg.registrantType, false);
        }
        await r.updateDraft(registrationId, { teamId: body.teamId, guestCount: body.guestCount });
      });
      return view(ctx, registrationId);
    },

    async submit(ctx, registrationId, meta) {
      await repository.transaction(async (r) => {
        // The row lock makes concurrent submits take turns; the loser sees SUBMITTED and gets 409.
        const reg = await r.lockOwned(registrationId, ctx.userId);
        if (!reg) throw notFound();
        assertRoleFor(ctx, reg.registrantType);
        assertTransition(reg.status, 'SUBMITTED', reg.registrantType);

        const event = await r.lockEvent(reg.eventId);
        if (!event || event.status !== 'PUBLISHED') {
          throw AppError.conflict('EVENT_NOT_OPEN', 'This event is not open for registration');
        }

        const issues: ErrorDetail[] = [];
        if (reg.playerId) {
          // A player needs a team and, under 18, a guardian. A coach or staff member needs neither: a coach creates
          // their team once approved, and staff are attached to a team only if they came through an invite.
          if (!reg.teamId) {
            issues.push({ path: 'teamId', message: 'a team must be selected' });
          } else {
            const problem = teamProblem(await r.findTeam(reg.teamId), event);
            if (problem) issues.push(problem);
          }
          const dateOfBirth = await r.lockPlayerDateOfBirth(reg.playerId);
          if (
            dateOfBirth &&
            isMinorForEvent(dateOfBirth, event.startsAt, event.timezone) &&
            (await r.countGuardians(reg.playerId)) === 0
          ) {
            issues.push({
              path: 'guardians',
              message: 'a parent or guardian is required for a player under 18',
            });
          }
        } else if (reg.teamId) {
          const problem = teamProblem(await r.findTeam(reg.teamId), event);
          if (problem) issues.push(problem);
        }
        if (issues.length > 0) {
          throw new AppError(422, 'REGISTRATION_INCOMPLETE', 'Registration is incomplete', issues);
        }

        // The binding limit check: it locks the team row, so concurrent submissions cannot all squeeze into the last place.
        if (reg.teamId) await assertTeamHasRoom(r, reg.teamId, reg.registrantType, true);

        // The fee is fixed at submission: what the family saw is what payment will ask for.
        await r.markSubmitted(reg.id, {
          feeCents: reg.registrantType === 'PLAYER' ? event.feeCents : 0,
          currency: event.currency,
        });
        await r.insertHistory({
          registrationId: reg.id,
          from: reg.status,
          to: 'SUBMITTED',
          changedBy: ctx.userId,
        });
        await r.audit({
          action: 'REGISTRATION_SUBMITTED',
          actorUserId: ctx.userId,
          entityId: reg.id,
          metadata: { eventId: event.id, registrantType: reg.registrantType },
          meta,
        });
      });
      return view(ctx, registrationId);
    },

    async getStatus(ctx, registrationId) {
      const registration = await view(ctx, registrationId);
      return {
        registrationId,
        status: registration.status,
        history: await repository.listHistory(registrationId),
      };
    },
  };
}
