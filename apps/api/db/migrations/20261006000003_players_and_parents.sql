-- Up Migration

-- players, parents, player_parents, staff_profiles. A parent row is shared by all of their children.
--
-- staff_profiles covers the frontend's Coach and Staff registrations. They are the same kind of person
-- (an adult attached to a team, with a live photo, certificates and admin approval) and differ only by
-- profile_type and, for STAFF, a staff_role, so they share one table instead of two near-identical ones.
-- Coach-only items live elsewhere: certificates are `documents`, the AB 506 acknowledgement is a `consent`,
-- and the approval workflow is the `registration` (see registrations.registrant_type).

create table public.players (
  id            uuid primary key default gen_random_uuid(),
  -- Set only if the player has their own login (older players); minors are managed by a parent.
  user_id       uuid unique references public.users (id) on delete set null,
  first_name    text not null check (length(btrim(first_name)) > 0),
  last_name     text not null check (length(btrim(last_name)) > 0),
  -- A calendar date with no time zone. The upper bound uses UTC so it never depends on session settings.
  date_of_birth date not null check (date_of_birth <= (now() at time zone 'utc')::date),
  email         text check (email is null or email = lower(email)),
  phone         text,
  school_id     text,  -- the player's school student ID, used by event-day manual search
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Manual-search lookups: by name, by date of birth, by school ID.
create index players_name_idx on public.players (lower(last_name), lower(first_name));
create index players_date_of_birth_idx on public.players (date_of_birth);
create index players_school_id_idx on public.players (school_id) where school_id is not null;

create table public.parents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references public.users (id) on delete set null,
  first_name text not null check (length(btrim(first_name)) > 0),
  last_name  text not null check (length(btrim(last_name)) > 0),
  email      text not null check (email = lower(email)),
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The same guardian is never stored twice.
create unique index parents_email_key on public.parents (email);

create table public.player_parents (
  player_id    uuid not null references public.players (id) on delete cascade,
  parent_id    uuid not null references public.parents (id) on delete cascade,
  relationship text not null check (length(btrim(relationship)) > 0),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (player_id, parent_id)
);
create index player_parents_parent_id_idx on public.player_parents (parent_id);
-- At most one primary guardian per player.
create unique index player_parents_one_primary_key on public.player_parents (player_id) where is_primary;

create table public.staff_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete restrict,
  profile_type text not null check (profile_type in ('COACH', 'STAFF')),
  -- The frontend's Staff roles. Required for STAFF, not allowed for COACH.
  staff_role   text check (staff_role in
                 ('TEAM_MANAGER', 'ATHLETIC_TRAINER', 'EQUIPMENT_MANAGER', 'SAFETY_OFFICER')),
  first_name   text not null check (length(btrim(first_name)) > 0),
  last_name    text not null check (length(btrim(last_name)) > 0),
  email        text not null check (email = lower(email)),
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((profile_type = 'STAFF') = (staff_role is not null)),
  -- A user can be both a coach and a staff member, but has one profile of each type.
  unique (user_id, profile_type)
);
create index staff_profiles_name_idx on public.staff_profiles (lower(last_name), lower(first_name));

-- The coach who owns a team (the frontend lets an approved coach create the team players join).
alter table public.teams
  add column coach_profile_id uuid references public.staff_profiles (id) on delete restrict;
create index teams_coach_profile_id_idx on public.teams (coach_profile_id);

create trigger players_set_updated_at before update on public.players
  for each row execute function public.set_updated_at();
create trigger parents_set_updated_at before update on public.parents
  for each row execute function public.set_updated_at();
create trigger staff_profiles_set_updated_at before update on public.staff_profiles
  for each row execute function public.set_updated_at();
