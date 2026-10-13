-- Up Migration

-- The face-scan (biometric) consent, version 1, with the client's approved wording. Consent text is immutable once published (a new
-- wording is a NEW version row, and families are asked again), so it is published by a migration, which also runs in production; the
-- dev seed never carries it.
--
-- The consent is OPTIONAL for a registration: it is never a requirement and never holds a registration back. Without it the player's photo
-- is not enrolled for face matching and the player is checked in by hand.
insert into public.consents (code, version, title, body)
select 'BIOMETRIC_CONSENT',
       1,
       'Face-scan check-in consent',
       'I consent to the collection, extraction, and secure storage of biometric face templates for event check-in and player identification purposes. I understand that facial templates are stored securely using encryption and can be deleted upon request or account termination.'
where not exists (select 1 from public.consents where code = 'BIOMETRIC_CONSENT' and version = 1);
