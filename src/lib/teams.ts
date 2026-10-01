import type { TeamInvite } from './types';
import { getTeam, getTournament, readTeams } from './data/localStore';

export interface TeamRecord {
  teamId: string;
  teamName: string;
  club: string;
}

/** Active admin-managed teams, in the shape the registration team-picker and event-day roster expect. */
export function getTeamDirectory(): TeamRecord[] {
  return readTeams()
    .filter((t) => t.status === 'active')
    .map((t) => ({ teamId: t.id, teamName: t.teamName, club: t.club }));
}

export interface InviteResolution {
  invite: TeamInvite | null;
  status: 'none' | 'valid' | 'unknown_team' | 'invalid_code' | 'team_disabled';
}

/**
 * Validates a team+invite-code pair against the admin-managed team store. Also used for
 * ad-hoc coach-created teams' invite codes — those aren't in the store, so they fall through
 * to 'unknown_team' here exactly as they did before this store existed (a pre-existing gap,
 * not introduced by this change).
 */
export function resolveInvite(teamId: string | null, inviteCode: string | null): InviteResolution {
  if (!teamId && !inviteCode) return { invite: null, status: 'none' };
  const team = getTeam(teamId ?? '');
  if (!team) return { invite: null, status: 'unknown_team' };
  if (team.status === 'disabled') return { invite: null, status: 'team_disabled' };
  if (!inviteCode || team.inviteCode !== inviteCode) {
    return { invite: null, status: 'invalid_code' };
  }
  return { invite: { teamId: team.id, inviteCode, teamName: team.teamName, club: team.club }, status: 'valid' };
}

/** Pure URL builder for a team+invite-code link (used for both admin-generated and coach-self-created team links). */
export function generateInviteLink(teamId: string, inviteCode: string, role: 'player' | 'coach' | 'staff' = 'player'): string {
  if (typeof window === 'undefined') return `/register/${role}?teamId=${teamId}&inviteCode=${inviteCode}`;
  const url = new URL(`/register/${role}`, window.location.origin);
  url.searchParams.set('teamId', teamId);
  url.searchParams.set('inviteCode', inviteCode);
  return url.toString();
}

export function resolveTournament(tournamentId: string) {
  return getTournament(tournamentId);
}

/** Resolves a team by id alone (no invite code) — for admin-generated tournament links, where the
 * team id embedded in the URL is itself the invite; returns null if unknown or disabled. */
export function resolveTeamById(teamId: string): TeamInvite | null {
  const team = getTeam(teamId);
  if (!team || team.status === 'disabled') return null;
  return { teamId: team.id, inviteCode: team.inviteCode, teamName: team.teamName, club: team.club };
}

/**
 * Builds a smart tournament registration link. Passing teamId+role skips both selection steps;
 * passing neither yields the common "pick your team, then your role" link.
 */
export function generateTournamentLink(params: { tournamentId: string; teamId?: string; role?: 'player' | 'coach' | 'staff' }): string {
  const path = `/tournament/${params.tournamentId}/register`;
  const search = new URLSearchParams();
  if (params.teamId) search.set('teamId', params.teamId);
  if (params.role) search.set('role', params.role);
  const qs = search.toString();
  const relative = qs ? `${path}?${qs}` : path;
  if (typeof window === 'undefined') return relative;
  return new URL(relative, window.location.origin).toString();
}
