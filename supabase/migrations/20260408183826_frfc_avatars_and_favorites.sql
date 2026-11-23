-- Add avatar URL column for manual override / cached avatars
alter table public.frfc_streamers
  add column if not exists avatar_url text;

-- Per-user favorites
create table if not exists public.frfc_streamer_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  streamer_id uuid not null references public.frfc_streamers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, streamer_id)
);

create index if not exists frfc_fav_user_idx on public.frfc_streamer_favorites(user_id);

alter table public.frfc_streamer_favorites enable row level security;

-- Users can only see their own favorites
create policy "frfc_fav_select_own"
  on public.frfc_streamer_favorites for select
  to authenticated
  using (user_id = auth.uid());

-- Users can only insert favorites for themselves
create policy "frfc_fav_insert_own"
  on public.frfc_streamer_favorites for insert
  to authenticated
  with check (user_id = auth.uid());

-- Users can only delete their own favorites
create policy "frfc_fav_delete_own"
  on public.frfc_streamer_favorites for delete
  to authenticated
  using (user_id = auth.uid());