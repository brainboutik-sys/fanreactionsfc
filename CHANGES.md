# Overnight Changes — 2026-04-10

Branch: `claude/overnight-improvements` (8 commits)

## Fixes

- **Nav active state not updating** — The navigation bar always highlighted "Home" regardless of the current page. Added `updateNavActive()` function called by `handleRoute()` that sets the correct active link based on `location.pathname`. (`js/app.js`)

- **Homepage search missed content types** — Searching for "tactical", "reactions", etc. returned 0 results because `initSearch()` only matched against `c.name` and `c.team`. Now also searches `c.contentTypes`. (`js/app.js:~395`)

- **Broken avatar for TheFootballStorey** — The only creator with no `avatar_url` in the database. Replaced external `ui-avatars.com` fallback with a local CSS-based initials placeholder (navy background, yellow text). Added `avatarImg()` helper and `onerror` handler on all avatar `<img>` tags so any broken avatar URL also degrades gracefully to initials. Removed external dependency. (`js/app.js`, `css/main.css`)

- **`escHtml()` didn't escape single quotes** — Could break inline `onclick` handlers that use single-quote delimiters if a team or creator name contained an apostrophe (e.g., "St. Patrick's"). Added `'` to `&#39;` escaping. (`js/app.js:~394`)

- **No error handling on Supabase calls** — `loadFavorites()`, `toggleFavorite()`, and `refreshAuth()` could throw uncaught promise rejections on network errors. Wrapped in try/catch with `console.error` logging. (`js/app.js`)

- **Profile rating grid broke on mobile** — The ratings/review 2-column grid used an inline `style="grid-template-columns:1fr 1fr"` with no breakpoint. Replaced with `.profile-rating-grid` CSS class that stacks to single column below 600px. Also added mobile breakpoints for the profile header (avatar, name, actions center and stack). (`js/app.js`, `css/main.css`)

## Improvements

- **Loading skeleton** — Added `showLoading()` that displays animated skeleton placeholders (hero, search bar, club grid shapes) during the initial Supabase data fetch, instead of showing a blank page or the static "Loading..." text from the HTML shell. Uses the existing `.skeleton` CSS class. (`js/app.js`)

## Flagged for Vincent's attention

- **`unavatar.io` still referenced in `generator.html`** (lines 1371-1378) — The description generator tool uses `unavatar.io/youtube/{handle}` to resolve YouTube profile pictures. This was rate-limited to death in previous sessions and may fail. Consider replacing with the Supabase `resolve-yt-avatar` edge function or removing avatar resolution from the generator entirely. Not changed because the task instructions said not to touch `generator.html` unless a specific bug was found.

- **TheFootballStorey channel** — This Liverpool creator has no `avatar_url` in the database. The channel may be deleted or renamed. Consider removing the row from `frfc_streamers` via Supabase dashboard if confirmed dead, or update the YouTube URL and re-fetch the avatar if the channel moved.

- **Custom domain DNS** — `fanreactionsfc.com` DNS configuration on spaceship.com is still pending (A record `@` -> `75.2.60.5`, CNAME `www` -> `frfcgenerator.netlify.app`).

## Known issues not yet resolved

- **No 404 page** — Unknown routes fall through to the homepage via the `else` clause in `handleRoute()`. A dedicated 404 component would be better UX but is low priority and was skipped as low-risk.

- **`getLeagues()` only returns leagues with creators** — Used in the footer to show league quick links. If a league had zero creators, it would be missing from the footer. Currently all 5 leagues have creators so this is not visible, but would surface if a league's creators were all deleted.

- **Crest image layout shift** — Club crest `<img>` tags use `onerror="this.style.display='none'"` which causes layout reflow if a crest fails to load. An `aspect-ratio` or min-height on crest containers would prevent this. Skipped as low-impact.
