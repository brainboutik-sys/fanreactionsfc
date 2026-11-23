-- Stripe webhook state for the paid Verified tier.
--
-- This file is the migration. It is NOT applied by the app or by CI.
-- Run it in the Supabase SQL editor (project ref dsxijgrpxsfywxuffbmt)
-- before the Netlify function netlify/functions/stripe-webhook.js can
-- record events. `create table if not exists` keeps a re-run safe.
--
-- frfc_stripe_events is the idempotency log (one row per Stripe event id).
-- frfc_verified_subscriptions links a Stripe customer and subscription to
-- the creator id Checkout received as client_reference_id.
--
-- Neither table is readable or writable by anon or authenticated. The
-- webhook uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. Browser
-- clients must not see Stripe customer or subscription ids.
--
-- What the webhook does to frfc_streamers (service role):
--   invoice.paid sets is_verified = true and moves verified_until forward
--   to that invoice's billing-period end. An open-ended comp
--   (is_verified true and verified_until null) is left open-ended.
--   customer.subscription.deleted marks this table canceled and leaves
--   is_verified / verified_until alone, so a paid period runs out on its
--   own. invoice.payment_failed marks past_due and does not extend or
--   clear the current period.

create table if not exists public.frfc_stripe_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

comment on table public.frfc_stripe_events is
  'Stripe webhook event ids already handled by stripe-webhook.js. Service role only.';

comment on column public.frfc_stripe_events.event_id is
  'Stripe event id (evt_...). Primary key so a redelivery is a no-op.';

create table if not exists public.frfc_verified_subscriptions (
  stripe_subscription_id text primary key,
  stripe_customer_id text not null,
  creator_id uuid not null references public.frfc_streamers (id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint frfc_verified_subscriptions_status_check
    check (status in ('active', 'past_due', 'canceled'))
);

comment on table public.frfc_verified_subscriptions is
  'Stripe customer and subscription ids for one creator. Written only by the service role from the Verified webhook.';

comment on column public.frfc_verified_subscriptions.creator_id is
  'frfc_streamers.id, taken from Checkout client_reference_id after the row is confirmed to exist.';

comment on column public.frfc_verified_subscriptions.status is
  'active after checkout or invoice.paid, past_due after invoice.payment_failed, canceled after customer.subscription.deleted. Does not itself grant the badge.';

create index if not exists frfc_verified_subscriptions_creator_id_idx
  on public.frfc_verified_subscriptions (creator_id);

create index if not exists frfc_verified_subscriptions_customer_id_idx
  on public.frfc_verified_subscriptions (stripe_customer_id);

alter table public.frfc_stripe_events enable row level security;
alter table public.frfc_verified_subscriptions enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies. anon and authenticated have
-- no access. service_role bypasses RLS and receives the grants below.
revoke all on table public.frfc_stripe_events from public, anon, authenticated;
revoke all on table public.frfc_verified_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.frfc_stripe_events to service_role;
grant select, insert, update, delete on table public.frfc_verified_subscriptions to service_role;
