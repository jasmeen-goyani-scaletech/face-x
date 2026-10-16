import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import type { AdminRepository } from '../admin';
import type { AuthContext } from '../auth/types';
import { APPROVED_PERSONNEL_STATUSES } from '../events';
import type { CoachRegistrationRow, CoachTeamRepository } from './repository';
import type { CreateCoachTeamBody } from './schema';
import type { CoachTeamView, TeamMemberDto } from './types';

/**
 * A coach's team: see it, create it once approved, and read the roster of the people registered to it.
 *
 * Everything hangs off the coach's OWN coach registration; anyone else's (or a player's) is "not found". Creating a team needs
 * an approved registration (VERIFIED or READY_FOR_EVENT) with no team yet, and attaches the new team to that registration.
 * The roster is open only while the coach is cleared for the event (READY_FOR_EVENT, access not switched off), and shows
 * players and staff of this team only: never coaches, never another team, never documents, payments or email addresses.
 */
export interface CoachTeamService {
  get(ctx: AuthContext, registrationId: string): Promise<CoachTeamView>;
  create(
    ctx: AuthContext,
    registrationId: string,
    body: CreateCoachTeamBody,
    meta: RequestMeta,
  ): Promise<CoachTeamView>;
  roster(ctx: AuthContext, registrationId: string): Promise<TeamMemberDto[]>;
}

const notFound = () => AppError.notFound('REGISTRATION_NOT_FOUND', 'Registration not found');
const approved = (status: string) => APPROVED_PERSONNEL_STATUSES.includes(status);

export function createCoachTeamService(
  repository: CoachTeamRepository,
  admin: Pick<AdminRepository, 'roster'>,
): CoachTeamService {
  async function view(
    reg: CoachRegistrationRow,
    repo: CoachTeamRepository,
  ): Promise<CoachTeamView> {
    const team = reg.teamId ? await repo.findTeam(reg.teamId) : null;
    return {
      registrationId: reg.registrationId,
      registrationStatus: reg.status,
      eventAccessDisabled: reg.eventAccessDisabled,
      event: {
        id: reg.event.id,
        name: reg.event.name,
        startsAt: reg.event.startsAt.toISOString(),
        endsAt: reg.event.endsAt.toISOString(),
        timezone: reg.event.timezone,
      },
      team,
      canCreateTeam: approved(reg.status) && team === null,
      rosterOpen: reg.status === 'READY_FOR_EVENT' && !reg.eventAccessDisabled,
    };
  }

  async function own(ctx: AuthContext, registrationId: string, lock = false) {
    return repository.findOwnCoachRegistration(registrationId, ctx.userId, lock);
  }

  return {
    async get(ctx, registrationId) {
      const reg = await own(ctx, registrationId);
      if (!reg) throw notFound();
      return view(reg, repository);
    },

    async create(ctx, registrationId, body, meta) {
      return repository.transaction(async (r) => {
        const reg = await r.findOwnCoachRegistration(registrationId, ctx.userId, true);
        if (!reg) throw notFound();
        if (!approved(reg.status)) {
          throw AppError.conflict(
            'REGISTRATION_NOT_APPROVED',
            'A team can be created once your registration is approved',
          );
        }
        if (reg.teamId) {
          throw AppError.conflict('COACH_ALREADY_HAS_TEAM', 'This coach already has a team');
        }
        const teamId = await r.insertTeam({
          eventId: reg.event.id,
          coachProfileId: reg.staffProfileId,
          name: body.name,
          // The form only asks for a name: the team is its own club until the league says otherwise.
          club: body.club ?? body.name,
          division: body.division ?? 'Open',
        });
        if (!teamId) {
          throw AppError.conflict(
            'TEAM_ALREADY_EXISTS',
            'This event already has a team with that name',
          );
        }
        await r.assignTeam(reg.registrationId, teamId);
        await r.audit({ actorUserId: ctx.userId, teamId, registrationId, meta });
        const fresh = await r.findOwnCoachRegistration(registrationId, ctx.userId);
        return view(fresh!, r);
      });
    },

    async roster(ctx, registrationId) {
      const reg = await own(ctx, registrationId);
      if (!reg) throw notFound();
      if (!reg.teamId) {
        throw AppError.conflict('COACH_HAS_NO_TEAM', 'You are not on a team yet');
      }
      if (reg.status !== 'READY_FOR_EVENT' || reg.eventAccessDisabled) {
        throw AppError.forbidden(
          'Your team opens once an organizer has approved everything',
          'TEAM_ROSTER_NOT_AVAILABLE',
        );
      }
      const everyone = await admin.roster(reg.event.id, reg.teamId);
      return everyone
        // Players only: staff details are for admins.
        .filter((m): m is typeof m & { registrantType: 'PLAYER' } => m.registrantType === 'PLAYER')
        .map((m) => ({
          registrationId: m.registrationId,
          registrationNumber: m.registrationNumber,
          registrantType: m.registrantType,
          firstName: m.firstName,
          lastName: m.lastName,
          dateOfBirth: m.dateOfBirth,
          phone: m.phone,
          guardianName: m.guardianName,
          guardianPhone: m.guardianPhone,
          approved: m.approved,
          eventAccessDisabled: m.eventAccessDisabled,
          flags: m.flags,
          checkedInAt: m.checkedInAt,
        }));
    },
  };
}
