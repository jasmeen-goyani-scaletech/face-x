export type TournamentStatus = 'draft' | 'published' | 'closed';

export interface Tournament {
  id: string;
  name: string;
  date: string; // yyyy-mm-dd
  time: string; // e.g. "5:30 PM – 8:00 PM"
  location: string;
  status: TournamentStatus;
  createdAt: number;
}

export type TeamStatus = 'active' | 'disabled';

export interface Team {
  id: string;
  tournamentId: string;
  teamName: string;
  club: string;
  division: string;
  inviteCode: string;
  status: TeamStatus;
  createdAt: number;
}
