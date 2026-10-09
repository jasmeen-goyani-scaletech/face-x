-- Up Migration

-- registrations (the central entity) and its audit trail of status changes.
-- The API enforces which transitions are legal (Phase 5); the DB guarantees the values are valid,
-- one registration exists per person per event, and every change can be recorded.
--
-- A registration is for exactly one registrant: a player OR a coach/staff member (staff_profiles).
-- Which status path each type follows (e.g. coaches/staff have no payment step; the frontend's
-- payment is players-only) is a Phase 5 service rule, not a database rule.

create sequence public.registration_number_seq;

create table public.registrations (
  id                  uuid primary key default gen_random_uuid(),
  -- Human-readable ID shown to families and staff (e.g. FX-2026-00042); also the offline check-in key.
  -- The year is the UTC year so it does not depend on the session time zone.
  registration_number text not null unique
                      default 'FX-' || extract(year from now() at time zone 'utc')::int || '-'
                              || lpad(nextval('public.registration_number_seq')::text, 5, '0'),
  event_id            uuid not null references public.events (id) on delete restrict,
  registrant_type     text not null check (registrant_type in ('PLAYER', 'COACH', 'STAFF')),
  player_id           uuid references public.players (id) on delete restrict,
  staff_profile_id    uuid references public.staff_profiles (id) on delete restrict,
  team_id             uuid,
  status              text not null default 'DRAFT' check (status in (
                        'DRAFT', 'SUBMITTED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED',
                        'DOCUMENT_REVIEW', 'VERIFIED', 'REJECTED', 'READY_FOR_EVENT', 'CANCELLED')),
  -- An admin can switch a person's event-day access off without cancelling the registration (the
  -- frontend's "Disable" toggle). While true, check-in is refused whatever the status is.
  event_access_disabled        boolean not null default false,
  event_access_disabled_reason text,
  -- Fee captured at registration time so later event-price changes do not alter what was charged.
  fee_cents           integer not null default 0 check (fee_cents >= 0),
  currency            text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  created_by          uuid references public.users (id) on delete set null,
  submitted_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Exactly one registrant, and it matches registrant_type.
  check (
    (registrant_type = 'PLAYER' and player_id is not null and staff_profile_id is null)
    or (registrant_type in ('COACH', 'STAFF') and staff_profile_id is not null and player_id is null)
  ),
  unique (event_id, player_id),
  unique (event_id, staff_profile_id),
  -- check_ins references this to prove its registration belongs to the event it claims.
  unique (id, event_id),
  -- A team must belong to the registration's own event. (Skipped while team_id is null.)
  foreign key (team_id, event_id) references public.teams (id, event_id) on delete restrict
);
create index registrations_player_id_idx on public.registrations (player_id) where player_id is not null;
create index registrations_staff_profile_id_idx on public.registrations (staff_profile_id)
  where staff_profile_id is not null;
create index registrations_event_status_idx on public.registrations (event_id, status);
create index registrations_team_id_idx on public.registrations (team_id);

create table public.registration_status_history (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete restrict,
  from_status     text,  -- null for the initial row
  to_status       text not null,
  -- null = changed by the system (e.g. Stripe webhook).
  changed_by      uuid references public.users (id) on delete restrict,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint registration_status_history_from_status_check check (from_status is null or from_status in (
    'DRAFT', 'SUBMITTED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED',
    'DOCUMENT_REVIEW', 'VERIFIED', 'REJECTED', 'READY_FOR_EVENT', 'CANCELLED')),
  constraint registration_status_history_to_status_check check (to_status in (
    'DRAFT', 'SUBMITTED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED',
    'DOCUMENT_REVIEW', 'VERIFIED', 'REJECTED', 'READY_FOR_EVENT', 'CANCELLED'))
);
create index registration_status_history_registration_idx
  on public.registration_status_history (registration_id, created_at);
create index registration_status_history_changed_by_idx
  on public.registration_status_history (changed_by) where changed_by is not null;

create trigger registrations_set_updated_at before update on public.registrations
  for each row execute function public.set_updated_at();
create trigger registration_status_history_append_only
  before update or delete on public.registration_status_history
  for each row execute function public.prevent_mutation();
