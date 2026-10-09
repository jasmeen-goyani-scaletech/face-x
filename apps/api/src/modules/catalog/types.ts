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

/** Never includes the invite code: it is a secret that lets a coach join the team. */
export interface TeamDto {
  id: string;
  eventId: string;
  name: string;
  club: string;
  division: string;
}

export interface TeamWithEventDto {
  team: TeamDto;
  event: EventDto;
}
