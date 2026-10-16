import { AppError } from '../../shared/errors/app-error';
import type { AdminRepository, AdminTeam } from '../admin';
import type { AuthContext } from '../auth/types';
import { APPROVED_PERSONNEL_STATUSES } from '../events';
import { strongest, type TeamAccessRepository } from './repository';
import type { AccessibleTeam, TeamAccessVia, TeamMemberDto } from './types';

/**
 * Team-scoped access for coaches and staff (and admins), enforced here and not in the UI.
 *
 * - ADMIN: every team of the organization that owns the team's event (the existing admin rule).
 * - COACH / STAFF: only teams they were assigned (team_assignments) AND for whose event they hold an approved registration of
 *   their own kind, with event-day access not switched off. Holding the role alone, or the assignment alone, grants nothing.
 *
 * A team the caller may not reach is "not found", never "forbidden", so team ids are not confirmed to exist.
 */
export interface TeamAccessService {
  /** The teams the caller holds as a coach or staff member (an admin sees the organization's teams through the admin API). */
  listTeams(ctx: AuthContext): Promise<AccessibleTeam[]>;
  getTeam(ctx: AuthContext, teamId: string): Promise<AccessibleTeam>;
  /** The players on the team, for its assigned coach or staff member only (not admins): names, contact, readiness. Never documents, payments or email addresses. */
  roster(ctx: AuthContext, teamId: string): Promise<TeamMemberDto[]>;
}

const notFound = () => AppError.notFound('TEAM_NOT_FOUND', 'Team not found');

export function createTeamAccessService(
  access: TeamAccessRepository,
  admin: Pick<AdminRepository, 'findTeam' | 'findEvent' | 'roster'>,
): TeamAccessService {
  const personnelRoles = (ctx: AuthContext) =>
    ctx.roles.filter((r): r is 'COACH' | 'STAFF' => r === 'COACH' || r === 'STAFF');

  async function present(team: AdminTeam, via: TeamAccessVia): Promise<AccessibleTeam> {
    const e = await admin.findEvent(team.eventId);
    if (!e) throw notFound();
    return {
      id: team.id,
      name: team.name,
      club: team.club,
      division: team.division,
      status: team.status,
      event: { id: e.id, name: e.name, startsAt: e.startsAt, endsAt: e.endsAt, timezone: e.timezone },
      via,
      limits: team.limits,
      inviteCode: via === 'STAFF' ? null : team.inviteCode,
    };
  }

  /** The caller's access to one team, or a 404. */
  async function resolve(ctx: AuthContext, teamId: string) {
    const found = await admin.findTeam(teamId);
    if (!found) throw notFound();
    let via: TeamAccessVia | null = null;
    if (
      ctx.roles.includes('ADMIN') &&
      ctx.organizationId !== null &&
      ctx.organizationId === found.organizationId
    ) {
      via = 'ADMIN';
    }
    const grants = await access.findGrants(
      ctx.userId,
      personnelRoles(ctx),
      APPROVED_PERSONNEL_STATUSES,
      teamId,
    );
    for (const g of grants) via = via ? strongest(via, g.via) : g.via;
    if (!via) throw notFound();
    return { team: found.team, via };
  }

  return {
    async listTeams(ctx) {
      const grants = await access.findGrants(
        ctx.userId,
        personnelRoles(ctx),
        APPROVED_PERSONNEL_STATUSES,
      );
      const vias = new Map<string, TeamAccessVia>();
      for (const g of grants) vias.set(g.teamId, strongest(vias.get(g.teamId) ?? g.via, g.via));
      const out: AccessibleTeam[] = [];
      for (const [teamId, via] of vias) {
        const found = await admin.findTeam(teamId);
        if (found) out.push(await present(found.team, via));
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getTeam(ctx, teamId) {
      const { team, via } = await resolve(ctx, teamId);
      return present(team, via);
    },

    async roster(ctx, teamId) {
      const { team } = await resolve(ctx, teamId);
      // The roster is for the coach or staff member assigned to the team. Being an admin of the organization is not enough.
      const grants = await access.findGrants(
        ctx.userId,
        personnelRoles(ctx),
        APPROVED_PERSONNEL_STATUSES,
        teamId,
      );
      if (grants.length === 0) throw notFound();
      const everyone = await admin.roster(team.eventId, team.id);
      return everyone
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
