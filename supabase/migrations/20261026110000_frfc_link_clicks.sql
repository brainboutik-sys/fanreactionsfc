-- Click counts for a creator's watch-live link and channel link.
-- Not applied by the app or by CI. Run it in the Supabase SQL editor
-- (project ref dsxijgrpxsfywxuffbmt) before link-click.js can insert.
--
-- A row is: which creator, which club page context (if any), live or
-- channel, the site path, and the database clock. No IP address, user
-- agent, user id, cookie, or other visitor identifier.

create table if not exists public.frfc_link_clicks (
  id bigint generated always as identity primary key,
  creator_id uuid,
  creator_slug text not null,
  club text,
  link_type text not null,
  page_path text not null,
  created_at timestamptz not null default now(),
  constraint frfc_link_clicks_link_type_check check (link_type in ('live', 'channel'))
);

comment on table public.frfc_link_clicks is
  'One row per click on a creator channel or watch-live link. Service role only. No visitor identifier.';

comment on column public.frfc_link_clicks.creator_id is
  'frfc_streamers.id looked up from the slug. Not a user id.';

comment on column public.frfc_link_clicks.club is
  'Club name from the page that held the link, when that page had one.';

comment on column public.frfc_link_clicks.page_path is
  'Site path only, such as /creators/aftv. No query string.';

create index if not exists frfc_link_clicks_created_at_idx
  on public.frfc_link_clicks (created_at desc);

create index if not exists frfc_link_clicks_creator_idx
  on public.frfc_link_clicks (creator_slug, created_at desc);

alter table public.frfc_link_clicks enable row level security;

revoke all on table public.frfc_link_clicks from public, anon, authenticated;
grant select, insert, update, delete on table public.frfc_link_clicks to service_role;

-- Counts per creator, club, and link type. The 30-day filter is the
-- window; clicks_7d is the subset. security_invoker so a later grant
-- cannot bypass the table's row level security.
create or replace view public.frfc_link_click_counts as
select
  creator_slug,
  club,
  link_type,
  count(*) filter (where created_at >= now() - interval '7 days') as clicks_7d,
  count(*) filter (where created_at >= now() - interval '30 days') as clicks_30d
from public.frfc_link_clicks
where created_at >= now() - interval '30 days'
group by creator_slug, club, link_type;

alter view public.frfc_link_click_counts set (security_invoker = true);

revoke all on table public.frfc_link_click_counts from public, anon, authenticated;
grant select on table public.frfc_link_click_counts to service_role;

-- Retention is 90 days. The daily retention-cleanup.js job deletes
-- older rows. pg_cron is not scheduled here: this project does not
-- enable that extension, and create extension would fail where it is
-- unavailable.
