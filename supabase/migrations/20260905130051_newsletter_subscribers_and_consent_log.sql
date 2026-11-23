
-- P0.2: MailerLite newsletter data model.
-- Writes happen only through service-role Netlify functions (newsletter-subscribe.js,
-- newsletter-confirm.js, newsletter-unsubscribe.js, the mailerlite webhook handler) —
-- no client-writable RLS policies here, same trust-root pattern as frfc_admin_roles.

create table frfc_newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending' check (status in ('pending','active','unsubscribed','bounced','complained')),
  source text not null check (source in ('site_footer','news_page','account','admin')),
  is_site_member boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  mailerlite_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);

create unique index frfc_newsletter_subscribers_email_lower_idx
  on frfc_newsletter_subscribers (lower(email));

create index frfc_newsletter_subscribers_status_idx on frfc_newsletter_subscribers (status);
create index frfc_newsletter_subscribers_user_id_idx on frfc_newsletter_subscribers (user_id) where user_id is not null;

create table frfc_newsletter_consent_log (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  action text not null check (action in ('opt_in','confirm','opt_out','erase')),
  notice_version text not null,
  source text not null,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index frfc_newsletter_consent_log_email_lower_idx on frfc_newsletter_consent_log (lower(email));
create index frfc_newsletter_consent_log_created_at_idx on frfc_newsletter_consent_log (created_at);

alter table frfc_newsletter_subscribers enable row level security;
alter table frfc_newsletter_consent_log enable row level security;

-- New granular permission for the P1 admin UI (subscriber list / manual suppress / resync).
insert into frfc_permissions (key, category, label, description) values
  ('newsletter.manage', 'Newsletter', 'Manage newsletter subscribers', 'View subscribers, suppress/export, trigger MailerLite resync')
on conflict (key) do nothing;

insert into frfc_role_permissions (role_slug, permission_key)
select r.slug, 'newsletter.manage'
from frfc_roles r
where r.slug in ('super_admin','admin')
on conflict do nothing;

create policy "newsletter.manage can read newsletter subscribers"
  on frfc_newsletter_subscribers for select
  using (frfc_has_permission(auth.uid(), 'newsletter.manage'));

create policy "newsletter.manage can read consent log"
  on frfc_newsletter_consent_log for select
  using (frfc_has_permission(auth.uid(), 'newsletter.manage'));
