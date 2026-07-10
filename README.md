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
  or a schedule (YouTube API, sitemap, OG cards, live checks, background sync).
- **Hosting:** Netlify, site ID `a845b6ad-3669-4634-b5df-f757ac227b71`.
- **External data:** YouTube Data API v3 (server-side only), club crests from
  crests.football-data.org / ESPN, league logos self-hosted in `img/leagues/`.

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
  live-check-fixtures.js  every 5 min; fires ~5 min before a real kickoff for
                        creators tied to the two clubs playing
  rank-snapshot-background.js  scheduled ranking snapshots
  sitemap.js            dynamic /sitemap.xml from the creator list
  creator-og.js         per-creator OG meta tags for social crawlers
  claim-creator.js      creator profile claim via YouTube description code
netlify.toml            redirects (sitemap, /creators/*, SPA fallback) + fn schedules
scripts/                one-off DB/data utilities (gitignored, not deployed)
```

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
| `YOUTUBE_API_KEY` | youtube-proxy, live-check, live-check-fixtures, sync-background, claim-creator | YouTube Data API v3 key, server-side only |
| `SUPABASE_SERVICE_ROLE_KEY` | sitemap, creator-og, live-check, live-check-fixtures, fixtures-sync, sync-background, rank-snapshot, claim-creator | Supabase secret key — bypasses RLS for server writes. **Never expose client-side.** |
| `FOOTBALL_DATA_API_KEY` | fixtures-sync | Free-tier key from football-data.org — pulls fixtures for every league/competition covered |
| `SUPABASE_URL` | all functions | Optional; falls back to the hardcoded project URL |

The browser only ever uses the Supabase **publishable** key (hardcoded in `app.js` by
design — it is safe to expose and is governed by Row Level Security).

## Database notes

- ~14 `frfc_*` tables. Core: `frfc_streamers` (creators), `frfc_reviews`,
  `frfc_submissions`, `frfc_battles`, `frfc_user_profiles`, `frfc_admin_roles`.
- Community Feature Requests: `frfc_feature_requests`, `frfc_feature_votes`,
  `frfc_feature_comments`, `frfc_feature_comment_likes`, `frfc_feature_status_log`.
- **Counts are trigger-owned.** `vote_count`, `comment_count`, and `like_count` are
  maintained by row triggers on the votes/comments/likes tables — never write them from
  the client. `is_official` on comments is derived server-side from `frfc_admin_roles`.
- Admin actions (status change, pin/lock, merge, official response) are gated by
  `frfc_admin_roles` membership, enforced in RLS/triggers, not just the UI.
- Battle votes go through the `record_battle_vote` RPC, which validates the pair,
  takes the voter id from the session, and rate-limits per fingerprint.

## Admin

Sign in, then visit `/admin`. Access requires a row in `frfc_admin_roles` for your user.
The panel manages creators, submissions, reviews, and can trigger a YouTube sync.
