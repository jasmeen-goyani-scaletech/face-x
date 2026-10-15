-- Up Migration

-- One-time sign-in links an admin issues for a coach or staff member who has no password and has lost their session.
-- Only a keyed hash of the token is stored, never the token. A link works once and only until it expires.
create table public.sign_in_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  token_hash  text not null unique,
  created_by  uuid references public.users (id) on delete set null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index sign_in_links_user_id_idx on public.sign_in_links (user_id);

-- Down Migration
-- drop table public.sign_in_links;
