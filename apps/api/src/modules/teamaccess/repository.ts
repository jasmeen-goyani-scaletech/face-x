import type { Database } from '../../infrastructure/database/database';
import type { TeamAccessVia } from './types';

export interface TeamGrant {
  teamId: string;
  eventId: string;
  via: 'COACH' | 'STAFF';
}

export interface TeamAccessRepository {
  /**
   * The teams this user was assigned as a coach/staff member (`profileTypes`: the roles they hold), where they ALSO hold an
   * approved registration of that kind for the team's event whose event-day access is not switched off. An assignment alone
   * grants nothing, and neither does a role: both must be there. `teamId` narrows the answer to one team.
   */
  findGrants(
    userId: string,
    profileTypes: readonly ('COACH' | 'STAFF')[],
    approvedStatuses: readonly string[],
    teamId?: string,
  ): Promise<TeamGrant[]>;
}

/** The strongest of two ways to reach the same team. */
export const strongest = (a: TeamAccessVia, b: TeamAccessVia): TeamAccessVia =>
  a === 'ADMIN' || b === 'ADMIN' ? 'ADMIN' : a === 'COACH' || b === 'COACH' ? 'COACH' : 'STAFF';

export function createTeamAccessRepository(db: Database): TeamAccessRepository {
  return {
    async findGrants(userId, profileTypes, approvedStatuses, teamId) {
      if (profileTypes.length === 0) return [];
      const { rows } = await db.query<{
        team_id: string;
        event_id: string;
        profile_type: 'COACH' | 'STAFF';
      }>(
        `select t.id as team_id, t.event_id, sp.profile_type
           from public.team_assignments a
           join public.staff_profiles sp on sp.id = a.staff_profile_id
           join public.teams t on t.id = a.team_id
           join public.registrations r
             on r.staff_profile_id = sp.id and r.event_id = t.event_id and r.registrant_type = sp.profile_type
          where sp.user_id = $1
            and sp.profile_type = any($2::text[])
            and r.status = any($3::text[])
            and not r.event_access_disabled
            and ($4::uuid is null or t.id = $4::uuid)`,
        [userId, [...profileTypes], [...approvedStatuses], teamId ?? null],
      );
      return rows.map((r) => ({ teamId: r.team_id, eventId: r.event_id, via: r.profile_type }));
    },
  };
}
