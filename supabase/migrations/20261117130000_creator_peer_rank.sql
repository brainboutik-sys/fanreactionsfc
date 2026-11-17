-- Peer rank for the Verified stats card, and owner-only referral clicks.
-- Not applied by the app or by CI. Run this file in the Supabase SQL
-- editor (project ref dsxijgrpxsfywxuffbmt) when the stats page should
-- use one database round trip. Until then creator-stats.js computes the
-- public block from frfc_streamers, frfc_video_metrics, and
-- frfc_subscriber_history. Referral totals stay unavailable until
-- frfc_owner_referral_clicks exists: frfc_link_clicks is not readable
-- by the browser.
--
-- Do not use frfc_streamers.subscriber_count_prev or rank_snapshot_at.
-- Those columns were re-baselined on 16 Nov 2026.
--
-- frfc_link_click_counts groups by creator slug and club. The owner
-- block needs one channel total and one live total for a creator id,
-- so the RPC reads frfc_link_clicks by creator_id. Poll clicks are
-- left out. A caller who is not the channel owner gets an error and
-- no counts.
--
-- Rollback (this does not delete click rows):
--   drop function if exists public.frfc_owner_referral_clicks(uuid);
--   drop function if exists public.frfc_creator_peer_rank(uuid);
--   drop function if exists public.frfc_club_identity(text);
--   drop index if exists public.frfc_link_clicks_creator_id_created_idx;

-- Display name, slug, and casing collapse to one club. The JSON maps
-- are the same objects as js/lib/club-slugs.js.
create or replace function public.frfc_club_identity(p_team text)
returns table (slug text, label text)
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  raw text := btrim(coalesce(p_team, ''));
  slugged text;
  display text;
  -- peer-rank-overrides:start
  overrides jsonb := $overrides${"Man United":"manchester-united","Man City":"manchester-city","Nottm Forest":"nottingham-forest","Oxford Utd":"oxford-united","Sheffield Utd":"sheffield-united","Sheffield Wed":"sheffield-wednesday","West Brom":"west-bromwich-albion","Multi-Club / Other":"multi-club"}$overrides$::jsonb;
  -- peer-rank-overrides:end
  -- peer-rank-aliases:start
  aliases jsonb := $aliases${"man-united":"Man United","man-utd":"Man United","manutd":"Man United","manchester-united":"Man United","man-city":"Man City","manchester-city":"Man City","nottm-forest":"Nottm Forest","nottingham-forest":"Nottm Forest","notts-forest":"Nottm Forest","oxford-utd":"Oxford Utd","oxford-united":"Oxford Utd","sheffield-utd":"Sheffield Utd","sheffield-united":"Sheffield Utd","sheffield-wed":"Sheffield Wed","sheffield-wednesday":"Sheffield Wed","west-brom":"West Brom","west-bromwich-albion":"West Brom","psg":"PSG","paris-saint-germain":"PSG","multi-club":"Multi-Club / Other","multi-club-other":"Multi-Club / Other"}$aliases$::jsonb;
  -- peer-rank-aliases:end
  -- peer-rank-names:start
  names jsonb := $names$["Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Chelsea","Coventry","Crystal Palace","Everton","Fulham","Hull City","Ipswich","Leeds United","Liverpool","Man City","Man United","Newcastle","Nottm Forest","Sunderland","Tottenham","Birmingham","Blackburn","Bristol City","Burnley","Charlton","Derby","Leicester","Middlesbrough","Millwall","Norwich","Oxford Utd","Portsmouth","Preston","QPR","Sheffield Utd","Sheffield Wed","Southampton","Stoke","Swansea","Watford","West Brom","West Ham","Wolves","Wrexham","Luton","Barcelona","Real Madrid","Atletico Madrid","Sevilla","Real Betis","Real Sociedad","Villarreal","Athletic Bilbao","Valencia","Celta Vigo","Espanyol","Getafe","Osasuna","Mallorca","Rayo Vallecano","Girona","Las Palmas","Alaves","Valladolid","Leganes","Juventus","AC Milan","Inter Milan","Napoli","Roma","Lazio","Atalanta","Fiorentina","Bologna","Torino","Udinese","Monza","Empoli","Genoa","Cagliari","Lecce","Hellas Verona","Parma","Venezia","Como","Bayern Munich","Borussia Dortmund","RB Leipzig","Bayer Leverkusen","Union Berlin","Freiburg","Eintracht Frankfurt","Wolfsburg","Mainz","Borussia Monchengladbach","Hoffenheim","Werder Bremen","Augsburg","Bochum","Heidenheim","Stuttgart","Holstein Kiel","St. Pauli","PSG","Marseille","Lyon","Monaco","Lille","Nice","Rennes","Lens","Strasbourg","Nantes","Montpellier","Toulouse","Brest","Reims","Le Havre","Auxerre","Angers","Saint-Etienne","Multi-Club / Other"]$names$::jsonb;
  -- peer-rank-names:end
begin
  if raw = '' then
    slug := '';
    label := '';
    return next;
    return;
  end if;

  select value into display
  from jsonb_array_elements_text(names) as value
  where lower(value) = lower(raw)
  limit 1;
  if display is not null then
    slug := coalesce(overrides ->> display, trim(both '-' from regexp_replace(lower(display), '[^a-z0-9]+', '-', 'g')));
    label := display;
    return next;
    return;
  end if;

  slugged := trim(both '-' from regexp_replace(lower(raw), '[^a-z0-9]+', '-', 'g'));
  if slugged = '' then
    slug := '';
    label := '';
    return next;
    return;
  end if;

  display := aliases ->> slugged;
  if display is not null then
    slug := coalesce(overrides ->> display, trim(both '-' from regexp_replace(lower(display), '[^a-z0-9]+', '-', 'g')));
    label := display;
    return next;
    return;
  end if;

  select o.key into display
  from jsonb_each_text(overrides) as o
  where o.value = slugged
  limit 1;
  if display is not null then
    slug := slugged;
    label := display;
    return next;
    return;
  end if;

  select value into display
  from jsonb_array_elements_text(names) as value
  where trim(both '-' from regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g')) = slugged
  limit 1;
  if display is not null then
    slug := coalesce(overrides ->> display, slugged);
    label := display;
    return next;
    return;
  end if;

  slug := slugged;
  label := raw;
  return next;
end;
$$;

revoke all on function public.frfc_club_identity(text) from public;
grant execute on function public.frfc_club_identity(text) to anon, authenticated, service_role;

comment on function public.frfc_club_identity(text) is
  'Canonical club slug and display label. Display name, slug, and casing are one club. Mirrors js/lib/club-slugs.js.';

-- Public comparison. security invoker so it only sees rows the caller
-- can already read (subscriber totals, video snapshots, and subscriber
-- history are public). No click rows.
create or replace function public.frfc_creator_peer_rank(p_creator_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select
      s.id,
      coalesce(s.subscriber_count, 0) as subscriber_count,
      ident.slug as club_slug,
      ident.label as club_label
    from public.frfc_streamers s
    cross join lateral public.frfc_club_identity(s.team) as ident
    where s.id = p_creator_id
  ),
  peers as (
    select s.id, coalesce(s.subscriber_count, 0) as subscriber_count
    from public.frfc_streamers s
    cross join lateral public.frfc_club_identity(s.team) as ident
    join me on me.club_slug <> '' and ident.slug = me.club_slug
  ),
  latest as (
    select distinct on (m.creator_id, m.video_id)
      m.creator_id,
      coalesce(m.views, 0) as views
    from public.frfc_video_metrics m
    where m.recorded_at >= now() - interval '30 days'
      and m.recorded_at <= now()
      and m.creator_id in (select id from peers union select id from me)
    order by m.creator_id, m.video_id, m.recorded_at desc, m.views desc
  ),
  avgs as (
    select
      creator_id,
      avg(views)::double precision as views_per_video,
      count(*)::integer as video_count
    from latest
    group by creator_id
  ),
  anchor as (
    select h.subscriber_count, h.recorded_at
    from public.frfc_subscriber_history h
    where h.creator_id = p_creator_id
      and h.recorded_at <= now()
    order by h.recorded_at desc
    limit 1
  ),
  candidate as (
    select h.subscriber_count, h.recorded_at
    from public.frfc_subscriber_history h
    cross join anchor a
    where h.creator_id = p_creator_id
      and h.recorded_at < a.recorded_at
    order by abs(extract(epoch from (h.recorded_at - (a.recorded_at - interval '7 days')))) asc,
             h.recorded_at asc
    limit 1
  ),
  week as (
    select
      c.subscriber_count as from_count,
      a.subscriber_count as to_count,
      a.subscriber_count - c.subscriber_count as delta,
      c.recorded_at as from_at,
      a.recorded_at as to_at,
      round((extract(epoch from (a.recorded_at - c.recorded_at)) / 86400.0)::numeric, 1) as gap_days
    from anchor a
    join candidate c
      on a.recorded_at - c.recorded_at between interval '5 days' and interval '10 days'
  )
  select jsonb_build_object(
    'club_slug', coalesce((select club_slug from me), ''),
    'club_label', coalesce((select club_label from me), ''),
    'rank', case
      when coalesce((select club_slug from me), '') = '' then null
      else 1 + coalesce((
        select count(*)::integer
        from peers p, me
        where p.subscriber_count > me.subscriber_count
      ), 0)
    end,
    'club_size', case
      when coalesce((select club_slug from me), '') = '' then 0
      else coalesce((select count(*)::integer from peers), 0)
    end,
    'subscriber_count', coalesce((select subscriber_count from me), 0),
    'views_per_video', (select views_per_video from avgs where creator_id = p_creator_id),
    'video_count', coalesce((select video_count from avgs where creator_id = p_creator_id), 0),
    'club_median_views_per_video', case
      when (select count(*) from avgs) >= 2
        then (select percentile_cont(0.5) within group (order by views_per_video) from avgs)
      else null
    end,
    'club_creators_with_videos', coalesce((select count(*)::integer from avgs), 0),
    'week_delta', (select delta from week),
    'week_from_count', (select from_count from week),
    'week_to_count', (select to_count from week),
    'week_from_at', (select from_at from week),
    'week_to_at', (select to_at from week),
    'week_gap_days', (select gap_days from week)
  );
$$;

revoke all on function public.frfc_creator_peer_rank(uuid) from public;
grant execute on function public.frfc_creator_peer_rank(uuid) to anon, authenticated, service_role;

comment on function public.frfc_creator_peer_rank(uuid) is
  'Public Verified stats comparison: club subscriber rank, 30-day views per video against the club median, and week-on-week subscribers. Does not read click rows or the 16 Nov 2026 rank snapshot.';

-- Owner-only. security definer so it can read frfc_link_clicks, which
-- is revoked from anon and authenticated. auth.uid() must equal
-- frfc_streamers.claimed_by. Anyone else gets an error and no counts.
create or replace function public.frfc_owner_referral_clicks(p_creator_id uuid)
returns table (link_type text, clicks_7d bigint, clicks_30d bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_creator_id is null or not exists (
    select 1
    from public.frfc_streamers s
    where s.id = p_creator_id
      and s.claimed_by = auth.uid()
  ) then
    raise exception 'not the channel owner' using errcode = '42501';
  end if;

  return query
  select
    kinds.link_type,
    count(c.id) filter (where c.created_at >= now() - interval '7 days') as clicks_7d,
    count(c.id) filter (where c.created_at >= now() - interval '30 days') as clicks_30d
  from (values ('channel'::text), ('live'::text)) as kinds(link_type)
  left join public.frfc_link_clicks c
    on c.creator_id = p_creator_id
   and c.link_type = kinds.link_type
   and c.created_at >= now() - interval '30 days'
  group by kinds.link_type
  order by kinds.link_type;
end;
$$;

revoke all on function public.frfc_owner_referral_clicks(uuid) from public, anon, authenticated, service_role;
grant execute on function public.frfc_owner_referral_clicks(uuid) to authenticated;

comment on function public.frfc_owner_referral_clicks(uuid) is
  'Channel and watch-live click totals for the signed-in channel owner. Checks frfc_streamers.claimed_by = auth.uid(). Poll clicks are not included.';

create index if not exists frfc_link_clicks_creator_id_created_idx
  on public.frfc_link_clicks (creator_id, created_at desc);
