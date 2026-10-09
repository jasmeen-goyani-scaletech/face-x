-- Up Migration

-- Payments reuse the existing `payments` table (states PAYMENT_PENDING / PAID / FAILED / CANCELLED / REFUNDED,
-- Stripe session and payment-intent references, at most one open and one PAID payment per registration).
-- Payment state is its own state: it is never folded into the registration, document, consent or check-in state.

alter table public.payments
  add column provider text not null default 'STRIPE' check (provider in ('STRIPE')),
  -- When the provider will expire the hosted checkout page if the customer does not pay.
  add column checkout_expires_at timestamptz,
  -- Who started the checkout (the registration's owner). Null only for rows created by the system.
  add column created_by uuid references public.users (id) on delete set null;

-- `failure_reason` holds a short machine code only (e.g. CHECKOUT_EXPIRED, SUPERSEDED, card_declined),
-- never provider payloads or card details. Make that explicit and bounded.
alter table public.payments
  add constraint payments_failure_reason_length_check check (failure_reason is null or length(failure_reason) <= 100),
  -- A payment is for a real amount. (Free events need no payment record.)
  add constraint payments_amount_positive_check check (amount_cents > 0),
  -- A PAID payment must carry the provider's reference, so it can be matched to the charge later.
  add constraint payments_paid_has_reference_check
    check (status <> 'PAID' or stripe_payment_intent_id is not null or stripe_checkout_session_id is not null);

create index payments_created_by_idx on public.payments (created_by) where created_by is not null;

-- Every provider webhook event is recorded exactly once. The primary key is the idempotency guard: an event is
-- inserted in the SAME transaction that applies it, so "recorded" means "applied", a replay (sequential or
-- simultaneous) finds the row and does nothing, and a failure rolls both back so the provider's retry is applied.
create table public.payment_webhook_events (
  provider    text not null check (provider in ('STRIPE')),
  event_id    text not null check (length(event_id) between 1 and 255),
  event_type  text not null check (length(event_type) between 1 and 100),
  -- The payment the event was applied to (null when the event concerned no payment of ours).
  payment_id  uuid references public.payments (id) on delete restrict,
  outcome     text not null check (outcome in ('APPLIED', 'NOOP', 'IGNORED', 'REJECTED')),
  -- Short machine code explaining the outcome. Never the provider payload.
  detail      text check (detail is null or length(detail) <= 100),
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
create index payment_webhook_events_payment_id_idx on public.payment_webhook_events (payment_id)
  where payment_id is not null;

-- Processed events are never removed (they are the proof an event was already applied).
create trigger payment_webhook_events_no_delete before delete on public.payment_webhook_events
  for each row execute function public.prevent_mutation();
