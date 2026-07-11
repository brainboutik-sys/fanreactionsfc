# FanReactionsFC.com

The definitive, community-rated directory of football (soccer) YouTubers across
Europe's top leagues — Premier League, Championship, La Liga, Serie A, Bundesliga,
Ligue 1. Browse creators by club/league/content type, see live streams and rankings,
play the "Creator Battle" head-to-head vote, and submit community feature requests.

Live: <https://fanreactionsfc.com>

---

## Stack

- **Frontend:** vanilla JS single-page app (no framework, no build step). Client-side
  router in `js/app.js` (`handleRoute()` + `history.pushState`).
- **Database & auth:** [Supabase](https://supabase.com) (Postgres + Auth), project ref
  `dsxijgrpxsfywxuffbmt`. Accessed in the browser via the official `supabase-js` CDN
  client (`const sb = window.supabase.createClient(...)`) using the **publishable** key.
- **Serverless:** Netlify Functions (`netlify/functions/`) for anything needing a secret
  or a schedule (YouTube API, sitemap, OG cards, live checks, background sync), plus a
  handful of **Supabase Edge Functions** (deployed straight to Supabase, not in this
  repo's tree) fired by Postgres triggers for transactional email — see below.
- **Hosting:** Netlify, site ID `a845b6ad-3669-4634-b5df-f757ac227b71`.
- **External data:** YouTube Data API v3 (server-side only), club crests from
  crests.football-data.org / ESPN, league logos self-hosted in `img/leagues/`, match
  fixtures from football-data.org (free tier — covers all 6 leagues + Champions League
  + World Cup).
- **Email:** [Resend](https://resend.com), sending domain `updates.fanreactionsfc.com`.
- **Analytics:** Google Tag Manager (`GTM-NSWNRXKH`) with GA4 configured as a tag inside
  it — see SEO & Analytics below.

## Project layout

```
index.html              SPA shell: header, nav, mount point (#app), script tags
css/
  main.css              design system + all page styles (navy/yellow theme)
  generator.css         description-generator styles
  admin.css             admin panel styles
js/
  data/teams.js         team/league reference data (crests, colors,
                        league→team map) — loaded before app.js
  app.js                the app: router, auth, data, all page renderers,
                        Creator Battle, Community Feature Requests
  generator.js          YouTube description generator (window.Gen)
  admin.js              admin back-office (window.Admin) — lazy-loaded
                        by app.js only when a signed-in user visits /admin
netlify/functions/
  youtube-proxy.js      browser -> YouTube API proxy (keeps key server-side;
                        origin/referer allowlisted)
  sync-background.js    scheduled full creator metadata refresh (07:00 & 15:00 UTC)
  live-check.js         scheduled is_live refresh (every 30 min, blanket safety net)
  fixtures-sync.js      daily fixtures pull from football-data.org -> frfc_fixtures
  live-check-fixtures-background.js  every 5 min; fires ~5 min before a real
                        kickoff for creators tied to the two clubs playing
                        (World Cup fixtures check every creator instead)
  rank-snapshot-background.js  scheduled ranking snapshots
  sitemap.js            dynamic /sitemap.xml from the creator list
  creator-og.js         per-creator OG meta tags for social crawlers
  claim-creator.js      creator profile claim via YouTube description code
netlify.toml            redirects (sitemap, /creators/*, SPA fallback) + fn schedules
img/icons/              custom PNG icon set for homepage sections (replaced emoji)
img/videos/             homepage hero background video
robots.txt              points crawlers at /sitemap.xml, disallows /admin, /account
scripts/                one-off DB/data utilities (gitignored, not deployed)
```

### Supabase Edge Functions

Deployed directly to the Supabase project (not part of this repo's file tree — managed
via the Supabase MCP/dashboard, not git). Each is invoked fire-and-forget by a Postgres
trigger via `net.http_post` (the `pg_net` extension) whenever the relevant row changes;
the trigger only passes IDs, and the function re-fetches any content it needs from the
DB with the service-role key rather than trusting the trigger payload.

| Function | Fired by | Purpose |
|---|---|---|
| `notify-submission` | INSERT on `frfc_submissions` | Emails admin a new creator suggestion |
| `notify-feature-status` | UPDATE on `frfc_feature_requests` (status change) | Emails followers of a feature request when its status changes |
| `notify-contact` | INSERT on `frfc_contact_messages` | Emails admin a Contact Us submission (reply-to = sender) |
| `notify-report` | INSERT on `frfc_creator_reports` | Emails admin a "report an issue" submission |
| `notify-claim` | UPDATE on `frfc_streamers` (`claimed_by` null → set) | FYI-only email when a channel is claimed — claims are self-verified via a YouTube description code and already in effect by the time this fires |
| `resolve-yt-avatar` | (pre-existing, called from client/admin) | Resolves a creator's current YouTube avatar URL |

All the `notify-*` functions send via [Resend](https://resend.com) and need
`RESEND_API_KEY` set as a **Supabase Edge Function secret** (Project Settings → Edge
Functions → Secrets in the Supabase dashboard — not a Netlify env var). Missing it
degrades gracefully: the function still returns `200 {"ok":true,"sent":false}` instead
of erroring, so a working deploy doesn't guarantee email is actually configured.

> ⚠️ Postgres trigger gotcha hit twice this week: this project only has the `pg_net`
> extension installed, not the synchronous `http` extension. A trigger function that
> calls `extensions.http_post(...)` (the 3-arg form) fails with "function does not
> exist" on *every* invocation, silently swallowed by an `EXCEPTION WHEN OTHERS`
> handler — so it looks deployed and correct but never actually fires. Always use
> `net.http_post(url := ..., body := ..., headers := ...)` (the named-argument pg_net
> form). Verify a new trigger actually works by checking `net._http_response` for a
> `200` after a real test insert/update, not just by reading the function definition.
> Both `notify_new_submission` and `notify_feature_status_change` were found silently
> broken this way and had to be fixed after already being "done."

## Deploying

**`main` is the production branch.** Netlify **auto-deploys from GitHub**, so:

```bash
git push origin main    # triggers a Netlify production build
```

You can also deploy manually (ships immediately, same result):

```bash
npx netlify-cli deploy --prod --dir=. --site=a845b6ad-3669-4634-b5df-f757ac227b71
```

There is **no build step** — the repo root is served as-is (`publish = "."`).

> ⚠️ This repo has historically had a git **worktree** (`.claude/worktrees/...`) holding a
> *different* codebase than `main`. Always make sure your edits land on `main` in the
> primary working copy, and remember the local `npx serve` preview serves whatever
> directory it runs in — a green preview does **not** prove `main` is correct. After
> deploying, verify against the live URLs.

## Local development

Static files, so any static server works:

```bash
npx serve -l 3000 -s .        # serves the SPA at http://localhost:3000
```

Note: Netlify Functions do **not** run under `npx serve`. To exercise functions locally
use `npx netlify-cli dev`, or just test them against the deployed site.

## Environment variables

Set in **Netlify → Project configuration → Environment variables** (never commit these):

| Variable | Used by | Notes |
|---|---|---|
| `YOUTUBE_API_KEY` | youtube-proxy, live-check, live-check-fixtures-background, sync-background, claim-creator | YouTube Data API v3 key, server-side only |
| `SUPABASE_SERVICE_ROLE_KEY` | sitemap, creator-og, live-check, live-check-fixtures-background, fixtures-sync, sync-background, rank-snapshot, claim-creator | Supabase secret key — bypasses RLS for server writes. **Never expose client-side.** |
| `FOOTBALL_DATA_API_KEY` | fixtures-sync | Free-tier key from football-data.org — pulls fixtures for every league/competition covered |
| `SUPABASE_URL` | all functions | Optional; falls back to the hardcoded project URL |

The browser only ever uses the Supabase **publishable** key (hardcoded in `app.js` by
design — it is safe to expose and is governed by Row Level Security).

## Database notes

18 `frfc_*` tables (public schema). Core: `frfc_streamers` (creators),
`frfc_streamer_favorites`, `frfc_subscriber_history`, `frfc_reviews`,
`frfc_submissions`, `frfc_creator_reports`, `frfc_contact_messages`, `frfc_battles`,
`frfc_user_profiles`, `frfc_admin_roles`, `frfc_admin_log`.

Community Feature Requests: `frfc_feature_requests`, `frfc_feature_votes`,
`frfc_feature_comments`, `frfc_feature_comment_likes`, `frfc_feature_follows`,
`frfc_feature_status_log`.

Fixtures: `frfc_fixtures` — synced daily from football-data.org by `fixtures-sync.js`;
`trigger_sent_at` marks which fixtures `live-check-fixtures-background.js` has already
fired a live-check for, so each kickoff only triggers once.

- **Counts are trigger-owned.** `vote_count`, `comment_count`, and `like_count` are
  maintained by row triggers on the votes/comments/likes tables — never write them from
  the client. `is_official` on comments is derived server-side from `frfc_admin_roles`.
- Admin actions (status change, pin/lock, merge, official response) are gated by
  `frfc_admin_roles` membership, enforced in RLS/triggers, not just the UI.
- Battle votes go through the `record_battle_vote` RPC, which validates the pair,
  takes the voter id from the session, and rate-limits per fingerprint.
- Win % on `/rankings` is computed client-side from `frfc_battles` win/loss counts
  (via the `get_battle_all_stats` RPC), not stored.
- `frfc_contact_messages` and `frfc_creator_reports` allow public INSERT only — no
  public SELECT policy, so submissions are only readable via the Supabase dashboard,
  the `/admin` panel, or the email a trigger sends (see Edge Functions above).

## SEO & Analytics

- **Google Tag Manager** (`GTM-NSWNRXKH`) is installed in `index.html` (head script +
  body noscript fallback). GA4 (`G-5HNGEQLJR2`) is configured as a tag *inside* GTM, not
  loaded directly by the site — don't add a second direct `gtag.js` include, it'll
  double-count pageviews.
- `<link rel="canonical">` (`index.html`, id `canonicalLink`) is kept in sync on every
  client-side route change by `updatePageMeta()` in `app.js` — every route calls it with
  a page-specific title + description, including filtered views (`/discover?league=...`,
  `/rankings?league=...`) and dynamic pages (creator profiles, club pages).
- Club pages, creator profiles, `/discover`, and `/rankings` render a **generated intro
  paragraph** (see `discoverIntroText`, `rankingsIntroText`, `clubIntroText`,
  `creatorIntroText` in `app.js`) — 2-3 phrasing variants picked deterministically per
  page so near-identical pages (e.g. 39 club pages) don't read as one repeated template.
  Real creator descriptions (currently none are populated — `frfc_streamers.description`
  is empty for all rows) take priority over the generated fallback when present.
- `robots.txt` (static file, repo root) points at `sitemap.js`'s dynamic
  `/sitemap.xml`, which is generated from live creator/club data — not itself in the
  repo as a static file.
- `favicon.ico` (repo root) is a real file, not the SPA catch-all — Google's favicon
  crawler checks `/favicon.ico` directly regardless of the `<link rel="icon">` tag, and
  Netlify's `/* -> /index.html` redirect only applies when no real file matches.

## Admin

Sign in, then visit `/admin`. Access requires a row in `frfc_admin_roles` for your user.
The panel manages creators, submissions, reviews, and can trigger a YouTube sync.
