import type { Team, Tournament } from './types';
import * as store from './localStore';

/**
 * The swap boundary: every admin CRUD screen calls getDataClient() rather than localStore
 * directly. Methods are Promise-based even though today's implementation resolves instantly, so
 * callers already handle a pending state — swapping in a real HTTP-backed client later (once a
 * shared backend exists) means implementing this same interface, not rewriting every screen.
 */
export interface DataClient {
  tournaments: {
    list(): Promise<Tournament[]>;
    get(id: string): Promise<Tournament | null>;
    create(input: Omit<Tournament, 'id' | 'createdAt'>): Promise<Tournament>;
    update(id: string, patch: Partial<Tournament>): Promise<Tournament | null>;
    remove(id: string): Promise<void>;
  };
  teams: {
    list(): Promise<Team[]>;
    listByTournament(tournamentId: string): Promise<Team[]>;
    get(id: string): Promise<Team | null>;
    create(input: Omit<Team, 'id' | 'createdAt'>): Promise<Team>;
    update(id: string, patch: Partial<Team>): Promise<Team | null>;
    remove(id: string): Promise<void>;
  };
}

const localDataClient: DataClient = {
  tournaments: {
    list: async () => store.readTournaments(),
    get: async (id) => store.getTournament(id),
    create: async (input) => store.createTournament(input),
    update: async (id, patch) => store.updateTournament(id, patch),
    remove: async (id) => store.removeTournament(id)
  },
  teams: {
    list: async () => store.readTeams(),
    listByTournament: async (tournamentId) => store.listTeamsByTournament(tournamentId),
    get: async (id) => store.getTeam(id),
    create: async (input) => store.createTeam(input),
    update: async (id, patch) => store.updateTeam(id, patch),
    remove: async (id) => store.removeTeam(id)
  }
};

export function getDataClient(): DataClient {
  return localDataClient;
}
