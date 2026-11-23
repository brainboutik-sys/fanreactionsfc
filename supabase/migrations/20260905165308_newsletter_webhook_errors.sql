
create table frfc_newsletter_webhook_errors (
  id uuid primary key default gen_random_uuid(),
  event_type text,
  email text,
  error_detail text not null,
  created_at timestamptz not null default now()
);

create index frfc_newsletter_webhook_errors_created_at_idx on frfc_newsletter_webhook_errors (created_at desc);

alter table frfc_newsletter_webhook_errors enable row level security;

create policy "newsletter.manage can read webhook errors"
  on frfc_newsletter_webhook_errors for select
  using (frfc_has_permission(auth.uid(), 'newsletter.manage'));
