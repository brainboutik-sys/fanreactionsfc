-- Review queue for invoice.paid events whose subscription was never
-- linked to a creator. Not applied by the app or by CI. Run it in the
-- Supabase SQL editor (project ref dsxijgrpxsfywxuffbmt) before the
-- admin list can read these rows. stripe-webhook.js still returns 200
-- for a stale unlinked invoice if this table is missing; the ids are
-- then only in the function log.
--
-- Rows are Stripe ids only: event, subscription, customer, invoice.
-- No email, name, card data, IP, or user id. Service role only.

create table if not exists public.frfc_stripe_unlinked_invoices (
  event_id text primary key,
  stripe_subscription_id text not null,
  stripe_customer_id text,
  invoice_id text,
  event_created_at timestamptz,
  logged_at timestamptz not null default now()
);

comment on table public.frfc_stripe_unlinked_invoices is
  'invoice.paid events older than one hour that were not linked to a creator. Service role only. For manual review.';

comment on column public.frfc_stripe_unlinked_invoices.event_id is
  'Stripe event id (evt_...). One row per event.';

comment on column public.frfc_stripe_unlinked_invoices.stripe_customer_id is
  'Stripe customer id (cus_...) when the invoice had one. Not an email.';

alter table public.frfc_stripe_unlinked_invoices enable row level security;

revoke all on table public.frfc_stripe_unlinked_invoices from public, anon, authenticated;
grant select, insert, update, delete on table public.frfc_stripe_unlinked_invoices to service_role;
