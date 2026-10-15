export interface EventDto {
  id: string;
  name: string;
  description: string | null;
  location: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  fee: { amountCents: number; currency: string };
  status: 'PUBLISHED' | 'CLOSED';
  /** Only a PUBLISHED event takes registrations. */
  registrationOpen: boolean;
}

/** One page of a list, with how many rows there are across every page. */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Never includes the invite code: it is a secret that lets a coach join the team. */
export interface TeamDto {
  id: string;
  eventId: string;
  name: string;
  club: string;
  division: string;
  /** Whether the team has reached its registration limit for each kind of registrant (a yes/no only: counts stay private). */
  full: { player: boolean; coach: boolean; staff: boolean };
}

export interface TeamWithEventDto {
  team: TeamDto;
  event: EventDto;
}
