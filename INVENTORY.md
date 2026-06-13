# FanReactionsFC.com — Full Application Inventory

## Architecture
- **Type**: Static SPA (no build system, no framework)
- **Frontend**: HTML + CSS + Vanilla JS (template literals, innerHTML rendering)
- **Backend**: Supabase (Postgres DB, Auth, Edge Functions)
- **Hosting**: Netlify (static deploy, SPA fallback redirect)
- **APIs**: YouTube Data API v3, Supabase REST, football-data.org (crests)

## Routes (SPA — js/app.js handleRoute())
| Path | Handler | Auth Required |
|------|---------|---------------|
| `/` or `/index.html` | `renderHome()` | No |
| `/discover` | `renderDiscover()` | No |
| `/creators/:slug` | `renderProfile(slug)` | No |
| `/clubs/:team` | `renderClubPage(club)` | No |
| `/rankings` | `renderRankings()` | No |
| `/tools/generator` | `renderGenerator()` | No |
| `/submit` | `renderSubmit()` | No |
| `/admin*` | `renderAdmin()` | Yes (admin role) |
| Fallback | `renderHome()` | No |

## Supabase Tables
| Table | Rows | Purpose |
|-------|------|---------|
| `frfc_streamers` | 169 | Creator profiles (main data) |
| `frfc_reviews` | 1 | User ratings/reviews |
| `frfc_streamer_favorites` | 18 | User bookmarks |
| `frfc_subscriber_history` | 157+ | Subscriber snapshots for growth |
| `frfc_submissions` | 0+ | Public creator submissions |
| `frfc_admin_roles` | 1 | Admin user mapping |
| `frfc_admin_log` | 0+ | Admin activity audit trail |

## JavaScript Modules
| File | Namespace | Functions | Purpose |
|------|-----------|-----------|---------|
| `js/app.js` | Global | ~50 | SPA router, rendering, auth, data |
| `js/generator.js` | `window.Gen` | 30 | Description generator tool |
| `js/admin.js` | `window.Admin` | 25+ | Admin panel CRUD, dashboard |

## CSS Files
| File | Lines | Scope |
|------|-------|-------|
| `css/main.css` | ~400 | Design system, all public pages |
| `css/generator.css` | ~200 | Generator-specific styles |
| `css/admin.css` | ~180 | Admin panel styles |

## Third-Party Dependencies
| Dependency | Type | URL |
|-----------|------|-----|
| Supabase JS v2 | CDN script | cdn.jsdelivr.net |
| Google Fonts (Inter) | CSS | fonts.googleapis.com |
| Football-data.org crests | Images | crests.football-data.org |
| YouTube Data API v3 | REST API | googleapis.com/youtube/v3 |

## Environment / Credentials
| Key | Location | Sensitivity |
|-----|----------|-------------|
| SUPABASE_URL | js/app.js line 6 | Public (publishable) |
| SUPABASE_KEY | js/app.js line 7 | Public (publishable) |
| YT_API_KEY | js/admin.js line 437 | Public (read-only, restricted) |
| RESEND_API_KEY | Edge function secret | Private (server-side) |

## External URLs
- YouTube: youtube.com/@fanreactionsfc
- Instagram: instagram.com/fanreactionsfc
- X/Twitter: x.com/FanReactionsFC
- Streamwall: frfcstreamwall.netlify.app
- OkayJersey: okayjersey.com (partner)
- Stream Builder: stream-builder.co.uk (partner)
