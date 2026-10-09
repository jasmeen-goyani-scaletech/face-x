-- Up Migration

-- Authentication data, kept apart from public.users so that a plain read of the identity table can never
-- expose a hash. Only the auth module's repository touches these tables.

-- Argon2id hash (self-describing: includes algorithm, parameters and salt). Never the password.
create table public.user_credentials (
  user_id       uuid primary key references public.users (id) on delete cascade,
  password_hash text not null check (password_hash like '$argon2id$%'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per issued refresh token. The token itself is never stored: only an HMAC of it.
-- Tokens are rotated on every use; all tokens that descend from one login share a family_id so that
-- reuse of an already-rotated token can revoke the whole family.
create table public.refresh_tokens (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  family_id      uuid not null,
  token_hash     text not null unique,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  revoked_reason text check (revoked_reason in
                   ('ROTATED', 'LOGOUT', 'REUSE_DETECTED', 'ACCOUNT_DISABLED')),
  replaced_by    uuid references public.refresh_tokens (id) on delete set null,
  created_at     timestamptz not null default now(),
  check ((revoked_at is null) = (revoked_reason is null)),
  check (expires_at > created_at)
);
create index refresh_tokens_user_id_idx on public.refresh_tokens (user_id);
create index refresh_tokens_family_id_idx on public.refresh_tokens (family_id);
-- For periodic cleanup of expired rows.
create index refresh_tokens_expires_at_idx on public.refresh_tokens (expires_at);

create trigger user_credentials_set_updated_at before update on public.user_credentials
  for each row execute function public.set_updated_at();

-- Authorization note: there is no row-level security in this database. The API is the only client, it
-- authenticates every request and enforces roles, organization and event access in code
-- (src/modules/auth, src/modules/events). Connect with a dedicated, non-superuser role that owns no
-- schema and cannot create roles; constraints and triggers in these migrations are the last line of defence.
