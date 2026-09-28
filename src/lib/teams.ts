import type { TeamInvite } from './types';

export interface TeamRecord {
  teamId: string;
  teamName: string;
  club: string;
  validInviteCodes: string[];
}

// Demo team directory. In production this would be a real lookup (API/DB) keyed by teamId.
export const TEAM_DIRECTORY: TeamRecord[] = [
  { teamId: 'CAL-LA-GALAXY-U16', teamName: 'LA Galaxy Youth U16', club: 'LA Galaxy Soccer Club', validInviteCodes: ['COACH-101'] },
  { teamId: 'CAL-SAC-RIVERCATS-U14', teamName: 'Sacramento River Cats U14', club: 'Sacramento Youth Football League', validInviteCodes: ['COACH-204'] },
  { teamId: 'CAL-SD-WAVE-U12', teamName: 'San Diego Wave U12', club: 'San Diego Coastal Athletics', validInviteCodes: ['COACH-317'] }
];

export interface InviteResolution {
  invite: TeamInvite | null;
  status: 'none' | 'valid' | 'unknown_team' | 'invalid_code';
}

export function resolveInvite(teamId: string | null, inviteCode: string | null): InviteResolution {
  if (!teamId && !inviteCode) return { invite: null, status: 'none' };
  const team = TEAM_DIRECTORY.find((t) => t.teamId === teamId);
  if (!team) return { invite: null, status: 'unknown_team' };
  if (!inviteCode || !team.validInviteCodes.includes(inviteCode)) {
    return { invite: null, status: 'invalid_code' };
  }
  return {
    invite: { teamId: team.teamId, inviteCode, teamName: team.teamName, club: team.club },
    status: 'valid'
  };
}

export function generateInviteLink(teamId: string, inviteCode: string): string {
  if (typeof window === 'undefined') return `/register/player?teamId=${teamId}&inviteCode=${inviteCode}`;
  const url = new URL('/register/player', window.location.origin);
  url.searchParams.set('teamId', teamId);
  url.searchParams.set('inviteCode', inviteCode);
  return url.toString();
}
