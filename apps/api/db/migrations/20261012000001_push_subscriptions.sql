-- Up Migration

-- Web Push subscriptions: one row per browser/device endpoint, owned by one user. A user may have many (phone,
-- laptop, several browsers). The endpoint is globally unique: it identifies one browser installation, so subscribing
-- again from the same browser updates the row (and moves it to whoever is signed in now) instead of duplicating it.
create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  endpoint         text not null check (char_length(endpoint) between 1 and 2048),
  -- The browser's public encryption key and auth secret for this endpoint. Needed to encrypt each push, never returned by the API.
  p256dh           text not null check (char_length(p256dh) between 1 and 512),
  auth             text not null check (char_length(auth) between 1 and 512),
  user_agent       text check (char_length(user_agent) <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  -- Consecutive transient failures; the row is deleted once this passes the service's limit. Reset by a success.
  failure_count    integer not null default 0 check (failure_count >= 0),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();
