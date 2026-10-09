import type { Database } from '../../infrastructure/database/database';
import type { EventDto, TeamDto } from './types';

export interface CatalogRepository {
  /** PUBLISHED events, soonest first. */
  listOpenEvents(): Promise<EventDto[]>;
  /** A PUBLISHED or CLOSED event; a DRAFT does not exist as far as families are concerned. */
  findVisibleEvent(eventId: string): Promise<EventDto | null>;
  /** ACTIVE teams of the event, by division then name. */
  listActiveTeams(eventId: string): Promise<TeamDto[]>;
  /** An ACTIVE team of a visible event. */
  findVisibleTeam(teamId: string): Promise<{ team: TeamDto; event: EventDto } | null>;
  /** An ACTIVE team of a PUBLISHED event with this invite code. */
  findOpenTeamByInviteCode(inviteCode: string): Promise<{ team: TeamDto; event: EventDto } | null>;
}

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  location: string;
  timezone: string;
  starts_at: Date;
  ends_at: Date;
  registration_fee_cents: number;
  currency: string;
  status: 'PUBLISHED' | 'CLOSED';
}

interface TeamRow {
  team_id: string;
  team_event_id: string;
  team_name: string;
  team_club: string;
  team_division: string;
}

const EVENT_COLUMNS = `e.id, e.name, e.description, e.location, e.timezone, e.starts_at, e.ends_at,
                       e.registration_fee_cents, e.currency, e.status`;
const TEAM_COLUMNS = `t.id as team_id, t.event_id as team_event_id, t.name as team_name,
                      t.club as team_club, t.division as team_division`;

const toEvent = (r: EventRow): EventDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  location: r.location,
  timezone: r.timezone,
  startsAt: r.starts_at.toISOString(),
  endsAt: r.ends_at.toISOString(),
  fee: { amountCents: r.registration_fee_cents, currency: r.currency },
  status: r.status,
  registrationOpen: r.status === 'PUBLISHED',
});

const toTeam = (r: TeamRow): TeamDto => ({
  id: r.team_id,
  eventId: r.team_event_id,
  name: r.team_name,
  club: r.team_club,
  division: r.team_division,
});

export function createCatalogRepository(db: Database): CatalogRepository {
  return {
    async listOpenEvents() {
      const { rows } = await db.query<EventRow>(
        `select ${EVENT_COLUMNS} from public.events e
          where e.status = 'PUBLISHED'
          order by e.starts_at, e.id
          limit 100`,
      );
      return rows.map(toEvent);
    },

    async findVisibleEvent(eventId) {
      const { rows } = await db.query<EventRow>(
        `select ${EVENT_COLUMNS} from public.events e
          where e.id = $1 and e.status in ('PUBLISHED', 'CLOSED')`,
        [eventId],
      );
      return rows[0] ? toEvent(rows[0]) : null;
    },

    async listActiveTeams(eventId) {
      const { rows } = await db.query<TeamRow>(
        `select ${TEAM_COLUMNS} from public.teams t
          where t.event_id = $1 and t.status = 'ACTIVE'
          order by t.division, lower(t.name), t.id`,
        [eventId],
      );
      return rows.map(toTeam);
    },

    async findVisibleTeam(teamId) {
      const { rows } = await db.query<EventRow & TeamRow>(
        `select ${EVENT_COLUMNS}, ${TEAM_COLUMNS}
           from public.teams t join public.events e on e.id = t.event_id
          where t.id = $1 and t.status = 'ACTIVE' and e.status in ('PUBLISHED', 'CLOSED')`,
        [teamId],
      );
      return rows[0] ? { team: toTeam(rows[0]), event: toEvent(rows[0]) } : null;
    },

    async findOpenTeamByInviteCode(inviteCode) {
      const { rows } = await db.query<EventRow & TeamRow>(
        `select ${EVENT_COLUMNS}, ${TEAM_COLUMNS}
           from public.teams t join public.events e on e.id = t.event_id
          where t.invite_code = $1 and t.status = 'ACTIVE' and e.status = 'PUBLISHED'`,
        [inviteCode],
      );
      return rows[0] ? { team: toTeam(rows[0]), event: toEvent(rows[0]) } : null;
    },
  };
}
