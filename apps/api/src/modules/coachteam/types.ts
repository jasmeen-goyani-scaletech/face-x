import type { RegistrationStatus } from '../registrations/transitions';

/** A coach's team. The invite code is theirs to share: it is how players and staff register straight onto the team. */
export interface CoachTeamDto {
  id: string;
  name: string;
  club: string;
  division: string;
  inviteCode: string;
  status: 'ACTIVE' | 'DISABLED';
}

export interface CoachTeamView {
  registrationId: string;
  registrationStatus: RegistrationStatus;
  /** An admin switched this coach's event-day access off. */
  eventAccessDisabled: boolean;
  event: { id: string; name: string; startsAt: string; endsAt: string; timezone: string };
  /** Null until the coach joins a team (through an invite) or creates one. */
  team: CoachTeamDto | null;
  /** The coach is approved and has no team yet, so they may create one. */
  canCreateTeam: boolean;
  /** The coach is cleared for the event, so their team's roster is open to them. */
  rosterOpen: boolean;
}

/** What a coach sees of someone on their team: enough to know who they are and how to reach them, no documents or payments. */
export interface TeamMemberDto {
  registrationId: string;
  registrationNumber: string;
  registrantType: 'PLAYER' | 'STAFF';
  firstName: string;
  lastName: string;
  /** Players only (\`YYYY-MM-DD\`). */
  dateOfBirth: string | null;
  phone: string | null;
  /** A player's primary guardian. */
  guardianName: string | null;
  guardianPhone: string | null;
  /** Cleared for the event (READY_FOR_EVENT). */
  approved: boolean;
  eventAccessDisabled: boolean;
  /** What still stands between this person and the event, in plain words. */
  flags: string[];
  checkedInAt: string | null;
}
