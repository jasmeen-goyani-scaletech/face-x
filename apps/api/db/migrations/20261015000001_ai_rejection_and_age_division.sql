-- Up Migration

-- A player's age division (the bracket they play in). Null only for players registered before it was asked for; new players
-- must supply it (the API requires it on create).
alter table public.players
  add column age_division text check (age_division in ('U12', 'U14', 'U16'));

-- Set when the family submitted a document that the AI check turned down twice: the document goes to review as normal, with this
-- marker so an admin knows to look at it by eye. The family is never told.
alter table public.documents
  add column ai_rejected boolean not null default false;

create index documents_ai_rejected_idx on public.documents (registration_id) where ai_rejected;
