-- Up Migration

-- Team assignments: which teams a coach or staff member may work with. One person can hold several teams.
-- teams.coach_profile_id (the creator/owner) and registrations.team_id (one team per registration) stay as they are;
-- this table is what the team-scoped access checks read, so an admin can add and remove teams for a person.
create table public.team_assignments (
  staff_profile_id uuid not null references public.staff_profiles (id) on delete cascade,
  team_id          uuid not null references public.teams (id) on delete cascade,
  assigned_by      uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  primary key (staff_profile_id, team_id)
);
create index team_assignments_team_id_idx on public.team_assignments (team_id);

-- Existing relationships become assignments, so nobody loses the team they already have.
insert into public.team_assignments (staff_profile_id, team_id)
select t.coach_profile_id, t.id from public.teams t where t.coach_profile_id is not null
on conflict do nothing;

insert into public.team_assignments (staff_profile_id, team_id)
select r.staff_profile_id, r.team_id from public.registrations r
 where r.staff_profile_id is not null and r.team_id is not null
on conflict do nothing;

-- Registration limits per team and registration type. NULL = unlimited (the default for every existing team).
-- A limit below the current count is allowed: it only blocks new registrations, existing ones are untouched.
alter table public.teams
  add column max_players integer check (max_players is null or max_players > 0),
  add column max_coaches integer check (max_coaches is null or max_coaches > 0),
  add column max_staff   integer check (max_staff is null or max_staff > 0);

-- Down Migration
-- alter table public.teams drop column max_players, drop column max_coaches, drop column max_staff;
-- drop table public.team_assignments;
