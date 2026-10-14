-- Sponsored featured creator on a club hub.
-- One row per club (zero or one). Not applied by this repo's deploy —
-- run it in the Supabase SQL editor when the slot should go live.
--
-- club_slug is the canonical hub slug (/clubs/manchester-united → manchester-united).
-- starts_at and ends_at are optional. The page treats a row as active when
-- starts_at is null or <= now, and ends_at is null or > now (end is exclusive).
-- The creator stays in the organic ranking at their normal position; this
-- row only fills the separate sponsored card.
--
-- Set a placement (open-ended):
--   insert into public.frfc_club_sponsorships (club_slug, creator_id)
--   values (
--     'liverpool',
--     (select id from public.frfc_streamers where slug = 'theredmentv')
--   );
--
-- Set a placement with a window:
--   insert into public.frfc_club_sponsorships (club_slug, creator_id, starts_at, ends_at)
--   values (
--     'liverpool',
--     (select id from public.frfc_streamers where slug = 'theredmentv'),
--     timestamptz '2026-10-14 00:00:00+00',
--     timestamptz '2026-11-14 00:00:00+00'
--   );
--
-- Replace the creator or the window (the unique club_slug makes this an update):
--   update public.frfc_club_sponsorships
--   set creator_id = (select id from public.frfc_streamers where slug = 'anfieldagenda'),
--       starts_at = null,
--       ends_at = null
--   where club_slug = 'liverpool';
--
-- Remove the slot:
--   delete from public.frfc_club_sponsorships where club_slug = 'liverpool';

create table public.frfc_club_sponsorships (
  id uuid primary key default gen_random_uuid(),
  club_slug text not null,
  creator_id uuid not null references public.frfc_streamers (id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint frfc_club_sponsorships_club_slug_key unique (club_slug),
  constraint frfc_club_sponsorships_slug_format check (club_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint frfc_club_sponsorships_window_ok check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

comment on table public.frfc_club_sponsorships is
  'Zero or one sponsored featured creator per club hub. Optional starts_at/ends_at. Writes are SQL-editor or service-role only.';

create index frfc_club_sponsorships_creator_id_idx
  on public.frfc_club_sponsorships (creator_id);

alter table public.frfc_club_sponsorships enable row level security;

-- The hub reads this with the publishable key. No insert/update/delete
-- policy: anon and authenticated cannot write. The SQL editor (postgres)
-- and the service role bypass RLS.
create policy frfc_club_sponsorships_public_read
  on public.frfc_club_sponsorships
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on table public.frfc_club_sponsorships from anon, authenticated;
grant select on table public.frfc_club_sponsorships to anon, authenticated;
grant select, insert, update, delete on table public.frfc_club_sponsorships to service_role;
