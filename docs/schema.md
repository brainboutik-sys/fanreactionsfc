# Database Schema — FanReactionsFC

Supabase Postgres, project ref `dsxijgrpxsfywxuffbmt`. Every table lives in `public`,
is prefixed `frfc_`, and has **Row Level Security enabled**. This document reflects the
live database as of 2026-07-08. Regenerate the facts with the Supabase MCP (`list_tables`,
`pg_policies`, `information_schema.triggers`, `pg_proc`) — don't trust it blindly after
schema changes.

## How access works

- **Browser** uses the Supabase **publishable** (anon) key. It authenticates as the
  `anon` role when logged out and `authenticated` (with a JWT carrying `auth.uid()`)
  when logged in. RLS is the *only* thing standing between the browser and the data.
- **Netlify functions** use the **service-role** key (`SUPABASE_SERVICE_ROLE_KEY`),
  which **bypasses RLS entirely**. All server-side writes (YouTube sync, live-check,
  sitemap, claim-creator) run with full privileges.
- **Admin** = a row in `frfc_admin_roles` for your `auth.uid()`. There is no separate
  admin JWT claim; admin-ness is checked either by a policy subquery against
  `frfc_admin_roles` or by the `frfc_is_admin()` helper.

> ⚠️ Because the browser talks to Postgres directly, **UI-only gating is not security** —
> every write must be enforced by RLS or a `SECURITY DEFINER` RPC, not just hidden in the
> UI. See [Security posture](#security-posture) for the current state (the known gaps were
> closed 2026-07-08).

---

## Tables

### Directory & creators

#### `frfc_streamers` — the creator directory (core table, ~260 rows)
Every football YouTuber in the database. Read by nearly every page.

Key columns: `id` (uuid PK), `name`, `team`, `league` (default `Premier League`),
`slug`, `channel_url`, `live_url`, `avatar_url`, `description`, `content_types` (text[]).
YouTube-synced: `youtube_channel_id`, `subscriber_count`, `total_view_count`,
`video_count`, `latest_video_*`, `upcoming_video_*`, `is_live`, `live_video_id`,
`upload_frequency`, `channel_country`, `last_youtube_sync`. Flags: `verified`,
`featured`, `claimed_by` (→ auth.users). Ranking snapshot: `subscriber_count_prev`,
`avg_rating_prev`, `rank_snapshot_at`. Audit: `created_by`, `created_at`, `updated_at`.

| Op | Role | Rule |
|----|------|------|
| SELECT | anon, authenticated | `true` |
| INSERT | authenticated | admin only (`frfc_admin_roles`) |
| UPDATE | authenticated | admin only |
| DELETE | authenticated | admin only |

Writes are admin-only (hardened 2026-07-08; anon UPDATE was previously open).
Server-side YouTube sync writes with the service-role key and bypasses these
policies; the admin panel's manual sync runs as the admin user and passes.
Trigger: `frfc_streamers_updated_at` (BEFORE UPDATE) bumps `updated_at`.

#### `frfc_subscriber_history` — subscriber time series (~3,375 rows)
One row per creator per sync (`creator_id`, `subscriber_count`, `recorded_at`). Powers
the profile sparkline. RLS: public SELECT; INSERT admin-only (server sync uses the
service-role key and bypasses this).

### Users & engagement

#### `frfc_user_profiles` — per-user profile (PK `user_id` → auth.users)
`display_name`, `avatar_url`, `favourite_team`, `country` (2-char), `bio`, notification
prefs (`notify_live`, `notify_weekly`), `reviews_public`.
RLS: `users_manage_own` (ALL, `user_id = auth.uid()`); `anon_read_profiles` (SELECT `true`).

#### `frfc_streamer_favorites` — user ⭐ creator (PK `user_id, streamer_id`)
RLS: all three ops restricted to `user_id = auth.uid()` (authenticated only). Clean.

#### `frfc_reviews` — creator ratings (currently 0 rows)
`creator_id`, `user_id`, `rating` (1–5 check), `review_text`, `helpful_count`.
RLS: read public; insert/update/delete restricted to `auth.uid() = user_id`. Clean.
Note: the frontend no longer surfaces reviews, but the admin panel still reads this table.

#### `frfc_creator_reports` — "report an issue" on a creator (0 rows)
`creator_id`, `reason`, `details`, `resolved*`. RLS: anon+authenticated INSERT (`true`,
public report form); SELECT and UPDATE are admin-only (hardened 2026-07-08).

### Community Feature Requests (hardened 2026-07-08)

#### `frfc_feature_requests` — the ideas (1 row)
`user_id`, `title` (≥5 chars), `description` (≥20 chars), `category` (default `Other`),
`status` (`open|under_review|planned|in_development|released|declined`), `vote_count`,
`comment_count`, `is_pinned`, `is_locked`, `merged_into` (self-FK), `admin_response*`.

| Op | Role | Rule |
|----|------|------|
| SELECT | public | `true` |
| INSERT | public | `auth.uid() = user_id` |
| UPDATE | public | owner (`auth.uid() = user_id`) **or** admin |
| DELETE | public | admin only |

Trigger `trg_frfc_request_guard` (BEFORE UPDATE) — for `anon`/`authenticated`
non-admins, reverts any change to protected columns (`vote_count`, `comment_count`,
`status`, `is_pinned`, `is_locked`, `admin_response*`, `merged_into`, `user_id`,
`created_at`). So an owner can only really edit title/description/category.

#### `frfc_feature_votes` — one vote per user per request (0 rows)
`feature_id`, `user_id`, unique together. RLS: read public; insert/delete `auth.uid() = user_id`.
Trigger `trg_frfc_vote_count` (AFTER INSERT/DELETE) maintains `frfc_feature_requests.vote_count`.
**Never write `vote_count` from the client.**

#### `frfc_feature_comments` — threaded discussion (0 rows)
`feature_id`, `user_id`, `parent_id` (self-FK for replies), `body` (≥1 char),
`is_official`, `like_count`.
- `trg_frfc_comment_before_insert` (BEFORE INSERT) derives `is_official` from
  `frfc_is_admin()` and forces `like_count = 0` for end-user roles — a normal user
  cannot post an "Official" comment even by sending the flag.
- `trg_frfc_comment_count` (AFTER INSERT/DELETE) maintains the parent's `comment_count`.
- `trg_frfc_comment_guard` (BEFORE UPDATE) reverts protected columns (`like_count`,
  `is_official`, `user_id`, `feature_id`, `parent_id`, `created_at`) for non-admin
  end users.
RLS: read public; insert `auth.uid() = user_id`; update `auth.uid() = user_id` (but the
guard strips everything meaningful, so effectively body edits only).

#### `frfc_feature_comment_likes` — one like per user per comment (0 rows)
RLS: read public; insert/delete `auth.uid() = user_id`.
Trigger `trg_frfc_like_count` (AFTER INSERT/DELETE) maintains `frfc_feature_comments.like_count`.
**Never write `like_count` from the client.**

#### `frfc_feature_status_log` — status-change history (0 rows)
`feature_id`, `old_status`, `new_status`, `changed_by`, `note`. RLS: read public; insert
`auth.uid() = changed_by`. Written by the admin panel alongside a status update.

#### `frfc_feature_follows` — follow a request for notifications (0 rows)
`feature_id`, `user_id`. RLS: read public; insert/delete `auth.uid() = user_id`.
**Schema exists but no UI writes to it yet** — reserved for the future notifications feature.

### Battles

#### `frfc_battles` — Creator Battle vote log (~895 rows)
`winner_id`, `loser_id` (→ streamers), `voter_fingerprint` (localStorage UUID),
`voter_id` (→ auth.users, nullable). Powers the homepage head-to-head.
RLS: SELECT public (`true`). There is **no direct INSERT policy** — the only way to add
a row is the `record_battle_vote` RPC (SECURITY DEFINER, owned by postgres, bypasses RLS),
which validates the pair and rate-limits. Direct client inserts are denied (hardened 2026-07-08).

### Admin & ops

#### `frfc_admin_roles` — who is an admin (PK `user_id`, 1 row)
`role` (`admin` | `super_admin`). RLS: `users_read_own_role` (SELECT own row only).
No INSERT/UPDATE/DELETE policy → the browser can never grant admin; roles are managed
via the Supabase dashboard / service role only. This is the trust root for everything.

#### `frfc_admin_log` — admin action audit trail (~179 rows)
`user_id`, `action`, `entity_type`, `entity_id`, `details` (jsonb). RLS: both SELECT and
INSERT gated on `EXISTS (… frfc_admin_roles WHERE user_id = auth.uid())`. Properly
admin-only.

#### `frfc_submissions` — public "submit a creator" queue (~126 rows)
`name`, `channel_url`, `team`, `league`, `status` (`pending|approved|rejected`),
`reviewed_*`. Trigger `on_new_submission` (AFTER INSERT) → `notify_new_submission()`
(email notification). RLS: anon+authenticated INSERT (public submit form) and SELECT
(`true`); UPDATE/DELETE (approve/reject) are admin-only (hardened 2026-07-08).
Note: SELECT is still public — pending submissions (incl. channel URLs) are readable by
anyone. Low-sensitivity, left open because the submit flow reads for duplicate detection.

---

## Functions (RPCs)

All are `SECURITY DEFINER` unless noted. Callable from the browser via `sb.rpc(...)`
except the trigger functions.

| Function | Args | Returns | Purpose |
|----------|------|---------|---------|
| `frfc_is_admin()` | — | boolean | `EXISTS` check against `frfc_admin_roles` for `auth.uid()`. Used by guards/triggers. |
| `record_battle_vote(w_id, l_id, fp, v_id=null)` | uuids + text | void | Battle vote. Validates the pair are distinct real creators, checks `fp` shape, **takes voter id from `auth.uid()` (ignores `v_id`… see note)**, rate-limits 300/hr per fingerprint, blocks same-pair re-vote within 2 min. |
| `get_battle_total()` | — | bigint | Count of all battles (homepage "N votes cast"). |
| `get_battle_leaderboard(lim=10)` | int | table(creator_id, total_wins, total_battles) | Hot-creators strip. |
| `get_creator_battle_stats(cid)` | uuid | table(wins, losses) | Per-creator battle record. |
| `frfc_feature_merge(p_source_id, p_target_id)` | uuids | void | Admin-only (`frfc_is_admin()` gate). Moves votes to target, recounts, marks source `merged_into` + `declined`. |
| `notify_new_submission()` | — | trigger | Fires on `frfc_submissions` insert to send an email. |
| `frfc_tg_vote_count` / `_comment_count` / `_like_count` | — | trigger | Maintain the denormalised counters (see tables above). |
| `frfc_tg_comment_before_insert` | — | trigger | Server-derives `is_official`, zeroes `like_count`. |
| `frfc_tg_comment_guard` / `frfc_tg_request_guard` | — | trigger | Revert protected-column writes by non-admin end users. |
| `frfc_streamers_set_updated_at` | — | trigger | Touch `updated_at`. |

**Denormalised counters are trigger-owned.** `vote_count`, `comment_count`, and
`like_count` are never written by application code — insert/delete the underlying row and
the trigger adjusts the count atomically. The old client-callable count RPCs
(`frfc_feature_vote_up/_down`, `frfc_feature_comment_added`) were dropped in the 2026-07-08
hardening.

---

## Security posture

The legacy-table RLS gaps were closed on 2026-07-08 (verified with the anon key):

- **`frfc_streamers`** — writes are admin-only; the anon UPDATE hole (any visitor could
  edit any creator) is closed. Reads stay public.
- **`frfc_submissions`** — approve/reject (UPDATE/DELETE) is admin-only; public submit
  (INSERT) stays.
- **`frfc_creator_reports`** — read/triage is admin-only; public report (INSERT) stays.
- **`frfc_battles`** — no direct INSERT; votes only via the validated `record_battle_vote`
  RPC.
- **`frfc_subscriber_history`** — INSERT admin-only (server uses service role).

Remaining low-sensitivity notes:

1. **`frfc_submissions` SELECT is public** — pending submissions (incl. channel URLs) are
   readable by anyone. Left open for the submit form's duplicate check; tighten to
   admin-only if that check is moved server-side.
2. **`frfc_battles` SELECT is public** — the raw vote log is readable. Harmless (it's
   aggregate battle data), but note it exposes `voter_id` where present.
3. **Trust root:** everything hinges on `frfc_admin_roles` having no client-writable
   policy. Never add an INSERT/UPDATE policy to that table — manage roles via the
   dashboard/service role only.

---

## Regenerating this doc

```sql
-- tables + columns + FKs: use the Supabase MCP list_tables (verbose)
-- policies:
SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies WHERE schemaname='public' ORDER BY tablename, cmd;
-- triggers:
SELECT event_object_table, trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers WHERE trigger_schema='public';
-- functions:
SELECT proname, pg_get_function_arguments(oid), pg_get_function_result(oid), prosecdef
FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'frfc%';
```
