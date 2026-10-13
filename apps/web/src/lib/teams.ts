import type { TeamInvite } from './types';

/** A team a registrant can pick (id, name, club). */
export interface TeamRecord {
  teamId: string;
  teamName: string;
  club: string;
}

export interface InviteResolution {
  invite: TeamInvite | null;
  /** `needs_signin`: a player invite can only be checked against the server once the visitor is signed in. */
  status: 'none' | 'valid' | 'unknown_team' | 'invalid_code' | 'team_disabled' | 'needs_signin';
}

/** Pure URL builder for a team+invite-code link (used for both admin-generated and coach-self-created team links). */
export function generateInviteLink(teamId: string, inviteCode: string, role: 'player' | 'coach' | 'staff' = 'player'): string {
  if (typeof window === 'undefined') return `/register/${role}?teamId=${teamId}&inviteCode=${inviteCode}`;
  const url = new URL(`/register/${role}`, window.location.origin);
  url.searchParams.set('teamId', teamId);
  url.searchParams.set('inviteCode', inviteCode);
  return url.toString();
}

/**
 * Builds a smart tournament registration link. Passing teamId+role skips both selection steps;
 * passing neither yields the common "pick your team, then your role" link.
 */
export function generateTournamentLink(params: { tournamentId: string; teamId?: string; inviteCode?: string; role?: 'player' | 'coach' | 'staff' }): string {
  const path = `/tournament/${params.tournamentId}/register`;
  const search = new URLSearchParams();
  if (params.teamId) search.set('teamId', params.teamId);
  if (params.inviteCode) search.set('inviteCode', params.inviteCode);
  if (params.role) search.set('role', params.role);
  const qs = search.toString();
  const relative = qs ? `${path}?${qs}` : path;
  if (typeof window === 'undefined') return relative;
  return new URL(relative, window.location.origin).toString();
}
