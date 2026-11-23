-- Generic across every format (weekly rankings now; match-reaction roundups
-- and spotlights later) — format-specific data lives in `payload` jsonb
-- rather than a growing set of nullable typed columns, per the PRD's own
-- "score-component JSON or normalized child records" allowance.
create table public.frfc_story_candidates (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null default 'detected' check (status in (
    'detected','evidence_ready','drafting','review_ready','approved',
    'scheduled','published','rejected','generation_failed',
    'validation_failed','publish_failed','archived'
  )),
  working_title text not null,
  cluster_key text,
  score integer,
  score_components jsonb,
  threshold_at_creation integer,
  explanation text,
  fixture_id bigint references public.frfc_fixtures(id),
  creator_ids uuid[] not null default '{}',
  club_names text[] not null default '{}',
  video_ids text[] not null default '{}',
  duplicate_risk jsonb,
  rejection_reason text,
  payload jsonb not null default '{}',
  article_id uuid references public.frfc_articles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index frfc_story_candidates_status_idx on public.frfc_story_candidates(status, created_at desc);
create index frfc_story_candidates_type_idx on public.frfc_story_candidates(type, created_at desc);

alter table public.frfc_story_candidates enable row level security;

create policy "admins can do everything with story candidates"
  on public.frfc_story_candidates for all
  to authenticated
  using (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));

-- Now that frfc_story_candidates exists, point the status-history log (E1.2)
-- at it for real, and add the write policy that couldn't exist until now.
alter table public.frfc_candidate_status_log
  add constraint frfc_candidate_status_log_candidate_id_fkey
  foreign key (candidate_id) references public.frfc_story_candidates(id) on delete cascade;

create policy "admins can insert candidate status log"
  on public.frfc_candidate_status_log for insert
  to authenticated
  with check (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));

create table public.frfc_evidence_items (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.frfc_story_candidates(id) on delete cascade,
  evidence_type text not null,
  source_entity_type text,
  source_entity_id text,
  external_url text,
  excerpt text,
  video_id text,
  ts_start integer,
  ts_end integer,
  retrieved_at timestamptz not null default now(),
  content_hash text,
  eligible boolean not null default true,
  exclusion_reason text
);

create index frfc_evidence_items_candidate_id_idx on public.frfc_evidence_items(candidate_id);

alter table public.frfc_evidence_items enable row level security;

create policy "admins can do everything with evidence items"
  on public.frfc_evidence_items for all
  to authenticated
  using (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.frfc_admin_roles where user_id = auth.uid()));