-- Up Migration

-- Event-day check-in (Phase 4D-B2). Reuses face_scans and check_ins; adds only what the existing tables could not
-- guarantee on their own.

-- 1. Idempotency. The client generates one id per check-in attempt and resends the SAME id on a retry. The
--    constraint is global (a random UUID), so the same id can never create a second check-in, and the service
--    refuses to replay it for a different registration, event, operator or scan.
alter table public.check_ins
  add column client_request_id uuid,
  add constraint check_ins_client_request_id_key unique (client_request_id);

-- 2. A face scan is consumed by at most one check-in. (Replaces the plain partial index created with the table;
--    a unique constraint carries its own index.) MANUAL rows have a null face_scan_id and are unaffected.
drop index public.check_ins_face_scan_idx;
alter table public.check_ins
  add constraint check_ins_face_scan_id_key unique (face_scan_id);

-- 3. A FACE check-in must be backed by a scan that really identified THIS registration's player, at THIS event, for
--    THIS operator. The application checks this first; the trigger is the final protection against a bug or a
--    direct insert. (Recency is not checked here: it is a time policy, kept in the service.)
create function public.check_ins_require_valid_scan()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  scan_event  uuid;
  scan_result text;
  scan_player uuid;
  scan_user   uuid;
  reg_player  uuid;
begin
  if new.face_scan_id is null then
    return new;
  end if;
  select event_id, result, matched_player_id, scanned_by
    into scan_event, scan_result, scan_player, scan_user
    from public.face_scans where id = new.face_scan_id;
  select player_id into reg_player from public.registrations where id = new.registration_id;
  if scan_result is distinct from 'MATCH'
     or scan_event is distinct from new.event_id
     or scan_player is distinct from reg_player
     or scan_user is distinct from new.checked_in_by then
    raise exception 'the face scan does not match this check-in'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger check_ins_require_valid_scan before insert on public.check_ins
  for each row execute function public.check_ins_require_valid_scan();
