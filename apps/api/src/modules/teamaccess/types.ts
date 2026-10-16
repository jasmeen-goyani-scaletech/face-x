import type { AdminTeam } from '../admin';
import type { TeamMemberDto } from '../coachteam';

/** How the caller reaches a team: as an admin of its organization, or through an assignment as a coach or staff member. */
export type TeamAccessVia = 'ADMIN' | 'COACH' | 'STAFF';

/** A team the caller may work with, and the event it belongs to. */
export interface AccessibleTeam {
  id: string;
  name: string;
  club: string;
  division: string;
  status: 'ACTIVE' | 'DISABLED';
  event: { id: string; name: string; startsAt: string; endsAt: string; timezone: string };
  via: TeamAccessVia;
  /** Registrations holding a place, by kind, with the configured limits. */
  limits: AdminTeam['limits'];
  /** Only for coaches and admins: it is how players and staff join. Never shown to a staff member. */
  inviteCode: string | null;
}

export type { TeamMemberDto };
