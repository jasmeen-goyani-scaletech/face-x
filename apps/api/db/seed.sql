-- Development seed data. NEVER run against production. Apply with `pnpm db:seed` (after `pnpm db:migrate`).
-- No users are seeded: create accounts through POST /api/v1/auth/register, then grant roles in SQL.

insert into public.organizations (id, name, slug) values
  ('00000000-0000-4000-8000-000000000001', 'Face-X Demo League', 'face-x-demo');

insert into public.events
  (id, organization_id, name, location, timezone, starts_at, ends_at, registration_fee_cents, status)
values
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001',
   'Fall Kickoff Tournament', 'Riverside Sports Complex, CA', 'America/Los_Angeles',
   '2026-11-14 17:30:00-08', '2026-11-14 20:00:00-08', 9500, 'PUBLISHED');

insert into public.teams (id, event_id, name, club, division, invite_code) values
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010',
   'Lightning', 'Riverside FC', 'U12', 'DEMOLTNG'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010',
   'Thunder', 'Riverside FC', 'U14', 'DEMOTHND');

-- DEVELOPMENT PLACEHOLDER TEXT ONLY. This is NOT legal wording and must never reach production.
-- TODO(client): supply approved wording for each consent; publish it as a NEW version in a migration
-- (consent text is immutable, and this seed never runs in production).
insert into public.consents (id, code, version, title, body) values
  ('00000000-0000-4000-8000-000000000030', 'GUARDIAN_CONSENT', 1, '[DEV PLACEHOLDER] Guardian consent',
   '[DEV PLACEHOLDER - NOT LEGAL TEXT] I am the parent or legal guardian and I consent to this player taking part in the event.'),
  ('00000000-0000-4000-8000-000000000031', 'AB506_ACKNOWLEDGEMENT', 1, '[DEV PLACEHOLDER] AB 506 acknowledgement',
   '[DEV PLACEHOLDER - NOT LEGAL TEXT] Coach/staff acknowledgement of the AB 506 requirements.');
-- (BIOMETRIC_CONSENT v1, with the approved wording, is published by migration 20261013000002, not by this seed.)

-- One guardian with two children (demonstrates the shared-parent model).
insert into public.parents (id, first_name, last_name, email, phone) values
  ('00000000-0000-4000-8000-000000000040', 'Dana', 'Rivera', 'dana.rivera@example.com', '555-0100');

insert into public.players (id, first_name, last_name, date_of_birth, school_id) values
  ('00000000-0000-4000-8000-000000000050', 'Mateo', 'Rivera', '2014-03-09', 'S-10042'),
  ('00000000-0000-4000-8000-000000000051', 'Lucia', 'Rivera', '2012-07-21', 'S-10043');

insert into public.player_parents (player_id, parent_id, relationship, is_primary) values
  ('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000040', 'Mother', true),
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000040', 'Mother', true);

insert into public.registrations (id, event_id, registrant_type, player_id, team_id, status, fee_cents) values
  ('00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000010', 'PLAYER',
   '00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000020', 'DRAFT', 9500),
  ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000010', 'PLAYER',
   '00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000021', 'SUBMITTED', 9500);

insert into public.registration_status_history (registration_id, from_status, to_status, reason) values
  ('00000000-0000-4000-8000-000000000060', null, 'DRAFT', 'seed'),
  ('00000000-0000-4000-8000-000000000061', null, 'DRAFT', 'seed'),
  ('00000000-0000-4000-8000-000000000061', 'DRAFT', 'SUBMITTED', 'seed');
