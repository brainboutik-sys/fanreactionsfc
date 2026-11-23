create table if not exists frfc_fixtures (
  id bigint generated always as identity primary key,
  external_id integer unique not null,
  competition_code text not null,
  home_team text,
  away_team text,
  home_team_raw text not null,
  away_team_raw text not null,
  kickoff_at timestamptz not null,
  status text not null default 'SCHEDULED',
  trigger_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists frfc_fixtures_kickoff_idx on frfc_fixtures (kickoff_at);
create index if not exists frfc_fixtures_home_idx on frfc_fixtures (home_team);
create index if not exists frfc_fixtures_away_idx on frfc_fixtures (away_team);

alter table frfc_fixtures enable row level security;

-- Public read (fixtures are non-sensitive, and this lets the client show
-- upcoming-match info later without needing a service-role proxy).
create policy "fixtures are publicly readable" on frfc_fixtures
  for select using (true);

-- All writes happen via service-role Netlify functions only — no policy
-- grants insert/update/delete to anon/authenticated.