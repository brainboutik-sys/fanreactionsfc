-- E0.1: News articles
create table public.frfc_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  dek text,
  summary text not null,
  body text not null,
  cover_image_url text,
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  author_id uuid references auth.users(id),
  tags text[] not null default '{}',
  related_team text,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index frfc_articles_status_published_idx on public.frfc_articles(status, published_at desc);
create index frfc_articles_related_team_idx on public.frfc_articles(related_team) where related_team is not null;

alter table public.frfc_articles enable row level security;

create policy "anyone can read published articles"
  on public.frfc_articles for select
  to anon, authenticated
  using (status = 'published');

create policy "admins can read all articles"
  on public.frfc_articles for select
  to authenticated
  using (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));

create policy "admins can insert articles"
  on public.frfc_articles for insert
  to authenticated
  with check (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));

create policy "admins can update articles"
  on public.frfc_articles for update
  to authenticated
  using (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));

create policy "admins can delete articles"
  on public.frfc_articles for delete
  to authenticated
  using (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));

-- Keep updated_at current on every edit, same convention as other tables.
create or replace function public.frfc_articles_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger frfc_articles_updated_at
  before update on public.frfc_articles
  for each row execute function public.frfc_articles_set_updated_at();

-- E1.1: Job run health tracking (Netlify scheduled functions)
create table public.frfc_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  items_processed integer not null default 0,
  items_failed integer not null default 0,
  quota_used integer,
  error_summary jsonb,
  created_at timestamptz not null default now()
);

create index frfc_job_runs_job_type_idx on public.frfc_job_runs(job_type, started_at desc);

alter table public.frfc_job_runs enable row level security;

create policy "admins can read job runs"
  on public.frfc_job_runs for select
  to authenticated
  using (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));

-- E1.2: Candidate status history (same shape as frfc_feature_status_log,
-- ready for Epic 2's frfc_story_candidates once that table exists).
create table public.frfc_candidate_status_log (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  old_status text,
  new_status text not null,
  changed_by text not null default 'system',
  note text,
  created_at timestamptz not null default now()
);

create index frfc_candidate_status_log_candidate_id_idx on public.frfc_candidate_status_log(candidate_id, created_at desc);

alter table public.frfc_candidate_status_log enable row level security;

create policy "admins can read candidate status log"
  on public.frfc_candidate_status_log for select
  to authenticated
  using (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));