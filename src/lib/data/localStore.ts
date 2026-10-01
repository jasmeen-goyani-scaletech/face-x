import { genId } from '@/lib/format';
import type { Team, Tournament } from './types';

/**
 * Single-browser data source for Tournament/Team admin CRUD. No shared backend exists yet — this
 * is deliberately isolated behind localStore.ts + client.ts so a real API can replace it later
 * without touching call sites (see client.ts's DataClient interface).
 */

const TOURNAMENTS_KEY = 'facex-admin-tournaments';
const TEAMS_KEY = 'facex-admin-teams';

const SEED_TOURNAMENT_ID = 'seed-fall-tackle-kickoff';

function seedTournaments(): Tournament[] {
  return [
    {
      id: SEED_TOURNAMENT_ID,
      name: 'Fall Tackle Kickoff Night',
      date: '2026-11-14',
      time: '5:30 PM – 8:00 PM',
      location: 'Roosevelt Community Field, 4820 Sequoia Ave, Sacramento, CA',
      status: 'published',
      createdAt: Date.now()
    }
  ];
}

// Preserves the teamId/inviteCode values the app already shipped with, so any existing invite
// link (?teamId=...&inviteCode=...) keeps resolving after this store replaces the old hardcoded
// TEAM_DIRECTORY in teams.ts.
function seedTeams(): Team[] {
  return [
    {
      id: 'CAL-LA-GALAXY-U16',
      tournamentId: SEED_TOURNAMENT_ID,
      teamName: 'LA Galaxy Youth U16',
      club: 'LA Galaxy Soccer Club',
      division: 'U16',
      inviteCode: 'COACH-101',
      status: 'active',
      createdAt: Date.now()
    },
    {
      id: 'CAL-SAC-RIVERCATS-U14',
      tournamentId: SEED_TOURNAMENT_ID,
      teamName: 'Sacramento River Cats U14',
      club: 'Sacramento Youth Football League',
      division: 'U14',
      inviteCode: 'COACH-204',
      status: 'active',
      createdAt: Date.now()
    },
    {
      id: 'CAL-SD-WAVE-U12',
      tournamentId: SEED_TOURNAMENT_ID,
      teamName: 'San Diego Wave U12',
      club: 'San Diego Coastal Athletics',
      division: 'U12',
      inviteCode: 'COACH-317',
      status: 'active',
      createdAt: Date.now()
    }
  ];
}

function readList<T>(key: string, seed: () => T[]): T[] {
  if (typeof window === 'undefined') return seed();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      const initial = seed();
      window.localStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Stored value from an older/corrupt schema — reseed rather than crash every consumer.
      const initial = seed();
      window.localStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }
    return parsed as T[];
  } catch {
    return seed();
  }
}

function writeList<T>(key: string, list: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // ignore quota/blocked storage errors — in-memory caller state still works for this render
  }
}

export function readTournaments(): Tournament[] {
  return readList(TOURNAMENTS_KEY, seedTournaments);
}

export function readTeams(): Team[] {
  return readList(TEAMS_KEY, seedTeams);
}

export function getTournament(id: string): Tournament | null {
  return readTournaments().find((t) => t.id === id) ?? null;
}

export function getTeam(id: string): Team | null {
  return readTeams().find((t) => t.id === id) ?? null;
}

export function listTeamsByTournament(tournamentId: string): Team[] {
  return readTeams().filter((t) => t.tournamentId === tournamentId);
}

export function createTournament(input: Omit<Tournament, 'id' | 'createdAt'>): Tournament {
  const tournament: Tournament = { ...input, id: genId('TOUR'), createdAt: Date.now() };
  writeList(TOURNAMENTS_KEY, [...readTournaments(), tournament]);
  return tournament;
}

export function updateTournament(id: string, patch: Partial<Tournament>): Tournament | null {
  const list = readTournaments();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated = { ...list[idx], ...patch, id };
  const next = [...list];
  next[idx] = updated;
  writeList(TOURNAMENTS_KEY, next);
  return updated;
}

export function removeTournament(id: string) {
  writeList(
    TOURNAMENTS_KEY,
    readTournaments().filter((t) => t.id !== id)
  );
}

export function createTeam(input: Omit<Team, 'id' | 'createdAt'>): Team {
  const team: Team = { ...input, id: genId('TEAM'), createdAt: Date.now() };
  writeList(TEAMS_KEY, [...readTeams(), team]);
  return team;
}

export function updateTeam(id: string, patch: Partial<Team>): Team | null {
  const list = readTeams();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated = { ...list[idx], ...patch, id };
  const next = [...list];
  next[idx] = updated;
  writeList(TEAMS_KEY, next);
  return updated;
}

export function removeTeam(id: string) {
  writeList(
    TEAMS_KEY,
    readTeams().filter((t) => t.id !== id)
  );
}
