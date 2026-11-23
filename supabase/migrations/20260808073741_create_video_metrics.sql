create table public.frfc_video_metrics (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.frfc_streamers(id) on delete cascade,
  video_id text not null,
  views integer not null default 0,
  likes integer,
  comments integer,
  recorded_at timestamptz not null default now()
);

create index frfc_video_metrics_creator_recorded_idx on public.frfc_video_metrics(creator_id, recorded_at desc);
create index frfc_video_metrics_video_recorded_idx on public.frfc_video_metrics(video_id, recorded_at desc);

alter table public.frfc_video_metrics enable row level security;

create policy "anyone can read video metrics"
  on public.frfc_video_metrics for select
  to anon, authenticated
  using (true);