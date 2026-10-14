-- Paid Verified creator tier (CHF 4/month).
--
-- This file is the migration. It is NOT applied by the app, by CI, or by
-- this pull request. Run it manually in the Supabase SQL editor (project
-- ref dsxijgrpxsfywxuffbmt) when the columns should exist in production.
--
-- A creator counts as verified in the product when:
--   is_verified is true
--   AND (verified_until IS NULL OR verified_until > now())
--
-- Null verified_until means the period does not expire. A past
-- verified_until hides the badge even if is_verified is still true —
-- the app does not auto-flip the boolean when a period lapses.
--
-- This is separate from the legacy frfc_streamers.verified boolean, which
-- the admin "Verified" checkbox still writes. That checkbox does not
-- grant the paid tier.
--
-- RLS is unchanged. frfc_streamers SELECT is public, so the new columns
-- are readable by the site. UPDATE stays admin-only, so a signed-in
-- creator cannot set is_verified on themselves. There is no Stripe
-- webhook yet. After someone pays (once the Payment Link in
-- js/lib/verified.js is real), turn the tier on with SQL.

alter table public.frfc_streamers
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_until timestamptz;

comment on column public.frfc_streamers.is_verified is
  'Paid Verified tier flag. Public badge, club pin, Streamwall priority, and the stats card require this to be true and verified_until null or in the future. Distinct from the legacy verified column.';

comment on column public.frfc_streamers.verified_until is
  'When the paid Verified period ends. Null means no expiry. Still requires is_verified = true.';

-- Grant one month, starting now:
--   update public.frfc_streamers
--      set is_verified = true,
--          verified_until = now() + interval '1 month'
--    where slug = 'example-creator';
--
-- Comp (no expiry):
--   update public.frfc_streamers
--      set is_verified = true,
--          verified_until = null
--    where slug = 'example-creator';
--
-- Revoke immediately:
--   update public.frfc_streamers
--      set is_verified = false
--    where slug = 'example-creator';
--
-- The YouTube sync PATCHes channel fields only. It must not send
-- is_verified or verified_until, or a sync would wipe the tier.
