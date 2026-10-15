-- Up Migration

-- Set by the API itself (never by the client) when the AI check of this very file came back accepted. A replacement upload resets it.
-- When every AI-checkable required document of a registration has it, they are approved without waiting for an admin.
alter table public.documents
  add column ai_accepted boolean not null default false;

-- An approval made by the AI check has no human reviewer.
alter table public.document_reviews
  alter column reviewer_id drop not null,
  add column automated boolean not null default false,
  add constraint document_reviews_reviewer_or_automated check (reviewer_id is not null or automated);
