import type { Database, Queryable } from '../../infrastructure/database/database';
import type { RequestMeta } from '../../shared/http/request-meta';
import { recordAudit } from '../audit';
import type { RegistrationStatus } from '../registrations/transitions';
import type { CoachTeamDto } from './types';

export interface CoachRegistrationRow {
  registrationId: string;
  status: RegistrationStatus;
  eventAccessDisabled: boolean;
  staffProfileId: string;
  teamId: string | null;
  event: { id: string; name: string; startsAt: Date; endsAt: Date; timezone: string };
}

export interface CoachTeamRepository {
  transaction<T>(fn: (repo: CoachTeamRepository) => Promise<T>): Promise<T>;
  /** The caller's own COACH registration (null for anyone else's, a player's or a staff member's). Optionally row-locked. */
  findOwnCoachRegistration(
    registrationId: string,
    userId: string,
    lock?: boolean,
  ): Promise<CoachRegistrationRow | null>;
  findTeam(teamId: string): Promise<CoachTeamDto | null>;
  /** Null when the event already has a team with this name and club. */
  insertTeam(input: {
    eventId: string;
    coachProfileId: string;
    name: string;
    club: string;
    division: string;
  }): Promise<string | null>;
  assignTeam(registrationId: string, teamId: string): Promise<void>;
  audit(entry: {
    actorUserId: string;
    teamId: string;
    registrationId: string;
    meta: RequestMeta;
  }): Promise<void>;
}

function build(q: Queryable, run: CoachTeamRepository['transaction']): CoachTeamRepository {
  return {
    transaction: run,

    async findOwnCoachRegistration(registrationId, userId, lock = false) {
      const { rows } = await q.query<{
        id: string;
        status: RegistrationStatus;
        event_access_disabled: boolean;
        staff_profile_id: string;
        team_id: string | null;
        event_id: string;
        event_name: string;
        starts_at: Date;
        ends_at: Date;
        timezone: string;
      }>(
        `select r.id, r.status, r.event_access_disabled, r.staff_profile_id, r.team_id,
                e.id as event_id, e.name as event_name, e.starts_at, e.ends_at, e.timezone
           from public.registrations r
           join public.staff_profiles sp on sp.id = r.staff_profile_id
           join public.events e on e.id = r.event_id
          where r.id = $1 and r.registrant_type = 'COACH' and sp.user_id = $2
          ${lock ? 'for update of r' : ''}`,
        [registrationId, userId],
      );
      const r = rows[0];
      return r
        ? {
            registrationId: r.id,
            status: r.status,
            eventAccessDisabled: r.event_access_disabled,
            staffProfileId: r.staff_profile_id,
            teamId: r.team_id,
            event: {
              id: r.event_id,
              name: r.event_name,
              startsAt: r.starts_at,
              endsAt: r.ends_at,
              timezone: r.timezone,
            },
          }
        : null;
    },

    async findTeam(teamId) {
      const { rows } = await q.query<{
        id: string;
        name: string;
        club: string;
        division: string;
        invite_code: string;
        status: CoachTeamDto['status'];
      }>('select id, name, club, division, invite_code, status from public.teams where id = $1', [
        teamId,
      ]);
      const t = rows[0];
      return t
        ? {
            id: t.id,
            name: t.name,
            club: t.club,
            division: t.division,
            inviteCode: t.invite_code,
            status: t.status,
          }
        : null;
    },

    async insertTeam(i) {
      const { rows } = await q.query<{ id: string }>(
        `insert into public.teams (event_id, name, club, division, coach_profile_id)
         values ($1, $2, $3, $4, $5)
         on conflict (event_id, name, club) do nothing
         returning id`,
        [i.eventId, i.name, i.club, i.division, i.coachProfileId],
      );
      const id = rows[0]?.id ?? null;
      // The coach who creates a team holds it, so the team-scoped access (team_assignments) covers it from the start.
      if (id) {
        await q.query(
          'insert into public.team_assignments (staff_profile_id, team_id) values ($1, $2) on conflict do nothing',
          [i.coachProfileId, id],
        );
      }
      return id;
    },

    async assignTeam(registrationId, teamId) {
      await q.query('update public.registrations set team_id = $2 where id = $1', [
        registrationId,
        teamId,
      ]);
    },

    audit: (entry) =>
      recordAudit(q, {
        action: 'TEAM_CREATED',
        actorUserId: entry.actorUserId,
        entityType: 'team',
        entityId: entry.teamId,
        metadata: { registrationId: entry.registrationId, byCoach: true },
        meta: entry.meta,
      }),
  };
}

export function createCoachTeamRepository(db: Database): CoachTeamRepository {
  const inTransaction: CoachTeamRepository['transaction'] = (fn) =>
    db.transaction((tx) =>
      fn(
        build(tx, () => {
          throw new Error('Nested transactions are not supported');
        }),
      ),
    );
  return build(db, inTransaction);
}
