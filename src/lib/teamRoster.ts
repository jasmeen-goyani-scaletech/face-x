import type { RosterEntry } from './seed';

/**
 * The only people a coach is ever shown for their team: role "player", on exactly this team (by id, never by name).
 * Staff, team managers, head / assistant coaches, and players on any other team, including one that shares the team's
 * name, are excluded. An empty or missing team id matches nobody, so a coach with no team sees no one.
 */
export function playersOfTeam(roster: RosterEntry[], teamId: string): RosterEntry[] {
  if (!teamId) return [];
  return roster.filter((r) => r.role === 'player' && r.teamId === teamId);
}
