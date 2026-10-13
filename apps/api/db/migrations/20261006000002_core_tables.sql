-- Up Migration

-- organizations, users (identity), user_roles (authorization), events, teams.
--
-- Identity vs. domain profile:
--   public.users           -> app identity: who can log in (passwords live in user_credentials, never here)
--   public.user_roles      -> what the account may do (ADMIN, COACH, STAFF, PARENT, PLAYER; several allowed,
--                             e.g. a parent who also coaches)
--   domain profiles        -> players, parents, staff_profiles (next migration): the person's data.
--                             A profile may link to a user via user_id; admins have no domain profile.
--
-- Time: all instants are timestamptz (stored as UTC). Nothing here depends on the session time zone.

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per account. Created by the API (modules/users), together with its credentials, in one transaction.
create table public.users (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete restrict,
  email           text not null check (email = lower(email)),  -- the API must lower-case before insert
  full_name       text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index users_email_key on public.users (email);
create index users_organization_id_idx on public.users (organization_id);

create table public.user_roles (
  user_id    uuid not null references public.users (id) on delete cascade,
  role       text not null check (role in ('ADMIN', 'COACH', 'STAFF', 'PARENT', 'PLAYER')),
  granted_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index user_roles_role_idx on public.user_roles (role);

create table public.events (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  name                   text not null check (length(btrim(name)) > 0),
  description            text,
  location               text not null,
  -- IANA zone name (e.g. America/Los_Angeles) used to DISPLAY the event's local times and to decide which
  -- local calendar day an instant falls on. Deliberately has no default: each event states it. The API
  -- validates it against the IANA database.
  timezone               text not null check (length(btrim(timezone)) > 0),
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  registration_fee_cents integer not null default 0 check (registration_fee_cents >= 0),
  currency               text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  status                 text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'CLOSED')),
  created_by             uuid references public.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index events_organization_id_idx on public.events (organization_id);
create index events_status_starts_at_idx on public.events (status, starts_at);

-- A team's coach (teams.coach_profile_id) is added in the next migration, after staff_profiles exists.
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete restrict,
  name        text not null check (length(btrim(name)) > 0),
  club        text not null default '',
  division    text not null,
  invite_code text not null unique
              default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, name, club),
  -- Lets registrations prove a team belongs to the registration's own event (composite FK).
  unique (id, event_id)
);
create index teams_event_id_idx on public.teams (event_id);

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger teams_set_updated_at before update on public.teams
  for each row execute function public.set_updated_at();
