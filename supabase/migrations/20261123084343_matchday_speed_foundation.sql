-- Matchday speed benchmark: when a video was uploaded, and when the
-- match ended. Not applied by the app or by CI. Run this file in the
-- Supabase SQL editor (project ref dsxijgrpxsfywxuffbmt) before the
-- benchmark can read either value. sync-background.js and fixtures-sync.js
-- both no-op the new write if this has not been applied yet, so a deploy
-- can land first.
--
-- frfc_videos is one row per YouTube video. frfc_video_metrics stays a
-- per-sync stats history (views, likes, comments). published_at does not
-- change between syncs, and the playlist response already carries it, so
-- it does not belong on every metrics snapshot.
--
-- frfc_fixtures.finished_at is the full-time instant used by the
-- benchmark. football-data.org v4 has no whistle timestamp (utcDate is
-- kickoff; lastUpdated is when their row was edited). fixtures-sync.js
-- therefore stores kickoff + 105 minutes, plus 30 minutes when
-- score.duration is EXTRA_TIME or PENALTY_SHOOTOUT, with
-- full_time_source = 'estimated'. 'api' is reserved for a later source
-- that actually reports the whistle.

create table if not exists public.frfc_videos (
  video_id text primary key,
  creator_id uuid not null references public.frfc_streamers (id) on delete cascade,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.frfc_videos is
  'One row per YouTube video. published_at is snippet.publishedAt from the uploads playlist already fetched by sync-background.js.';

comment on column public.frfc_videos.video_id is
  'YouTube video id. Primary key.';

comment on column public.frfc_videos.published_at is
  'When the video was published on YouTube. Null only if a row is inserted before that timestamp is known.';

comment on column public.frfc_videos.updated_at is
  'When sync-background.js last upserted this row.';

create index if not exists frfc_videos_creator_id_idx
  on public.frfc_videos (creator_id);

create index if not exists frfc_videos_published_at_idx
  on public.frfc_videos (published_at);

alter table public.frfc_videos enable row level security;

revoke all on table public.frfc_videos from public, anon, authenticated;
grant select on table public.frfc_videos to anon, authenticated;
grant select, insert, update, delete on table public.frfc_videos to service_role;

drop policy if exists "anyone can read video publish times" on public.frfc_videos;
create policy "anyone can read video publish times"
  on public.frfc_videos
  for select
  to anon, authenticated
  using (true);

alter table public.frfc_fixtures
  add column if not exists finished_at timestamptz,
  add column if not exists full_time_source text,
  add column if not exists extra_time boolean;

comment on column public.frfc_fixtures.finished_at is
  'Full-time instant for the matchday speed benchmark. Null until fixtures-sync records it.';

comment on column public.frfc_fixtures.full_time_source is
  'api when a feed reports the whistle, estimated when finished_at is kickoff plus 105 minutes (plus 30 if the match went to extra time or penalties).';

comment on column public.frfc_fixtures.extra_time is
  'True when the feed reports extra time or a penalty shootout. Null until a sync classifies the match.';

alter table public.frfc_fixtures
  drop constraint if exists frfc_fixtures_full_time_source_check;
alter table public.frfc_fixtures
  add constraint frfc_fixtures_full_time_source_check
  check (full_time_source is null or full_time_source in ('api', 'estimated'));

alter table public.frfc_fixtures
  drop constraint if exists frfc_fixtures_finished_at_source_check;
alter table public.frfc_fixtures
  add constraint frfc_fixtures_finished_at_source_check
  check (
    (finished_at is null and full_time_source is null)
    or (finished_at is not null and full_time_source is not null)
  );

create index if not exists frfc_fixtures_finished_at_idx
  on public.frfc_fixtures (finished_at)
  where finished_at is not null;

-- Down migration (do not run as part of the up migration):
-- drop index if exists public.frfc_fixtures_finished_at_idx;
-- alter table public.frfc_fixtures
--   drop constraint if exists frfc_fixtures_finished_at_source_check,
--   drop constraint if exists frfc_fixtures_full_time_source_check,
--   drop column if exists extra_time,
--   drop column if exists full_time_source,
--   drop column if exists finished_at;
-- drop table if exists public.frfc_videos;
