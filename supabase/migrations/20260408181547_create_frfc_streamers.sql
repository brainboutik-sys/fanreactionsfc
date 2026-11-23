create table if not exists public.frfc_streamers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team text not null,
  channel_url text,
  live_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists frfc_streamers_team_idx on public.frfc_streamers(team);
create index if not exists frfc_streamers_name_idx on public.frfc_streamers(name);

alter table public.frfc_streamers enable row level security;

-- Authenticated users can read all streamers
create policy "frfc_streamers_select_authenticated"
  on public.frfc_streamers for select
  to authenticated
  using (true);

-- Authenticated users can insert (created_by must match auth.uid())
create policy "frfc_streamers_insert_authenticated"
  on public.frfc_streamers for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Authenticated users can update any row
create policy "frfc_streamers_update_authenticated"
  on public.frfc_streamers for update
  to authenticated
  using (true)
  with check (true);

-- Authenticated users can delete any row
create policy "frfc_streamers_delete_authenticated"
  on public.frfc_streamers for delete
  to authenticated
  using (true);

-- Trigger to keep updated_at fresh
create or replace function public.frfc_streamers_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists frfc_streamers_updated_at on public.frfc_streamers;
create trigger frfc_streamers_updated_at
  before update on public.frfc_streamers
  for each row execute function public.frfc_streamers_set_updated_at();