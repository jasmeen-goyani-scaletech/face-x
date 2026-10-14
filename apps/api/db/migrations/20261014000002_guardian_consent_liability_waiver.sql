-- Up Migration

-- The guardian consent, version 2, with the client's approved liability release wording. Consent text is immutable once published
-- (a new wording is a NEW version row), so it is published by a migration, which also runs in production; the dev seed only carries
-- the placeholder version 1. Version 2 becomes the current wording straight away, so families are shown (and sign) this text.
insert into public.consents (code, version, title, body)
select 'GUARDIAN_CONSENT',
       2,
       'Liability release & waiver',
       'I am the parent or legal guardian of this player. I consent to their participation in this camp and agree to the event-day face-scan check-in. I acknowledge and agree that the organization, its staff, and event organizers shall not be held liable for any injuries, accidents, or claims arising from participation in this event.'
where not exists (select 1 from public.consents where code = 'GUARDIAN_CONSENT' and version = 2);
