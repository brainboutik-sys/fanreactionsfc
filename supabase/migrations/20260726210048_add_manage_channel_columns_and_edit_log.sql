alter table public.frfc_streamers
  add column avatar_custom boolean not null default false,
  add column featured_video_id text,
  add column social_x text,
  add column social_twitch text,
  add column social_discord text,
  add column social_tiktok text;

create table public.frfc_creator_edit_log (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.frfc_streamers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

alter table public.frfc_creator_edit_log enable row level security;

create policy "owner can view own edit log"
  on public.frfc_creator_edit_log for select
  to authenticated
  using (exists (
    select 1 from public.frfc_streamers s
    where s.id = creator_id and s.claimed_by = auth.uid()
  ));

create policy "admins can view all edit logs"
  on public.frfc_creator_edit_log for select
  to authenticated
  using (exists (
    select 1 from public.frfc_admin_roles a where a.user_id = auth.uid()
  ));

create index frfc_creator_edit_log_creator_id_idx on public.frfc_creator_edit_log(creator_id, created_at desc);