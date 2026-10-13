-- Up Migration

-- Shared trigger functions. `set search_path = ''` pins name resolution, so every object reference inside
-- function bodies must be schema-qualified.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Append-only guard for audit-style tables (status history, reviews, consent records, audit logs).
create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;
