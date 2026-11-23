create table public.frfc_consent_log (
  id uuid primary key default gen_random_uuid(),
  analytics_accepted boolean not null,
  notice_version text not null default '2026-07-26',
  page_path text,
  created_at timestamptz not null default now()
);

alter table public.frfc_consent_log enable row level security;

create policy "anyone can log their consent choice"
  on public.frfc_consent_log for insert
  to anon, authenticated
  with check (true);