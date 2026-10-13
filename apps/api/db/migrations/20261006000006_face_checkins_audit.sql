-- Up Migration

-- face_profiles, face_scans, check_ins, audit_logs.
--
-- Biometric data: we store the face provider's reference ID only. No face images, embeddings or
-- templates are stored in this database.
-- TODO(client / privacy): before any real face data is enrolled, decide and document: retention
-- period, deletion (including deletion at the provider and on guardian request), where the provider
-- stores data, the consent wording for minors, and applicable privacy law. See docs/architecture.md.
-- Revoking a profile here only marks the row; provider-side deletion is a Phase 9 requirement.

create table public.face_profiles (
  id                  uuid primary key default gen_random_uuid(),
  -- The enrolled person: a player OR a coach/staff member (the frontend scans all three).
  player_id           uuid references public.players (id) on delete restrict,
  staff_profile_id    uuid references public.staff_profiles (id) on delete restrict,
  provider            text not null check (length(btrim(provider)) > 0),
  provider_profile_id text not null check (length(btrim(provider_profile_id)) > 0),
  status              text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  -- The biometric consent under which this profile was enrolled (set once the consent flow exists).
  consent_record_id   uuid references public.consent_records (id) on delete restrict,
  enrolled_by         uuid references public.users (id) on delete set null,
  enrolled_at         timestamptz not null default now(),
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_profile_id),
  check ((player_id is not null) <> (staff_profile_id is not null)),
  check ((status = 'REVOKED') = (revoked_at is not null))
);
create index face_profiles_player_id_idx on public.face_profiles (player_id) where player_id is not null;
create index face_profiles_staff_profile_id_idx on public.face_profiles (staff_profile_id)
  where staff_profile_id is not null;
create index face_profiles_consent_record_idx on public.face_profiles (consent_record_id)
  where consent_record_id is not null;
-- One active profile per person; re-enrolling means revoking the old one first.
create unique index face_profiles_one_active_player_key
  on public.face_profiles (player_id) where status = 'ACTIVE' and player_id is not null;
create unique index face_profiles_one_active_staff_key
  on public.face_profiles (staff_profile_id) where status = 'ACTIVE' and staff_profile_id is not null;

create table public.face_scans (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references public.events (id) on delete restrict,
  scanned_by               uuid not null references public.users (id) on delete restrict,
  result                   text not null check (result in ('MATCH', 'NO_MATCH', 'REVIEW_REQUIRED', 'ERROR')),
  matched_player_id        uuid references public.players (id) on delete restrict,
  matched_staff_profile_id uuid references public.staff_profiles (id) on delete restrict,
  face_profile_id          uuid references public.face_profiles (id) on delete restrict,
  provider                 text not null,
  -- Provider-defined score. Its scale is not assumed here; document it when the provider is chosen.
  provider_score           numeric,
  provider_request_id      text,
  error_code               text,
  created_at               timestamptz not null default now(),
  -- At most one matched person; a MATCH must name one.
  check (not (matched_player_id is not null and matched_staff_profile_id is not null)),
  check (result <> 'MATCH' or matched_player_id is not null or matched_staff_profile_id is not null)
);
create index face_scans_event_created_idx on public.face_scans (event_id, created_at);
create index face_scans_matched_player_idx on public.face_scans (matched_player_id)
  where matched_player_id is not null;
create index face_scans_matched_staff_idx on public.face_scans (matched_staff_profile_id)
  where matched_staff_profile_id is not null;
create index face_scans_scanned_by_idx on public.face_scans (scanned_by);
create index face_scans_face_profile_idx on public.face_scans (face_profile_id)
  where face_profile_id is not null;

-- The person is derived from the registration (registrations are unique per person per event), so
-- check_ins does not repeat player_id / staff_profile_id.
create table public.check_ins (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null,
  registration_id uuid not null,
  method          text not null check (method in ('FACE', 'MANUAL')),
  face_scan_id    uuid references public.face_scans (id) on delete restrict,
  checked_in_by   uuid not null references public.users (id) on delete restrict,
  checked_in_at   timestamptz not null default now(),
  notes           text,
  created_at      timestamptz not null default now(),

  -- The registration must belong to the event being checked into: no check-in to another event.
  foreign key (registration_id, event_id)
    references public.registrations (id, event_id) on delete restrict,
  -- One check-in per registration, i.e. per person per event. This is what makes duplicates and two
  -- devices racing yield exactly one row.
  unique (registration_id),
  check ((method = 'FACE') = (face_scan_id is not null))
);
create index check_ins_event_checked_in_idx on public.check_ins (event_id, checked_in_at);
create index check_ins_checked_in_by_idx on public.check_ins (checked_in_by);
create index check_ins_face_scan_idx on public.check_ins (face_scan_id) where face_scan_id is not null;

-- Last line of defence: whatever the API does, only a READY_FOR_EVENT registration whose event-day
-- access is not switched off can be checked in (so unpaid, unverified and cancelled are refused).
-- FOR SHARE blocks a concurrent status change until this insert commits.
--
-- There is deliberately NO override path here. The frontend currently has none (see
-- docs/architecture.md, "Admin override"). If the client wants one, it will be a separate, explicit
-- admin-only rule added in Phase 10, never a relaxation of this trigger for everyone.
create function public.check_ins_require_ready_registration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reg_status text;
  reg_disabled boolean;
begin
  select status, event_access_disabled into reg_status, reg_disabled
    from public.registrations where id = new.registration_id for share;
  if reg_status is distinct from 'READY_FOR_EVENT' then
    raise exception 'registration is not eligible for check-in (status: %)', coalesce(reg_status, 'unknown')
      using errcode = 'check_violation';
  end if;
  if reg_disabled then
    raise exception 'event-day access is disabled for this registration'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger check_ins_require_ready_registration before insert on public.check_ins
  for each row execute function public.check_ins_require_ready_registration();

create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  -- No cascade/set-null: audit rows are append-only and a user with history cannot be hard-deleted.
  actor_user_id uuid references public.users (id) on delete restrict,
  action        text not null check (action ~ '^[A-Z][A-Z0-9_]*$'),  -- e.g. CHECK_IN_COMPLETED
  entity_type   text not null,
  entity_id     uuid,
  metadata      jsonb not null default '{}'::jsonb,   -- never put tokens or biometric data here
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at);
create index audit_logs_action_idx on public.audit_logs (action, created_at);

create trigger face_profiles_set_updated_at before update on public.face_profiles
  for each row execute function public.set_updated_at();
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.prevent_mutation();
