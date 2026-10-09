-- Up Migration

-- documents (metadata only; files live in private Storage), document_reviews,
-- consents (versioned text), consent_records (who accepted which version), payments.

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete restrict,
  document_type   text not null check (document_type in (
                    -- player documents
                    'PROFILE_PHOTO', 'BIRTH_CERTIFICATE', 'SCHOOL_ID',
                    'SCHOOL_TRANSCRIPT', 'CALIFORNIA_KID_ID',
                    -- coach / staff certificates (PROFILE_PHOTO is shared)
                    'FIRST_AID_CPR', 'YALF_TACKLE', 'BACKGROUND_CHECK', 'SAFESPORT')),
  -- Key of the object in the private object-storage bucket (server-generated, e.g.
  -- registration-documents/<registration_id>/<uuid>). Never a URL, never client-supplied.
  storage_key     text not null unique check (length(storage_key) > 0),
  file_name       text not null,
  mime_type       text not null,
  size_bytes      bigint check (size_bytes is null or size_bytes > 0),
  status          text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  uploaded_by     uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index documents_registration_id_idx on public.documents (registration_id);
create index documents_status_idx on public.documents (status);
-- One live document per type per registration; a rejected one is kept as history and can be replaced.
create unique index documents_one_live_per_type_key
  on public.documents (registration_id, document_type) where status <> 'REJECTED';

create table public.document_reviews (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete restrict,
  reviewer_id uuid not null references public.users (id) on delete restrict,
  decision    text not null check (decision in ('APPROVED', 'REJECTED')),
  reason_code text check (reason_code is null or reason_code in
                ('UNREADABLE', 'WRONG_TYPE', 'NAME_MISMATCH', 'EXPIRED', 'CUSTOM')),
  reason      text,
  notes       text,
  created_at  timestamptz not null default now(),
  -- A rejection must say why.
  check (decision = 'APPROVED' or length(btrim(coalesce(reason, ''))) > 0)
);
create index document_reviews_document_id_idx on public.document_reviews (document_id, created_at);
create index document_reviews_reviewer_id_idx on public.document_reviews (reviewer_id);

-- A consent is one immutable version of a piece of consent text. To change the wording, add a new version.
-- TODO(client): production wording for every consent (guardian consent, AB 506 acknowledgement,
-- biometric / face-scan consent) must be supplied and approved by the client / counsel before launch.
-- Nothing in this repository is final legal text.
create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  code         text not null check (code ~ '^[A-Z][A-Z0-9_]*$'),   -- e.g. GUARDIAN_CONSENT
  version      integer not null check (version > 0),
  title        text not null,
  body         text not null check (length(btrim(body)) > 0),
  effective_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (code, version)
);

create function public.consents_freeze_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'consents are immutable: delete is not allowed' using errcode = 'restrict_violation';
  end if;
  if new.code is distinct from old.code or new.version is distinct from old.version
     or new.title is distinct from old.title or new.body is distinct from old.body then
    raise exception 'consent text is immutable: publish a new version instead'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger consents_freeze_content before update or delete on public.consents
  for each row execute function public.consents_freeze_content();

create table public.consent_records (
  id                  uuid primary key default gen_random_uuid(),
  consent_id          uuid not null references public.consents (id) on delete restrict,
  registration_id     uuid not null references public.registrations (id) on delete restrict,
  -- The signer: a logged-in user and/or a guardian record (guardians may sign via an emailed link).
  accepted_by_user_id   uuid references public.users (id) on delete restrict,
  accepted_by_parent_id uuid references public.parents (id) on delete restrict,
  signed_name         text not null check (length(btrim(signed_name)) > 0),
  accepted_at         timestamptz not null default now(),
  ip_address          inet,
  user_agent          text,
  created_at          timestamptz not null default now(),
  check (accepted_by_user_id is not null or accepted_by_parent_id is not null),
  unique (consent_id, registration_id)
);
create index consent_records_registration_id_idx on public.consent_records (registration_id);
create index consent_records_parent_idx on public.consent_records (accepted_by_parent_id);
create index consent_records_user_idx on public.consent_records (accepted_by_user_id);

-- TODO(Phase 8): Stripe webhook processing MUST be idempotent before payments are production-ready
-- (record each Stripe event id, ignore replays, make the payment + registration update one atomic
-- step). Needs a processed-events table that does not exist yet. See docs/architecture.md.
create table public.payments (
  id                        uuid primary key default gen_random_uuid(),
  registration_id           uuid not null references public.registrations (id) on delete restrict,
  status                    text not null default 'PAYMENT_PENDING' check (status in
                              ('PAYMENT_PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED')),
  amount_cents              integer not null check (amount_cents >= 0),
  currency                  text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id  text unique,
  failure_reason            text,
  paid_at                   timestamptz,
  refunded_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (status <> 'PAID' or paid_at is not null),
  check (status <> 'REFUNDED' or refunded_at is not null)
);
create index payments_registration_id_idx on public.payments (registration_id);
create index payments_status_idx on public.payments (status);
-- A registration can retry after a failure, but never has two open attempts or two successful charges.
create unique index payments_one_pending_per_registration_key
  on public.payments (registration_id) where status = 'PAYMENT_PENDING';
create unique index payments_one_paid_per_registration_key
  on public.payments (registration_id) where status = 'PAID';

create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger document_reviews_append_only before update or delete on public.document_reviews
  for each row execute function public.prevent_mutation();
create trigger consent_records_append_only before update or delete on public.consent_records
  for each row execute function public.prevent_mutation();
