-- Article poll votes ("Who reacted best?").
-- Not applied by the app or by CI. Run this file in the Supabase SQL
-- editor (project ref dsxijgrpxsfywxuffbmt) before the poll can store a
-- vote or read a share. The site switch is ARTICLE_POLL_ENABLED in
-- js/lib/article-poll.js: false hides the poll without dropping this table.
--
-- One row is one browser's vote on one published article. client_id is
-- a random UUID minted in localStorage (frfc_article_poll_client). It is
-- not an account id, IP address, or user agent. The unique key is the
-- abuse limit: the same client id cannot insert a second row for the
-- same article. Raw rows are not readable by anon or authenticated.
-- Counts come back only through frfc_article_poll_counts.

create table if not exists public.frfc_article_poll_votes (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.frfc_articles (id) on delete cascade,
  creator_slug text not null,
  client_id text not null,
  created_at timestamptz not null default now(),
  constraint frfc_article_poll_votes_article_client_key unique (article_id, client_id),
  constraint frfc_article_poll_votes_slug_check check (
    char_length(creator_slug) between 1 and 80
    and creator_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint frfc_article_poll_votes_client_check check (
    client_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

comment on table public.frfc_article_poll_votes is
  'One vote per browser per news article. client_id is a random UUID, not an account id.';

comment on column public.frfc_article_poll_votes.client_id is
  'Random UUID from localStorage key frfc_article_poll_client. Not a user id.';

comment on column public.frfc_article_poll_votes.creator_slug is
  'frfc_streamers.slug the voter picked. Must appear as /creators/<slug> in the published article body.';

alter table public.frfc_article_poll_votes enable row level security;

revoke all on table public.frfc_article_poll_votes from public, anon, authenticated;
grant insert on table public.frfc_article_poll_votes to anon, authenticated;
grant usage, select on sequence public.frfc_article_poll_votes_id_seq to anon, authenticated;
grant select, insert, update, delete on table public.frfc_article_poll_votes to service_role;

-- Insert check. security definer so the published-article and body lookup
-- does not depend on the caller's select grants. Returns a boolean only.
create or replace function public.frfc_article_poll_vote_ok(
  p_article_id uuid,
  p_creator_slug text,
  p_client_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_creator_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and char_length(p_creator_slug) between 1 and 80
      and p_client_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then exists (
        select 1
        from public.frfc_streamers s
        where lower(s.slug) = p_creator_slug
      )
      and exists (
        select 1
        from public.frfc_articles a
        where a.id = p_article_id
          and a.status = 'published'
          and a.body ~* ('/creators/' || p_creator_slug || '([^a-z0-9-]|$)')
      )
    else false
  end;
$$;

comment on function public.frfc_article_poll_vote_ok(uuid, text, text) is
  'True when a poll insert names a real creator linked from a published article body.';

revoke all on function public.frfc_article_poll_vote_ok(uuid, text, text) from public;
grant execute on function public.frfc_article_poll_vote_ok(uuid, text, text) to anon, authenticated, service_role;

drop policy if exists frfc_article_poll_votes_insert on public.frfc_article_poll_votes;
create policy frfc_article_poll_votes_insert
  on public.frfc_article_poll_votes
  for insert
  to anon, authenticated
  with check (public.frfc_article_poll_vote_ok(article_id, creator_slug, client_id));

-- Aggregates only. No client id is returned. Unpublished articles return no rows.
create or replace function public.frfc_article_poll_counts(p_article_id uuid)
returns table (creator_slug text, votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select v.creator_slug, count(*)::bigint as votes
  from public.frfc_article_poll_votes v
  where v.article_id = p_article_id
    and exists (
      select 1
      from public.frfc_articles a
      where a.id = p_article_id
        and a.status = 'published'
    )
  group by v.creator_slug
  order by v.creator_slug;
$$;

comment on function public.frfc_article_poll_counts(uuid) is
  'Vote totals per creator for one published article. Does not return client ids.';

revoke all on function public.frfc_article_poll_counts(uuid) from public;
grant execute on function public.frfc_article_poll_counts(uuid) to anon, authenticated, service_role;

-- Poll links on creator names use the existing click log. Widen the
-- link_type check so link-click.js can store link_type = 'poll'.
-- Requires supabase/migrations/20261026110000_frfc_link_clicks.sql.
alter table public.frfc_link_clicks
  drop constraint if exists frfc_link_clicks_link_type_check;

alter table public.frfc_link_clicks
  add constraint frfc_link_clicks_link_type_check
  check (link_type in ('live', 'channel', 'poll'));

comment on column public.frfc_link_clicks.link_type is
  'live, channel, or poll. poll is a creator-page link inside the article poll.';

-- Site rollback without SQL: set ARTICLE_POLL_ENABLED to false in
-- js/lib/article-poll.js. That removes the poll. To drop the storage later:
--   drop function if exists public.frfc_article_poll_counts(uuid);
--   drop function if exists public.frfc_article_poll_vote_ok(uuid, text, text);
--   drop table if exists public.frfc_article_poll_votes;
--   alter table public.frfc_link_clicks drop constraint if exists frfc_link_clicks_link_type_check;
--   alter table public.frfc_link_clicks add constraint frfc_link_clicks_link_type_check
--     check (link_type in ('live', 'channel'));
