-- Up Migration

-- Face profiles (the existing table) link a player to an identity held by an external face-recognition
-- provider. This database stores ONLY the provider's opaque reference: no image, no template, no embedding
-- (there is deliberately no column that could hold one). Changing provider later means enrolling again.
--
-- Already enforced by the existing table: one ACTIVE profile per player (across all providers: switching
-- provider means removing the old profile first), unique (provider, provider_profile_id), status ACTIVE/REVOKED
-- with revoked_at set exactly when REVOKED, and the optional link to the consent record it was enrolled under.

alter table public.face_profiles
  -- Provenance: the registration photo (a PROFILE_PHOTO document) the profile was enrolled from. The image itself
  -- stays only in private storage under that document's own lifecycle; nothing is copied.
  add column source_document_id uuid references public.documents (id) on delete restrict,
  add column revoked_by uuid references public.users (id) on delete set null,
  -- Short machine code (e.g. USER_REQUEST), never free text.
  add column revoked_reason text check (revoked_reason is null or length(revoked_reason) <= 50),
  add constraint face_profiles_revocation_fields_check
    check (status = 'REVOKED' or (revoked_by is null and revoked_reason is null));

create index face_profiles_source_document_idx on public.face_profiles (source_document_id)
  where source_document_id is not null;
create index face_profiles_enrolled_by_idx on public.face_profiles (enrolled_by) where enrolled_by is not null;

-- Who a profile belongs to, and which provider identity it points at, never change. Enrolling someone else (or
-- somewhere else) is a new profile, so history stays truthful.
create function public.face_profiles_lock_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.player_id is distinct from old.player_id
     or new.staff_profile_id is distinct from old.staff_profile_id
     or new.provider is distinct from old.provider
     or new.provider_profile_id is distinct from old.provider_profile_id
     or new.source_document_id is distinct from old.source_document_id
     or new.consent_record_id is distinct from old.consent_record_id then
    raise exception 'a face profile cannot be reassigned'
      using errcode = 'restrict_violation';
  end if;
  -- A removed profile stays removed.
  if old.status = 'REVOKED' and new.status is distinct from 'REVOKED' then
    raise exception 'a revoked face profile cannot be reactivated'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger face_profiles_lock_identity before update on public.face_profiles
  for each row execute function public.face_profiles_lock_identity();

-- Removing a profile marks it REVOKED; the row (a reference to something that no longer exists, not biometric
-- data) stays as the record that an enrollment existed. How long even that is kept is an open privacy decision.
create trigger face_profiles_no_delete before delete on public.face_profiles
  for each row execute function public.prevent_mutation();
