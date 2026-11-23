-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- Enums
-- ============================================================
create type tweet_status     as enum ('to_review', 'approved', 'declined');
create type tweet_action     as enum ('reply', 'quote_tweet', 'like_only', 'skip');
create type compliance_check as enum ('pass', 'flag');
create type tweet_category   as enum ('market', 'regulation', 'industry', 'technology', 'opinion');
create type member_role      as enum ('owner', 'admin', 'editor', 'viewer');
create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');

-- ============================================================
-- Workspaces (tenants)
-- ============================================================
create table workspaces (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  logo_url     text,
  brand_color  text,
  -- Billing (Stripe)
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  stripe_price_id         text,
  subscription_status     subscription_status,
  subscription_period_end timestamptz,
  -- Ownership
  created_by_clerk_id text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on workspaces (stripe_customer_id);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  clerk_user_id text not null,
  role         member_role not null default 'editor',
  invited_at   timestamptz not null default now(),
  joined_at    timestamptz,
  primary key (workspace_id, clerk_user_id)
);
create index on workspace_members (clerk_user_id);

-- Helper: check whether the currently-authenticated Clerk user is a member of a workspace.
-- Clerk user id is passed via the 'x-clerk-user-id' request header (set server-side).
-- Security definer so policies do not recurse on workspace_members.
create or replace function current_clerk_user_id()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.sub', true),
    current_setting('request.headers', true)::jsonb ->> 'x-clerk-user-id'
  );
$$;

create or replace function is_workspace_member(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = _workspace_id
      and clerk_user_id = current_clerk_user_id()
  );
$$;

-- ============================================================
-- Managed X accounts (CEO personas we curate for)
-- ============================================================
create table managed_accounts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  display_name    text not null,
  handle          text not null,
  avatar_url      text,
  x_user_id       text,
  x_access_token  text,
  x_refresh_token text,
  x_token_expires_at timestamptz,
  voice_profile   jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, handle)
);
create index on managed_accounts (workspace_id);

-- ============================================================
-- Strategic pillars
-- ============================================================
create table pillars (
  id                  uuid primary key default gen_random_uuid(),
  managed_account_id  uuid not null references managed_accounts(id) on delete cascade,
  name                text not null,
  description         text,
  color               text,
  sort_order          smallint not null default 0,
  is_active           boolean not null default true,
  unique (managed_account_id, name)
);
create index on pillars (managed_account_id);

-- ============================================================
-- Tracked accounts
-- ============================================================
create table tracked_accounts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  handle        text not null,
  display_name  text,
  x_user_id     text,
  notes         text,
  added_by_clerk_id text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, handle)
);
create index on tracked_accounts (workspace_id);

create table managed_account_tracked_accounts (
  managed_account_id uuid not null references managed_accounts(id) on delete cascade,
  tracked_account_id uuid not null references tracked_accounts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (managed_account_id, tracked_account_id)
);

-- ============================================================
-- Curated tweet queue
-- ============================================================
create table curated_tweets (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  managed_account_id  uuid not null references managed_accounts(id) on delete cascade,
  tweet_id            text not null,
  tweet_url           text,
  tweet_subject       text,
  tweet_text          text not null,
  author              text,
  author_handle       text,
  tracked_account_id  uuid references tracked_accounts(id) on delete set null,
  published_at        timestamptz,
  category            tweet_category,
  relevance_score     smallint check (relevance_score between 0 and 10),
  primary_pillar_id   uuid references pillars(id) on delete set null,
  secondary_pillar_id uuid references pillars(id) on delete set null,
  reasoning           text,
  ai_model            text,
  processed_at        timestamptz,
  action              tweet_action not null default 'skip',
  suggested_response  text,
  char_count          integer generated always as (coalesce(char_length(suggested_response), 0)) stored,
  compliance          compliance_check,
  compliance_note     text,
  status              tweet_status not null default 'to_review',
  reviewed_by_clerk_id text,
  reviewed_at         timestamptz,
  posted_at           timestamptz,
  posted_tweet_id     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (managed_account_id, tweet_id)
);
create index on curated_tweets (workspace_id, status);
create index on curated_tweets (managed_account_id, status, relevance_score desc);
create index on curated_tweets (managed_account_id, published_at desc);
create index on curated_tweets (workspace_id, compliance) where compliance = 'flag';
create index on curated_tweets (primary_pillar_id);
create index on curated_tweets (secondary_pillar_id);

-- updated_at trigger
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_workspaces_updated         before update on workspaces
  for each row execute function set_updated_at();
create trigger trg_managed_accounts_updated   before update on managed_accounts
  for each row execute function set_updated_at();
create trigger trg_curated_tweets_updated     before update on curated_tweets
  for each row execute function set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table workspaces                        enable row level security;
alter table workspace_members                 enable row level security;
alter table managed_accounts                  enable row level security;
alter table pillars                           enable row level security;
alter table tracked_accounts                  enable row level security;
alter table managed_account_tracked_accounts  enable row level security;
alter table curated_tweets                    enable row level security;

create policy workspaces_select on workspaces
  for select using (is_workspace_member(id));
create policy workspaces_update on workspaces
  for update using (
    exists (
      select 1 from workspace_members
      where workspace_id = workspaces.id
        and clerk_user_id = current_clerk_user_id()
        and role in ('owner','admin')
    )
  );

create policy members_select on workspace_members
  for select using (is_workspace_member(workspace_id));
create policy members_write on workspace_members
  for all using (
    exists (
      select 1 from workspace_members m
      where m.workspace_id = workspace_members.workspace_id
        and m.clerk_user_id = current_clerk_user_id()
        and m.role in ('owner','admin')
    )
  );

create policy managed_accounts_rw on managed_accounts
  for all using (is_workspace_member(workspace_id))
          with check (is_workspace_member(workspace_id));

create policy pillars_rw on pillars
  for all using (
    is_workspace_member((select workspace_id from managed_accounts where id = managed_account_id))
  )
  with check (
    is_workspace_member((select workspace_id from managed_accounts where id = managed_account_id))
  );

create policy tracked_accounts_rw on tracked_accounts
  for all using (is_workspace_member(workspace_id))
          with check (is_workspace_member(workspace_id));

create policy ma_ta_rw on managed_account_tracked_accounts
  for all using (
    is_workspace_member((select workspace_id from managed_accounts where id = managed_account_id))
  )
  with check (
    is_workspace_member((select workspace_id from managed_accounts where id = managed_account_id))
  );

create policy curated_tweets_rw on curated_tweets
  for all using (is_workspace_member(workspace_id))
          with check (is_workspace_member(workspace_id));