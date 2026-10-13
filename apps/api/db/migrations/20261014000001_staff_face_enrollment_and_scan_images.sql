-- Up Migration

-- Face matching for coaches and staff (not only players), and the camera frame behind every event-day scan.

-- 1. The enrolled photo's permanent object-storage URL, set when the photo is enrolled for face matching.
--    An address, not a link: the bucket is private, so it is signed on the way out when someone needs to see it.
alter table public.players
  add column photo_url text check (photo_url is null or length(photo_url) > 0);
alter table public.staff_profiles
  add column photo_url text check (photo_url is null or length(photo_url) > 0);

-- 2. Where the face service filed the frame it was asked to match (scans/{event}/{timestamp}_{id}.jpg).
--    Null when no frame was kept (no face in it, or the service retained none). Only the URL is stored here.
alter table public.face_scans
  add column scan_image_url text check (scan_image_url is null or length(scan_image_url) > 0);

-- 3. A FACE check-in must be backed by a scan that identified THIS registration's person, a player OR a
--    coach/staff member, at THIS event, for THIS operator. Replaces the player-only version.
create or replace function public.check_ins_require_valid_scan()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  scan_event  uuid;
  scan_result text;
  scan_player uuid;
  scan_staff  uuid;
  scan_user   uuid;
  reg_player  uuid;
  reg_staff   uuid;
begin
  if new.face_scan_id is null then
    return new;
  end if;
  select event_id, result, matched_player_id, matched_staff_profile_id, scanned_by
    into scan_event, scan_result, scan_player, scan_staff, scan_user
    from public.face_scans where id = new.face_scan_id;
  select player_id, staff_profile_id into reg_player, reg_staff
    from public.registrations where id = new.registration_id;
  if scan_result is distinct from 'MATCH'
     or scan_event is distinct from new.event_id
     or scan_player is distinct from reg_player
     or scan_staff is distinct from reg_staff
     or scan_user is distinct from new.checked_in_by then
    raise exception 'the face scan does not match this check-in'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
