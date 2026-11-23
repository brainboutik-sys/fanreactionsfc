-- Club-hub match clicks and Streamwall plays.
-- Not applied by the app or by CI. Run this file in the Supabase SQL
-- editor (project ref dsxijgrpxsfywxuffbmt) after merging. Until it runs,
-- link-click.js accepts live_hub and streamwall_play but the insert
-- returns 503 because of the check constraint.
--
-- Requires supabase/migrations/20261026110000_frfc_link_clicks.sql.
-- Keeps "poll" from 20261113100000_frfc_article_poll_votes.sql.
--
-- live_hub is the club-hub YouTube button during a match window or while
-- that creator is live. streamwall_play is adding a stream on Streamwall
-- or opening one in a new tab. Neither is counted as link_type "live".
-- The counts view already groups by link_type, so these show as their
-- own rows. No view change.

alter table public.frfc_link_clicks
  drop constraint if exists frfc_link_clicks_link_type_check;

alter table public.frfc_link_clicks
  add constraint frfc_link_clicks_link_type_check
  check (link_type in ('live', 'channel', 'poll', 'live_hub', 'streamwall_play'));

comment on column public.frfc_link_clicks.link_type is
  'live (watch-live links), channel (channel page), poll (article poll), live_hub (club-hub button during a match), or streamwall_play (Streamwall add or open). live_hub and streamwall_play are not live.';

-- Rollback. Delete the new rows first or the check will fail:
--   delete from public.frfc_link_clicks
--     where link_type in ('live_hub', 'streamwall_play');
--   alter table public.frfc_link_clicks drop constraint if exists frfc_link_clicks_link_type_check;
--   alter table public.frfc_link_clicks add constraint frfc_link_clicks_link_type_check
--     check (link_type in ('live', 'channel', 'poll'));
--   comment on column public.frfc_link_clicks.link_type is
--     'live, channel, or poll. poll is a creator-page link inside the article poll.';
