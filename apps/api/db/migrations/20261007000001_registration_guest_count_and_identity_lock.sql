-- Up Migration

-- Family members / guests attending with the player (the frontend's "guestCount", whole number 0 to 10).
alter table public.registrations
  add column guest_count integer not null default 0
  constraint registrations_guest_count_check check (guest_count between 0 and 10);

-- A registration is for one person at one event, forever. Moving it to another event or player would
-- bypass the duplicate protection (unique event + player) and the audit trail, so the database refuses it
-- no matter which code path tries. (Cancel the registration and create a new one instead.)
create function public.registrations_lock_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_id is distinct from old.event_id
     or new.player_id is distinct from old.player_id
     or new.staff_profile_id is distinct from old.staff_profile_id
     or new.registrant_type is distinct from old.registrant_type then
    raise exception 'a registration cannot be moved to another event or person'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger registrations_lock_identity before update on public.registrations
  for each row execute function public.registrations_lock_identity();
