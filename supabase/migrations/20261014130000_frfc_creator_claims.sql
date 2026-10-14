-- Claim this channel.
--
-- DO NOT apply this file from the app. It is the reviewable migration for
-- Supabase project dsxijgrpxsfywxuffbmt. Apply it once, by hand, before the
-- new claim / manage-channel functions are used in production.
--
-- Security model
-- --------------
-- * Browser roles (anon, authenticated) cannot insert, update, or delete
--   frfc_creator_claims. There is no write policy and no write grant.
--   The Netlify function claim-creator.js writes with the service role
--   after it has checked the YouTube description itself.
-- * code_hash is an HMAC-SHA256 (pepper stays on the server). Authenticated
--   users may read their own claim status, but not code_hash or check_times.
--   A short code must not be recoverable from a leaked hash.
-- * At most one row per creator may have status = 'verified'.
-- * expires_at is at most 24 hours after created_at. The column default is
--   now() + 24 hours; the check constraint rejects a longer window.
-- * A verified owner edits a profile only by calling
--   frfc_owner_update_profile(). The function is SECURITY DEFINER, checks
--   auth.uid() against the verified claim (or a legacy claimed_by), and
--   accepts only description plus http(s) social links. Direct table
--   updates by anon/authenticated users who lack creators.edit are rejected
--   by frfc_tg_streamer_column_guard. Admin edits keep using the existing
--   "Admins update streamers" RLS policy (creators.edit) and are not clamped.
-- * The same trigger forces protected columns back to their previous values
--   during an owner update, so a future edit to the function cannot set
--   is_verified, verified_until, verified, subscriber stats, slug, team,
--   approval/admin flags, or claimed_by.
-- * Unclaim goes through frfc_owner_unclaim(), which may only clear the
--   caller's own claimed_by and revoke their verified row.

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

create table public.frfc_creator_claims (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.frfc_streamers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- HMAC-SHA256 hex of the one-time code. The plaintext is never stored.
  code_hash text not null,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  last_checked_at timestamptz,
  check_count integer not null default 0,
  check_times timestamptz[] not null default '{}',
  constraint frfc_creator_claims_code_hash_hex
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint frfc_creator_claims_status
    check (status in ('pending', 'verified', 'expired', 'superseded', 'revoked')),
  constraint frfc_creator_claims_expiry_window
    check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  constraint frfc_creator_claims_check_count_nonneg
    check (check_count >= 0),
  constraint frfc_creator_claims_verified_at
    check (status <> 'verified' or verified_at is not null)
);

comment on table public.frfc_creator_claims is
  'YouTube description challenges for creator ownership. Plaintext codes are not stored. One verified owner per creator.';

comment on column public.frfc_creator_claims.code_hash is
  'HMAC-SHA256 hex. Do not grant this column to anon or authenticated.';

-- One verified owner per creator.
create unique index frfc_creator_claims_one_verified
  on public.frfc_creator_claims (creator_id)
  where status = 'verified';

-- One live challenge per user per creator. Issuing a new code supersedes the old row first.
create unique index frfc_creator_claims_one_pending
  on public.frfc_creator_claims (creator_id, user_id)
  where status = 'pending';

create index frfc_creator_claims_user_created_idx
  on public.frfc_creator_claims (user_id, created_at desc);

create index frfc_creator_claims_creator_status_idx
  on public.frfc_creator_claims (creator_id, status);

create or replace function public.frfc_creator_claims_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger frfc_creator_claims_updated_at
  before update on public.frfc_creator_claims
  for each row execute function public.frfc_creator_claims_set_updated_at();

alter table public.frfc_creator_claims enable row level security;

-- Supabase default privileges grant DML to anon/authenticated on new tables.
-- Take that back, then grant the status columns a signed-in user may see.
revoke all on table public.frfc_creator_claims from public, anon, authenticated;

grant select (
  id,
  creator_id,
  user_id,
  status,
  expires_at,
  created_at,
  updated_at,
  verified_at
) on table public.frfc_creator_claims to authenticated;

-- No INSERT / UPDATE / DELETE grant. No policy for those commands either,
-- so a browser JWT cannot write a claim or flip status to verified.

create policy frfc_creator_claims_select_own
  on public.frfc_creator_claims
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy frfc_creator_claims_select_admin
  on public.frfc_creator_claims
  for select
  to authenticated
  using (public.frfc_has_permission((select auth.uid()), 'creators.edit'));

-- ---------------------------------------------------------------------------
-- Owner helpers
-- ---------------------------------------------------------------------------

create or replace function public.frfc_is_verified_owner(p_creator_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.frfc_creator_claims c
    where c.creator_id = p_creator_id
      and c.user_id = p_user_id
      and c.status = 'verified'
  )
  or exists (
    select 1
    from public.frfc_streamers s
    where s.id = p_creator_id
      and s.claimed_by = p_user_id
  );
$$;

revoke all on function public.frfc_is_verified_owner(uuid, uuid) from public, anon, authenticated;

-- http and https only. Empty clears the link. Rejects javascript:, data:,
-- protocol-relative URLs, and userinfo (user:pass@host).
create or replace function public.frfc_http_url_or_null(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := nullif(btrim(p_value), '');
  authority text;
begin
  if v is null then
    return null;
  end if;
  if char_length(v) > 300 then
    raise exception 'URL must be at most 300 characters' using errcode = '22023';
  end if;
  if v !~* '^https?://[^[:space:]<>"'']+$' then
    raise exception 'URL must be http or https' using errcode = '22023';
  end if;
  authority := split_part(regexp_replace(v, '^https?://', '', 'i'), '/', 1);
  if position('@' in authority) > 0 then
    raise exception 'URL must not include credentials' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function public.frfc_http_url_or_null(text) from public, anon, authenticated;

create or replace function public.frfc_owner_update_profile(p_creator_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_allowed text[] := array[
    'description', 'social_x', 'social_instagram', 'social_twitch', 'social_discord', 'social_tiktok'
  ];
  v_old public.frfc_streamers%rowtype;
  v_new_description text;
  v_changed text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_creator_id is null then
    raise exception 'creator id is required' using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch object is required' using errcode = '22023';
  end if;

  -- Anything outside the whitelist is rejected, including is_verified,
  -- verified_until, verified, subscriber stats, slug, team, league, name,
  -- claimed_by, featured, approval/status, and every other admin column.
  -- The whole call fails; forbidden keys are never applied alongside a bio.
  for v_key in select jsonb_object_keys(p_patch)
  loop
    if not (v_key = any (v_allowed)) then
      raise exception 'field is not editable: %', v_key using errcode = '42501';
    end if;
  end loop;

  if not public.frfc_is_verified_owner(p_creator_id, v_uid) then
    raise exception 'not the verified owner' using errcode = '42501';
  end if;

  select * into v_old from public.frfc_streamers where id = p_creator_id;
  if not found then
    raise exception 'creator not found' using errcode = 'P0002';
  end if;

  if p_patch ? 'description' then
    v_new_description := nullif(btrim(p_patch->>'description'), '');
    if v_new_description is not null and char_length(v_new_description) > 280 then
      raise exception 'description must be at most 280 characters' using errcode = '22023';
    end if;
    if v_new_description is not null and v_new_description ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]' then
      raise exception 'description contains invalid characters' using errcode = '22023';
    end if;
  end if;

  -- Validate every supplied social link before writing any column.
  if p_patch ? 'social_x' then
    perform public.frfc_http_url_or_null(p_patch->>'social_x');
  end if;
  if p_patch ? 'social_instagram' then
    perform public.frfc_http_url_or_null(p_patch->>'social_instagram');
  end if;
  if p_patch ? 'social_twitch' then
    perform public.frfc_http_url_or_null(p_patch->>'social_twitch');
  end if;
  if p_patch ? 'social_discord' then
    perform public.frfc_http_url_or_null(p_patch->>'social_discord');
  end if;
  if p_patch ? 'social_tiktok' then
    perform public.frfc_http_url_or_null(p_patch->>'social_tiktok');
  end if;

  -- Tells frfc_tg_streamer_column_guard to clamp every protected column
  -- for this transaction, even if the statement below is later widened.
  perform set_config('frfc.owner_profile_update', 'on', true);

  update public.frfc_streamers s
  set
    description = case
      when p_patch ? 'description' then nullif(btrim(p_patch->>'description'), '')
      else s.description
    end,
    social_x = case
      when p_patch ? 'social_x' then public.frfc_http_url_or_null(p_patch->>'social_x')
      else s.social_x
    end,
    social_instagram = case
      when p_patch ? 'social_instagram' then public.frfc_http_url_or_null(p_patch->>'social_instagram')
      else s.social_instagram
    end,
    social_twitch = case
      when p_patch ? 'social_twitch' then public.frfc_http_url_or_null(p_patch->>'social_twitch')
      else s.social_twitch
    end,
    social_discord = case
      when p_patch ? 'social_discord' then public.frfc_http_url_or_null(p_patch->>'social_discord')
      else s.social_discord
    end,
    social_tiktok = case
      when p_patch ? 'social_tiktok' then public.frfc_http_url_or_null(p_patch->>'social_tiktok')
      else s.social_tiktok
    end
  where s.id = p_creator_id;

  if p_patch ? 'description' and v_old.description is distinct from (
    select description from public.frfc_streamers where id = p_creator_id
  ) then
    v_changed := v_changed || 'description';
    insert into public.frfc_creator_edit_log (creator_id, user_id, field, old_value, new_value)
    values (
      p_creator_id, v_uid, 'description', v_old.description,
      (select description from public.frfc_streamers where id = p_creator_id)
    );
  end if;

  -- Log each social column that actually changed. Re-read so the values are
  -- the ones the guard trigger left in place.
  if p_patch ? 'social_x' and v_old.social_x is distinct from (select social_x from public.frfc_streamers where id = p_creator_id) then
    v_changed := v_changed || 'social_x';
    insert into public.frfc_creator_edit_log (creator_id, user_id, field, old_value, new_value)
    values (p_creator_id, v_uid, 'social_x', v_old.social_x, (select social_x from public.frfc_streamers where id = p_creator_id));
  end if;
  if p_patch ? 'social_instagram' and v_old.social_instagram is distinct from (select social_instagram from public.frfc_streamers where id = p_creator_id) then
    v_changed := v_changed || 'social_instagram';
    insert into public.frfc_creator_edit_log (creator_id, user_id, field, old_value, new_value)
    values (p_creator_id, v_uid, 'social_instagram', v_old.social_instagram, (select social_instagram from public.frfc_streamers where id = p_creator_id));
  end if;
  if p_patch ? 'social_twitch' and v_old.social_twitch is distinct from (select social_twitch from public.frfc_streamers where id = p_creator_id) then
    v_changed := v_changed || 'social_twitch';
    insert into public.frfc_creator_edit_log (creator_id, user_id, field, old_value, new_value)
    values (p_creator_id, v_uid, 'social_twitch', v_old.social_twitch, (select social_twitch from public.frfc_streamers where id = p_creator_id));
  end if;
  if p_patch ? 'social_discord' and v_old.social_discord is distinct from (select social_discord from public.frfc_streamers where id = p_creator_id) then
    v_changed := v_changed || 'social_discord';
    insert into public.frfc_creator_edit_log (creator_id, user_id, field, old_value, new_value)
    values (p_creator_id, v_uid, 'social_discord', v_old.social_discord, (select social_discord from public.frfc_streamers where id = p_creator_id));
  end if;
  if p_patch ? 'social_tiktok' and v_old.social_tiktok is distinct from (select social_tiktok from public.frfc_streamers where id = p_creator_id) then
    v_changed := v_changed || 'social_tiktok';
    insert into public.frfc_creator_edit_log (creator_id, user_id, field, old_value, new_value)
    values (p_creator_id, v_uid, 'social_tiktok', v_old.social_tiktok, (select social_tiktok from public.frfc_streamers where id = p_creator_id));
  end if;

  return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed));
end;
$$;

comment on function public.frfc_owner_update_profile(uuid, jsonb) is
  'Verified-owner profile edit. Whitelist: description (max 280) and http(s) social links. Never verification, stats, slug, team, or admin columns.';

revoke all on function public.frfc_owner_update_profile(uuid, jsonb) from public, anon;
grant execute on function public.frfc_owner_update_profile(uuid, jsonb) to authenticated;

create or replace function public.frfc_owner_unclaim(p_creator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_creator_id is null then
    raise exception 'creator id is required' using errcode = '22023';
  end if;
  if not public.frfc_is_verified_owner(p_creator_id, v_uid) then
    raise exception 'not the verified owner' using errcode = '42501';
  end if;

  update public.frfc_creator_claims
  set status = 'revoked'
  where creator_id = p_creator_id
    and user_id = v_uid
    and status = 'verified';

  perform set_config('frfc.owner_unclaim', 'on', true);

  update public.frfc_streamers
  set claimed_by = null
  where id = p_creator_id
    and claimed_by = v_uid;

  insert into public.frfc_creator_edit_log (creator_id, user_id, field, old_value, new_value)
  values (p_creator_id, v_uid, 'claimed_by', v_uid::text, null);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.frfc_owner_unclaim(uuid) is
  'Clears the caller''s own claim. Cannot clear another user or change any other column.';

revoke all on function public.frfc_owner_unclaim(uuid) from public, anon;
grant execute on function public.frfc_owner_unclaim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Column guard on frfc_streamers
-- ---------------------------------------------------------------------------
-- Runs before the existing frfc_streamers_updated_at trigger (name order).
-- * frfc.owner_profile_update: keep description + social links, restore
--   every protected column from OLD.
-- * frfc.owner_unclaim: restore the whole row and force claimed_by null.
-- * anon/authenticated without creators.edit: reject the update.
-- * service_role (YouTube sync) and admins (creators.edit) are unchanged.

create or replace function public.frfc_tg_streamer_column_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op is distinct from 'UPDATE' then
    return new;
  end if;

  if current_setting('frfc.owner_unclaim', true) = 'on' then
    new := old;
    new.claimed_by := null;
    return new;
  end if;

  if current_setting('frfc.owner_profile_update', true) = 'on' then
    -- Protected: verification, subscriber stats, identity, and admin fields.
    new.is_verified := old.is_verified;
    new.verified_until := old.verified_until;
    new.verified := old.verified;
    new.subscriber_count := old.subscriber_count;
    new.subscriber_count_prev := old.subscriber_count_prev;
    new.total_view_count := old.total_view_count;
    new.video_count := old.video_count;
    new.avg_rating_prev := old.avg_rating_prev;
    new.slug := old.slug;
    new.team := old.team;
    new.league := old.league;
    new.name := old.name;
    new.claimed_by := old.claimed_by;
    new.featured := old.featured;
    new.featured_video_id := old.featured_video_id;
    new.content_types := old.content_types;
    new.avatar_url := old.avatar_url;
    new.avatar_custom := old.avatar_custom;
    new.channel_url := old.channel_url;
    new.live_url := old.live_url;
    new.youtube_channel_id := old.youtube_channel_id;
    new.is_live := old.is_live;
    new.live_video_id := old.live_video_id;
    new.latest_video_id := old.latest_video_id;
    new.latest_video_title := old.latest_video_title;
    new.latest_video_date := old.latest_video_date;
    new.latest_video_views := old.latest_video_views;
    new.latest_video_thumbnail := old.latest_video_thumbnail;
    new.upcoming_video_id := old.upcoming_video_id;
    new.upcoming_video_title := old.upcoming_video_title;
    new.upcoming_video_thumbnail := old.upcoming_video_thumbnail;
    new.upcoming_video_scheduled_at := old.upcoming_video_scheduled_at;
    new.upload_frequency := old.upload_frequency;
    new.channel_country := old.channel_country;
    new.channel_created_at := old.channel_created_at;
    new.last_youtube_sync := old.last_youtube_sync;
    new.rank_snapshot_at := old.rank_snapshot_at;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.id := old.id;
    return new;
  end if;

  if current_user in ('anon', 'authenticated') then
    if auth.uid() is null or not public.frfc_has_permission(auth.uid(), 'creators.edit') then
      raise exception 'direct creator updates are not allowed' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.frfc_tg_streamer_column_guard() is
  'Blocks non-admin browser updates and clamps protected columns during owner profile edits.';

revoke all on function public.frfc_tg_streamer_column_guard() from public;
-- The invoking role needs EXECUTE for a trigger function to run.
grant execute on function public.frfc_tg_streamer_column_guard() to anon, authenticated, service_role;

create trigger frfc_streamers_column_guard
  before update on public.frfc_streamers
  for each row execute function public.frfc_tg_streamer_column_guard();

-- Anon has no UPDATE policy. Drop the table-level write grants anyway so a
-- future policy cannot update verification, stats, slug, or team as anon.
revoke insert, update, delete on table public.frfc_streamers from anon;
