# Team access and registration limits

Migration: `apps/api/db/migrations/20261016000001_team_assignments_and_registration_limits.sql`.

## Team assignments (coaches and staff)

`team_assignments (staff_profile_id, team_id)` says which teams a coach or staff member works with. One person can hold
many teams. The migration backfills it from `teams.coach_profile_id` and from the team on each coach/staff registration, and
a coach who creates a team through `POST /registrations/:id/team` is assigned to it.

Admin (role `ADMIN` of the registration's organization; anyone else gets 403/404). The registration id names the person, and
the team must belong to that registration's event:

| Method | Path | |
| --- | --- | --- |
| GET | `/admin/registrations/:registrationId/teams` | the person's teams |
| POST | `/admin/registrations/:registrationId/teams` `{ teamId }` | add (idempotent), returns the list |
| DELETE | `/admin/registrations/:registrationId/teams/:teamId` | remove, returns the list |

Coach / staff (and admins of the team's organization):

| Method | Path | |
| --- | --- | --- |
| GET | `/me/teams` | the caller's teams |
| GET | `/team-access/teams/:teamId` | one team (staff do not get the invite code) |
| GET | `/team-access/teams/:teamId/roster` | players and staff on it: no documents, payments or emails |

Access is granted only when **all** hold: the team is assigned to the caller's profile; the caller has the matching role
(`COACH` / `STAFF`); the caller has a `VERIFIED` or `READY_FOR_EVENT` registration of that kind for the team's event; and
their event-day access is not switched off. Anything else is `404 TEAM_NOT_FOUND`, so team ids are not confirmed to exist.
The existing `/admin/*` endpoints stay `ADMIN`-only. The web app shows coaches and staff only `/admin/my-teams`.

## Registration limits

`teams.max_players`, `max_coaches`, `max_staff` (`NULL` = unlimited, the default). Set or clear them with
`PATCH /admin/teams/:teamId { maxPlayers?, maxCoaches?, maxStaff? }` (positive integer, or `null` to remove). Team responses
carry `limits: { players | coaches | staff: { max, used } }`.

A registration **holds a place** in every status except `DRAFT`, `CANCELLED` and `REJECTED` (the same people the event roster
lists). Limits are checked:

- when a family picks the team (`POST /registrations`, `PATCH /registrations/:id`): an early, friendly refusal;
- at `POST /registrations/:id/submit`: the binding check. It locks the team row (`select ... for update`) and counts after
  the lock, so concurrent submissions cannot exceed the limit.

A full team answers `409 TEAM_REGISTRATION_FULL` with a message such as *"Registration for Hawks U12 is full: it cannot accept
any more players."* (`coaches`, `staff members`). Lowering a limit below the current count keeps everyone already registered
and blocks new registrations until the count drops below the limit.
