/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC.com — SPA core (routing, auth, data, page renderers, battle)

   ARCHITECTURE (no build step — plain classic <script>s sharing one global
   scope; load order is set in index.html):
     js/data/teams.js  → LEAGUES, TEAM_CRESTS, TEAM_TO_LEAGUE, TEAM_COLORS, CONTENT_TYPES
     js/lib/slugify.js → slugify()
     js/lib/club-slugs.js → clubSlug(), clubPath(), resolveClub()
     js/app.js         → THIS FILE: the globals + helpers everything else uses
     js/community.js   → Feature Requests module (calls app.js core at runtime)
     js/generator.js   → window.Gen (description generator)
     js/admin.js       → window.Admin (lazy-loaded on /admin only)

   SHARED GLOBAL STATE (declared here, read/written across files — treat as the
   app's single source of truth; always mutate through the helpers noted):
     sb              supabase-js client (all DB/auth access)
     creators        array of creator objects (loadCreators; cached in localStorage)
     favorites       Set of favourited creator ids for the signed-in user
     favouriteCounts Map creatorId → count
     currentUser     supabase auth user | null (set by refreshAuth)
     currentProfile  frfc_user_profiles row | null (set by refreshAuth)
     currentRoute    { page, ... } describing the active route (set by handleRoute)
   Other files must not redeclare these; they rely on them being present at
   runtime (every cross-file reference is inside a function, never top-level).
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Supabase ──────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iq6Dv3b9IYfNktis7WeZ-g_y7_DV0gm';
let sb;
try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }
catch (_) { /* initialized in DOMContentLoaded fallback */ }

// ── State ─────────────────────────────────────────────────────────────────
let creators = [];
// reviews removed
let favorites = new Set();
let favouriteCounts = new Map();
let currentUser = null;
let currentProfile = null;  // frfc_user_profiles row for the signed-in user
let currentRoute = { page: 'home' };

// Team/league reference data (CONTENT_TYPES, LEAGUES, TEAM_CRESTS,
// TEAM_TO_LEAGUE, TEAM_COLORS) lives in js/data/teams.js, loaded before
// this file — see index.html. Extracted from here so it can be edited
// (add a team, fix a crest URL) without touching app logic.

function getTeamColor(team) {
  return TEAM_COLORS[team] || ['#F6BE06','#061A5D'];
}

function getLeague(team) {
  return TEAM_TO_LEAGUE[team] || 'Other';
}

function leagueFlag(name) {
  const l = LEAGUES.find(lg => lg.name === name);
  return l ? l.flag : '';
}
function leagueChipImg(name) {
  const l = LEAGUES.find(lg => lg.name === name);
  if (!l || !l.logo) return '';
  return '<img src="' + l.logo + '" alt="" class="chip-league-logo" onerror="this.style.display=\'none\'">';
}
function leagueLogo(name, cls = 'league-logo') {
  const l = LEAGUES.find(lg => lg.name === name);
  if (!l || !l.logo) return '';
  return `<img src="${l.logo}" alt="" class="${cls}" loading="lazy" onerror="this.style.display='none'">`;
}
function crestImg(team, cls = 'crest') {
  const url = TEAM_CRESTS[team];
  if (!url) return '';
  return `<img src="${url}" alt="" class="${cls}" loading="lazy" onerror="this.style.display='none'">`;
}

// ── Teams (derived from DB) ───────────────────────────────────────────────
function getTeams() {
  const teams = new Set(creators.map(c => c.team).filter(Boolean));
  return [...teams].sort();
}

function getLeagues() {
  const leagues = new Set(creators.map(c => c.league || getLeague(c.team)).filter(l => l && l !== 'Other'));
  // Return in the same order as LEAGUES
  return LEAGUES.map(l => l.name).filter(n => leagues.has(n));
}

function getTeamsByLeague() {
  const result = {};
  const teams = getTeams();
  teams.forEach(t => {
    const league = TEAM_TO_LEAGUE[t] || 'Other';
    if (!result[league]) result[league] = [];
    result[league].push(t);
  });
  return result;
}

// ── Cookie consent ───────────────────────────────────────────────────────
// Gates Google Tag Manager/GA4 behind opt-in, per GDPR/ePrivacy. Consent
// choice is a plain yes/no stored locally; only 'true' triggers loadGTM().
const CONSENT_KEY = 'frfc_consent_analytics';
const GTM_ID = 'GTM-NSWNRXKH';
const CONSENT_NOTICE_VERSION = '2026-07-26';

function getConsent() {
  const v = localStorage.getItem(CONSENT_KEY);
  return v === null ? null : v === 'true';
}

function setConsent(analytics) {
  try { localStorage.setItem(CONSENT_KEY, String(analytics)); } catch (e) {}
  hideConsentBanner();
  if (analytics) loadGTMIfConsented();
  logConsentChoice(analytics);
}

// Best-effort audit trail (GDPR accountability principle) — records that a
// consent choice was made, when, and under which notice version. Anonymous:
// no cookie/fingerprint is attached, so this cannot be used to identify who
// made the choice, only that the banner is functioning and choices are real.
function logConsentChoice(analytics) {
  fetch(`${SUPABASE_URL}/rest/v1/frfc_consent_log`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ analytics_accepted: analytics, notice_version: CONSENT_NOTICE_VERSION, page_path: location.pathname }),
  }).catch(() => {});
}

function initConsentBanner() {
  const consent = getConsent();
  if (consent === true) { loadGTMIfConsented(); return; }
  if (consent === null) showConsentBanner();
}

function showConsentBanner() {
  const el = document.getElementById('consentBanner');
  if (el) el.style.display = 'block';
}

function hideConsentBanner() {
  const el = document.getElementById('consentBanner');
  if (el) el.style.display = 'none';
}

function loadGTMIfConsented() {
  if (window.__gtmLoaded) return;
  window.__gtmLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  const j = document.createElement('script');
  j.async = true;
  j.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
  document.head.appendChild(j);
}

// Reopen the banner from a "Cookie preferences" footer link so users can
// change their mind after the initial choice.
function openConsentSettings() {
  showConsentBanner();
}

// CCPA/CPRA "Do Not Sell or Share My Personal Information" — a one-click,
// no-friction opt-out (not routed through the full consent banner, per the
// CCPA requirement that this control take no more than the accept flow).
// Analytics is the only "sharing" this site does, so opting out is
// equivalent to rejecting analytics.
function doNotSellOptOut() {
  setConsent(false);
  swShowToast("You're opted out — we won't share your data with analytics providers.");
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    if (!sb && window.supabase) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    if (!sb) throw new Error('Supabase library failed to load. Please reload the page.');
    initConsentBanner();
    // Skip the loading skeleton when we can render instantly from a cached
    // creators list — loadCreators() still revalidates in the background.
    const hadCreatorsCache = loadCreatorsFromCache();
    if (!hadCreatorsCache) showLoading();
    await loadCreators();
    loadFavouriteCounts(); // fire-and-forget; non-critical
    updateAuthUI();        // show Sign In button immediately
    handleRoute();
    window.addEventListener('popstate', handleRoute);
    initSearch();
    // Resolve the session in the background so first paint doesn't wait on
    // the auth round-trip. If a user turns out to be signed in, re-render
    // the current route once so auth-dependent UI (account/admin pages,
    // favourite hearts, feature-vote state) reflects the session.
    refreshAuth().then(() => { if (currentUser) handleRoute(); }).catch(() => {});
    sb.auth.onAuthStateChange(() => refreshAuth());
  } catch (e) {
    console.error('Init failed:', e);
    document.getElementById('app').innerHTML = '<div class="container section-message"><h2>Something went wrong</h2><p style="color:var(--text-dim)">' + e.message + '</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div>';
  }
});

function showLoading() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="hero">
      <div class="container" style="text-align:center">
        <div class="skeleton" style="width:320px;height:36px;margin:0 auto 16px;border-radius:8px"></div>
        <div class="skeleton" style="width:480px;max-width:100%;height:18px;margin:0 auto 28px;border-radius:6px"></div>
        <div class="skeleton" style="width:560px;max-width:100%;height:48px;margin:0 auto 20px;border-radius:100px"></div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${Array(5).fill('<div class="skeleton" style="width:120px;height:36px;border-radius:100px"></div>').join('')}
        </div>
      </div>
    </section>
    <div class="container">
      <div class="skeleton" style="width:180px;height:24px;margin-bottom:16px;border-radius:6px"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:12px">
        ${Array(10).fill('<div class="skeleton" style="height:120px;border-radius:var(--radius)"></div>').join('')}
      </div>
    </div>`;
}

// ── Routing ───────────────────────────────────────────────────────────────
function navigate(path, push = true) {
  if (push) history.pushState(null, '', path);
  handleRoute();
}

// Renders a "Sign in required" panel into #app so the route still visually
// reflects the URL when the user isn't authenticated. Also opens the modal
// so they can sign in immediately.
function renderAuthRequired(what) {
  const label = what || 'view this page';
  document.getElementById('app').innerHTML = `
    <div class="container section-message">
      <div class="empty-state">
        <div class="es-icon">&#128274;</div>
        <div class="es-title">Sign in required</div>
        <p style="color:var(--text-dim);margin-bottom:16px">Please sign in to ${escHtml(label)}.</p>
        <button class="btn btn-primary" onclick="openModal('signin')">Sign In</button>
        <a href="/" class="btn btn-ghost" style="margin-left:8px">Back to Home</a>
      </div>
    </div>
    ${renderFooter()}`;
  openModal('signin');
}

function updateNavActive(path) {
  const links = { navHome: '/', navDiscover: '/discover', navRankings: '/rankings', navNews: '/news', navBecome: '/become-a-creator', navCommunity: '/community' };
  Object.entries(links).forEach(([id, prefix]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const isActive = prefix === '/' ? (path === '/' || path === '/index.html') : path.startsWith(prefix);
    el.classList.toggle('active', isActive);
  });
}

const DEFAULT_OG_IMAGE = 'https://fanreactionsfc.com/img/og-social-card.jpg';

// Same mapping as firstPartyCoverUrl() in netlify/functions/news-article.js
// — keep both in sync. Supabase Storage's public object URLs carry
// X-Robots-Tag: none, which social crawlers refuse; article-cover.js
// proxies the same file under this origin instead.
function firstPartyCoverUrl(coverImageUrl) {
  const m = coverImageUrl && coverImageUrl.match(/\/article-covers\/([^/]+\/[^/?]+)/);
  return m ? `https://fanreactionsfc.com/article-covers/${m[1]}` : null;
}

// image is optional — omit it (or pass a falsy value) to reset to the
// default site logo, e.g. when navigating away from a news article to a
// page with no image of its own. Only news articles pass one today (see
// renderNewsArticle), matching news-article.js's server-rendered tags for
// in-app shares — real crawlers never run this, they get news-article.js's
// SSR output directly.
function updatePageMeta(title, description, image) {
  document.title = title;
  let meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', description);
  const canonical = document.getElementById('canonicalLink');
  if (canonical) canonical.setAttribute('href', 'https://fanreactionsfc.com' + location.pathname);
  const resolvedImage = image || DEFAULT_OG_IMAGE;
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) ogImage.setAttribute('content', resolvedImage);
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  if (twitterImage) twitterImage.setAttribute('content', resolvedImage);
}

// Populate the header "N live now" chip whenever creator data is (re)loaded.
function updateLiveCountChip() {
  const chip = document.getElementById('navLiveChip');
  if (!chip) return;
  const count = creators.filter(c => c.isLive).length;
  if (!count) { chip.style.display = 'none'; return; }
  chip.innerHTML = `<span class="nav-live-dot"></span>${count} live now`;
  chip.style.display = 'inline-flex';
}

function handleRoute() {
  const path = location.pathname;
  const app = document.getElementById('app');
  closeModal();
  document.getElementById('navLinks')?.classList.remove('open'); // close mobile nav
  if (typeof Gen !== 'undefined' && Gen.cleanup) Gen.cleanup();
  // Streamwall's wall view hides the site header for a full-screen
  // experience — renderStreamwall() owns re-entering it, but any OTHER
  // route must restore chrome, or navigating away would leave it hidden.
  if (path !== '/streamwall' && typeof swExitFullscreen === 'function') swExitFullscreen();
  window.scrollTo(0, 0);

  // Update nav active state
  updateNavActive(path);

  try {
    if (path === '/' || path === '/index.html') {
      currentRoute = { page: 'home' };
      updatePageMeta('FanReactionsFC — Discover the Best Football YouTubers', 'The definitive database of football YouTubers. Rated by fans. Ranked daily. Premier League, Championship, La Liga, Serie A, Bundesliga, Ligue 1.');
      renderHome();
    } else if (path === '/discover' || path === '/discover/' || path.startsWith('/discover')) {
      if (path === '/discover/') history.replaceState(null, '', '/discover' + location.search);
      currentRoute = { page: 'discover', params: new URLSearchParams(location.search) };
      renderDiscover();
    } else if (path.startsWith('/creators/')) {
      const slug = path.split('/creators/')[1].replace(/\/$/, '');
      if (!slug) {
        currentRoute = { page: 'notfound' };
        updatePageMeta('Page Not Found | FanReactionsFC', 'The page you were looking for doesn\'t exist.');
        app.innerHTML = `
          <div class="container section-message">
            <div class="empty-state">
              <div class="es-title">Page not found</div>
              <a href="/discover" class="btn btn-primary">Browse creators</a>
            </div>
          </div>
          ${renderFooter()}`;
      } else {
        if (path !== '/creators/' + slug) history.replaceState(null, '', '/creators/' + slug + location.search);
        currentRoute = { page: 'profile', slug };
        renderProfile(slug);
      }
    } else if (path.startsWith('/clubs/')) {
      const tail = path.split('/clubs/')[1] || '';
      const isVideos = /\/videos\/?$/.test(tail);
      const raw = tail.replace(/\/videos\/?$/, '').replace(/\/$/, '');
      const extra = creators.map(c => c.team);
      const club = resolveClub(raw, extra);
      if (!club) {
        currentRoute = { page: 'notfound' };
        updatePageMeta('Page Not Found | FanReactionsFC', 'The page you were looking for doesn\'t exist.');
        app.innerHTML = `
          <div class="container section-message">
            <div class="empty-state">
              <div class="es-title">Page not found</div>
              <p style="color:var(--text-dim);margin-bottom:16px">No club page at <code>${escHtml(path)}</code>.</p>
              <a href="/discover" class="btn btn-primary">Browse creators</a>
            </div>
          </div>
          ${renderFooter()}`;
      } else {
        const canonical = clubPath(club, isVideos ? '/videos' : '');
        if (path !== canonical) history.replaceState(null, '', canonical + location.search);
        if (isVideos) {
          currentRoute = { page: 'clubVideos', club };
          renderClubVideos(club);
        } else {
          currentRoute = { page: 'club', club };
          renderClubPage(club);
        }
      }
    } else if (path === '/rankings' || path === '/rankings/') {
      if (path !== '/rankings') history.replaceState(null, '', '/rankings' + location.search);
      currentRoute = { page: 'rankings' };
      renderRankings();
    } else if (path === '/tools/generator') {
      currentRoute = { page: 'generator' };
      updatePageMeta('Description Generator | FanReactionsFC', 'Generate a polished YouTube channel description for your football content in seconds.');
      renderGenerator();
    } else if (path === '/submit') {
      currentRoute = { page: 'submit' };
      updatePageMeta('Submit a Creator | FanReactionsFC', 'Know a great football YouTuber? Suggest them for the FanReactionsFC database — submissions are reviewed within 24 hours.');
      renderSubmit();
    } else if (path === '/contact') {
      currentRoute = { page: 'contact' };
      updatePageMeta('Contact Us | FanReactionsFC', 'Get in touch with the FanReactionsFC team — questions, feedback, or partnership inquiries.');
      renderContact();
    } else if (path === '/news' || path === '/news/') {
      if (path !== '/news') history.replaceState(null, '', '/news');
      currentRoute = { page: 'news' };
      updatePageMeta('News | FanReactionsFC', 'Football creator news, rankings, and fan-culture coverage from FanReactionsFC.');
      renderNewsList();
    } else if (path.startsWith('/news/')) {
      const slug = path.split('/news/')[1].replace(/\/$/, '');
      currentRoute = { page: 'newsArticle', slug };
      renderNewsArticle(slug);
    } else if (path === '/privacy') {
      currentRoute = { page: 'privacy' };
      updatePageMeta('Privacy Policy | FanReactionsFC', 'How FanReactionsFC collects, uses, and protects your personal data.');
      renderPrivacyPolicy();
    } else if (path === '/cookies') {
      currentRoute = { page: 'cookies' };
      updatePageMeta('Cookie Policy | FanReactionsFC', 'The cookies and trackers FanReactionsFC uses, and how to control them.');
      renderCookiePolicy();
    } else if (path === '/terms') {
      currentRoute = { page: 'terms' };
      updatePageMeta('Terms of Service | FanReactionsFC', 'The terms that govern your use of FanReactionsFC.');
      renderTermsOfService();
    } else if (path.startsWith('/manage/')) {
      const creatorId = path.split('/manage/')[1].replace(/\/$/, '');
      currentRoute = { page: 'manageChannel', creatorId };
      updatePageMeta('Manage Channel | FanReactionsFC', 'Manage your claimed channel profile.');
      renderManageChannel(creatorId);
    } else if (path === '/streamwall') {
      currentRoute = { page: 'streamwall' };
      updatePageMeta('Streamwall — Watch Live Football Creators | FanReactionsFC', 'Watch multiple football creators streaming live on YouTube, all at once. Live watchalongs, reactions, and match day content.');
      renderStreamwall();
    } else if (path === '/become-a-creator' || path === '/become-a-creator/') {
      if (path !== '/become-a-creator') history.replaceState(null, '', '/become-a-creator');
      currentRoute = { page: 'becomeCreator' };
      updatePageMeta('How to Start a Football Live Streaming Channel on YouTube | FanReactionsFC', 'Free step-by-step guide to setting up a professional football watchalong channel on YouTube using Prism Live Studio, Uno Overlays, and Canva. Start streaming for free.');
      renderBecomeCreator();
    } else if (path === '/community/features' || path === '/community/features/') {
      currentRoute = { page: 'features' };
      updatePageMeta('Community Feature Requests | FanReactionsFC', 'Suggest and vote on new features for FanReactionsFC. Help shape the future of the platform.');
      renderFeatureRequests();
    } else if (path.startsWith('/community/features/')) {
      const featureId = path.split('/community/features/')[1].replace(/\/$/, '');
      currentRoute = { page: 'featureDetail', featureId };
      renderFeatureDetail(featureId);
    } else if (path === '/account') {
      currentRoute = { page: 'account' };
      updatePageMeta('Account | FanReactionsFC', 'Manage your FanReactionsFC account.');
      renderAccount();
    } else if (path.startsWith('/admin')) {
      currentRoute = { page: 'admin' };
      updatePageMeta('Admin | FanReactionsFC', 'FanReactionsFC admin panel.');
      renderAdmin();
    } else {
      // Unknown route — show a 404 rather than falling back to Home
      // silently, which used to make broken links feel invisible.
      currentRoute = { page: 'notfound' };
      updatePageMeta('Page Not Found | FanReactionsFC', 'The page you were looking for doesn\'t exist.');
      app.innerHTML = `
        <div class="container section-message">
          <div class="empty-state">
            <div class="es-icon">&#128269;</div>
            <div class="es-title">Page not found</div>
            <p style="color:var(--text-dim);margin-bottom:16px">No page at <code style="background:var(--bg-hover);padding:2px 6px;border-radius:4px">${escHtml(path)}</code>.</p>
            <a href="/" class="btn btn-primary">Back to Home</a>
          </div>
        </div>
        ${renderFooter()}`;
    }
  } catch (e) {
    app.innerHTML = `
      <div class="container section-message">
        <div class="empty-state">
          <div class="es-icon">&#9888;</div>
          <div class="es-title">Something went wrong rendering this page.</div>
          <p style="color:var(--text-dim);margin-bottom:8px">${escHtml(e && e.message || String(e))}</p>
          <a href="/" class="btn btn-primary" style="margin-top:8px">Back to Home</a>
        </div>
      </div>
      ${renderFooter()}`;
  }
}

// Click handler for internal links
document.addEventListener('click', e => {
  // Let the browser handle modified clicks natively (Ctrl/Cmd/Shift/Alt +
  // click, or non-primary buttons) so internal links can open in a new
  // tab/window. Middle-click fires `auxclick`, not `click`, so it's already
  // untouched here.
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (href.startsWith('/') && !href.startsWith('//') && !a.hasAttribute('target')) {
    e.preventDefault();
    navigate(href);
  }
});

// Some interactive elements (the Discover league/club filter accordion) are
// non-semantic <div role="button"> nodes for layout reasons. This makes
// them keyboard-activatable the same way a real <button> would be —
// Enter/Space triggers the same click the mouse would.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[role="button"]');
  if (!el) return;
  e.preventDefault();
  el.click();
});

// ── Auth ──────────────────────────────────────────────────────────────────
async function refreshAuth() {
  try {
    const { data: { user } } = await sb.auth.getUser();
    currentUser = user;
    if (currentUser) {
      currentProfile = await loadUserProfile(currentUser.id);
      await loadFavorites();
    } else {
      currentProfile = null;
      favorites = new Set();
    }
  } catch (e) { /* auth refresh failed silently — user will see sign-in */ }
  updateAuthUI();
}

function updateAuthUI() {
  const btn = document.getElementById('authBtn');
  if (!btn) return;
  if (currentUser) {
    btn.className = 'auth-btn';
    btn.onclick = () => showUserMenu();
    if (currentProfile && currentProfile.avatar_url) {
      btn.innerHTML = `<img class="auth-avatar" src="${escHtml(currentProfile.avatar_url)}" alt="">`;
    } else {
      const source = (currentProfile && currentProfile.display_name) || currentUser.email || '?';
      btn.innerHTML = `<span class="auth-avatar auth-avatar--initials">${escHtml(avatarInitials(source))}</span>`;
    }
  } else {
    btn.innerHTML = 'Sign In';
    btn.className = 'btn btn-primary btn-sm';
    btn.onclick = () => openModal('signin');
  }
}

function showUserMenu() {
  const existing = document.querySelector('.user-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.className = 'user-menu';
  menu.style.cssText = 'position:fixed;top:52px;right:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 0;z-index:150;min-width:180px;box-shadow:var(--shadow)';
  const displayName = (currentProfile && currentProfile.display_name) || '';
  menu.innerHTML = `
    <div style="padding:8px 16px;border-bottom:1px solid var(--border)">
      ${displayName ? `<div style="font-size:var(--fs-base);font-weight:600;color:var(--text)">${escHtml(displayName)}</div>` : ''}
      <div style="font-size:var(--fs-sm);color:var(--text-dim)">${escHtml(currentUser.email)}</div>
    </div>
    <a href="/account" style="display:block;padding:8px 16px;font-size:var(--fs-base);color:var(--text)">Account settings</a>
    <a href="/tools/generator" style="display:block;padding:8px 16px;font-size:var(--fs-base);color:var(--text)">Description Generator</a>
    <a href="/admin" style="display:block;padding:8px 16px;font-size:var(--fs-base);color:var(--text)">Admin Panel</a>
    <button onclick="signOut()" style="display:block;width:100%;text-align:left;padding:8px 16px;font-size:var(--fs-base);color:var(--accent);background:none;border:none;border-top:1px solid var(--border)">Sign Out</button>`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function rem() { menu.remove(); document.removeEventListener('click', rem); }, { once: true }), 10);
}

async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  await refreshAuth();
  closeModal();
  return null;
}

// Google OAuth — supabase-js handles the redirect back automatically
// (detectSessionInUrl is on by default), firing onAuthStateChange → refreshAuth.
async function signInWithGoogle() {
  const msg = document.getElementById('authMsg');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error && msg) { msg.textContent = error.message; msg.style.color = 'var(--red)'; }
}

async function signUp(email, password) {
  const { error } = await sb.auth.signUp({ email, password });
  if (error) return error.message;
  return null;
}

async function signOut() {
  try { await sb.auth.signOut(); } catch (_) {}
  currentUser = null;
  currentProfile = null;
  favorites = new Set();
  updateAuthUI();
  handleRoute();
}

// ── Data loading ──────────────────────────────────────────────────────────
// ── Creators cache (stale-while-revalidate) ─────────────────────────────
// A full creators fetch is the single biggest thing blocking first paint.
// If we have a cached copy from a previous visit, render it immediately
// and refresh from the network in the background — only re-rendering if
// the refresh actually succeeds, so a flaky network never wipes out a
// perfectly good cached view. First-ever visit (no cache) still blocks
// on the network, same as before.
const CREATORS_CACHE_KEY = 'frfc_creators_cache_v1';

function loadCreatorsFromCache() {
  try {
    const raw = localStorage.getItem(CREATORS_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.creators) || !parsed.creators.length) return false;
    creators = parsed.creators;
    updateLiveCountChip();
    return true;
  } catch (e) { return false; }
}

function saveCreatorsToCache() {
  try { localStorage.setItem(CREATORS_CACHE_KEY, JSON.stringify({ creators, cachedAt: Date.now() })); }
  catch (e) { /* storage full/unavailable — non-critical, just skip caching */ }
}

async function fetchCreatorsFromNetwork() {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase query timed out')), 10000));
  let data, error;
  try {
    const result = await Promise.race([sb.from('frfc_streamers').select('*').order('team').order('name'), timeout]);
    data = result.data;
    error = result.error;
  } catch (e) {
    console.error('loadCreators failed:', e);
    return false;
  }
  if (error) { console.error('loadCreators error:', error); return false; }
  creators = data.map(r => ({
    id: r.id,
    name: r.name,
    team: r.team,
    channel: r.channel_url || '',
    live: r.live_url || '',
    avatar: r.avatar_url || '',
    slug: r.slug || slugify(r.name),
    league: r.league || getLeague(r.team),
    description: r.description || '',
    verified: r.verified || false,
    contentTypes: r.content_types || [],
    subscriberCount: r.subscriber_count || 0,
    featured: r.featured || false,
    totalViews: r.total_view_count || 0,
    videoCount: r.video_count || 0,
    channelCreatedAt: r.channel_created_at || null,
    latestVideoId: r.latest_video_id || '',
    latestVideoTitle: r.latest_video_title || '',
    latestVideoDate: r.latest_video_date || null,
    latestVideoViews: r.latest_video_views || 0,
    latestVideoThumbnail: r.latest_video_thumbnail || '',
    isLive: r.is_live || false,
    liveVideoId: r.live_video_id || '',
    uploadFrequency: r.upload_frequency || '',
    channelCountry: r.channel_country || '',
    upcomingVideoId: r.upcoming_video_id || '',
    upcomingVideoTitle: r.upcoming_video_title || '',
    upcomingVideoThumbnail: r.upcoming_video_thumbnail || '',
    upcomingVideoScheduledAt: r.upcoming_video_scheduled_at || null,
    subscriberCountPrev: r.subscriber_count_prev || 0,
    claimedBy: r.claimed_by || null,
    avatarCustom: r.avatar_custom || false,
    featuredVideoId: r.featured_video_id || '',
    socialX: r.social_x || '',
    socialTwitch: r.social_twitch || '',
    socialDiscord: r.social_discord || '',
    socialTiktok: r.social_tiktok || '',
    socialInstagram: r.social_instagram || '',
    youtubeChannelId: r.youtube_channel_id || ''
  }));
  updateLiveCountChip();
  saveCreatorsToCache();
  return true;
}

async function loadCreators() {
  const hadCache = loadCreatorsFromCache();
  if (hadCache) {
    // Fast path: caller can render immediately with `creators` already
    // populated. Revalidate in the background; only re-render on success.
    fetchCreatorsFromNetwork().then(ok => { if (ok) handleRoute(); });
    return;
  }
  // No cache yet (first visit, or storage was cleared) — block as before.
  const ok = await fetchCreatorsFromNetwork();
  if (!ok) creators = [];
}

async function loadFavorites() {
  if (!currentUser) return;
  try {
    const { data, error } = await sb.from('frfc_streamer_favorites').select('streamer_id').eq('user_id', currentUser.id);
    if (error) return;
    favorites = new Set((data || []).map(r => r.streamer_id));
  } catch (e) { /* favorites load failed — non-critical */ }
}

async function loadFavouriteCounts() {
  try {
    const { data, error } = await sb.rpc('get_favourite_counts');
    if (error || !data) return;
    favouriteCounts = new Map(data.map(r => [r.streamer_id, Number(r.fav_count)]));
  } catch (e) { /* non-critical */ }
}

async function toggleFavorite(id) {
  if (!currentUser) { openModal('signin'); return; }
  try {
    if (favorites.has(id)) {
      const { error } = await sb.from('frfc_streamer_favorites').delete().eq('user_id', currentUser.id).eq('streamer_id', id);
      if (error) throw error;
      favorites.delete(id);
    } else {
      const { error } = await sb.from('frfc_streamer_favorites').insert({ user_id: currentUser.id, streamer_id: id });
      if (error) throw error;
      favorites.add(id);
    }
  } catch (e) { /* favorite toggle failed silently */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────
// slugify() lives in js/lib/slugify.js (loaded before this script — see
// index.html) so it can be unit tested with a plain require(), no DOM.
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// Safe to embed as a single-quoted JS string literal inside a double-quoted
// HTML onclick="..." attribute — e.g. onclick="fn('${jsAttrStr(name)}')".
// JSON.stringify() is NOT safe here: it always wraps the value in literal
// double quotes, which breaks out of the attribute for every string.
function jsAttrStr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function safeId(s) { return (s || '').replace(/[^A-Za-z0-9_-]/g, ''); }
function safeUrl(s) { try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }

// ── YouTube click-to-load facade ────────────────────────────────────────
// No request to Google/YouTube fires until the visitor actually clicks play
// — a static thumbnail stands in for the iframe until then. Only used for
// passive/promotional embeds; Streamwall itself is exempted because opening
// it is already a deliberate, explicit action to watch video.
function ytFacadeHTML(videoId, opts = {}) {
  const id = safeId(videoId);
  const params = opts.params || 'autoplay=1';
  return `<div class="yt-facade" data-video="${id}" data-params="${escHtml(params)}" onclick="ytFacadePlay(this)" role="button" tabindex="0" aria-label="Play video" onkeydown="if(event.key==='Enter')ytFacadePlay(this)">
    <img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy">
    <span class="yt-facade-play" aria-hidden="true">&#9658;</span>
  </div>`;
}

function ytFacadePlay(el) {
  const id = el.getAttribute('data-video');
  const params = el.getAttribute('data-params') || 'autoplay=1';
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?${params}`;
  iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
  iframe.setAttribute('allowfullscreen', '');
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
  el.replaceWith(iframe);
}
// Subtle, pulsing red dot used next to a creator's name site-wide when
// they're currently livestreaming on YouTube.
function liveDot(isLive) { return isLive ? '<span class="live-dot" title="Live now" aria-label="Live now"></span>' : ''; }
// Small country-flag bubble overlayed on the bottom-right of a creator
// avatar. Returns empty if no country is set.
function avFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const cc = countryCode.toLowerCase();
  return `<span class="av-flag" title="${escHtml(countryName(countryCode) || countryCode.toUpperCase())}" style="background-image:url('https://flagcdn.com/w80/${cc}.png')"></span>`;
}

// Readable country names for the ISO-2 codes we see most. Falls back to
// the raw code if we don't have a mapping yet.
const COUNTRY_NAMES = {
  GB: 'England', US: 'USA', ES: 'Spain', FR: 'France', DE: 'Germany',
  IT: 'Italy', IE: 'Ireland', PT: 'Portugal', NL: 'Netherlands', BE: 'Belgium',
  IN: 'India', AU: 'Australia', CA: 'Canada', BR: 'Brazil', AR: 'Argentina',
  MX: 'Mexico', NG: 'Nigeria', ZA: 'South Africa', KR: 'South Korea',
  JP: 'Japan', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', CH: 'Switzerland',
  AT: 'Austria', TR: 'Turkey', GR: 'Greece', PL: 'Poland', RU: 'Russia',
};
function countryName(code) {
  if (!code || code.length !== 2) return '';
  return COUNTRY_NAMES[code.toUpperCase()] || '';
}
function avatarInitials(name) { return (name || '?').split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase(); }
function avatarOnerror(img, name) { img.onerror=null; img.style.display='none'; const el=document.createElement('div'); el.className=img.className+' avatar-fallback'; el.textContent=avatarInitials(name); img.parentNode.insertBefore(el,img); }
function avatarImg(c, cls = 'cc-avatar') {
  const url = c.avatar || '';
  if (!url) return `<div class="${cls} avatar-fallback">${avatarInitials(c.name)}</div>`;
  return `<img class="${cls}" src="${url}" alt="" loading="lazy" onerror="avatarOnerror(this,'${escHtml(c.name.replace(/'/g, "\\'"))}')">`;
}
function creatorLink(c) { return `/creators/${c.slug || slugify(c.name)}`; }
function clubHref(team, suffix) { return clubPath(team, suffix); }

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  const cc = code.toLowerCase();
  const up = code.toUpperCase();
  // Use flagcdn.com SVG instead of Unicode flag emoji — Windows Chrome/Edge
  // don't render flag emojis and fall back to showing the country code.
  return `<img src="https://flagcdn.com/${cc}.svg" alt="${up}" title="${up}" class="country-flag" loading="lazy">`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo ago';
  return Math.floor(months / 12) + 'y ago';
}

function channelYear(dateStr) {
  if (!dateStr) return '';
  return 'Est. ' + new Date(dateStr).getFullYear();
}

// Human-friendly future time — "In 2h", "Tonight 8 PM", "Tomorrow 3 PM",
// "Sat 14 Apr · 8 PM" for anything further out.
function whenUpcoming(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diffMs = d.getTime() - Date.now();
  const diffHrs = diffMs / 3_600_000;
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
  if (diffMs < 0) return 'Starting soon';
  if (diffHrs < 1) return 'In ' + Math.max(1, Math.round(diffMs / 60000)) + ' min';
  if (diffHrs < 6) return 'In ' + Math.round(diffHrs) + 'h';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (dDay.getTime() === today.getTime()) return 'Today · ' + timeStr;
  if (dDay.getTime() === tomorrow.getTime()) return 'Tomorrow · ' + timeStr;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + timeStr;
}

// Returns last-30-day subscriber history for a creator as an array of
// { subscriber_count, recorded_at } ordered oldest → newest. Uses direct
// fetch instead of supabase-js for consistency with the rest of the app.
async function loadSubscriberHistory(creatorId) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/frfc_subscriber_history?select=subscriber_count,recorded_at&creator_id=eq.${creatorId}&recorded_at=gte.${since}&order=recorded_at.asc`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// Builds a compact SVG sparkline for the subscriber history. Returns an
// empty string if we don't have enough points for a meaningful line.
function subscriberSparkline(series, width = 220, height = 48) {
  if (!series || series.length < 2) return '';
  const values = series.map(s => s.subscriber_count);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${points.join(' L ')}`;
  const areaPath = `${path} L ${width - pad},${height} L ${pad},${height} Z`;
  const trendUp = values[values.length - 1] >= values[0];
  const stroke = trendUp ? 'var(--green)' : 'var(--red)';
  return `<svg class="sub-sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <path d="${areaPath}" fill="${stroke}" fill-opacity="0.08" stroke="none"/>
    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ── Search ────────────────────────────────────────────────────────────────
let _searchTimer = null;

// Static pages the hero/nav search can jump to — matched by name or keyword
// so "vote", "battle", "stream" etc. surface the right page even if the
// query doesn't literally appear in its title.
// `icon` is either a path into the custom PNG icon set or, where that set
// doesn't cover the page yet, an emoji placeholder — pageIconHTML() renders
// whichever it finds. Swap a placeholder to a path as soon as the artwork
// exists; nothing else needs to change.
const SITE_PAGES = [
  { name: 'Rankings', path: '/rankings', icon: '🏆', keywords: ['leaderboard', 'top', 'chart'] },
  { name: 'Community Feature Requests', path: '/community/features', icon: '/img/icons/feature-request.png', keywords: ['suggest', 'idea', 'vote', 'request'] },
  { name: 'Creator Battle', path: '/', icon: '/img/icons/creator-battle.png', keywords: ['battle', 'vote', 'vs'] },
  { name: 'Streamwall', path: '/streamwall', icon: '/img/icons/live-now.png', keywords: ['live', 'watch', 'stream'] },
  { name: 'Become a Creator', path: '/become-a-creator', icon: '/img/icons/become-a-creator.png', keywords: ['start', 'stream', 'guide', 'tutorial'] },
  { name: 'Description Generator', path: '/tools/generator', icon: '📝', keywords: ['title', 'tags', 'description'] },
  { name: 'Submit a Creator', path: '/submit', icon: '➕', keywords: ['add', 'suggest', 'new channel'] },
];

// Renders a SITE_PAGES icon: an <img> for the custom set, the raw glyph for
// the emoji still awaiting artwork.
function pageIconHTML(icon) {
  return icon.startsWith('/')
    ? `<img src="${icon}" alt="" class="search-crest" loading="lazy" onerror="this.style.display='none'">`
    : icon;
}

function renderSearchResults(q, input) {
  const wrap = input.closest('.search-wrap');
  const box = wrap.querySelector('.search-results');
  const clearBtn = wrap.querySelector('.search-clear');
  if (clearBtn) clearBtn.style.display = input.value.length ? 'flex' : 'none';
  if (q.length < 2) { box.classList.remove('open'); return; }

  // Match creators — name, team, or content type
  const creatorMatches = creators.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.team.toLowerCase().includes(q) ||
    c.contentTypes.some(t => t.toLowerCase().includes(q))
  ).slice(0, 6);

  // Match clubs — dedupe by team name, count creators per team
  const clubCountMap = {};
  creators.forEach(c => {
    if (c.team && c.team !== 'Multi-Club / Other') {
      clubCountMap[c.team] = (clubCountMap[c.team] || 0) + 1;
    }
  });
  const clubMatches = Object.entries(clubCountMap)
    .filter(([team]) => team.toLowerCase().includes(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Match site pages — name or any keyword
  const pageMatches = SITE_PAGES.filter(p =>
    p.name.toLowerCase().includes(q) || p.keywords.some(k => k.includes(q))
  ).slice(0, 3);

  if (!creatorMatches.length && !clubMatches.length && !pageMatches.length) {
    box.innerHTML = '<div class="search-empty">No results found</div>';
    box.classList.add('open');
    return;
  }

  let html = '';
  if (pageMatches.length) {
    html += '<div class="search-group-head">Pages</div>';
    html += pageMatches.map(p => `
      <a href="${p.path}" class="search-result">
        <span class="cc-avatar search-crest-wrap" style="font-size:var(--fs-lg)">${pageIconHTML(p.icon)}</span>
        <div class="sr-info">
          <div class="sr-name">${escHtml(p.name)}</div>
        </div>
      </a>`).join('');
  }
  if (creatorMatches.length) {
    html += '<div class="search-group-head">Creators</div>';
    html += creatorMatches.map(c => `
      <a href="${creatorLink(c)}" class="search-result">
        ${avatarImg(c, 'cc-avatar')}
        <div class="sr-info">
          <div class="sr-name">${liveDot(c.isLive)}${escHtml(c.name)}</div>
          <div class="sr-team">${escHtml(c.team)}</div>
        </div>
      </a>`).join('');
  }
  if (clubMatches.length) {
    html += '<div class="search-group-head">Clubs</div>';
    html += clubMatches.map(([team, count]) => `
      <a href="${clubPath(team)}" class="search-result">
        <span class="cc-avatar search-crest-wrap">${crestImg(team, 'search-crest')}</span>
        <div class="sr-info">
          <div class="sr-name">${escHtml(team)}</div>
          <div class="sr-team">${escHtml(getLeague(team))}</div>
        </div>
        <span class="sr-meta">${count} creator${count !== 1 ? 's' : ''}</span>
      </a>`).join('');
  }
  box.innerHTML = html;
  box.classList.add('open');
}

function initSearch() {
  document.addEventListener('input', e => {
    if (!e.target.classList.contains('search-input')) return;
    clearTimeout(_searchTimer);
    const input = e.target;
    _searchTimer = setTimeout(() => {
      renderSearchResults(input.value.trim().toLowerCase(), input);
    }, 250);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const box = document.querySelector('.search-results.open');
      if (box) box.classList.remove('open');
    }
  });
  document.addEventListener('focusout', e => {
    if (e.target.classList.contains('search-input')) {
      setTimeout(() => {
        const box = e.target.closest('.search-wrap')?.querySelector('.search-results');
        if (box) box.classList.remove('open');
      }, 200);
    }
  });
  // Click handler for the clear (×) button inside search-wrap.
  document.addEventListener('click', e => {
    const btn = e.target.closest('.search-clear');
    if (!btn) return;
    const wrap = btn.closest('.search-wrap');
    const input = wrap?.querySelector('.search-input');
    if (!input) return;
    input.value = '';
    btn.style.display = 'none';
    wrap.querySelector('.search-results')?.classList.remove('open');
    input.focus();
  });
}

// ── Render: Home ──────────────────────────────────────────────────────────
function renderHome() {
  const activeLeagues = getLeagues();
  const topBySubs = [...creators].filter(c => c.subscriberCount > 0).sort((a, b) => b.subscriberCount - a.subscriberCount).slice(0, 8);
  const liveNow = creators.filter(c => c.isLive);

  // Upcoming scheduled livestreams — soonest first, within the next 14 days.
  const now = Date.now();
  const upcoming = [...creators]
    .filter(c => c.upcomingVideoId && c.upcomingVideoScheduledAt)
    .map(c => ({ c, ms: new Date(c.upcomingVideoScheduledAt).getTime() }))
    .filter(u => u.ms > now && u.ms < now + 14 * 24 * 60 * 60 * 1000)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 4);

  // All clubs with ≥1 creator, sorted by creator count.
  // Display is capped to 18 tiles at a time (≈ 2 rows on desktop) and
  // filtered client-side via the league chips — see filterClubs().
  const clubCounts = {};
  creators.forEach(c => {
    if (c.team && c.team !== 'Multi-Club / Other') clubCounts[c.team] = (clubCounts[c.team] || 0) + 1;
  });
  const allClubs = Object.entries(clubCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([team, count]) => ({ team, count, league: getLeague(team) }));

  const totalLive = liveNow.length;
  const totalClubs = Object.keys(clubCounts).length;

  // Skip the ~3MB autoplaying hero video entirely on mobile (real bandwidth
  // cost, small screen) and when the visitor has asked for reduced motion —
  // the .hero element already has the poster image as a CSS background, so
  // omitting <video> just leaves that static image in place seamlessly.
  const skipHeroVideo = window.matchMedia('(max-width: 600px)').matches
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.getElementById('app').innerHTML = `
    <!-- Hero -->
    <section class="hero">
      ${skipHeroVideo ? '' : `
      <video class="hero-video" autoplay muted loop playsinline poster="/img/hero-bg.jpg">
        <source src="/img/videos/header-video.mp4" type="video/mp4">
      </video>`}
      <div class="container">
        <img src="/img/logo-wide.png" alt="FanReactionsFC" class="hero-logo">
        <h1>Discover the best football<br>creators on <span class="accent">YouTube</span></h1>
        <p class="subtitle">The definitive database of football YouTubers. Ranked daily.</p>
        <div class="search-wrap">
          <span class="search-icon">&#128269;</span>
          <input class="search-input" type="text" placeholder="Search a creator, club, or content style...">
          <button type="button" class="search-clear" aria-label="Clear search" style="display:none">&times;</button>
          <div class="search-results"></div>
        </div>
        <div class="chip-row">
          ${LEAGUES.map(l =>
            `<span class="chip" onclick="navigate('/discover?league=${encodeURIComponent(l.name)}')"><img src="${l.logo}" alt="" class="chip-league-logo" onerror="this.style.display='none'"> ${l.name}</span>`
          ).join('')}
        </div>
        <p class="seo-more-links home-dir-links">
          <a href="/rankings" onclick="event.preventDefault();navigate('/rankings')">Rankings</a> ·
          <a href="/discover" onclick="event.preventDefault();navigate('/discover')">Discover</a> ·
          <a href="/news" onclick="event.preventDefault();navigate('/news')">News</a> ·
          <a href="/become-a-creator" onclick="event.preventDefault();navigate('/become-a-creator')">Become a Creator</a>
        </p>
      </div>
    </section>

    <!-- Platform stats bar -->
    <div class="platform-stat-bar">
      <div class="container">
        <div class="platform-stats">
          <div class="platform-stat">
            <img class="platform-stat-icon" src="/img/icons/creators.png" alt="">
            <div class="platform-stat-num">${creators.length}</div>
            <div class="platform-stat-label">Creators indexed</div>
          </div>
          <div class="platform-stat">
            <img class="platform-stat-icon" src="/img/icons/clubs.png" alt="">
            <div class="platform-stat-num">${totalClubs}</div>
            <div class="platform-stat-label">Clubs covered</div>
          </div>
          <div class="platform-stat">
            <img class="platform-stat-icon" src="/img/icons/leagues.png" alt="">
            <div class="platform-stat-num">${LEAGUES.length}</div>
            <div class="platform-stat-label">Leagues</div>
          </div>
          ${totalLive ? `
          <a href="/streamwall" class="platform-stat platform-stat--live" title="See who's live on Streamwall">
            <img class="platform-stat-icon" src="/img/icons/live-now.png" alt="">
            <div class="platform-stat-num platform-stat-num--live">${totalLive}</div>
            <div class="platform-stat-label" style="color:var(--red)">● Live now</div>
          </a>` : `
          <div class="platform-stat">
            <img class="platform-stat-icon" src="/img/icons/live-now.png" alt="">
            <div class="platform-stat-num">Daily</div>
            <div class="platform-stat-label">Rankings updated</div>
          </div>`}
        </div>
      </div>
    </div>

    <!-- Live Now — leads right under the stat bar since seeing who's live
         is the site's core value proposition, ahead of Creator Battle. -->
    ${liveNow.length ? `
    <div class="container section-stack">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title"><img class="section-title-icon" src="/img/icons/live-now.png" alt=""><span class="live-dot-sm"></span> Live Now <span class="live-count">${liveNow.length}</span></div>
          <a href="/streamwall" class="sc-head-link">View all &rarr;</a>
        </div>
        <div class="sc-body">
          <div class="live-strip">
            ${liveNow.slice(0, 4).map(c => `
              <a href="https://youtube.com/watch?v=${safeId(c.liveVideoId)}" target="_blank" rel="noopener" class="live-card" title="${escHtml(c.name)} — Live on YouTube">
                <div class="live-thumb-wrap">
                  <img class="live-thumb" src="https://i.ytimg.com/vi/${safeId(c.liveVideoId)}/mqdefault.jpg" alt="" loading="lazy" onerror="this.style.display='none'">
                  <span class="live-badge"><span class="live-badge-dot"></span>LIVE</span>
                </div>
                <div class="live-body">
                  <span class="av-wrap live-av">${avatarImg(c, 'lc-avatar')}${avFlag(c.channelCountry)}</span>
                  <div class="live-info">
                    <div class="lc-name">${escHtml(c.name)}</div>
                    <div class="lc-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
                  </div>
                </div>
              </a>
            `).join('')}
          </div>
        </div>
      </div>
    </div>` : ''}

    <!-- Latest News — fetched after paint (see loadHomeLatestNews) so a
         slow/failed query never delays the rest of the homepage. -->
    <div id="homeLatestNews"></div>

    <!-- Creator Battle -->
    <div class="container battle-section">
      <div class="battle-wrap">
        <div class="battle-top">
          <div class="battle-title"><img class="section-title-icon" src="/img/icons/creator-battle.png" alt="">Creator Battle</div>
          <div class="battle-filters">
            <span class="battle-social-item" id="battleTotalVotes"></span>
            <select class="battle-select" id="battleLeague" onchange="battleLeagueChange()">
              <option value="">All Leagues</option>
              ${LEAGUES.map(l => `<option value="${escHtml(l.name)}"${l.name === 'Premier League' ? ' selected' : ''}>${escHtml(l.name)}</option>`).join('')}
            </select>
            <select class="battle-select" id="battleClub" onchange="battleClubChange()">
              <option value="">All Clubs</option>
            </select>
          </div>
        </div>
        <div class="battle-arena" id="battleArena">
          <div class="battle-loading">Loading matchup...</div>
        </div>
        <button class="battle-skip-btn" id="battleSkip" style="display:none" onclick="battleSkipDelay()">Next matchup &rarr;</button>
        <div class="battle-hot" id="battleHot" style="display:none">
          <div class="battle-hot-title">&#128293; Hot Creators</div>
          <div class="battle-hot-strip" id="battleHotStrip"></div>
        </div>
      </div>
    </div>

    <!-- FRFC Channel banner -->
    <div class="container section-stack">
      <div class="frfc-banner">
        <div class="frfc-banner-logo-wrap">
          <img src="/img/logo-round.png" alt="FanReactionsFC" class="frfc-banner-logo" onerror="this.parentNode.style.display='none'">
        </div>
        <div class="frfc-banner-main">
          <div class="frfc-banner-eyebrow">Curated by</div>
          <div class="frfc-banner-title">@fanreactionsfc</div>
          <div class="frfc-banner-desc">Post-match fan reactions, compilation videos, and rankings every matchday. The editorial voice behind this platform.</div>
        </div>
        <div id="frfc-videos" class="frfc-banner-videos">
          <div class="frfc-video-placeholder">Loading latest videos…</div>
        </div>
        <div class="frfc-banner-cta">
          <a href="https://www.youtube.com/@fanreactionsfc?sub_confirmation=1" target="_blank" rel="noopener" class="btn-youtube">&#9654; Subscribe on YouTube</a>
          <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener" class="btn-x">Follow on X</a>
        </div>
      </div>
    </div>

    <!-- Upcoming streams -->
    ${upcoming.length ? `
    <div class="container section-stack">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title">&#128197; Upcoming Streams</div>
        </div>
        <div class="sc-body">
          <div class="upcoming-grid">
            ${upcoming.map(({ c }) => `
              <a href="https://youtube.com/watch?v=${safeId(c.upcomingVideoId)}" target="_blank" rel="noopener" class="upcoming-card">
                <div class="up-thumb-wrap">
                  <img class="up-thumb" src="${c.upcomingVideoThumbnail || ''}" alt="" loading="lazy">
                  <span class="up-when-badge">${escHtml(whenUpcoming(c.upcomingVideoScheduledAt))}</span>
                </div>
                <div class="up-body">
                  <div class="up-title">${escHtml(c.upcomingVideoTitle || 'Upcoming stream')}</div>
                  <div class="up-creator">
                    ${avatarImg(c, 'up-avatar')}
                    <div class="up-creator-info">
                      <div class="up-creator-name">${escHtml(c.name)}</div>
                      <div class="up-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
                    </div>
                  </div>
                </div>
              </a>
            `).join('')}
          </div>
        </div>
      </div>
    </div>` : ''}

    <!-- Top Clubs -->
    <div class="container section-stack">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title"><img class="section-title-icon" src="/img/icons/top-clubs.png" alt="">Top Clubs</div>
          <div class="sc-head-right">
            <div class="club-filter-row" style="margin:0;gap:6px">
              <span class="chip club-filter active" style="font-size:var(--fs-xs);padding:4px 12px" onclick="filterClubs(this,'')">All</span>
              ${LEAGUES.map(l => `<span class="chip club-filter" style="font-size:var(--fs-xs);padding:4px 10px" onclick="filterClubs(this,'${jsAttrStr(l.name)}')"><img src="${l.logo}" alt="" class="chip-league-logo" onerror="this.style.display='none'"> ${escHtml(l.name)}</span>`).join('')}
            </div>
            <a href="/discover" class="sc-head-link">View all &rarr;</a>
          </div>
        </div>
        <div class="sc-body">
          <div class="club-grid" id="topClubsGrid">
            ${allClubs.map(({ team, count, league }) => {
              return `<a href="${clubPath(team)}" class="club-tile" data-league="${escHtml(league || '')}">
                ${crestImg(team)}
                <div class="club-name">${escHtml(team)}</div>
                <div class="club-meta"><strong>${count} creator${count !== 1 ? 's' : ''}</strong></div>
              </a>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Suggest CTA band -->
    <div class="cta-band">
      <div class="container">
        <div class="cta-band-inner">
          <div>
            <div class="cta-band-title">Know a great football creator?</div>
            <p class="cta-band-sub">Help us grow the database — submissions are reviewed and published within 24 hours.</p>
          </div>
          <a href="/submit" class="btn btn-primary btn-pill btn-lg">+ Suggest a Creator</a>
        </div>
      </div>
    </div>

    <!-- Explore the community -->
    <div class="container section-stack">
      <div class="home-promo-row">
        <a href="/community/features" class="home-promo-card">
          <span class="home-promo-icon"><img src="/img/icons/feature-request.png" alt=""></span>
          <div>
            <div class="home-promo-title">Shape what we build next</div>
            <p class="home-promo-sub">Suggest a feature and vote on what the community wants most.</p>
          </div>
          <span class="home-promo-arrow">&rarr;</span>
        </a>
        <a href="/streamwall" class="home-promo-card">
          <span class="home-promo-icon"><img src="/img/icons/live-now.png" alt=""></span>
          <div>
            <div class="home-promo-title">Watch live, all in one place</div>
            <p class="home-promo-sub">Streamwall lines up every live football creator side by side.</p>
          </div>
          <span class="home-promo-arrow">&rarr;</span>
        </a>
      </div>
    </div>

    <!-- Become a Creator -->
    <div class="container section-stack">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title"><img class="section-title-icon" src="/img/icons/become-a-creator.png" alt="">Become a Creator</div>
        </div>
        <div class="sc-body">
          <div class="become-section">
            <div class="become-video">
              ${ytFacadeHTML('RA7-Wtsk8Pg')}
            </div>
            <div class="become-text">
              <h3>Start Your Watchalong Journey</h3>
              <p>Learn how to set up a professional streaming environment for football watchalongs — completely free. Prism Live Studio, Uno Overlays, live scoreboards, and more.</p>
              <a href="/become-a-creator" class="btn btn-accent btn-pill" onclick="event.preventDefault();navigate('/become-a-creator')">Read the Full Guide &rarr;</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Top Creators -->
    <div class="container section">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title"><img class="section-title-icon" src="/img/icons/top-creators.png" alt="">Top Creators</div>
          <div class="sc-head-right">
            <a href="/discover" class="sc-head-link">Browse all &rarr;</a>
          </div>
        </div>
        <div class="sc-body">
          <div class="card-grid" id="topCreatorsGrid">
            ${topBySubs.map(c => creatorCard(c)).join('')}
          </div>
        </div>
      </div>
    </div>

    ${renderFooter()}
  `;

  // Cap Top Clubs to ~2 rows on initial render (matches filterClubs MAX_VISIBLE).
  const defaultClubFilter = document.querySelector('.club-filter.active');
  if (defaultClubFilter) filterClubs(defaultClubFilter, '');

  // Async: populate the FRFC channel video cards after paint.
  loadFRFCVideos();

  // Async: populate the Latest News strip after paint.
  loadHomeLatestNews();

  // Init Creator Battle
  battleInit();
}

// Fetched after the homepage's main render so a slow/failed news query
// never delays the Live Now / Creator Battle modules above and below it —
// same pattern as loadClubRelatedNews() for club pages.
async function loadHomeLatestNews() {
  const el = document.getElementById('homeLatestNews');
  if (!el) return;
  try {
    const { data, error } = await sb.from('frfc_articles')
      .select('slug,title,summary,cover_image_url,tags,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(3);
    if (error || !data || !data.length) return;
    // Bail if the user has already navigated away by the time this resolves.
    if (currentRoute.page !== 'home') return;
    el.innerHTML = `
      <div class="container section-stack">
        <div class="sc-card">
          <div class="sc-head">
            <div class="sc-head-title">&#128240; Latest News</div>
            <a href="/news" class="sc-head-link" onclick="event.preventDefault();navigate('/news')">View all &rarr;</a>
          </div>
          <div class="sc-body">
            <div class="news-grid">${data.map(newsCardCompactHTML).join('')}</div>
          </div>
        </div>
      </div>`;
  } catch (e) { /* non-critical — silently skip */ }
}

// ── Creator Battle ──────────────────────────────────────────────────────────
const battleSeen = new Set();
let battlePair = [null, null];
let battleVoteCount = 0;
let battleAdvanceTimer = null;
let battleLeaderboard = [];
let battleSessionVotes = 0;
let battleSignupDismissed = false;

function battleFingerprint() {
  let fp = localStorage.getItem('frfc_fp');
  if (!fp) { fp = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('frfc_fp', fp); }
  return fp;
}

function battleInit() {
  battlePopulateClubs();
  battleNextMatchup();
  battleLoadMeta();
}

async function battleLoadMeta() {
  try {
    const [totalRes, lbRes] = await Promise.all([
      sb.rpc('get_battle_total'),
      sb.rpc('get_battle_leaderboard', { lim: 8 })
    ]);
    battleVoteCount = Number(totalRes.data) || 0;
    const el = document.getElementById('battleTotalVotes');
    if (el && battleVoteCount > 0) el.textContent = '🗳 ' + formatNum(battleVoteCount) + ' votes cast';
    battleLeaderboard = (lbRes.data || []);
    battleRenderHot();
  } catch (e) { /* non-critical */ }
}

function battleRenderHot() {
  const container = document.getElementById('battleHot');
  const strip = document.getElementById('battleHotStrip');
  if (!container || !strip || !battleLeaderboard.length) return;
  const items = battleLeaderboard.map(r => {
    const c = creators.find(x => x.id === r.creator_id);
    if (!c) return '';
    const winRate = r.total_battles > 0 ? Math.round(r.total_wins / r.total_battles * 100) : 0;
    return `<a class="battle-hot-item" href="${creatorLink(c)}" onclick="event.preventDefault();navigate('${creatorLink(c)}')">
      ${c.avatar ? `<img class="battle-hot-av" src="${c.avatar}" alt="" loading="lazy">` : ''}
      <span class="battle-hot-name">${escHtml(c.name)}</span>
      <span class="battle-hot-wins">${winRate}% W</span>
    </a>`;
  }).filter(Boolean);
  if (items.length) { strip.innerHTML = items.join(''); container.style.display = ''; }
}

function battlePopulateClubs() {
  const leagueSel = document.getElementById('battleLeague');
  const clubSel = document.getElementById('battleClub');
  if (!leagueSel || !clubSel) return;
  const league = leagueSel.value;
  let html = '<option value="">All Clubs</option>';
  if (league) {
    const clubs = Object.entries(TEAM_TO_LEAGUE).filter(([t, l]) => l === league).map(([t]) => t).sort();
    clubs.forEach(t => { html += `<option value="${escHtml(t)}">${escHtml(t)}</option>`; });
  }
  clubSel.innerHTML = html;
}

function battleLeagueChange() {
  battlePopulateClubs();
  battleSeen.clear();
  battleNextMatchup();
}

function battleClubChange() {
  battleSeen.clear();
  battleNextMatchup();
}

function battleGetPool() {
  const league = document.getElementById('battleLeague')?.value || '';
  const club = document.getElementById('battleClub')?.value || '';
  let pool = creators.filter(c => c.subscriberCount > 0 && c.avatar);
  if (club) pool = pool.filter(c => c.team === club);
  else if (league) pool = pool.filter(c => (c.league || getLeague(c.team)) === league);
  pool.sort((a, b) => b.subscriberCount - a.subscriberCount);
  const cutoff = Math.max(10, Math.ceil(pool.length * 0.6));
  return pool.slice(0, cutoff);
}

function battlePairKey(a, b) { return [a.id, b.id].sort().join(':'); }

function battleNextMatchup() {
  const arena = document.getElementById('battleArena');
  if (!arena) return;
  if (battleAdvanceTimer) { clearTimeout(battleAdvanceTimer); battleAdvanceTimer = null; }
  const skipBtn = document.getElementById('battleSkip');
  if (skipBtn) skipBtn.style.display = 'none';
  const pool = battleGetPool();
  if (pool.length < 2) {
    arena.innerHTML = '<div class="battle-loading">Not enough creators for this filter — try a broader selection.</div>';
    return;
  }
  let attempts = 0, a, b;
  do {
    a = pool[Math.floor(Math.random() * pool.length)];
    b = pool[Math.floor(Math.random() * pool.length)];
    attempts++;
  } while ((a.id === b.id || battleSeen.has(battlePairKey(a, b))) && attempts < 50);
  if (a.id === b.id) { a = pool[0]; b = pool[1]; }
  battlePair = [a, b];
  battleSeen.add(battlePairKey(a, b));
  battleRender(a, b);
}

function battleRender(a, b) {
  const arena = document.getElementById('battleArena');
  if (!arena) return;
  // Fade-in effect
  arena.style.opacity = '0';
  arena.innerHTML = `
    ${battleCardHTML(a, 0)}
    <div class="battle-vs"><img class="battle-vs-text" src="/img/icons/vs.png" alt="VS"></div>
    ${battleCardHTML(b, 1)}
  `;
  requestAnimationFrame(() => { arena.style.transition = 'opacity .3s'; arena.style.opacity = '1'; });
}

function battleCardHTML(c, idx) {
  const lb = battleLeaderboard.find(r => r.creator_id === c.id);
  const wins = lb ? Number(lb.total_wins) : 0;
  const streak = wins >= 5 ? `<span class="battle-streak">&#128293; ${wins}W</span>` : '';
  const [tc1, tc2] = getTeamColor(c.team);
  const crestUrl = TEAM_CRESTS[c.team] || '';
  return `<div class="battle-card" id="bcard${idx}" style="--tc:${tc1};--tc2:${tc2};--tcr:${hexToRgb(tc1)}">
    ${crestUrl ? `<img class="battle-crest-bg" src="${crestUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
    <div class="battle-team-row">
      ${crestUrl ? `<img class="battle-crest" src="${crestUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      <span class="battle-team-name">${escHtml(c.team)}</span>
    </div>
    <div class="battle-avatar-wrap">
      ${c.avatar ? `<img class="battle-avatar" src="${c.avatar}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="battle-avatar"></div>'}
      ${streak}
    </div>
    <div class="battle-name">${escHtml(c.name)}</div>
    <div class="battle-subs">${formatNum(c.subscriberCount)} subs</div>
    <button class="battle-vote-btn" onclick="battleVote(${idx})" aria-label="Vote for ${escHtml(c.name)}">Vote</button>
    <div class="battle-result">
      <div class="battle-pct" id="bpct${idx}"></div>
      <div class="battle-toast" id="btoast${idx}"></div>
    </div>
    <div class="battle-pct-bar"><div class="battle-pct-fill" id="bfill${idx}"></div></div>
  </div>`;
}

async function battleVote(winIdx) {
  const winner = battlePair[winIdx];
  const loser = battlePair[1 - winIdx];
  if (!winner || !loser) return;

  // Visual feedback
  document.querySelectorAll('.battle-card').forEach(el => el.classList.add('battle-card--voted'));
  document.getElementById('bcard' + winIdx).classList.add('battle-card--winner');
  document.getElementById('bcard' + (1 - winIdx)).classList.add('battle-card--loser');

  // Toast
  const toast = document.getElementById('btoast' + winIdx);
  if (toast) toast.textContent = '✓ Vote counted';

  // Record vote via RPC (SECURITY DEFINER; validates + rate-limits server-
  // side). Since the 2026-07 consolidation it also returns both creators'
  // win counts computed after the insert — one round-trip instead of three,
  // and no client-side +1 (the old version double-counted the fresh vote).
  battleVoteCount++;

  // Signup prompt for anonymous users after 3 votes
  if (!currentUser) {
    battleSessionVotes++;
    if (battleSessionVotes >= 3 && !battleSignupDismissed) showBattleSignupPrompt();
  }
  const totalEl = document.getElementById('battleTotalVotes');
  if (totalEl) totalEl.textContent = '🗳 ' + formatNum(battleVoteCount) + ' votes cast';

  try {
    const { data, error: voteErr } = await sb.rpc('record_battle_vote', {
      w_id: winner.id, l_id: loser.id, fp: battleFingerprint(),
      v_id: currentUser ? currentUser.id : null
    });
    if (voteErr) throw voteErr;
    const row = Array.isArray(data) ? data[0] : data;
    const winnerWins = Number(row?.winner_wins) || 0;
    const loserWins = Number(row?.loser_wins) || 0;
    const total = winnerWins + loserWins;
    const winnerPct = total ? Math.round(winnerWins / total * 100) : 100;

    document.getElementById('bpct' + winIdx).textContent = winnerWins + ' wins';
    document.getElementById('bpct' + (1 - winIdx)).textContent = loserWins + ' wins';
    document.getElementById('bfill' + winIdx).style.width = winnerPct + '%';
    document.getElementById('bfill' + (1 - winIdx)).style.width = (100 - winnerPct) + '%';
  } catch (e) {
    console.error('Battle vote failed:', e);
    document.getElementById('bpct' + winIdx).textContent = '✓';
  }

  const skipBtn = document.getElementById('battleSkip');
  if (skipBtn) skipBtn.style.display = '';
  battleAdvanceTimer = setTimeout(() => { battleAdvanceTimer = null; battleNextMatchup(); }, 1800);
}

function battleSkipDelay() {
  battleNextMatchup();
}

function showBattleSignupPrompt() {
  if (document.getElementById('battleSignupPrompt')) return;
  const arena = document.getElementById('battleArena');
  if (!arena) return;
  const p = document.createElement('div');
  p.id = 'battleSignupPrompt';
  p.className = 'battle-signup-prompt';
  p.innerHTML = `<div class="bsp-inner">
    <div class="bsp-text"><strong>Track your votes!</strong> Create a free account to keep your voting stats and join the voters leaderboard.</div>
    <div class="bsp-actions">
      <button class="btn btn-primary btn-sm" onclick="openModal('signup')">Sign Up Free</button>
      <button class="btn btn-ghost btn-sm" onclick="dismissBattleSignup()">Not now</button>
    </div>
  </div>`;
  arena.parentNode.insertBefore(p, arena);
}
function dismissBattleSignup() {
  battleSignupDismissed = true;
  const el = document.getElementById('battleSignupPrompt');
  if (el) el.remove();
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)].join(',');
}

function switchTopCreators(mode, btn) {
  document.querySelectorAll('.top-creators-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const grid = document.getElementById('topCreatorsGrid');
  const list = [...creators].filter(c => c.subscriberCount > 0).sort((a, b) => b.subscriberCount - a.subscriberCount).slice(0, 8);
  grid.innerHTML = list.map(c => creatorCard(c)).join('');
}

// ── FRFC YouTube channel videos ──────────────────────────────────────────────
const FRFC_CACHE_KEY = 'frfc_channel_videos';
const FRFC_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function loadFRFCVideos() {
  const el = document.getElementById('frfc-videos');
  if (!el) return;
  try {
    const cached = sessionStorage.getItem(FRFC_CACHE_KEY);
    let videos;
    if (cached) {
      const p = JSON.parse(cached);
      if (Date.now() - p.ts < FRFC_CACHE_TTL) videos = p.videos;
    }
    if (!videos) {
      // 1. Resolve channel ID from handle
      const chRes = await fetch(`/.netlify/functions/youtube-proxy?endpoint=channels&part=snippet&forHandle=fanreactionsfc`);
      if (!chRes.ok) throw new Error('channel lookup failed');
      const chData = await chRes.json();
      const channelId = chData.items?.[0]?.id;
      if (!channelId) throw new Error('no channel id');
      // 2. Get uploads playlist ID
      const detRes = await fetch(`/.netlify/functions/youtube-proxy?endpoint=channels&part=contentDetails&id=${channelId}`);
      const detData = await detRes.json();
      const uploadsId = detData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsId) throw new Error('no uploads playlist');
      // 3. Fetch last 2 videos
      const plRes = await fetch(`/.netlify/functions/youtube-proxy?endpoint=playlistItems&part=snippet&playlistId=${uploadsId}&maxResults=2`);
      const plData = await plRes.json();
      videos = (plData.items || []).map(item => ({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        published: item.snippet.publishedAt,
      }));
      sessionStorage.setItem(FRFC_CACHE_KEY, JSON.stringify({ ts: Date.now(), videos }));
    }
    if (!videos.length) { el.style.display = 'none'; return; }
    el.innerHTML = videos.map(v => `
      <a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener" class="frfc-video-card">
        <div class="frfc-video-thumb-wrap">
          <img class="frfc-video-thumb" src="${escHtml(v.thumb)}" alt="" loading="lazy">
          <span class="frfc-video-play">&#9654;</span>
        </div>
        <div class="frfc-video-title">${escHtml(v.title)}</div>
      </a>`).join('');
  } catch (e) {
    el.style.display = 'none';
  }
}

// Filter Top Clubs tiles by league, capping visible tiles to ~2 rows.
function filterClubs(el, league) {
  document.querySelectorAll('.club-filter').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const tiles = document.querySelectorAll('#topClubsGrid .club-tile');
  const MAX_VISIBLE = 20;
  let shown = 0;
  tiles.forEach(t => {
    const matches = !league || t.dataset.league === league;
    if (matches && shown < MAX_VISIBLE) {
      t.style.display = '';
      shown++;
    } else {
      t.style.display = 'none';
    }
  });
}

// ── Render: Creator Card ──────────────────────────────────────────────────
function creatorCard(c) {
  const subsStr = c.subscriberCount ? formatNum(c.subscriberCount) + ' sub' + (c.subscriberCount !== 1 ? 's' : '') : '';
  const freqStr = c.uploadFrequency && c.uploadFrequency !== 'Unknown' && c.uploadFrequency !== 'Inactive' ? c.uploadFrequency : '';
  return `
    <a href="${creatorLink(c)}" class="creator-card${c.isLive ? ' is-live' : ''}">
      ${c.isLive ? '<span class="cc-live badge badge-live">LIVE</span>' : ''}
      <div class="cc-top">
        <span class="av-wrap">${avatarImg(c, 'cc-avatar')}${avFlag(c.channelCountry)}</span>
        <div class="cc-info">
          <div class="cc-name">${liveDot(c.isLive)}${escHtml(c.name)} ${c.verified ? '<span class="verified">&#10003;</span>' : ''}</div>
          <div class="cc-team">${crestImg(c.team, 'cc-crest')} ${escHtml(c.team)}${countryName(c.channelCountry) ? ` <span class="cc-loc">&middot; ${escHtml(countryName(c.channelCountry))}</span>` : ''}</div>
        </div>
      </div>
      <div class="cc-meta">
        ${subsStr ? `<span class="cc-subs">${subsStr}</span>` : ''}
        ${(favouriteCounts.get(c.id) || 0) > 0 ? `<span class="cc-fav-count">&#9733; ${favouriteCounts.get(c.id)}</span>` : ''}
        ${freqStr ? `<span class="cc-freq">${freqStr}</span>` : ''}
      </div>
      ${c.latestVideoThumbnail ? `<div class="cc-video"><img src="${c.latestVideoThumbnail}" alt="" loading="lazy"><span class="cc-video-title">${escHtml((c.latestVideoTitle || '').substring(0, 50))}${(c.latestVideoTitle || '').length > 50 ? '...' : ''}</span></div>` : ''}
      ${!c.latestVideoThumbnail && c.contentTypes.length ? `<div class="cc-tags">${c.contentTypes.slice(0, 3).map(t => `<span class="cc-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
    </a>`;
}

// ── Render: Discover ──────────────────────────────────────────────────────
function renderDiscover() {
  const params = currentRoute.params || new URLSearchParams();
  const q = (params.get('q') || '').toLowerCase();
  const leagueFilter = params.get('league') || '';
  const teamFilter = params.get('team') || '';
  const typeFilter = params.get('type') || '';
  const sort = params.get('sort') || 'subs';
  const favOnly = params.get('favs') === '1';
  const activeOnly = params.get('active') === '1';
  const liveOnly = params.get('live') === '1';
  const teams = getTeams();
  const teamsByLeague = getTeamsByLeague();
  const activeLeagues = getLeagues();

  let filtered = creators.slice();
  if (q) filtered = filtered.filter(c =>
    c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q) ||
    (c.league || '').toLowerCase().includes(q) ||
    c.contentTypes.some(t => t.toLowerCase().includes(q))
  );
  if (leagueFilter) filtered = filtered.filter(c => (c.league || getLeague(c.team)) === leagueFilter);
  if (teamFilter) filtered = filtered.filter(c => c.team === teamFilter);
  if (typeFilter) filtered = filtered.filter(c => c.contentTypes.includes(typeFilter));
  if (favOnly) filtered = filtered.filter(c => favorites.has(c.id));
  if (activeOnly) filtered = filtered.filter(c => c.latestVideoDate && (Date.now() - new Date(c.latestVideoDate).getTime()) < 30 * 24 * 60 * 60 * 1000);
  if (liveOnly) filtered = filtered.filter(c => c.isLive);

  if (sort === 'subs') filtered.sort((a, b) => b.subscriberCount - a.subscriberCount);
  else filtered.sort((a, b) => a.name.localeCompare(b.name));

  // Build accordion: which league should be open?
  const openLeague = leagueFilter || (teamFilter ? getLeague(teamFilter) : '');

  const discoverIntro = discoverIntroText(filtered, leagueFilter, teamFilter, q, activeLeagues, teams);
  updatePageMeta(
    (teamFilter ? `Discover ${teamFilter} Creators` : leagueFilter ? `Discover ${leagueFilter} Creators` : 'Discover Football Creators') + ' | FanReactionsFC',
    discoverIntro
  );

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Directory</div>
            <h1 class="page-hero-title">Discover Football Creators</h1>
            <p class="page-hero-subtitle" style="max-width:640px">${escHtml(discoverIntro)}</p>
          </div>
          <a href="/submit" class="btn btn-accent btn-pill btn-lg">+ Suggest a Creator</a>
        </div>
      </div>
    </div>

    <div class="container section">
      <div class="discover-layout">
        <!-- Left sidebar: League/Club accordion -->
        <aside class="filter-sidebar" id="filterSidebar">
          <div class="league-accordion">
            <div class="league-acc-item">
              <div class="league-acc-header ${!leagueFilter && !teamFilter ? 'active' : ''}" onclick="applyFilter('league','')" role="button" tabindex="0">
                <img src="/img/icons/leagues.png" alt="" class="acc-league-logo" onerror="this.style.display='none'"> All Leagues
                <span class="acc-count">${creators.length}</span>
              </div>
            </div>
            ${LEAGUES.map(l => {
              // Show all league teams from TEAM_TO_LEAGUE, not just those with creators
              const allLeagueTeams = Object.entries(TEAM_TO_LEAGUE).filter(([t, lg]) => lg === l.name).map(([t]) => t).sort();
              const cnt = creators.filter(c => (c.league || getLeague(c.team)) === l.name).length;
              const isOpen = openLeague === l.name;
              return `
                <div class="league-acc-item">
                  <div class="league-acc-header ${leagueFilter === l.name && !teamFilter ? 'active' : ''} ${isOpen ? 'open' : ''}" onclick="toggleAccordion(this, '${jsAttrStr(l.name)}')" role="button" tabindex="0" aria-expanded="${isOpen}">
                    <img src="${l.logo}" alt="" class="acc-league-logo" onerror="this.style.display='none'"> ${escHtml(l.name)}
                    <span class="acc-count">${cnt}</span>
                    <span class="acc-arrow">&#9654;</span>
                  </div>
                  <div class="league-acc-body ${isOpen ? 'open' : ''}">
                    ${allLeagueTeams.map(t => {
                      const tCnt = creators.filter(c => c.team === t).length;
                      return `<div class="acc-club ${teamFilter === t ? 'active' : ''}" onclick="applyFilter('team','${jsAttrStr(t)}')" role="button" tabindex="0">${crestImg(t, 'crest-sm')} ${escHtml(t)} <span class="count">${tCnt || ''}</span></div>`;
                    }).join('')}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </aside>

        <!-- Right: top bar + grid -->
        <div>
          <!-- Top filter bar -->
          <div class="discover-top-bar">
            <span class="bar-label">Quick</span>
            <span class="filter-chip ${sort === 'subs' ? 'active' : ''}" onclick="applyFilter('sort','subs')">&#128200; Most Subs</span>
            <span class="filter-chip ${sort === 'name' ? 'active' : ''}" onclick="applyFilter('sort','name')">&#9398; A–Z</span>
            <span class="filter-chip ${favOnly ? 'active' : ''}" onclick="applyFilter('favs','${favOnly ? '' : '1'}')">&#9733; Favorites${favOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>
            <span class="filter-chip ${activeOnly ? 'active' : ''}" onclick="applyFilter('active','${activeOnly ? '' : '1'}')">&#9889; Active (30d)${activeOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>
            ${creators.some(c => c.isLive) ? `<span class="filter-chip ${liveOnly ? 'active' : ''}" onclick="applyFilter('live','${liveOnly ? '' : '1'}')"><span class="live-dot-sm"></span> Live Now${liveOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>` : ''}
          </div>

          <!-- Active filters + result count -->
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <span class="discover-result-count">${filtered.length} creator${filtered.length !== 1 ? 's' : ''}</span>
            ${leagueFilter ? `<span class="chip active" style="font-size:var(--fs-sm);padding:4px 12px" onclick="applyFilter('league','')">${leagueChipImg(leagueFilter)} ${escHtml(leagueFilter)} &times;</span>` : ''}
            ${teamFilter ? `<span class="chip active" style="font-size:var(--fs-sm);padding:4px 12px" onclick="applyFilter('team','')">${escHtml(teamFilter)} &times;</span>` : ''}
            ${favOnly ? `<span class="chip active" style="font-size:var(--fs-sm);padding:4px 12px" onclick="applyFilter('favs','')">Favorites &times;</span>` : ''}
          </div>

          <div class="card-grid">
            ${filtered.length ? filtered.map(c => creatorCard(c)).join('') :
              '<div class="empty-state"><div class="es-icon">&#128269;</div><div class="es-title">No creators found</div><p style="color:var(--text-dim)">Try adjusting your filters or <a href="/submit">suggest a creator</a></p></div>'}
          </div>
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;
}

function applyFilter(key, value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  // When changing league, reset team filter
  if (key === 'league') url.searchParams.delete('team');
  // When picking a team, auto-set its league
  if (key === 'team' && value) {
    const league = getLeague(value);
    if (league && league !== 'Other') url.searchParams.set('league', league);
  }
  navigate(url.pathname + url.search);
}

function toggleAccordion(el, leagueName) {
  const body = el.nextElementSibling;
  const wasOpen = body.classList.contains('open');
  // Close all
  document.querySelectorAll('.league-acc-body').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.league-acc-header').forEach(h => h.classList.remove('open'));
  if (!wasOpen) {
    body.classList.add('open');
    el.classList.add('open');
  }
  // Navigate to filter by this league
  applyFilter('league', wasOpen ? '' : leagueName);
}

// ── Social link icons ────────────────────────────────────────────────────
// Simplified, hand-drawn glyphs rather than exact brand marks — small and
// safe to render at 18px, no dependency on an external icon font/library.
// currentColor so each inherits the button's text color.
const SOCIAL_ICONS = {
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
  twitch: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 3h16v11l-4 4h-4l-3 3v-3H4z"/><line x1="10" y1="7" x2="10" y2="12"/><line x1="14" y1="7" x2="14" y2="12"/></svg>',
  discord: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 5.5c1-1 2.5-1.5 4-1.5s3 .5 4 1.5" stroke-linecap="round"/><rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="17" r="3" fill="currentColor" stroke="none"/><path d="M12 17V4h1.5a4 4 0 0 0 4 4v2a6 6 0 0 1-4-1.5V17" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function socialLinkHTML(url, key, label) {
  if (!url) return '';
  return `<a href="${safeUrl(url)}" target="_blank" rel="noopener" class="btn btn-icon btn-on-dark" title="${escHtml(label)}" aria-label="${escHtml(label)}">${SOCIAL_ICONS[key]}</a>`;
}

// ── Render: Creator Profile ───────────────────────────────────────────────
async function renderProfile(slug) {
  const c = creators.find(cr => (cr.slug || slugify(cr.name)) === slug);
  if (!c) {
    document.getElementById('app').innerHTML = '<div class="container section-message"><div class="empty-state"><div class="es-title">Creator not found</div><a href="/discover" class="btn btn-primary" style="margin-top:12px">Browse creators</a></div></div>';
    return;
  }

  const isFav = favorites.has(c.id);
  const similar = creators.filter(s => s.team === c.team && s.id !== c.id).slice(0, 4);

  updatePageMeta(
    `${c.name} — Football Creator on FanReactionsFC`,
    (c.description ? c.description.slice(0, 160) : `${c.name} is ${aOrAn(c.team)} ${c.team} football YouTuber on FanReactionsFC.`) + (c.subscriberCount ? ` ${formatNum(c.subscriberCount)} subscribers.` : '')
  );

  document.getElementById('app').innerHTML = `
    <!-- ── Hero Header ─────────────────────────────────────────────────────── -->
    <div class="cp-hero">
      <div class="container">
        <div class="cp-hero-inner">
          <div class="cp-avatar-wrap">
            ${avatarImg(c, 'cp-avatar')}
            ${c.isLive ? '<span class="cp-live-ring"></span>' : ''}
            ${c.channelCountry ? `<span class="cp-flag-badge">${countryFlag(c.channelCountry)}</span>` : ''}
          </div>
          <div class="cp-hero-info">
            <div class="cp-hero-eyebrow">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)} ${c.league ? '&middot; ' + escHtml(c.league) : ''}</div>
            <h1 class="cp-hero-name">
              ${escHtml(c.name)}
              ${c.claimedBy ? '<img src="/img/icons/claimed-verified.png" alt="Claimed by the creator" title="Claimed by the creator" class="cp-claimed-icon">' : ''}
              ${c.verified ? '<span class="badge badge-green" style="font-size:var(--fs-xs);vertical-align:middle">Verified</span>' : ''}
              ${c.isLive ? '<span class="badge badge-live" style="vertical-align:middle">● LIVE</span>' : ''}
            </h1>
            <p class="cp-hero-desc">${c.description ? escHtml(c.description) : escHtml(creatorIntroText(c))}</p>
            ${(c.socialX || c.socialInstagram || c.socialTwitch || c.socialDiscord || c.socialTiktok) ? `
            <div class="cp-social-links">
              ${socialLinkHTML(c.socialX, 'x', 'X (Twitter)')}
              ${socialLinkHTML(c.socialInstagram, 'instagram', 'Instagram')}
              ${socialLinkHTML(c.socialTwitch, 'twitch', 'Twitch')}
              ${socialLinkHTML(c.socialDiscord, 'discord', 'Discord')}
              ${socialLinkHTML(c.socialTiktok, 'tiktok', 'TikTok')}
            </div>` : ''}
            <div class="cp-hero-actions">
              ${c.channel ? `<a href="${safeUrl(c.channel)}" target="_blank" rel="noopener" class="btn btn-accent cp-cta">▶ Watch on YouTube</a>` : ''}
              ${c.live ? `<a href="${safeUrl(c.live)}" target="_blank" rel="noopener" class="btn btn-on-dark"><img src="/img/icons/live-now.png" alt="" class="btn-ico" onerror="this.style.display='none'"> Live / Streams</a>` : ''}
              <button class="btn btn-on-dark${isFav ? ' btn-favourited' : ''}" onclick="handleFavorite('${c.id}')" id="favBtn" aria-pressed="${isFav}">${isFav ? '★ Favourited' : '☆ Favourite'}${(favouriteCounts.get(c.id) || 0) > 0 ? ' <span class="fav-count-badge" id="favCount">' + (favouriteCounts.get(c.id)) + '</span>' : ''}</button>
              <button class="cp-report-link" onclick="openReportModal('${c.id}','${jsAttrStr(c.name)}')">Report issue</button>
              ${c.claimedBy && currentUser && c.claimedBy === currentUser.id
                ? `<a href="/manage/${c.id}" class="btn btn-sm btn-accent" onclick="event.preventDefault();navigate('/manage/${c.id}')" title="Edit your channel's profile">Manage Channel</a>`
                : !c.claimedBy ? `<button class="cp-report-link" onclick="openClaimModal('${c.id}','${jsAttrStr(c.name)}')">Claim this channel</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Stat Cards ──────────────────────────────────────────────────────── -->
    <div class="cp-stats-bar">
      <div class="container">
        <div class="cp-stat-cards">
          ${c.subscriberCount ? `
          <div class="cp-stat-card cp-stat-card--primary">
            <div class="cp-stat-label">Subscribers</div>
            <div class="cp-stat-num">${formatNum(c.subscriberCount)}<span id="subGrowth" class="cp-stat-growth"></span></div>
          </div>` : ''}
          ${c.totalViews ? `
          <div class="cp-stat-card">
            <div class="cp-stat-label">Total Views</div>
            <div class="cp-stat-num">${formatNum(c.totalViews)}</div>
          </div>` : ''}
          ${c.videoCount ? `
          <div class="cp-stat-card">
            <div class="cp-stat-label">Videos</div>
            <div class="cp-stat-num">${formatNum(c.videoCount)}</div>
          </div>` : ''}
          ${c.uploadFrequency && c.uploadFrequency !== 'Unknown' ? `
          <div class="cp-stat-card">
            <div class="cp-stat-label">Upload Freq.</div>
            <div class="cp-stat-num cp-stat-num--sm">${escHtml(c.uploadFrequency)}</div>
          </div>` : ''}
          ${c.channelCreatedAt ? `
          <div class="cp-stat-card">
            <div class="cp-stat-label">Est.</div>
            <div class="cp-stat-num cp-stat-num--sm">${channelYear(c.channelCreatedAt)}</div>
          </div>` : ''}
          <div class="cp-stat-card" id="battleWonStat" style="display:none">
            <div class="cp-stat-label">Battles Won</div>
            <div class="cp-stat-num" id="battleWonNum">—</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Main Content ────────────────────────────────────────────────────── -->
    <div class="container cp-body">
      <div class="cp-main">

        ${c.isLive ? `
        <div class="cp-live-alert">
          <span class="live-dot-sm"></span>
          <strong>${escHtml(c.name)} is streaming live right now</strong>
          <a href="https://youtube.com/watch?v=${safeId(c.liveVideoId)}" target="_blank" rel="noopener" class="btn btn-sm" style="background:var(--red);color:#fff;margin-left:auto;flex-shrink:0">Watch Live &rarr;</a>
        </div>` : ''}

        ${c.featuredVideoId ? `
        <div class="cp-section-card">
          <div class="cp-section-head">
            <span class="cp-section-label">Featured Video</span>
            <span class="cp-section-meta">Pinned by the creator</span>
          </div>
          <a href="https://youtube.com/watch?v=${safeId(c.featuredVideoId)}" target="_blank" rel="noopener" class="cp-video-card">
            <div class="cp-video-thumb-wrap">
              <img src="https://i.ytimg.com/vi/${safeId(c.featuredVideoId)}/hqdefault.jpg" alt="" class="cp-video-thumb" loading="lazy">
              <span class="cp-video-play">▶</span>
            </div>
          </a>
        </div>` : ''}

        ${c.latestVideoId ? `
        <div class="cp-section-card">
          <div class="cp-section-head">
            <span class="cp-section-label">Latest Video</span>
            <span class="cp-section-meta">${c.latestVideoDate ? timeAgo(c.latestVideoDate) : ''}</span>
          </div>
          <a href="https://youtube.com/watch?v=${safeId(c.latestVideoId)}" target="_blank" rel="noopener" class="cp-video-card">
            <div class="cp-video-thumb-wrap">
              <img src="${c.latestVideoThumbnail || ''}" alt="" class="cp-video-thumb" loading="lazy">
              <span class="cp-video-play">▶</span>
            </div>
            <div class="cp-video-info">
              <div class="cp-video-title">${escHtml(c.latestVideoTitle || '')}</div>
              <div class="cp-video-meta">
                ${c.latestVideoViews ? `<span>${formatNum(c.latestVideoViews)} views</span>` : ''}
              </div>
            </div>
          </a>
        </div>` : ''}

        ${similar.length ? `
        <div class="cp-section-card">
          <div class="cp-section-head">
            <span class="cp-section-label">${crestImg(c.team, 'crest-sm')} More ${escHtml(c.team)} Creators</span>
            <a href="${clubPath(c.team)}" class="cp-section-link">View all &rarr;</a>
          </div>
          <div class="card-grid">${similar.map(s => creatorCard(s)).join('')}</div>
        </div>` : ''}

        <div class="cta-band" style="border-radius:var(--radius);margin-top:4px;padding:24px 28px">
          <div class="cta-band-inner" style="padding:0">
            <div>
              <div class="cta-band-title">Know a great ${escHtml(c.team)} creator?</div>
              <p class="cta-band-sub">Help us grow the database — submissions reviewed within 24h.</p>
            </div>
            <a href="/submit" class="btn btn-primary btn-pill btn-lg">+ Suggest a Creator</a>
          </div>
        </div>
      </div>

      <!-- ── Sidebar ──────────────────────────────────────────────────────── -->
      <aside class="cp-sidebar">
        ${c.subscriberCount ? `
        <div class="cp-sidebar-card">
          <div class="cp-sidebar-title">Subscriber Growth <span style="font-size:var(--fs-xs);color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">— last 30 days</span></div>
          <div id="subSparkline" style="padding:12px 0 4px;text-align:center;color:var(--text-muted);font-size:var(--fs-sm)">Loading…</div>
        </div>` : ''}

        <div class="cp-sidebar-card">
          <div class="cp-sidebar-title">Channel Info</div>
          <div class="cp-info-list">
            ${c.channelCountry ? `<div class="cp-info-row"><span class="cp-info-key">Based in</span><span class="cp-info-val">${countryFlag(c.channelCountry)} ${escHtml(countryName(c.channelCountry) || c.channelCountry)}</span></div>` : ''}
            ${c.channelCreatedAt ? `<div class="cp-info-row"><span class="cp-info-key">Est.</span><span class="cp-info-val">${channelYear(c.channelCreatedAt)}</span></div>` : ''}
            ${c.uploadFrequency && c.uploadFrequency !== 'Unknown' ? `<div class="cp-info-row"><span class="cp-info-key">Uploads</span><span class="cp-info-val">${escHtml(c.uploadFrequency)}</span></div>` : ''}
            ${c.league ? `<div class="cp-info-row"><span class="cp-info-key">League</span><span class="cp-info-val">${escHtml(c.league)}</span></div>` : ''}
            ${c.contentTypes && c.contentTypes.length ? `<div class="cp-info-row"><span class="cp-info-key">Content</span><span class="cp-info-val cp-tags">${c.contentTypes.slice(0,4).map(t => `<span class="cc-tag">${escHtml(t)}</span>`).join('')}</span></div>` : ''}
          </div>
        </div>

        ${c.channel || c.live ? `
        <div class="cp-sidebar-card">
          <div class="cp-sidebar-title">Links</div>
          <div class="cp-links">
            ${c.channel ? `<a href="${safeUrl(c.channel)}" target="_blank" rel="noopener" class="cp-link-btn cp-link-yt">▶ YouTube Channel</a>` : ''}
            ${c.live ? `<a href="${safeUrl(c.live)}" target="_blank" rel="noopener" class="cp-link-btn cp-link-live"><img src="/img/icons/live-now.png" alt="" class="btn-ico" onerror="this.style.display='none'"> Live / Streams</a>` : ''}
          </div>
        </div>` : ''}
      </aside>
    </div>
    ${renderFooter()}
  `;


  // Async: load subscriber history for growth delta + sparkline
  if (c.subscriberCount) {
    loadSubscriberHistory(c.id).then(series => {
      if (!series.length) return;
      if (series.length >= 2) {
        const growth = series[series.length - 1].subscriber_count - series[0].subscriber_count;
        const el = document.getElementById('subGrowth');
        if (el) {
          const dir = growth >= 0 ? 'up' : 'down';
          el.className = 'cp-stat-growth ' + dir;
          el.textContent = (growth >= 0 ? '+' : '') + formatNum(Math.abs(growth));
        }
      }
      const sparkEl = document.getElementById('subSparkline');
      if (sparkEl) {
        if (series.length >= 2) {
          const growth = series[series.length - 1].subscriber_count - series[0].subscriber_count;
          const isUp = growth >= 0;
          const color = isUp ? '#16a34a' : 'var(--red)';
          const sign = isUp ? '+' : '−';
          sparkEl.innerHTML = `
            <div style="text-align:center;padding:10px 0 6px">
              <div style="font-size:var(--fs-3xl);font-weight:800;color:${color};letter-spacing:-.03em;line-height:1">${sign}${formatNum(Math.abs(growth))}</div>
              <div style="font-size:var(--fs-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-top:6px">subscribers</div>
            </div>`;
        } else {
          sparkEl.innerHTML = `<div style="padding:12px 0;text-align:center;color:var(--text-muted);font-size:var(--fs-sm)">Not enough data yet</div>`;
        }
      }
    });
  }

  // Async: load battle wins
  sb.rpc('get_creator_battle_stats', { cid: c.id }).then(({ data, error }) => {
    if (error) { console.warn('battle stats error', error); return; }
    const wins = data && data.length ? Number(data[0].wins) || 0 : 0;
    const el = document.getElementById('battleWonStat');
    const num = document.getElementById('battleWonNum');
    if (el && num) {
      num.textContent = formatNum(wins);
      el.style.display = '';
    }
  });
}


function formatNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

// Small deterministic hash used to pick among a few phrasing variants,
// so pages with similar underlying data don't read as one repeated
// template (thin/duplicate-content smell) when a real description or
// hand-written copy isn't available.
function textVariant(seed, count) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % count;
}

function aOrAn(word) { return /^[aeiou]/i.test(word) ? 'an' : 'a'; }

function joinWithAnd(arr) {
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + ' and ' + arr[1];
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}

// Generated fallback intro paragraph for a creator profile — only used
// when the channel has no real description synced from YouTube.
function creatorIntroText(c) {
  const subs = formatNum(c.subscriberCount || 0);
  const videos = c.videoCount ? formatNum(c.videoCount) : '';
  const styles = (c.contentTypes && c.contentTypes.length)
    ? joinWithAnd(c.contentTypes.slice(0, 3).map(t => t.toLowerCase()))
    : 'football reactions and match content';
  const freq = c.uploadFrequency && c.uploadFrequency !== 'Unknown' && c.uploadFrequency !== 'Inactive' ? c.uploadFrequency.toLowerCase() : '';
  const videosPart = videos ? ` across ${videos} videos` : '';
  const freqPart = freq ? `, uploading ${freq}` : '';

  const variants = [
    `${c.name} is ${aOrAn(c.team)} ${c.team} YouTuber covering ${styles}. The channel has grown to ${subs} subscribers${videosPart}${freqPart}.`,
    `Covering ${c.team} on YouTube, ${c.name} has built an audience of ${subs} subscribers${videosPart} with content focused on ${styles}${freqPart}.`,
    `${c.name} is one of the ${c.team} creators tracked on FanReactionsFC — ${subs} subscribers${videosPart}, focused on ${styles}${freqPart}.`,
  ];
  return variants[textVariant(c.id || c.name, variants.length)];
}

// Generated intro paragraph for a club page — varies phrasing by club
// name so 39 club pages don't read as one template with the name swapped.
// Generated intro paragraph for the Discover page — varies by the
// active league/team/search filter so filtered views read as distinct
// copy rather than one static line regardless of context.
function discoverIntroText(filtered, leagueFilter, teamFilter, q, activeLeagues, teams) {
  const seed = leagueFilter || teamFilter || q || 'all';
  const n = filtered.length;
  if (q) {
    const variants = [
      `Searching "${q}" turns up ${n} matching creator${n !== 1 ? 's' : ''} on FanReactionsFC.`,
      `${n} creator${n !== 1 ? 's' : ''} match "${q}" across every league in the directory.`,
    ];
    return variants[textVariant(seed, variants.length)];
  }
  if (teamFilter) {
    const variants = [
      `${n} ${teamFilter} creator${n !== 1 ? 's' : ''} are listed here, filterable by content type and sortable by subscribers.`,
      `Browsing ${teamFilter}: ${n} YouTube creator${n !== 1 ? 's' : ''} covering the club.`,
    ];
    return variants[textVariant(seed, variants.length)];
  }
  if (leagueFilter) {
    const variants = [
      `${n} ${leagueFilter} creators are tracked here, covering every club in the competition — filter by team or content type to narrow it down.`,
      `Browse ${n} football YouTubers covering ${leagueFilter} clubs, ranked by subscribers or sorted A–Z.`,
      `From title challengers to relegation battles, ${n} creators cover ${leagueFilter} on this page.`,
    ];
    return variants[textVariant(seed, variants.length)];
  }
  const variants = [
    `Browse all ${creators.length} football YouTubers in the FanReactionsFC directory, spanning ${activeLeagues.length} leagues and ${teams.length} clubs. Filter by league, club, content type, or search by name.`,
    `The full FanReactionsFC directory: ${creators.length} creators across ${activeLeagues.length} leagues and ${teams.length} clubs, from Premier League regulars to Championship watchalongs.`,
    `${creators.length} football content creators, filterable by league, club, and content type — ${activeLeagues.length} leagues and ${teams.length} clubs covered.`,
  ];
  return variants[textVariant(seed, variants.length)];
}

// Generated intro paragraph for the Rankings page — varies by the
// active league/team filter and names the current #1 by subscribers.
function rankingsIntroText(ranked, leagueFilter, teamFilter) {
  if (!ranked.length) return '';
  const top = ranked[0];
  const scope = teamFilter || leagueFilter || '';
  const scopePart = scope ? scope + ' ' : '';
  const n = ranked.length;
  const variants = [
    `${n} ${scopePart}creators are ranked here by subscribers, videos, total views, and Creator Battle record. ${top.name} leads with ${formatNum(top.subscriberCount)} subscribers.`,
    `See how ${n} ${scopePart}creators compare — click any column to re-sort by subscribers, videos, views, or battle wins. ${top.name} currently tops the list.`,
    `Daily-updated rankings for ${n} ${scopePart}creator${n !== 1 ? 's' : ''}. Sort by any stat — ${top.name} is currently #1 by subscribers.`,
  ];
  return variants[textVariant(scope || 'all', variants.length)];
}

function clubIntroText(club, clubCreators, clubLeague) {
  if (!clubCreators.length) return '';
  const count = clubCreators.length;
  const top = clubCreators.reduce((a, b) => (b.subscriberCount || 0) > (a.subscriberCount || 0) ? b : a, clubCreators[0]);
  const leaguePart = clubLeague && clubLeague !== 'Other' ? ` in the ${clubLeague}` : '';
  const liveCount = clubCreators.filter(c => c.isLive).length;
  const livePart = liveCount ? ` ${liveCount === 1 ? 'One is' : liveCount + ' are'} live right now.` : '';

  const variants = [
    `FanReactionsFC tracks ${count} ${club} YouTube channel${count !== 1 ? 's' : ''}${leaguePart}, covering post-match reactions, watchalongs, and fan commentary. The most-followed is ${top.name}, with ${formatNum(top.subscriberCount || 0)} subscribers.${livePart}`,
    `Looking for ${club} content on YouTube? There are ${count} creator${count !== 1 ? 's' : ''}${leaguePart} in this directory, led by ${top.name} at ${formatNum(top.subscriberCount || 0)} subscribers.${livePart}`,
    `${count} ${club} YouTuber${count !== 1 ? 's' : ''}${leaguePart} are ranked here by subscriber count, from post-match reactions to full watchalongs. ${top.name} leads the pack with ${formatNum(top.subscriberCount || 0)} subscribers.${livePart}`,
  ];
  return variants[textVariant(club, variants.length)];
}

async function handleFavorite(id) {
  await toggleFavorite(id);
  const fav = favorites.has(id);
  // Update favourite count in the local map
  const prev = favouriteCounts.get(id) || 0;
  favouriteCounts.set(id, Math.max(0, prev + (fav ? 1 : -1)));
  const count = favouriteCounts.get(id) || 0;
  // Update button
  const btn = document.getElementById('favBtn');
  if (btn) {
    btn.innerHTML = (fav ? '&#9733; Favourited' : '&#9734; Favourite') + (count > 0 ? ' <span class="fav-count-badge" id="favCount">' + count + '</span>' : '');
    btn.classList.toggle('btn-favourited', fav);
    btn.setAttribute('aria-pressed', fav);
  }
}

// ── Render: Club Page ─────────────────────────────────────────────────────
function renderClubPage(club) {
  const params = new URLSearchParams(location.search);
  const sort = params.get('sort') || 'subs';
  let clubCreators = creators.filter(c => c.team === club);

  if (sort === 'name') clubCreators.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'recent') clubCreators.sort((a, b) => new Date(b.latestVideoDate || 0) - new Date(a.latestVideoDate || 0));
  else clubCreators.sort((a, b) => b.subscriberCount - a.subscriberCount);

  const clubLeague = getLeague(club);
  const leagueInfo = LEAGUES.find(l => l.name === clubLeague);
  const clubUrl = clubPath(club);

  updatePageMeta(
    `${club} Football YouTubers | FanReactionsFC`,
    `${clubCreators.length} ${club} content creator${clubCreators.length !== 1 ? 's' : ''} on YouTube — watchalongs, reactions, and fan commentary, ranked by subscribers.`
  );

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <a href="/discover${clubLeague !== 'Other' ? '?league=' + encodeURIComponent(clubLeague) : ''}" class="page-hero-back">&larr; ${clubLeague !== 'Other' ? escHtml(clubLeague) : 'All clubs'}</a>
        <div class="page-hero-inner">
          ${crestImg(club, 'page-hero-crest')}
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">${leagueInfo ? escHtml(clubLeague) : 'Football Club'}</div>
            <h1 class="page-hero-title">${escHtml(club)} Football YouTubers</h1>
            ${clubCreators.length ? `<p class="page-hero-subtitle" style="max-width:640px">${escHtml(clubIntroText(club, clubCreators, clubLeague))}</p>` : ''}
            <div class="page-hero-meta">
              <span class="page-hero-tag">${clubCreators.length} creator${clubCreators.length !== 1 ? 's' : ''}</span>
              ${clubCreators.filter(c => c.isLive).length ? `<span class="page-hero-tag" style="background:rgba(230,57,70,.2);border-color:rgba(230,57,70,.3);color:#ff8080">● ${clubCreators.filter(c => c.isLive).length} live</span>` : ''}
            </div>
          </div>
          <div class="page-hero-actions">
            <a href="${clubPath(club, '/videos')}" class="btn btn-on-dark btn-sm">📺 Videos</a>
            <a href="/submit" class="btn btn-accent btn-pill btn-sm">+ Suggest</a>
          </div>
        </div>
      </div>
    </div>

    <div class="container section">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title">${crestImg(club, 'crest-sm')} Creators</div>
          <div class="top-creators-tabs" style="margin:0">
            <button class="top-creators-tab ${sort === 'subs' ? 'active' : ''}" onclick="navigate('${clubUrl}?sort=subs')">By Subs</button>
            <button class="top-creators-tab ${sort === 'name' ? 'active' : ''}" onclick="navigate('${clubUrl}?sort=name')">A&ndash;Z</button>
            <button class="top-creators-tab ${sort === 'recent' ? 'active' : ''}" onclick="navigate('${clubUrl}?sort=recent')">Recent</button>
          </div>
        </div>
        <div class="sc-body">
          <div class="card-grid">
            ${clubCreators.length ? clubCreators.map(c => creatorCard(c)).join('') :
              `<div class="empty-state"><div class="es-title">No creators yet</div><p style="color:var(--text-dim)">Know a great ${escHtml(club)} YouTuber?</p><a href="/submit" class="btn btn-primary" style="margin-top:12px">Suggest a Creator</a></div>`}
          </div>
        </div>
      </div>
      <div class="cta-band" style="border-radius:var(--radius);margin-top:4px;padding:24px 28px">
        <div class="cta-band-inner" style="padding:0">
          <div>
            <div class="cta-band-title">Know a ${escHtml(club)} YouTuber we're missing?</div>
            <p class="cta-band-sub">Help us grow the database — submissions reviewed within 24h.</p>
          </div>
          <a href="/submit" class="btn btn-primary btn-pill btn-lg">+ Suggest a Creator</a>
        </div>
      </div>
      <div id="clubRelatedNews"></div>
    </div>
    ${renderFooter()}
  `;

  loadClubRelatedNews(club);
}

// Fetched after the main club page renders so a slow/failed news query never
// delays the creator grid — the whole point of this section is a bonus
// internal link, not core content.
async function loadClubRelatedNews(club) {
  const el = document.getElementById('clubRelatedNews');
  if (!el) return;
  try {
    const { data, error } = await sb.from('frfc_articles')
      .select('slug,title,summary,cover_image_url,tags,published_at')
      .eq('status', 'published')
      .eq('related_team', club)
      .order('published_at', { ascending: false })
      .limit(3);
    if (error || !data || !data.length) return;
    // Bail if the user has already navigated elsewhere by the time this resolves.
    if (currentRoute.page !== 'club' || currentRoute.club !== club) return;
    el.innerHTML = `
      <div class="sc-card" style="margin-top:20px">
        <div class="sc-head"><div class="sc-head-title">${crestImg(club, 'crest-sm')} ${escHtml(club)} in the News</div></div>
        <div class="sc-body"><div class="news-grid">${data.map(newsCardHTML).join('')}</div></div>
      </div>`;
  } catch (e) { /* non-critical — silently skip */ }
}

// ── Render: Club Latest Videos ────────────────────────────────────────────
function renderClubVideos(club) {
  const clubCreators = creators.filter(c => c.team === club);
  // Use each creator's latest_video_* as a single "card". Hide creators
  // with no recent upload data. Sort newest first.
  const videos = clubCreators
    .filter(c => c.latestVideoId && c.latestVideoDate)
    .map(c => ({ c, publishedAt: new Date(c.latestVideoDate).getTime() }))
    .sort((a, b) => b.publishedAt - a.publishedAt);

  const clubLeague = getLeague(club);
  const clubUrl = clubPath(club);

  updatePageMeta(
    `Latest ${club} Videos | FanReactionsFC`,
    `The newest ${club} reaction and watchalong videos from every creator FanReactionsFC tracks, newest first.`
  );

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <a href="${clubUrl}" class="page-hero-back">&larr; ${escHtml(club)}</a>
        <div class="page-hero-inner">
          ${crestImg(club, 'page-hero-crest')}
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">📺 Latest Videos</div>
            <h1 class="page-hero-title">${escHtml(club)} Videos</h1>
            <p class="page-hero-subtitle">${videos.length} recent upload${videos.length !== 1 ? 's' : ''} from ${clubCreators.length} creator${clubCreators.length !== 1 ? 's' : ''}${clubLeague !== 'Other' ? ' in ' + escHtml(clubLeague) : ''}.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="container section">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title">${crestImg(club, 'crest-sm')} Recent Uploads</div>
          <span style="font-size:var(--fs-sm);color:var(--text-muted)">${videos.length} video${videos.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="sc-body">
          ${videos.length ? `<div class="team-video-grid">
            ${videos.map(({ c }) => `
              <a href="https://youtube.com/watch?v=${safeId(c.latestVideoId)}" target="_blank" rel="noopener" class="team-video-card">
                <div class="tv-thumb-wrap">
                  <img class="tv-thumb" src="${c.latestVideoThumbnail || ''}" alt="" loading="lazy">
                  ${c.isLive ? '<span class="tv-live-badge badge badge-live">LIVE</span>' : ''}
                </div>
                <div class="tv-body">
                  <div class="tv-title">${escHtml(c.latestVideoTitle || 'Untitled')}</div>
                  <div class="tv-creator">
                    ${avatarImg(c, 'tv-avatar')}
                    <div class="tv-creator-info">
                      <div class="tv-creator-name">${liveDot(c.isLive)}${escHtml(c.name)}</div>
                      <div class="tv-meta">${c.latestVideoViews ? formatNum(c.latestVideoViews) + ' views' : ''}${c.latestVideoViews && c.latestVideoDate ? ' · ' : ''}${c.latestVideoDate ? timeAgo(c.latestVideoDate) : ''}</div>
                    </div>
                  </div>
                </div>
              </a>`).join('')}
          </div>` : `<div class="empty-state"><div class="es-icon">📺</div><div class="es-title">No recent videos yet</div><p style="color:var(--text-dim)">Creator video data will appear here after the next sync.</p></div>`}
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;
}

// ── Render: Rankings ──────────────────────────────────────────────────────
// ── Rankings table: sortable columns ────────────────────────────────────────
const RK_COLS = [
  { key: 'subscribers', label: 'Subscribers',  get: c => c.subscriberCount || 0 },
  { key: 'videos',      label: 'Videos',       get: c => c.videoCount || 0 },
  { key: 'views',       label: 'Total Views',  get: c => c.totalViews || 0 },
  { key: 'won',         label: 'Battles Won',  get: c => c.battleWins || 0 },
  { key: 'lost',        label: 'Battles Lost', get: c => c.battleLosses || 0 },
  { key: 'winpct',      label: 'Win %',        get: c => rkWinPct(c) },
];

function rkWinPct(c) {
  const w = c.battleWins || 0, l = c.battleLosses || 0;
  const total = w + l;
  return total ? Math.round((w / total) * 100) : 0;
}
let rkRanked = [];
let rkSortField = 'subscribers';
let rkSortDir = 'desc';
let rkPrevRanks = {};

function rkApplySort() {
  const get = RK_COLS.find(c => c.key === rkSortField).get;
  rkRanked.sort((a, b) => (get(b) - get(a)) * (rkSortDir === 'asc' ? -1 : 1));
}

function rkRowsHTML() {
  return rkRanked.map((c, i) => {
    const rankClass = i < 3 ? ' rk-row--top rk-row--top' + (i + 1) : '';
    const currentRank = i + 1;
    let move = '';
    if (rkSortField === 'subscribers') {
      const prev = rkPrevRanks[c.id];
      if (prev == null) {
        if (c.subscriberCountPrev <= 0) move = '<span class="rk-move rk-move--new">NEW</span>';
      } else if (prev > currentRank) {
        move = `<span class="rk-move rk-move--up">&uarr;${prev - currentRank}</span>`;
      } else if (prev < currentRank) {
        move = `<span class="rk-move rk-move--down">&darr;${currentRank - prev}</span>`;
      }
    }
    return `
    <a href="${creatorLink(c)}" class="rk-row${rankClass}${c.isLive ? ' rk-row--live' : ''}">
      <div class="rk-rank">${currentRank}${move}</div>
      <span class="av-wrap">${avatarImg(c, 'rk-avatar')}</span>
      <div class="rk-info">
        <div class="rk-name">${liveDot(c.isLive)}${escHtml(c.name)}${c.verified ? ' <span class="rk-verified" title="Verified">&#10003;</span>' : ''}</div>
        <div class="rk-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
      </div>
      <div class="rk-col rk-col--subs">${formatNum(c.subscriberCount)}</div>
      <div class="rk-col">${formatNum(c.videoCount || 0)}</div>
      <div class="rk-col">${formatNum(c.totalViews || 0)}</div>
      <div class="rk-col">${formatNum(c.battleWins || 0)}</div>
      <div class="rk-col">${formatNum(c.battleLosses || 0)}</div>
      <div class="rk-col">${(c.battleWins || c.battleLosses) ? rkWinPct(c) + '%' : '—'}</div>
      <span class="rk-arrow">&rsaquo;</span>
    </a>`;
  }).join('');
}

function rkHeaderHTML() {
  return RK_COLS.map(col => {
    const active = rkSortField === col.key;
    const arrow = active ? (rkSortDir === 'desc' ? '&#9660;' : '&#9650;') : '';
    return `<button type="button" class="rk-sort-btn${active ? ' rk-sort-btn--active' : ''}" onclick="rkSort('${col.key}')">${col.label}${arrow ? ` <span class="rk-sort-arrow">${arrow}</span>` : ''}</button>`;
  }).join('');
}

function rkSort(field) {
  if (rkSortField === field) rkSortDir = rkSortDir === 'desc' ? 'asc' : 'desc';
  else { rkSortField = field; rkSortDir = 'desc'; }
  rkApplySort();
  const rowsEl = document.getElementById('rkRows');
  if (rowsEl) rowsEl.innerHTML = rkRowsHTML();
  const headEl = document.getElementById('rkHeaderCols');
  if (headEl) headEl.innerHTML = rkHeaderHTML();
}

// Shows a right-edge fade over the rankings table while there's more to
// scroll horizontally, hides it once scrolled to the end — otherwise the
// Win % column (often the most interesting one) can sit hidden off-screen
// with no visual hint that it exists.
function rkUpdateScrollFade() {
  const wrap = document.getElementById('rkTableWrap');
  const fade = document.getElementById('rkScrollFade');
  if (!wrap || !fade) return;
  const canScrollMore = wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 4;
  fade.classList.toggle('visible', canScrollMore);
}

function rkInitScrollFade() {
  const wrap = document.getElementById('rkTableWrap');
  if (!wrap) return;
  wrap.addEventListener('scroll', rkUpdateScrollFade);
  window.addEventListener('resize', rkUpdateScrollFade);
  rkUpdateScrollFade();
}

// Same rule as isFanRankingsChannel() in netlify/functions/rankings.js —
// keep both in sync. Club-directory channels plus multi-club
// watchalong/reaction rows; exclude celebrity streamers/journalists.
const FAN_RANK_TYPES = ['Reactions', 'Watchalong', 'Match Review', 'Banter', 'Fan Cam', 'Compilation'];
const NON_FAN_SLUGS = new Set(['live-djmariio', 'bydiegox10']);
function isFanRankingsChannel(c) {
  const slug = String(c.slug || '').toLowerCase();
  if (slug && NON_FAN_SLUGS.has(slug)) return false;
  const team = c.team || '';
  if (team && team !== 'Multi-Club / Other') return true;
  const types = c.contentTypes || c.content_types || [];
  return types.some(t => FAN_RANK_TYPES.includes(t));
}

// Same rule as dedupeRankedCreators() in netlify/functions/rankings.js —
// keep both in sync. Slug first, then channel URL, then name.
function rankingIdentity(c) {
  const slug = String(c.slug || '').trim().toLowerCase();
  if (slug) return 'slug:' + slug;
  const url = String(c.channel || c.channel_url || '').trim().toLowerCase();
  if (url) return 'url:' + url;
  const name = String(c.name || '').trim().toLowerCase();
  if (name) return 'name:' + name;
  return '';
}
function dedupeRankedCreators(list) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    const key = rankingIdentity(c);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(c);
  }
  return out;
}

async function renderRankings() {
  const params = new URLSearchParams(location.search);
  const leagueFilter = params.get('league') || '';
  const teamFilter = params.get('team') || '';
  const mode = params.get('mode') || 'subs';
  if (mode === 'voters') return renderVoterLeaderboard();

  let ranked = [...creators].filter(c => c.subscriberCount > 0 && isFanRankingsChannel(c));
  if (leagueFilter) ranked = ranked.filter(c => (c.league || getLeague(c.team)) === leagueFilter);
  if (teamFilter) ranked = ranked.filter(c => c.team === teamFilter);
  ranked = dedupeRankedCreators(ranked);
  ranked.sort((a, b) => b.subscriberCount - a.subscriberCount);

  // Build team strip: show teams for the selected league, or all teams
  const stripTeams = [];
  if (leagueFilter) {
    Object.entries(TEAM_TO_LEAGUE).filter(([t, lg]) => lg === leagueFilter).forEach(([t]) => stripTeams.push(t));
  } else {
    Object.keys(TEAM_TO_LEAGUE).forEach(t => stripTeams.push(t));
  }
  stripTeams.sort();

  // Compute previous ranks from the same filtered set for week-over-week movement.
  rkPrevRanks = {};
  [...ranked]
    .filter(c => c.subscriberCountPrev > 0)
    .sort((a, b) => b.subscriberCountPrev - a.subscriberCountPrev)
    .forEach((c, i) => { rkPrevRanks[c.id] = i + 1; });

  // Reset sort to the default (subscribers, desc) each time the page/filter loads.
  rkSortField = 'subscribers';
  rkSortDir = 'desc';
  rkRanked = ranked;

  const rankingsIntro = rankingsIntroText(ranked, leagueFilter, teamFilter);
  const rankingsH1 = teamFilter
    ? `Best ${teamFilter} Fan YouTubers Ranked`
    : leagueFilter
      ? `Best ${leagueFilter} Fan YouTubers Ranked`
      : 'Best Football Fan YouTubers Ranked';
  updatePageMeta(
    rankingsH1 + ' | FanReactionsFC',
    rankingsIntro || 'Football fan YouTubers ranked by subscribers, videos, views, and Creator Battle record — updated daily.'
  );

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">&#127942; Daily Rankings</div>
            <h1 class="page-hero-title">${escHtml(rankingsH1)}</h1>
            <p class="page-hero-subtitle" style="max-width:640px">${escHtml(rankingsIntro)}</p>
            <div class="rk-tabs-row">
              <div class="rk-tabs">
                <button class="rk-tab rk-tab--active" onclick="navigate('/rankings')">Creators</button>
                <button class="rk-tab" onclick="navigate('/rankings?mode=voters')">Top Voters</button>
              </div>
              <div class="page-hero-meta">
                <span class="page-hero-tag ${!leagueFilter ? 'page-hero-tag--active' : ''}" onclick="navigate('/rankings')" style="cursor:pointer${!leagueFilter ? ';background:rgba(246,190,6,.25);border-color:rgba(246,190,6,.4);color:#fff' : ''}">All leagues</span>
                ${LEAGUES.map(l =>
                  `<span class="page-hero-tag" onclick="navigate('/rankings?league=${encodeURIComponent(l.name)}')" style="cursor:pointer${leagueFilter === l.name ? ';background:rgba(246,190,6,.25);border-color:rgba(246,190,6,.4);color:#fff' : ''}">${l.name}</span>`
                ).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${stripTeams.length ? `<div class="rk-team-strip">
      <div class="container">
        <div class="rk-team-strip-inner">
          <button class="rk-team-btn rk-team-btn--all${!teamFilter ? ' rk-team-btn--active' : ''}" onclick="navigate('/rankings${leagueFilter ? '?league=' + encodeURIComponent(leagueFilter) : ''}')">All</button>
          ${stripTeams.map(t => {
            const url = TEAM_CRESTS[t];
            const active = teamFilter === t ? ' rk-team-btn--active' : '';
            const href = '/rankings?' + (leagueFilter ? 'league=' + encodeURIComponent(leagueFilter) + '&' : '') + 'team=' + encodeURIComponent(t);
            return url ? `<button class="rk-team-btn${active}" title="${escHtml(t)}" onclick="navigate('${href}')"><img src="${url}" alt="${escHtml(t)}"></button>` : '';
          }).join('')}
        </div>
      </div>
    </div>` : ''}

    <div class="container section">
      ${ranked.length ? `
      <div class="sc-card" style="margin-bottom:0">
        <div class="sc-head">
          <div class="sc-head-title">&#127942; ${teamFilter ? escHtml(teamFilter) : (leagueFilter ? escHtml(leagueFilter) : 'All Leagues')}</div>
          <div style="font-size:var(--fs-sm);color:var(--text-dim)">${ranked.length} creator${ranked.length !== 1 ? 's' : ''} &middot; ${formatNum(ranked.reduce((a, c) => a + (c.subscriberCount || 0), 0))} combined subscribers</div>
        </div>
        <div class="sc-body--tight">
      <div class="rk-table-outer">
        <div class="rankings-card rk-table-wrap" id="rkTableWrap" style="border:none;border-radius:0;box-shadow:none">
          <div class="rk-row rk-header-row">
            <div></div><div></div><div>Creator</div>
            <div id="rkHeaderCols" class="rk-header-cols">${rkHeaderHTML()}</div>
            <div></div>
          </div>
          <div id="rkRows">${rkRowsHTML()}</div>
        </div>
        <div class="rk-scroll-fade" id="rkScrollFade"></div>
      </div>
        </div>
      </div>` :
        `<div class="empty-state"><div class="es-icon">&#127942;</div><div class="es-title">No rankings yet</div><p style="color:var(--text-dim)">No subscriber data available.</p></div>`}
    </div>
    ${renderFooter()}
  `;

  rkInitScrollFade();

  // Battle wins/losses come from a separate RPC — fetch after first paint and
  // patch the already-rendered rows in place (avoids blocking initial render).
  if (ranked.length) {
    const { data: battleStats } = await sb.rpc('get_battle_all_stats');
    const bMap = {};
    (battleStats || []).forEach(r => { bMap[r.creator_id] = r; });
    ranked.forEach(c => {
      const b = bMap[c.id];
      c.battleWins = b ? Number(b.wins) : 0;
      c.battleLosses = b ? Number(b.losses) : 0;
    });
    rkApplySort();
    const rowsEl = document.getElementById('rkRows');
    if (rowsEl) rowsEl.innerHTML = rkRowsHTML();
  }
}

// ── Render: Voter Leaderboard ─────────────────────────────────────────────
async function renderVoterLeaderboard() {
  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">&#127942; Daily Rankings</div>
            <h1 class="page-hero-title">Top Voters</h1>
            <p class="page-hero-subtitle">The most active voters in Creator Battles.</p>
            <div class="rk-tabs-row">
              <div class="rk-tabs">
                <button class="rk-tab" onclick="navigate('/rankings')">Creators</button>
                <button class="rk-tab rk-tab--active" onclick="navigate('/rankings?mode=voters')">Top Voters</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div id="voterLbBody"><div class="empty-state" style="padding:40px 0"><div style="color:var(--text-dim)">Loading leaderboard…</div></div></div>
    </div>${renderFooter()}`;

  const { data: voters, error } = await sb.rpc('get_top_voters', { lim: 50 });
  const body = document.getElementById('voterLbBody');
  if (!body) return;

  if (error || !voters || !voters.length) {
    body.innerHTML = '<div class="empty-state"><div class="es-icon">&#128499;</div><div class="es-title">No votes yet</div><p style="color:var(--text-dim)">Be the first to vote in a Creator Battle!</p></div>';
    return;
  }

  body.innerHTML = `
    <div class="sc-card" style="margin-bottom:0">
      <div class="sc-head">
        <div class="sc-head-title">&#128499; Top Voters</div>
        <div style="font-size:var(--fs-sm);color:var(--text-dim)">${voters.length} voter${voters.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="sc-body--tight">
        <div class="rankings-card" style="border:none;border-radius:0;box-shadow:none">
          ${voters.map((v, i) => {
            const rankClass = i < 3 ? ' rk-row--top rk-row--top' + (i + 1) : '';
            return `<div class="rk-row${rankClass}" style="cursor:default">
              <div class="rk-rank">${i + 1}</div>
              <span class="av-wrap"><div class="rk-avatar avatar-fallback" style="width:40px;height:40px;font-size:var(--fs-sm)">${(v.display_name || '?')[0].toUpperCase()}</div></span>
              <div class="rk-info">
                <div class="rk-name">${escHtml(v.display_name)}</div>
              </div>
              <div class="rk-score">
                <div class="rk-score-num">${formatNum(Number(v.vote_count))}</div>
                <div class="rk-score-label">votes</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
}

// ── Render: Generator ────────────────────────────────────────────────────
async function renderGenerator() {
  if (typeof Gen === 'undefined') {
    document.getElementById('app').innerHTML = '<div class="container section-message"><p>Generator module not loaded.</p></div>' + renderFooter();
    return;
  }
  if (!creators.length) await loadCreators();
  document.getElementById('app').innerHTML = Gen.renderHTML() + renderFooter();
  Gen.init();
}

// ── Render: Submit Creator ────────────────────────────────────────────────
function renderSubmit() {
  // Build team options grouped by league (same logic as admin)
  function teamSelect() {
    var html = '<option value="">Select team...</option>';
    var leagueOrder = ['Premier League','Championship','La Liga','Serie A','Bundesliga','Ligue 1'];
    var teamsByLeague = {};
    Object.entries(TEAM_TO_LEAGUE).forEach(function(e) {
      if (!teamsByLeague[e[1]]) teamsByLeague[e[1]] = [];
      teamsByLeague[e[1]].push(e[0]);
    });
    leagueOrder.forEach(function(l) {
      var teams = (teamsByLeague[l] || []).sort();
      html += '<optgroup label="' + l + '">' + teams.map(function(t) { return '<option value="' + escHtml(t) + '">' + escHtml(t) + '</option>'; }).join('') + '</optgroup>';
    });
    html += '<optgroup label="Other"><option value="Multi-Club / Other">Multi-Club / Other</option></optgroup>';
    return html;
  }

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Community</div>
            <h1 class="page-hero-title">Submit a Creator</h1>
            <p class="page-hero-subtitle">Know a great football YouTuber? Suggest them for the database. Submissions are reviewed before being published.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="container container-narrow section">
      <div id="submitForm">
        <div class="sc-card" style="margin-bottom:0">
          <div class="sc-head"><div class="sc-head-title">Creator details</div></div>
          <div class="sc-body">
          <div style="margin-bottom:14px">
            <label class="field-label">YouTube Channel URL</label>
            <input type="text" id="sub_channel" class="admin-form-input" placeholder="e.g. https://www.youtube.com/@AFTVmedia" oninput="checkDuplicateChannel(this.value)">
            <div id="channelDupeWarn" class="dupe-warn"></div>
            <div style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:4px">We'll fetch the channel name automatically.</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div>
              <label class="field-label">League</label>
              <select id="sub_league" class="admin-form-select" onchange="document.getElementById('sub_team').innerHTML = submitTeamOpts(this.value)">
                <option>Premier League</option><option>Championship</option><option>La Liga</option><option>Serie A</option><option>Bundesliga</option><option>Ligue 1</option>
              </select>
            </div>
            <div>
              <label class="field-label">Team</label>
              <select id="sub_team" class="admin-form-select">${teamSelect()}</select>
            </div>
          </div>
          <button class="btn btn-primary btn-block btn-lg" onclick="submitCreator()" style="margin-top:8px">Submit for Review</button>
          <div id="submitMsg" style="text-align:center;margin-top:12px;font-size:var(--fs-base)"></div>
          </div>
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;
}

// Helper for league-filtered team options in submit form
function submitTeamOpts(league) {
  var teams = Object.entries(TEAM_TO_LEAGUE).filter(function(e) { return e[1] === league; }).map(function(e) { return e[0]; }).sort();
  return '<option value="">Select team...</option>' + teams.map(function(t) { return '<option value="' + escHtml(t) + '">' + escHtml(t) + '</option>'; }).join('') + '<option value="Multi-Club / Other">Multi-Club / Other</option>';
}

let _dupeTimer = null;
function checkDuplicateChannel(val) {
  clearTimeout(_dupeTimer);
  const warn = document.getElementById('channelDupeWarn');
  if (!warn) return;
  _dupeTimer = setTimeout(() => {
    const m = val.match(/@([A-Za-z0-9_.-]+)/);
    if (!m) { warn.style.display = 'none'; return; }
    const handle = m[1].toLowerCase();
    const match = creators.find(c => (c.channel || '').toLowerCase().includes('@' + handle));
    if (match) {
      warn.innerHTML = '⚠ This channel may already be in our database: <a href="' + creatorLink(match) + '">' + escHtml(match.name) + '</a> (' + escHtml(match.team) + ')';
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  }, 300);
}

async function submitCreator() {
  var channel = document.getElementById('sub_channel').value.trim();
  var team = document.getElementById('sub_team').value;
  var league = document.getElementById('sub_league').value;
  var msg = document.getElementById('submitMsg');
  var err = function(text) { msg.innerHTML = '<span style="color:var(--red)">' + escHtml(text) + '</span>'; };
  var info = function(text) { msg.innerHTML = '<span style="color:var(--text-dim)">' + escHtml(text) + '</span>'; };

  if (!channel) return err('Please enter the YouTube channel URL.');
  if (!team) return err('Please select a team.');

  var handleMatch = channel.match(/@([A-Za-z0-9_.-]+)/);
  if (!handleMatch) return err('URL must include an @handle — e.g. youtube.com/@ChannelName');
  var handle = handleMatch[1];

  info('Looking up channel…');

  // 1. Resolve the channel name from YouTube via our serverless proxy.
  var name;
  try {
    var proxyUrl = '/.netlify/functions/youtube-proxy?' + new URLSearchParams({
      endpoint: 'channels', forHandle: handle, part: 'snippet',
    });
    var ytRes = await fetch(proxyUrl);
    if (!ytRes.ok) throw new Error('YouTube lookup failed (' + ytRes.status + ')');
    var ytData = await ytRes.json();
    var ch = ytData.items && ytData.items[0];
    if (!ch) return err('Channel not found on YouTube. Please check the URL.');
    name = (ch.snippet && ch.snippet.title) || handle;
  } catch (e) {
    return err('Could not look up channel: ' + (e.message || 'unknown error'));
  }

  info('Submitting ' + name + '…');

  // 2. Insert via direct PostgREST fetch (bypasses supabase-js, which has
  //    been observed hanging on this insert in production for unclear
  //    reasons). Direct REST call with the publishable key returns 201.
  var submission = { name: name, channel_url: channel, team: team, league: league };
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
  try {
    var insertRes = await fetch(SUPABASE_URL + '/rest/v1/frfc_submissions', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(submission),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!insertRes.ok) {
      var errText = await insertRes.text().catch(function() { return ''; });
      return err('Submission failed (' + insertRes.status + '): ' + (errText.slice(0, 200) || insertRes.statusText));
    }
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') return err('Request timed out — please try again.');
    return err('Submission failed: ' + (e.message || 'unknown error'));
  }

  // 3. Notify admin — best-effort, no UI blocking.
  fetch(SUPABASE_URL + '/functions/v1/notify-submission', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record: submission }),
  }).catch(function() { /* non-critical */ });

  document.getElementById('submitForm').innerHTML = '<div style="text-align:center;padding:40px 0"><div style="font-size:var(--fs-2xl);margin-bottom:12px">&#10003;</div><h2 style="font-size:var(--fs-lg);font-weight:700;margin-bottom:6px">Thank you!</h2><p style="color:var(--text-dim);font-size:var(--fs-base);margin-bottom:20px">Your submission is under review. If approved, the creator will appear on the site.</p><a href="/discover" class="btn btn-primary">Browse Creators</a></div>';
}

// ── Render: Contact Us ───────────────────────────────────────────────────
function renderContact() {
  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Get in touch</div>
            <h1 class="page-hero-title">Contact Us</h1>
            <p class="page-hero-subtitle">Questions, feedback, partnership inquiries — we read every message.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="container container-narrow section">
      <div id="contactForm">
        <div class="sc-card" style="margin-bottom:0">
          <div class="sc-head"><div class="sc-head-title">Send a message</div></div>
          <div class="sc-body">
            <div style="margin-bottom:14px">
              <label class="field-label">Your Name</label>
              <input type="text" id="ct_name" class="admin-form-input" placeholder="Jane Smith">
            </div>
            <div style="margin-bottom:14px">
              <label class="field-label">Your Email</label>
              <input type="email" id="ct_email" class="admin-form-input" placeholder="jane@example.com">
            </div>
            <div style="margin-bottom:14px">
              <label class="field-label">Subject</label>
              <input type="text" id="ct_subject" class="admin-form-input" placeholder="What's this about?">
            </div>
            <div style="margin-bottom:14px">
              <label class="field-label">Message</label>
              <textarea id="ct_message" class="admin-form-input" rows="6" placeholder="Tell us more..." style="resize:vertical"></textarea>
            </div>
            <button class="btn btn-primary btn-block btn-lg" onclick="submitContact()">Send Message</button>
            <div style="text-align:center;margin-top:10px;font-size:var(--fs-xs);color:var(--text-muted)">We'll only use this to reply to you — see our <a href="/privacy">Privacy Policy</a>.</div>
            <div id="contactMsg" style="text-align:center;margin-top:12px;font-size:var(--fs-base)"></div>
          </div>
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;
}

async function submitContact() {
  const name = document.getElementById('ct_name').value.trim();
  const email = document.getElementById('ct_email').value.trim();
  const subject = document.getElementById('ct_subject').value.trim();
  const message = document.getElementById('ct_message').value.trim();
  const msg = document.getElementById('contactMsg');
  const err = text => { msg.innerHTML = `<span style="color:var(--red)">${escHtml(text)}</span>`; };
  const info = text => { msg.innerHTML = `<span style="color:var(--text-dim)">${escHtml(text)}</span>`; };

  if (!name) return err('Please enter your name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Please enter a valid email address.');
  if (!subject) return err('Please enter a subject.');
  if (!message) return err('Please enter a message.');

  info('Sending…');

  const payload = { name, email, subject, message };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/frfc_contact_messages', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return err(`Send failed (${res.status}): ${errText.slice(0, 200) || res.statusText}`);
    }
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') return err('Request timed out — please try again.');
    return err('Send failed: ' + (e.message || 'unknown error'));
  }

  document.getElementById('contactForm').innerHTML = '<div style="text-align:center;padding:40px 0"><div style="font-size:var(--fs-2xl);margin-bottom:12px">&#10003;</div><h2 style="font-size:var(--fs-lg);font-weight:700;margin-bottom:6px">Message sent!</h2><p style="color:var(--text-dim);font-size:var(--fs-base);margin-bottom:20px">Thanks for reaching out — we\'ll get back to you soon.</p><a href="/" class="btn btn-primary">Back to Home</a></div>';
}

// ── Render: Legal pages (Privacy / Cookies / Terms) ────────────────────────
// Drafted from the actual data-collection audit in this codebase (Supabase
// tables, localStorage keys, GTM/GA4, YouTube embeds) — not boilerplate.
// These are informational drafts; have counsel review before relying on them
// as your sole compliance basis.
const LEGAL_LAST_UPDATED = 'July 26, 2026';

function legalPageShell(eyebrow, title, bodyHtml) {
  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">${eyebrow}</div>
            <h1 class="page-hero-title">${title}</h1>
            <p class="page-hero-subtitle">Last updated ${LEGAL_LAST_UPDATED}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div class="legal-content">${bodyHtml}</div>
    </div>
    ${renderFooter()}
  `;
}

// ── Render: News ────────────────────────────────────────────────────────
// Articles aren't preloaded like creators are (loadCreators() runs once at
// boot) — each news route fetches directly from Supabase on entry, same as
// renderContact()/renderAccount(). Body is stored as plain text; paragraphs
// are split on blank lines and escaped, matching the site's existing
// plain-string content model rather than introducing a markdown parser.
const NEWS_PAGE_SIZE = 12;
let newsOffset = 0;

// A paragraph that's nothing but a YouTube URL (pasted on its own line,
// blank line before/after — the same convention as any other paragraph)
// renders as a responsive embed instead of link text. Same regex as
// bodyHtml() in netlify/functions/news-article.js — keep both in sync.
const YOUTUBE_URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&]\S*)?$/;

function newsBodyHTML(body) {
  function isSafeHref(url) {
    const u = String(url).trim();
    return /^https?:\/\//i.test(u) || (/^\//.test(u) && !u.startsWith('//'));
  }
  function inline(text) {
    const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = LINK_RE.exec(text)) !== null) {
      out += escHtml(text.slice(last, m.index));
      const href = m[2].trim();
      if (isSafeHref(href)) out += `<a href="${escHtml(href)}">${escHtml(m[1])}</a>`;
      else out += escHtml(m[0]);
      last = m.index + m[0].length;
    }
    out += escHtml(text.slice(last));
    return out;
  }
  return body.split(/\n\s*\n/).map(p => {
    const trimmed = p.trim();
    const m = trimmed.match(YOUTUBE_URL_RE);
    if (m) return `<div class="news-video-embed"><iframe src="https://www.youtube.com/embed/${m[1]}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    if (/^##[ \t]+/.test(trimmed) && !trimmed.includes('\n')) {
      return `<h2>${inline(trimmed.replace(/^##[ \t]+/, '').trim())}</h2>`;
    }
    return `<p>${inline(trimmed)}</p>`;
  }).join('');
}

function metaDescText(s, max) {
  const text = String(s || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > 80 ? cut.slice(0, sp) : cut).replace(/[.,;:]+$/, '') + '…';
}

function creatorLinksHTML(links) {
  if (!Array.isArray(links) || !links.length) return '';
  const items = links.map(link => {
    if (!link) return '';
    if (typeof link === 'string') {
      const c = creators.find(cr => cr.slug === link || slugify(cr.name) === slugify(link) || cr.name === link);
      const href = c ? creatorLink(c) : '/creators/' + slugify(link);
      return `<a href="${href}">${escHtml(c ? c.name : link)}</a>`;
    }
    const slug = link.slug || (link.name ? slugify(link.name) : '');
    if (!slug) return '';
    return `<a href="/creators/${escHtml(slug)}">${escHtml(link.name || slug)}</a>`;
  }).filter(Boolean);
  if (!items.length) return '';
  return `<div class="news-article-related"><span>Creators</span> ${items.join(' ')}</div>`;
}

function newsCardHTML(a) {
  return `
    <a href="/news/${escHtml(a.slug)}" class="news-card" onclick="event.preventDefault();navigate('/news/${escHtml(a.slug)}')">
      ${a.cover_image_url ? `<div class="news-card-thumb-wrap"><img src="${escHtml(a.cover_image_url)}" alt="" class="news-card-thumb" loading="lazy"></div>` : ''}
      <div class="news-card-body">
        ${a.tags && a.tags.length ? `<div class="news-card-tags">${a.tags.slice(0, 2).map(t => `<span class="news-card-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="news-card-title">${escHtml(a.title)}</div>
        <div class="news-card-summary">${escHtml(a.summary)}</div>
        <div class="news-card-meta">${a.published_at ? timeAgo(a.published_at) : ''}</div>
      </div>
    </a>`;
}

// Cover + title + a 3-line-clamped summary, no tags/meta — used by the
// homepage's Latest News strip, which is meant as a glanceable teaser,
// not the full listing card. Reuses the same news-card classes so
// grid/hover styling matches; .news-card-summary-clamp caps the summary
// to 3 lines via CSS rather than truncating the string server-side, so
// it reflows correctly at any card width.
function newsCardCompactHTML(a) {
  return `
    <a href="/news/${escHtml(a.slug)}" class="news-card news-card-compact" onclick="event.preventDefault();navigate('/news/${escHtml(a.slug)}')">
      ${a.cover_image_url ? `<div class="news-card-thumb-wrap"><img src="${escHtml(a.cover_image_url)}" alt="" class="news-card-thumb" loading="lazy"></div>` : ''}
      <div class="news-card-body">
        <div class="news-card-title">${escHtml(a.title)}</div>
        ${a.summary ? `<div class="news-card-summary news-card-summary-clamp">${escHtml(a.summary)}</div>` : ''}
      </div>
    </a>`;
}

async function renderNewsList() {
  newsOffset = 0;
  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">News</div>
            <h1 class="page-hero-title">FanReactionsFC News</h1>
            <p class="page-hero-subtitle">Football creator news, rankings, and fan-culture coverage.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div id="newsGrid" class="news-grid"><div class="empty-state" style="grid-column:1/-1"><div style="color:var(--text-dim)">Loading…</div></div></div>
      <div style="text-align:center;margin-top:24px"><button class="btn btn-secondary" id="newsLoadMore" style="display:none" onclick="loadMoreNews()">Load more</button></div>
    </div>
    ${renderFooter()}
  `;
  await loadNewsPage(true);
}

async function loadNewsPage(replace) {
  const grid = document.getElementById('newsGrid');
  const moreBtn = document.getElementById('newsLoadMore');
  try {
    const { data, error } = await sb.from('frfc_articles')
      .select('slug,title,summary,cover_image_url,tags,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .range(newsOffset, newsOffset + NEWS_PAGE_SIZE - 1);
    if (error) throw error;
    const html = (data || []).map(newsCardHTML).join('');
    if (replace) grid.innerHTML = html || '<div class="empty-state" style="grid-column:1/-1"><div class="es-title">No articles yet</div><p style="color:var(--text-dim)">Check back soon.</p></div>';
    else grid.insertAdjacentHTML('beforeend', html);
    newsOffset += (data || []).length;
    moreBtn.style.display = (data && data.length === NEWS_PAGE_SIZE) ? 'inline-flex' : 'none';
  } catch (e) {
    if (replace) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p style="color:var(--text-dim)">Couldn\'t load articles right now.</p></div>';
  }
}

function loadMoreNews() { loadNewsPage(false); }

async function renderNewsArticle(slug) {
  document.getElementById('app').innerHTML = '<div class="container section-message"><div style="color:var(--text-dim)">Loading…</div></div>';
  let article = null;
  try {
    const { data, error } = await sb.from('frfc_articles').select('*').eq('slug', slug).eq('status', 'published').maybeSingle();
    if (error) throw error;
    article = data;
  } catch (e) { /* falls through to not-found */ }

  if (!article) {
    document.getElementById('app').innerHTML = '<div class="container section-message"><div class="empty-state"><div class="es-title">Article not found</div><a href="/news" class="btn btn-primary" style="margin-top:12px" onclick="event.preventDefault();navigate(\'/news\')">Back to News</a></div></div>';
    return;
  }

  updatePageMeta(`${article.title} | FanReactionsFC News`, metaDescText(article.summary, 155), firstPartyCoverUrl(article.cover_image_url));

  sb.rpc('increment_article_view', { article_id: article.id }).then(() => {});

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">News${article.tags && article.tags.length ? ' &middot; ' + escHtml(article.tags[0]) : ''}</div>
            <h1 class="page-hero-title">${escHtml(article.title)}</h1>
            ${article.dek ? `<p class="page-hero-subtitle">${escHtml(article.dek)}</p>` : ''}
            <div class="news-article-meta">${article.published_at ? new Date(article.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="container container-narrow section">
      ${firstPartyCoverUrl(article.cover_image_url) ? `<img src="${escHtml(firstPartyCoverUrl(article.cover_image_url))}" alt="" class="news-article-cover">` : ''}
      <div class="news-article-body">${newsBodyHTML(article.body)}</div>
      ${article.related_team ? `
      <div class="news-article-related">
        <span>More on</span>
        <a href="${clubPath(article.related_team)}" onclick="event.preventDefault();navigate('${clubPath(article.related_team)}')">${crestImg(article.related_team, 'crest-sm')} ${escHtml(article.related_team)}</a>
      </div>` : ''}
      ${creatorLinksHTML(article.creator_links)}
      <div style="margin-top:32px"><a href="/news" class="btn btn-secondary" onclick="event.preventDefault();navigate('/news')">&larr; Back to News</a></div>
    </div>
    ${renderFooter()}
  `;
}

function renderPrivacyPolicy() {
  legalPageShell('Legal', 'Privacy Policy', `
    <p>FanReactionsFC ("we", "us") operates fanreactionsfc.com, a directory and community site for football YouTube creators. This policy explains what personal data we collect, why, and the choices you have.</p>

    <h2>Who we are</h2>
    <p>FanReactionsFC.com is operated by Vincent Tervooren, who acts as the data controller for the personal data described in this policy. You can reach us at <a href="mailto:admin@fanreactionsfc.com">admin@fanreactionsfc.com</a> for any privacy question or request.</p>

    <h2>1. Data we collect</h2>
    <table class="legal-table">
      <tr><th>What</th><th>When</th><th>Why</th></tr>
      <tr><td>Email address, name, Google profile info</td><td>Signing in with Google</td><td>To create and secure your account</td></tr>
      <tr><td>Display name, avatar, favourite team</td><td>You edit your account profile</td><td>To personalise your experience</td></tr>
      <tr><td>Favourited creators</td><td>You tap the heart icon on a creator</td><td>To show your favourites across sessions</td></tr>
      <tr><td>Name, email, message subject/body</td><td>You submit the Contact form or report/claim a creator profile</td><td>To respond to your request</td></tr>
      <tr><td>Anonymous device identifier (random UUID, no personal info)</td><td>Automatically, stored in your browser</td><td>To prevent repeat voting abuse in Creator Battle</td></tr>
      <tr><td>Usage analytics (pages viewed, approximate location, device type)</td><td>Only if you accept analytics cookies</td><td>To understand traffic and improve the site</td></tr>
    </table>
    <p>We do not collect payment information, government IDs, or sensitive categories of data (health, religion, etc.).</p>

    <h2>2. Legal basis for processing</h2>
    <p>We process account and profile data under <strong>contract</strong> (to provide the service you signed up for), contact/report data under <strong>legitimate interest</strong> (responding to inquiries), and analytics cookies under your <strong>consent</strong>, which you can withdraw at any time via the cookie banner or the "Cookie preferences" link in the footer.</p>

    <h2>3. Who we share data with (subprocessors)</h2>
    <table class="legal-table">
      <tr><th>Provider</th><th>Purpose</th></tr>
      <tr><td>Supabase</td><td>Database, authentication, file storage</td></tr>
      <tr><td>Netlify</td><td>Website hosting, serverless functions</td></tr>
      <tr><td>Resend</td><td>Transactional email (notifications you trigger, e.g. contact replies)</td></tr>
      <tr><td>Google (Sign-In, YouTube, Tag Manager/Analytics)</td><td>Authentication, video embeds, analytics (analytics only with consent)</td></tr>
      <tr><td>football-data.org</td><td>Match fixture data used to detect live streams</td></tr>
    </table>
    <p>We do not sell your personal data.</p>

    <h2>4. International transfers</h2>
    <p>Some of the providers above (Google, Resend, Supabase's underlying infrastructure) may process data outside your country, including the United States. Where required, transfers rely on those providers' standard contractual clauses or equivalent safeguards.</p>

    <h2>5. Retention</h2>
    <p>Account data (profile, favourites, votes, community posts) is retained while your account is active and deleted when you delete your account (Section 7). Contact form messages and creator reports are automatically deleted 12 months after submission. You can request earlier deletion at any time — see Section 10.</p>

    <h2>6. Cookies</h2>
    <p>See our <a href="/cookies">Cookie Policy</a> for the full list of cookies and trackers.</p>

    <h2>7. Your rights</h2>
    <p>Depending on your location (including under the EU/UK GDPR), you have the right to access, correct, export, or delete your personal data, and to object to or restrict certain processing. You can:</p>
    <ul>
      <li>Update your profile directly from your <a href="/account">Account</a> page</li>
      <li>Request a copy or deletion of your data by contacting us (Section 10)</li>
      <li>Withdraw analytics consent at any time via the cookie banner</li>
    </ul>

    <h2>8. California residents (CCPA/CPRA)</h2>
    <p>The only "sharing" of personal information we do, as CCPA/CPRA defines it, is through analytics cookies (Google Analytics) — and only if you've consented to them. You can opt out at any time, with no account required, via the <strong>"Do Not Sell or Share My Info"</strong> link in the site footer; this immediately withdraws analytics consent. California residents also have the rights described in Section 7 (access, deletion, correction) regardless of this section.</p>

    <h2>9. Children</h2>
    <p>FanReactionsFC is not directed at children under 16, and we do not knowingly collect their data.</p>

    <h2>10. Contact</h2>
    <p>Questions or data requests: <a href="mailto:admin@fanreactionsfc.com">admin@fanreactionsfc.com</a> or via our <a href="/contact">Contact form</a>.</p>

    <p class="legal-disclaimer">This page is provided for transparency and is not a substitute for legal advice.</p>
  `);
}

function renderCookiePolicy() {
  legalPageShell('Legal', 'Cookie Policy', `
    <p>This page lists the cookies and similar technologies (like localStorage) that FanReactionsFC uses.</p>

    <h2>Strictly necessary (always on)</h2>
    <table class="legal-table">
      <tr><th>Name</th><th>Purpose</th><th>Duration</th></tr>
      <tr><td>Supabase auth session</td><td>Keeps you signed in</td><td>Until you sign out / session expiry</td></tr>
      <tr><td><code>frfc_consent_analytics</code></td><td>Remembers your cookie choice</td><td>Persistent (until cleared)</td></tr>
      <tr><td><code>frfc_fp</code></td><td>Random anonymous ID to prevent repeat-vote abuse in Creator Battle — not linked to your identity</td><td>Persistent (until cleared)</td></tr>
      <tr><td><code>frfc_streamwall_streams</code> / <code>frfc_streamwall_goal_ids</code></td><td>Remembers which streams you added to your Streamwall</td><td>Persistent (until cleared)</td></tr>
    </table>
    <p>These are required for the site to function and are not subject to consent.</p>

    <h2>Optional — only set if you accept</h2>
    <table class="legal-table">
      <tr><th>Provider</th><th>Purpose</th><th>Control</th></tr>
      <tr><td>Google Tag Manager / Google Analytics (GA4) — <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a></td><td>Aggregate traffic and usage analytics</td><td>Only loads after you click "Accept analytics"; reject or withdraw anytime via the "Cookie preferences" link in the footer</td></tr>
    </table>

    <h2>Third-party embeds</h2>
    <p>Creator videos and live streams are embedded from YouTube (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a>) using its privacy-enhanced <code>youtube-nocookie.com</code> domain. Promotional and preview videos show a static thumbnail and only load the YouTube player after you click play, so no request reaches Google just from viewing those pages. The one exception is Streamwall: clicking "Open Streamwall" is itself the action that loads the video players you selected, since that page's whole purpose is watching those streams. Once a YouTube player loads, YouTube/Google may set cookies under Google's own policy.</p>

    <h2>Managing cookies</h2>
    <p>You can change your analytics choice anytime via the "Cookie preferences" link in the site footer, or clear cookies/localStorage in your browser settings.</p>
  `);
}

function renderTermsOfService() {
  legalPageShell('Legal', 'Terms of Service', `
    <p>These terms govern your use of fanreactionsfc.com. By using the site, you agree to them.</p>

    <h2>1. What FanReactionsFC is</h2>
    <p>FanReactionsFC is a community-curated directory of football YouTube creators. We aggregate publicly available information (channel names, subscriber counts, video links) and let users rate, favourite, and discover creators. We are not affiliated with YouTube, Google, or the clubs/leagues referenced on the site.</p>

    <h2>2. Accounts</h2>
    <p>You may sign in with Google to unlock features like favourites, Streamwall, and Creator Battle voting. You're responsible for keeping your account secure and for activity under it.</p>

    <h2>3. Acceptable use</h2>
    <p>You agree not to: submit false or defamatory creator reports/claims; attempt to manipulate rankings, votes, or battle results; scrape or bulk-extract site data; upload unlawful, infringing, or abusive content via forms; or interfere with the site's operation.</p>

    <h2>4. Creator claims and content</h2>
    <p>Creators may claim their own profile. We may verify claims and remove or edit listings at our discretion, including in response to a valid report. Video content embedded on the site remains the property of its original creator/YouTube and is not hosted by us.</p>

    <h2>5. Disclaimers</h2>
    <p>The site is provided "as is". Live status, rankings, and fixture-based alerts are best-effort and may be inaccurate or delayed (e.g. due to third-party API or YouTube API limits). We don't guarantee uninterrupted availability.</p>

    <h2>6. Limitation of liability</h2>
    <p>To the extent permitted by law, FanReactionsFC is not liable for indirect or consequential damages arising from your use of the site.</p>

    <h2>7. Changes</h2>
    <p>We may update these terms as the site evolves; the "Last updated" date above reflects the current version.</p>

    <h2>8. Contact</h2>
    <p><a href="mailto:admin@fanreactionsfc.com">admin@fanreactionsfc.com</a></p>

    <p class="legal-disclaimer">This page is provided for transparency and is not a substitute for legal advice.</p>
  `);
}

// ── Render: Account settings ──────────────────────────────────────────────

// Fetches the user's profile row (or returns an empty template so the form
// can still render on first visit).
async function loadUserProfile(userId) {
  const emptyProfile = {
    user_id: userId, display_name: '', avatar_url: '', favourite_team: '',
    country: '', bio: '', notify_live: false, notify_weekly: true,
  };
  try {
    const url = `${SUPABASE_URL}/rest/v1/frfc_user_profiles?select=*&user_id=eq.${userId}&limit=1`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) return emptyProfile;
    const rows = await res.json();
    return rows[0] || emptyProfile;
  } catch { return emptyProfile; }
}

async function renderAccount() {
  if (!currentUser) return renderAuthRequired('access your account settings');
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">My account</div>
            <h1 class="page-hero-title">Account Settings</h1>
            <p class="page-hero-subtitle">Update how you appear on FanReactionsFC.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container container-mid section">
      <div id="accountBody"><div class="empty-state" style="padding:40px 0"><div style="color:var(--text-dim)">Loading…</div></div></div>
    </div>${renderFooter()}`;

  const profile = await loadUserProfile(currentUser.id);
  const memberSince = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';

  // Favorites count + voter stats
  let favCount = 0;
  let voterTotalVotes = 0;
  let voterPreferred = [];
  try {
    const [fRes, vStatsRes, vPrefRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/frfc_streamer_favorites?select=streamer_id&user_id=eq.${currentUser.id}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact' } }),
      sb.rpc('get_voter_stats', { uid: currentUser.id }),
      sb.rpc('get_voter_preferred_creators', { uid: currentUser.id, lim: 5 })
    ]);
    favCount = (await fRes.json()).length;
    voterTotalVotes = vStatsRes.data && vStatsRes.data.length ? Number(vStatsRes.data[0].total_votes) : 0;
    voterPreferred = vPrefRes.data || [];
  } catch {}

  // Team options grouped by league (same logic as submit form)
  let teamOpts = '<option value="">No favourite</option>';
  const leagueOrder = ['Premier League','Championship','La Liga','Serie A','Bundesliga','Ligue 1'];
  const teamsByLeague = {};
  Object.entries(TEAM_TO_LEAGUE).forEach(([t, l]) => { (teamsByLeague[l] = teamsByLeague[l] || []).push(t); });
  leagueOrder.forEach(l => {
    const teams = (teamsByLeague[l] || []).sort();
    teamOpts += `<optgroup label="${escHtml(l)}">${teams.map(t => `<option value="${escHtml(t)}" ${profile.favourite_team === t ? 'selected' : ''}>${escHtml(t)}</option>`).join('')}</optgroup>`;
  });

  const countryOpts = '<option value="">—</option>' + Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) =>
    `<option value="${code}" ${profile.country === code ? 'selected' : ''}>${escHtml(name)}</option>`
  ).join('');

  const avatarPreview = profile.avatar_url || '';
  const initials = avatarInitials(profile.display_name || currentUser.email);

  document.getElementById('accountBody').innerHTML = `
    <div class="sc-card" style="margin-bottom:16px">
      <div class="sc-head"><div class="sc-head-title">Profile picture</div></div>
      <div class="sc-body">
        <div class="acct-avatar-row">
          <div id="acctAvatarPreview" class="acct-avatar">${avatarPreview ? `<img src="${escHtml(avatarPreview)}" alt="">` : `<div class="avatar-fallback">${escHtml(initials)}</div>`}</div>
          <div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
              <label for="acctAvatarFile" class="btn btn-secondary btn-sm" style="cursor:pointer">Upload new photo</label>
              <input type="file" id="acctAvatarFile" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
              ${avatarPreview ? '<button class="btn btn-ghost btn-sm" onclick="removeAvatar()" type="button">Remove</button>' : ''}
              <span id="acctAvatarMsg" style="font-size:var(--fs-sm);color:var(--text-muted)"></span>
            </div>
            <div style="font-size:var(--fs-xs);color:var(--text-muted)">JPG, PNG, WebP or GIF — up to 2MB.</div>
          </div>
        </div>
      </div>
    </div>

    <div class="sc-card" style="margin-bottom:16px">
      <div class="sc-head"><div class="sc-head-title">Identity</div></div>
      <div class="sc-body">
        <div style="margin-bottom:14px">
          <label class="field-label">Display name</label>
          <input id="acctName" class="admin-form-input" placeholder="Your display name" value="${escHtml(profile.display_name || '')}">
        </div>
        <div style="margin-bottom:14px">
          <label class="field-label">Bio</label>
          <textarea id="acctBio" class="admin-form-input" style="min-height:72px;resize:vertical" placeholder="One line about you — optional">${escHtml(profile.bio || '')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <label class="field-label">Favourite club</label>
            <select id="acctTeam" class="admin-form-select">${teamOpts}</select>
          </div>
          <div>
            <label class="field-label">Country</label>
            <select id="acctCountry" class="admin-form-select">${countryOpts}</select>
          </div>
        </div>
      </div>
    </div>

    <div class="sc-card" style="margin-bottom:16px">
      <div class="sc-head"><div class="sc-head-title">Account</div></div>
      <div class="sc-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          <div>
            <label class="field-label">Email</label>
            <input class="admin-form-input" value="${escHtml(currentUser.email || '')}" disabled>
          </div>
          <div>
            <label class="field-label">Member since</label>
            <input class="admin-form-input" value="${escHtml(memberSince)}" disabled>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" disabled title="Coming soon">Change email</button>
          <button class="btn btn-secondary btn-sm" disabled title="Coming soon">Change password</button>
        </div>
      </div>
    </div>

    <div class="sc-card" style="margin-bottom:16px">
      <div class="sc-head"><div class="sc-head-title">Notifications</div></div>
      <div class="sc-body">
        <label class="acct-check"><input type="checkbox" id="acctNotifyLive" ${profile.notify_live ? 'checked' : ''}> Email me when a favourite creator goes live</label>
        <label class="acct-check"><input type="checkbox" id="acctNotifyWeekly" ${profile.notify_weekly ? 'checked' : ''}> Send me the weekly digest</label>
      </div>
    </div>

    <div class="sc-card" style="margin-bottom:16px">
      <div class="sc-head"><div class="sc-head-title">Activity</div></div>
      <div class="sc-body">
        <div class="cp-stat-cards" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-bottom:${voterPreferred.length ? '14px' : '0'}">
          <div class="cp-stat-card cp-stat-card--primary">
            <div class="cp-stat-label">Favourited</div>
            <div class="cp-stat-num">${favCount}</div>
          </div>
          <div class="cp-stat-card">
            <div class="cp-stat-label">Battle Votes</div>
            <div class="cp-stat-num">${formatNum(voterTotalVotes)}</div>
          </div>
        </div>
        ${voterPreferred.length ? `
        <div class="field-label" style="margin-bottom:8px">Your Top Creators</div>
        <div class="voter-top-creators">${voterPreferred.map(pc => {
          const cr = creators.find(x => x.id === pc.creator_id);
          if (!cr) return '';
          return `<a href="${creatorLink(cr)}" class="voter-top-item">
            <span class="av-wrap">${avatarImg(cr, 'voter-top-av')}</span>
            <span class="voter-top-name">${escHtml(cr.name)}</span>
            <span class="voter-top-count">${pc.vote_count} vote${pc.vote_count > 1 ? 's' : ''}</span>
          </a>`;
        }).join('')}</div>` : ''}
      </div>
    </div>

    <div class="sc-card" style="margin-bottom:16px">
      <div class="sc-head"><div class="sc-head-title">Privacy &amp; Data</div></div>
      <div class="sc-body">
        <p style="font-size:var(--fs-base);color:var(--text-dim);margin-bottom:14px">Download a copy of your data, or permanently delete your account. See our <a href="/privacy">Privacy Policy</a> for details.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="exportMyData()">Export my data</button>
          <button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="confirmDeleteAccount()">Delete my account</button>
        </div>
        <div id="acctPrivacyMsg" style="font-size:var(--fs-sm);margin-top:10px"></div>
      </div>
    </div>

    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="saveAccount()">Save changes</button>
      <button class="btn btn-ghost" onclick="signOut()">Sign out</button>
      <span id="acctSaveMsg" style="font-size:var(--fs-base)"></span>
    </div>
  `;

  // Wire up file input
  const fileInput = document.getElementById('acctAvatarFile');
  if (fileInput) fileInput.addEventListener('change', handleAvatarUpload);
}

async function exportMyData() {
  const msg = document.getElementById('acctPrivacyMsg');
  if (msg) { msg.style.color = 'var(--text-dim)'; msg.textContent = 'Preparing your export…'; }
  try {
    const uid = currentUser.id;
    const [profileRes, favRes, votesRes, requestsRes, commentsRes] = await Promise.all([
      sb.from('frfc_user_profiles').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('frfc_streamer_favorites').select('streamer_id, created_at').eq('user_id', uid),
      sb.from('frfc_feature_votes').select('feature_id, created_at').eq('user_id', uid),
      sb.from('frfc_feature_requests').select('id, title, description, category, status, created_at').eq('user_id', uid),
      sb.from('frfc_feature_comments').select('id, feature_id, body, created_at').eq('user_id', uid),
    ]);
    const exportData = {
      exported_at: new Date().toISOString(),
      account: { id: uid, email: currentUser.email, created_at: currentUser.created_at },
      profile: profileRes.data || null,
      favourites: favRes.data || [],
      feature_votes: votesRes.data || [],
      feature_requests_authored: requestsRes.data || [],
      feature_comments_authored: commentsRes.data || [],
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frfc-my-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (msg) { msg.style.color = 'var(--text-dim)'; msg.textContent = 'Download started.'; }
  } catch (e) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Export failed: ' + (e.message || 'unknown error'); }
  }
}

function confirmDeleteAccount() {
  confirmDialog('This permanently deletes your account, profile, favourites, and community activity. This cannot be undone. Continue?', deleteMyAccount, { confirmLabel: 'Delete account', danger: true });
}

async function deleteMyAccount() {
  const msg = document.getElementById('acctPrivacyMsg');
  if (msg) { msg.style.color = 'var(--text-dim)'; msg.textContent = 'Deleting your account…'; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `Delete failed (${res.status})`);
    await sb.auth.signOut();
    currentUser = null;
    currentProfile = null;
    navigate('/');
    swShowToast('Your account has been deleted.');
  } catch (e) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Delete failed: ' + (e.message || 'unknown error'); }
  }
}

async function handleAvatarUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const msg = document.getElementById('acctAvatarMsg');
  msg.textContent = 'Uploading…';
  msg.style.color = 'var(--text-dim)';
  if (file.size > 2 * 1024 * 1024) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Too large — max 2MB.';
    return;
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${currentUser.id}/avatar.${ext}`;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { msg.textContent = 'Please sign in again.'; msg.style.color = 'var(--red)'; return; }
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: file,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      msg.style.color = 'var(--red)';
      msg.textContent = 'Upload failed: ' + (body.slice(0, 120) || res.status);
      return;
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;
    // Update preview
    const preview = document.getElementById('acctAvatarPreview');
    if (preview) preview.innerHTML = `<img src="${publicUrl}" alt="">`;
    // Persist to profile row via upsert
    await upsertProfile({ avatar_url: publicUrl });
    // Update cached profile + header button so the top-right refreshes instantly.
    if (!currentProfile) currentProfile = {};
    currentProfile.avatar_url = publicUrl;
    updateAuthUI();
    msg.style.color = 'var(--green)';
    msg.textContent = 'Uploaded — don\'t forget to save other changes.';
  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Upload error: ' + (e.message || 'unknown');
  }
}

async function removeAvatar() {
  const msg = document.getElementById('acctAvatarMsg');
  msg.textContent = 'Removing…';
  await upsertProfile({ avatar_url: null });
  const preview = document.getElementById('acctAvatarPreview');
  if (preview) preview.innerHTML = `<div class="avatar-fallback">${escHtml(avatarInitials(currentUser.email))}</div>`;
  if (currentProfile) currentProfile.avatar_url = null;
  updateAuthUI();
  msg.style.color = 'var(--green)';
  msg.textContent = 'Removed.';
}

// Upsert into frfc_user_profiles via direct REST. Merges the passed fields
// into the user's row (creating it if it doesn't exist yet).
async function upsertProfile(patch) {
  const body = { user_id: currentUser.id, updated_at: new Date().toISOString(), ...patch };
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token || SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/frfc_user_profiles?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function saveAccount() {
  const msg = document.getElementById('acctSaveMsg');
  msg.style.color = 'var(--text-dim)';
  msg.textContent = 'Saving…';
  const patch = {
    display_name: document.getElementById('acctName').value.trim() || null,
    bio: document.getElementById('acctBio').value.trim() || null,
    favourite_team: document.getElementById('acctTeam').value || null,
    country: document.getElementById('acctCountry').value || null,
    notify_live: document.getElementById('acctNotifyLive').checked,
    notify_weekly: document.getElementById('acctNotifyWeekly').checked,
  };
  const res = await upsertProfile(patch);
  if (res.ok) {
    currentProfile = Object.assign({}, currentProfile || {}, patch);
    updateAuthUI();
    msg.style.color = 'var(--green)';
    msg.textContent = 'Saved.';
  } else {
    const body = await res.text().catch(() => '');
    msg.style.color = 'var(--red)';
    msg.textContent = 'Save failed: ' + (body.slice(0, 160) || res.status);
  }
}

// Loads js/admin.js on first visit to /admin instead of shipping it (and
// its window.Admin API) to every page load. Idempotent — safe to call on
// every renderAdmin(); subsequent calls resolve immediately once loaded.
let _adminAssetsPromise = null;
function loadAdminAssets() {
  if (typeof Admin !== 'undefined') return Promise.resolve();
  if (_adminAssetsPromise) return _adminAssetsPromise;
  _adminAssetsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/js/admin.js';
    script.onload = resolve;
    script.onerror = () => { _adminAssetsPromise = null; reject(new Error('Failed to load admin.js')); };
    document.body.appendChild(script);
  });
  return _adminAssetsPromise;
}

// ── Render: Admin ────────────────────────────────────────────────────────
async function renderAdmin() {
  if (!currentUser) return renderAuthRequired('open the admin panel');
  document.getElementById('app').innerHTML = '<div class="container section-message"><div style="color:var(--text-dim);font-size:var(--fs-base)">Loading admin…</div></div>';
  try {
    await loadAdminAssets();
  } catch (e) {
    document.getElementById('app').innerHTML = '<div class="container section-message"><p>Admin module failed to load.</p></div>';
    return;
  }
  if (typeof Admin === 'undefined') { document.getElementById('app').innerHTML = '<div class="container section-message"><p>Admin module not loaded.</p></div>'; return; }

  // Use direct PostgREST fetch instead of supabase-js — the latter has
  // been observed hanging on production for certain reads.
  let isAdmin = false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/frfc_admin_roles?select=role&user_id=eq.${currentUser.id}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${(await sb.auth.getSession()).data.session?.access_token || SUPABASE_KEY}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      isAdmin = rows.length > 0 && !!rows[0].role;
    }
  } catch { /* fall through — renders Access Denied */ }

  if (!isAdmin) {
    document.getElementById('app').innerHTML = '<div class="container section-message"><div class="empty-state"><div class="es-icon">&#128274;</div><div class="es-title">Access Denied</div><p style="color:var(--text-dim)">You do not have admin privileges.</p><a href="/" class="btn btn-primary" style="margin-top:12px">Back to Home</a></div></div>';
    return;
  }
  // Render admin chrome, then hand off to the Admin module for data loading.
  document.getElementById('app').innerHTML = Admin.renderHTML();
  try {
    await Admin.init();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="container section-message"><div class="empty-state"><div class="es-icon">&#9888;</div><div class="es-title">Admin failed to load</div><p style="color:var(--text-dim);margin-bottom:16px">${escHtml(e.message || String(e))}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div></div>`;
  }
}

// ── Modal accessibility (shared by the auth modal and the admin modal) ────
// Adds dialog semantics, moves focus into the modal, traps Tab/Shift+Tab
// inside it, closes on Escape, and restores focus to whatever triggered
// the modal when it closes. Call activateModalA11y() right after showing
// an overlay and deactivateModalA11y() right before hiding it.
let _modalReturnFocus = null;
let _modalKeydownHandler = null;

function activateModalA11y(overlayEl, modalEl, onClose) {
  if (!overlayEl || !modalEl) return;
  modalEl.setAttribute('role', 'dialog');
  modalEl.setAttribute('aria-modal', 'true');
  if (!modalEl.hasAttribute('tabindex')) modalEl.setAttribute('tabindex', '-1');
  _modalReturnFocus = document.activeElement;

  const getFocusable = () => Array.from(modalEl.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
  const first = getFocusable()[0];
  (first || modalEl).focus({ preventScroll: true });

  if (_modalKeydownHandler) document.removeEventListener('keydown', _modalKeydownHandler);
  _modalKeydownHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (onClose) onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) return;
    const firstEl = items[0], lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  };
  document.addEventListener('keydown', _modalKeydownHandler);
}

function deactivateModalA11y() {
  if (_modalKeydownHandler) { document.removeEventListener('keydown', _modalKeydownHandler); _modalKeydownHandler = null; }
  if (_modalReturnFocus && typeof _modalReturnFocus.focus === 'function') {
    try { _modalReturnFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  _modalReturnFocus = null;
}

// ── Auth Modal ────────────────────────────────────────────────────────────
// `reason` customizes the modal's subtitle so a user who got interrupted
// mid-action (voting, commenting, claiming a channel...) sees why they're
// being asked to sign in, instead of generic copy.
const AUTH_MODAL_REASONS = {
  vote: 'Sign in to vote on this idea.',
  comment: 'Sign in to join the discussion.',
  like: 'Sign in to like this comment.',
  submitFeature: 'Sign in to suggest a feature.',
  claim: 'Sign in to claim this channel.',
  follow: 'Sign in to follow this request and get status updates by email.',
};
let _lastAuthReason = null;

// `reason` fully determines the subtitle on every call — pass '' (or omit)
// for the generic "just clicked Sign In" case. Internal links that switch
// between signin/signup or open the reset-password screen forward
// `_lastAuthReason` explicitly so the context survives that navigation.
function openModal(type = 'signin', reason = '') {
  _lastAuthReason = reason || null;
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  if (type === 'reset') {
    modal.innerHTML = `
      <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
      <h2>Reset your password</h2>
      <p class="modal-sub">Enter your email and we'll send you a link to reset your password.</p>
      <label>Email</label>
      <input type="email" id="authEmail" placeholder="you@example.com">
      <button class="btn btn-primary" onclick="handleResetPassword()">Send Reset Link</button>
      <div class="auth-msg" id="authMsg"></div>
      <div class="switch-link">
        <a href="#" onclick="event.preventDefault();openModal('signin', _lastAuthReason)">Back to Sign In</a>
      </div>`;
    overlay.classList.add('open');
    activateModalA11y(overlay, modal, closeModal);
    return;
  }
  const isSignIn = type === 'signin';
  const subtitle = (reason && AUTH_MODAL_REASONS[reason])
    || (isSignIn ? 'Sign in to follow and favourite creators.' : 'Join the community of football YouTube fans.');
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
    <h2>${isSignIn ? 'Welcome back' : 'Create an account'}</h2>
    <p class="modal-sub">${subtitle}</p>
    <button type="button" class="btn-google" onclick="signInWithGoogle()">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
      Continue with Google
    </button>
    <div class="auth-divider"><span>or</span></div>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@example.com">
    <label>Password</label>
    <input type="password" id="authPass" placeholder="${isSignIn ? 'Your password' : 'Choose a password'}">
    ${isSignIn ? '<a href="#" class="forgot-link" onclick="event.preventDefault();openModal(\'reset\', _lastAuthReason)">Forgot your password?</a>' : ''}
    <button class="btn btn-primary" onclick="handleAuth('${type}')">${isSignIn ? 'Sign In' : 'Create Account'}</button>
    <div class="auth-msg" id="authMsg"></div>
    <div class="switch-link">
      ${isSignIn ? "Don't have an account? <a href=\"#\" onclick=\"event.preventDefault();openModal('signup', _lastAuthReason)\">Sign up</a>" :
        "Already have an account? <a href=\"#\" onclick=\"event.preventDefault();openModal('signin', _lastAuthReason)\">Sign in</a>"}
    </div>`;
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

function closeModal() {
  deactivateModalA11y();
  document.getElementById('authOverlay')?.classList.remove('open');
}

// Report-issue modal — reuses the auth modal overlay DOM so we don't need
// to add a second overlay to index.html.
function openReportModal(creatorId, creatorName) {
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  if (!overlay || !modal) return;
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
    <h2>Report an issue</h2>
    <p class="modal-sub">Help keep <strong>${escHtml(creatorName)}</strong>'s info accurate.</p>
    <label>What's wrong?</label>
    <select id="reportReason" class="admin-form-select" style="margin-bottom:14px">
      <option value="wrong_team">Wrong team / club</option>
      <option value="inactive">Channel is inactive or deleted</option>
      <option value="not_football">Not a football creator</option>
      <option value="duplicate">Duplicate of another creator</option>
      <option value="other">Something else</option>
    </select>
    <label>Details (optional)</label>
    <textarea id="reportDetails" placeholder="Anything that would help us verify..." style="width:100%;min-height:80px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:var(--fs-base);resize:vertical;margin-bottom:14px"></textarea>
    <button class="btn btn-primary" onclick="submitReport('${creatorId}')">Submit report</button>
    <div style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:10px">See our <a href="/privacy">Privacy Policy</a> for how report data is used.</div>
    <div class="auth-msg" id="reportMsg"></div>`;
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function submitReport(creatorId) {
  const reason = document.getElementById('reportReason').value;
  const details = document.getElementById('reportDetails').value.trim() || null;
  const msg = document.getElementById('reportMsg');
  msg.style.color = 'var(--text-dim)';
  msg.textContent = 'Sending…';
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/frfc_creator_reports', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ creator_id: creatorId, reason, details }),
    });
    if (!res.ok) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Could not submit (' + res.status + '). Please try again.';
      return;
    }
    msg.style.color = 'var(--green)';
    msg.textContent = 'Thanks — we\'ll review this shortly.';
    setTimeout(closeModal, 1400);
  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Network error. Please try again.';
  }
}

// ── Claim-a-channel modal ────────────────────────────────────────────────
// Verifies ownership by asking the creator to paste a short code into
// their YouTube channel description, then calling the claim-creator
// Netlify function which checks it server-side via the YouTube API.
function openClaimModal(creatorId, creatorName) {
  if (!currentUser) { openModal('signin', 'claim'); return; }
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  if (!overlay || !modal) return;
  const code = 'FRFC-' + currentUser.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
    <h2>Claim this channel</h2>
    <p class="modal-sub">Verify you run <strong>${escHtml(creatorName)}</strong> to manage this profile.</p>
    <ol style="font-size:var(--fs-base);color:var(--text-dim);line-height:1.7;padding-left:20px;margin-bottom:14px">
      <li>Open your channel's <strong>About</strong> section on YouTube.</li>
      <li>Add this code anywhere in the description: <code style="background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-weight:700;color:var(--text)">${code}</code></li>
      <li>Save, then click Verify below.</li>
    </ol>
    <button class="btn btn-primary" style="width:100%" onclick="submitClaim('${creatorId}')">Verify</button>
    <div class="auth-msg" id="claimMsg"></div>`;
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function submitClaim(creatorId) {
  const msg = document.getElementById('claimMsg');
  msg.style.color = 'var(--text-dim)';
  msg.textContent = 'Checking your channel description…';
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) { msg.style.color = 'var(--red)'; msg.textContent = 'Please sign in again.'; return; }
    const res = await fetch('/.netlify/functions/claim-creator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ creatorId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { msg.style.color = 'var(--red)'; msg.textContent = data.error || 'Verification failed.'; return; }
    msg.style.color = 'var(--green)';
    msg.textContent = data.message || 'Verified!';
    const c = creators.find(cr => cr.id === creatorId);
    if (c) c.claimedBy = currentUser.id;
    setTimeout(() => { closeModal(); handleRoute(); }, 1200);
  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Network error. Please try again.';
  }
}

// ── Manage Channel panel ─────────────────────────────────────────────────
// Self-service editing for a claimed creator's own profile. Every write
// goes through the manage-channel Netlify function, which re-verifies
// ownership server-side and appends to frfc_creator_edit_log — this page
// only ever sends a diff of what actually changed. League/team are
// deliberately not editable here (see manage-channel.js for why).
let mcOriginal = null; // snapshot of editable fields, to diff on save
let mcFeaturedPick = null; // pending featured-video selection, if changed

function renderManageChannel(creatorId) {
  if (!currentUser) return renderAuthRequired('manage your channel');
  const c = creators.find(cr => cr.id === creatorId);
  if (!c) {
    document.getElementById('app').innerHTML = '<div class="container section-message"><div class="empty-state"><div class="es-title">Creator not found</div><a href="/discover" class="btn btn-primary" style="margin-top:12px">Browse creators</a></div></div>';
    return;
  }
  if (c.claimedBy !== currentUser.id) {
    document.getElementById('app').innerHTML = `<div class="container section-message"><div class="empty-state"><div class="es-title">You don't manage this channel</div><p style="color:var(--text-dim)">Only the account that claimed ${escHtml(c.name)} can access this page.</p><a href="${creatorLink(c)}" class="btn btn-primary" style="margin-top:12px">Back to profile</a></div></div>`;
    return;
  }

  mcOriginal = {
    description: c.description || '',
    content_types: [...c.contentTypes],
    social_x: c.socialX || '',
    social_twitch: c.socialTwitch || '',
    social_discord: c.socialDiscord || '',
    social_tiktok: c.socialTiktok || '',
    social_instagram: c.socialInstagram || '',
  };
  mcFeaturedPick = c.featuredVideoId || null;

  const contentTypeChecks = CONTENT_TYPES.map(t => `
    <label class="acct-check">
      <input type="checkbox" class="mc-content-type" value="${escHtml(t)}" ${c.contentTypes.includes(t) ? 'checked' : ''}>
      ${escHtml(t)}
    </label>`).join('');

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Manage Channel</div>
            <h1 class="page-hero-title">${escHtml(c.name)}</h1>
            <p class="page-hero-subtitle">Edits here appear on your public profile immediately. Want to change your club or league? <a href="/contact">Contact us</a> — that one goes through review since it affects rankings.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="container container-mid section">
      <div class="sc-card" style="margin-bottom:16px">
        <div class="sc-head"><div class="sc-head-title">Profile picture</div></div>
        <div class="sc-body">
          <div class="acct-avatar-row">
            <div id="mcAvatarPreview" class="acct-avatar">${c.avatar ? `<img src="${escHtml(c.avatar)}" alt="">` : `<div class="avatar-fallback">${escHtml(avatarInitials(c.name))}</div>`}</div>
            <div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
                <label for="mcAvatarFile" class="btn btn-secondary btn-sm" style="cursor:pointer">Upload new photo</label>
                <input type="file" id="mcAvatarFile" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
                <span id="mcAvatarMsg" style="font-size:var(--fs-sm);color:var(--text-muted)"></span>
              </div>
              <div style="font-size:var(--fs-xs);color:var(--text-muted)">JPG, PNG, WebP or GIF — up to 2MB. ${c.avatarCustom ? 'Currently a custom photo — the automatic YouTube sync won\'t override it.' : 'Currently synced from YouTube automatically.'}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="sc-card" style="margin-bottom:16px">
        <div class="sc-head"><div class="sc-head-title">Channel description</div></div>
        <div class="sc-body">
          <textarea id="mcDescription" class="admin-form-input" style="min-height:100px;resize:vertical" maxlength="1000" placeholder="Tell fans what your channel is about...">${escHtml(c.description || '')}</textarea>
          <div style="text-align:right;font-size:var(--fs-xs);color:var(--text-muted);margin-top:4px">Shown on your profile instead of the auto-generated summary.</div>
        </div>
      </div>

      <div class="sc-card" style="margin-bottom:16px">
        <div class="sc-head"><div class="sc-head-title">Content type</div></div>
        <div class="sc-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${contentTypeChecks}</div>
        </div>
      </div>

      <div class="sc-card" style="margin-bottom:16px">
        <div class="sc-head"><div class="sc-head-title">Social links</div></div>
        <div class="sc-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label class="field-label">X (Twitter)</label><input id="mcSocialX" class="admin-form-input" placeholder="https://x.com/..." value="${escHtml(c.socialX || '')}"></div>
            <div><label class="field-label">Instagram</label><input id="mcSocialInstagram" class="admin-form-input" placeholder="https://instagram.com/..." value="${escHtml(c.socialInstagram || '')}"></div>
            <div><label class="field-label">Twitch</label><input id="mcSocialTwitch" class="admin-form-input" placeholder="https://twitch.tv/..." value="${escHtml(c.socialTwitch || '')}"></div>
            <div><label class="field-label">Discord</label><input id="mcSocialDiscord" class="admin-form-input" placeholder="https://discord.gg/..." value="${escHtml(c.socialDiscord || '')}"></div>
            <div><label class="field-label">TikTok</label><input id="mcSocialTiktok" class="admin-form-input" placeholder="https://tiktok.com/@..." value="${escHtml(c.socialTiktok || '')}"></div>
          </div>
        </div>
      </div>

      <div class="sc-card" style="margin-bottom:16px">
        <div class="sc-head"><div class="sc-head-title">Featured video</div></div>
        <div class="sc-body">
          <p style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:12px">Pin a specific video to show above your latest upload. Optional.</p>
          <div id="mcFeaturedGrid"><div style="font-size:var(--fs-sm);color:var(--text-muted)">Loading your videos…</div></div>
          ${c.featuredVideoId ? '<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="mcClearFeatured()">Clear featured video</button>' : ''}
        </div>
      </div>

      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn btn-primary" onclick="saveManageChannel('${creatorId}')">Save changes</button>
        <a href="${creatorLink(c)}" class="btn btn-ghost" onclick="event.preventDefault();navigate('${creatorLink(c)}')">Back to profile</a>
        <span id="mcSaveMsg" style="font-size:var(--fs-sm)"></span>
      </div>

      <div class="sc-card" style="margin-bottom:16px">
        <div class="sc-head"><div class="sc-head-title">Edit history</div></div>
        <div class="sc-body">
          <div id="mcHistory"><div style="font-size:var(--fs-sm);color:var(--text-muted)">Loading…</div></div>
        </div>
      </div>

      <div class="sc-card" style="border-color:rgba(230,57,70,.25)">
        <div class="sc-head"><div class="sc-head-title" style="color:var(--red)">Danger zone</div></div>
        <div class="sc-body">
          <p style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:12px">Un-claiming removes your ownership of this profile. Anyone will be able to claim it again by re-verifying the same YouTube channel.</p>
          <button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="confirmUnclaimChannel('${creatorId}')">Un-claim this channel</button>
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;

  const fileInput = document.getElementById('mcAvatarFile');
  if (fileInput) fileInput.addEventListener('change', e => handleManageAvatarUpload(e, creatorId));

  mcLoadFeaturedVideos(c);
  mcLoadHistory(creatorId);
}

async function mcLoadFeaturedVideos(c) {
  const grid = document.getElementById('mcFeaturedGrid');
  if (!grid) return;
  if (!c.youtubeChannelId) { grid.innerHTML = '<div style="font-size:var(--fs-sm);color:var(--text-muted)">No YouTube channel on file yet — check back after the next sync.</div>'; return; }
  try {
    const detRes = await fetch(`/.netlify/functions/youtube-proxy?endpoint=channels&part=contentDetails&id=${c.youtubeChannelId}`);
    const detData = await detRes.json();
    const uploadsId = detData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) throw new Error('no uploads playlist');
    const plRes = await fetch(`/.netlify/functions/youtube-proxy?endpoint=playlistItems&part=snippet&playlistId=${uploadsId}&maxResults=12`);
    const plData = await plRes.json();
    const videos = (plData.items || []).map(item => ({
      id: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    })).filter(v => v.id);
    if (!videos.length) { grid.innerHTML = '<div style="font-size:var(--fs-sm);color:var(--text-muted)">No videos found.</div>'; return; }
    grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
      ${videos.map(v => `
        <div class="mc-video-pick${mcFeaturedPick === v.id ? ' active' : ''}" data-video-id="${escHtml(v.id)}" onclick="mcSelectFeatured(this)" title="${escHtml(v.title)}">
          <img src="${escHtml(v.thumb || '')}" alt="" loading="lazy">
        </div>`).join('')}
    </div>`;
  } catch (e) {
    grid.innerHTML = '<div style="font-size:var(--fs-sm);color:var(--text-muted)">Couldn\'t load your videos right now.</div>';
  }
}

function mcSelectFeatured(el) {
  document.querySelectorAll('.mc-video-pick.active').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  mcFeaturedPick = el.getAttribute('data-video-id');
}

function mcClearFeatured() {
  mcFeaturedPick = null;
  document.querySelectorAll('.mc-video-pick.active').forEach(x => x.classList.remove('active'));
  swShowToast('Featured video will be cleared on save.');
}

async function mcLoadHistory(creatorId) {
  const el = document.getElementById('mcHistory');
  if (!el) return;
  try {
    const { data, error } = await sb.from('frfc_creator_edit_log')
      .select('field, old_value, new_value, created_at')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    if (!data || !data.length) { el.innerHTML = '<div style="font-size:var(--fs-sm);color:var(--text-muted)">No edits yet.</div>'; return; }
    el.innerHTML = data.map(row => `
      <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:var(--fs-sm)">
        <strong>${escHtml(row.field)}</strong> changed &middot; <span style="color:var(--text-muted)">${timeAgo(row.created_at)}</span>
      </div>`).join('');
  } catch (e) {
    el.innerHTML = '<div style="font-size:var(--fs-sm);color:var(--text-muted)">Couldn\'t load edit history.</div>';
  }
}

async function handleManageAvatarUpload(e, creatorId) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const msg = document.getElementById('mcAvatarMsg');
  msg.textContent = 'Uploading…';
  msg.style.color = 'var(--text-dim)';
  if (file.size > 2 * 1024 * 1024) { msg.style.color = 'var(--red)'; msg.textContent = 'Too large — max 2MB.'; return; }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${currentUser.id}/creator-${creatorId}.${ext}`;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { msg.textContent = 'Please sign in again.'; msg.style.color = 'var(--red)'; return; }
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body: file,
    });
    if (!uploadRes.ok) { msg.style.color = 'var(--red)'; msg.textContent = 'Upload failed.'; return; }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;
    const patchRes = await mcPatch(creatorId, { avatar_url: publicUrl });
    if (!patchRes.ok) { msg.style.color = 'var(--red)'; msg.textContent = patchRes.error || 'Save failed.'; return; }
    const c = creators.find(cr => cr.id === creatorId);
    if (c) { c.avatar = publicUrl; c.avatarCustom = true; }
    document.getElementById('mcAvatarPreview').innerHTML = `<img src="${publicUrl}" alt="">`;
    msg.style.color = 'var(--green)';
    msg.textContent = 'Uploaded!';
  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Network error.';
  }
}

// Sends only the fields whose value actually differs from mcOriginal — the
// server diffs again independently, but doing it here too keeps "No
// changes" saves from writing a no-op edit-log row for nothing.
async function saveManageChannel(creatorId) {
  const msg = document.getElementById('mcSaveMsg');
  msg.style.color = 'var(--text-dim)';
  msg.textContent = 'Saving…';

  const contentTypes = [...document.querySelectorAll('.mc-content-type:checked')].map(el => el.value);
  const current = {
    description: document.getElementById('mcDescription').value.trim(),
    content_types: contentTypes,
    social_x: document.getElementById('mcSocialX').value.trim(),
    social_twitch: document.getElementById('mcSocialTwitch').value.trim(),
    social_discord: document.getElementById('mcSocialDiscord').value.trim(),
    social_tiktok: document.getElementById('mcSocialTiktok').value.trim(),
    social_instagram: document.getElementById('mcSocialInstagram').value.trim(),
  };

  const patch = {};
  for (const [key, value] of Object.entries(current)) {
    const before = mcOriginal[key];
    const same = Array.isArray(before) ? JSON.stringify(before) === JSON.stringify(value) : before === value;
    if (!same) patch[key] = value;
  }
  const c = creators.find(cr => cr.id === creatorId);
  if (mcFeaturedPick !== (c.featuredVideoId || null)) patch.featured_video_id = mcFeaturedPick;

  if (!Object.keys(patch).length) { msg.style.color = 'var(--text-dim)'; msg.textContent = 'No changes to save.'; return; }

  const result = await mcPatch(creatorId, patch);
  if (!result.ok) { msg.style.color = 'var(--red)'; msg.textContent = result.error || 'Save failed.'; return; }

  if (c) {
    if ('description' in patch) c.description = patch.description;
    if ('content_types' in patch) c.contentTypes = patch.content_types;
    if ('social_x' in patch) c.socialX = patch.social_x;
    if ('social_twitch' in patch) c.socialTwitch = patch.social_twitch;
    if ('social_discord' in patch) c.socialDiscord = patch.social_discord;
    if ('social_tiktok' in patch) c.socialTiktok = patch.social_tiktok;
    if ('social_instagram' in patch) c.socialInstagram = patch.social_instagram;
    if ('featured_video_id' in patch) c.featuredVideoId = patch.featured_video_id || '';
  }
  msg.style.color = 'var(--green)';
  msg.textContent = 'Saved!';
  mcLoadHistory(creatorId);
}

async function mcPatch(creatorId, patch) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { ok: false, error: 'Please sign in again.' };
    const res = await fetch('/.netlify/functions/manage-channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ creatorId, action: 'update', patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error.' };
  }
}

function confirmUnclaimChannel(creatorId) {
  const c = creators.find(cr => cr.id === creatorId);
  confirmDialog(`Un-claim ${c ? c.name : 'this channel'}? You'll lose management access immediately.`, () => unclaimChannel(creatorId), { confirmLabel: 'Un-claim', danger: true });
}

async function unclaimChannel(creatorId) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('/.netlify/functions/manage-channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ creatorId, action: 'unclaim' }),
    });
    if (!res.ok) { swShowToast('Failed to un-claim — please try again.'); return; }
    const c = creators.find(cr => cr.id === creatorId);
    if (c) c.claimedBy = null;
    swShowToast('Channel un-claimed.');
    navigate(c ? creatorLink(c) : '/discover');
  } catch (e) {
    swShowToast('Network error — please try again.');
  }
}

// ── Custom confirm dialog (replaces window.confirm) ──────────────────────
// Reuses the auth modal overlay. Resolves nothing itself — callers pass a
// callback to run if the user confirms, matching the call-site shape of
// `if (!confirm(...)) return; doTheThing();`.
function confirmDialog(message, onConfirm, opts = {}) {
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  if (!overlay || !modal) { if (window.confirm(message)) onConfirm(); return; }
  const danger = opts.danger !== false;
  const confirmLabel = opts.confirmLabel || 'Confirm';
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
    <h2>${opts.title ? escHtml(opts.title) : 'Are you sure?'}</h2>
    <p class="modal-sub">${escHtml(message)}</p>
    <div class="switch-link" style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmDialogBtn">${escHtml(confirmLabel)}</button>
    </div>`;
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
  document.getElementById('confirmDialogBtn').onclick = () => { closeModal(); onConfirm(); };
}

async function handleResetPassword() {
  const email = document.getElementById('authEmail').value.trim();
  const msg = document.getElementById('authMsg');
  if (!email) { msg.textContent = 'Please enter your email address.'; return; }
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/account'
    });
    if (error) { msg.style.color = 'var(--red)'; msg.textContent = error.message; return; }
    msg.style.color = 'var(--green)';
    msg.textContent = 'Check your email for a password reset link.';
  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Something went wrong. Please try again.';
  }
}

async function handleAuth(type) {
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  const msg = document.getElementById('authMsg');
  if (!email || !pass) { msg.textContent = 'Please fill in both fields.'; return; }
  if (type === 'signin') {
    const err = await signIn(email, pass);
    if (err) msg.textContent = err;
  } else {
    const err = await signUp(email, pass);
    if (err) { msg.textContent = err; return; }
    msg.style.color = 'var(--green)';
    msg.textContent = 'Account created! Check your email to confirm, then sign in.';
  }
}

// ── Render: Streamwall ───────────────────────────────────────────────────
// Two states on the same route (account required for both — see
// renderAuthRequired below):
//   1. Picker (default, normal site chrome) — check up to SW_PICKER_MAX
//      live creators, then launch the wall with them pre-loaded.
//   2. Wall (?wall=1, full-screen/no chrome) — the control room: drag to
//      reorder, per-tile pause/mute/fullscreen/remove, add more streams by
//      pasting any YouTube URL, global pause/mute/go-live, a "Goal!" button
//      that opens a synced clone tab (?goal=<ts>) jumped to the live edge,
//      keyboard shortcuts, localStorage persistence.
const SW_STORAGE_KEY = 'frfc_streamwall_streams';
const SW_GOAL_KEY = 'frfc_streamwall_goal_ids';
const SW_PICKER_MAX = 16;
const SW_WALL_MAX = 16;
const SW_COLS = 4;

const SW_ICONS = {
  pause:  '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  play:   '<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>',
  mute:   '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',
  unmute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77 0-4.28-2.99-7.86-7-8.77z"/></svg>',
  fs:     '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  newtab: '<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
  close:  '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  drag:   '<svg viewBox="0 0 24 24"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><circle cx="9" cy="15" r="1.5"/><circle cx="15" cy="15" r="1.5"/><circle cx="9" cy="20" r="1.5"/><circle cx="15" cy="20" r="1.5"/></svg>',
};

let swPickerSelected = new Set();
let swPickLeague = '';
let swPickTeam = '';
let swStreams = [];
let swAllPaused = false;
let swAllMuted = false;
let swDragSrcIndex = null;
let swKeydownHandler = null;

function renderStreamwall() {
  if (!currentUser) { swExitFullscreen(); renderAuthRequired('use Streamwall'); return; }
  const params = new URLSearchParams(location.search);
  if (params.has('goal')) { swEnterFullscreen(); renderStreamwallWall(true); return; }
  if (params.get('wall') === '1') { swEnterFullscreen(); renderStreamwallWall(false); return; }
  swExitFullscreen();
  renderStreamwallPicker();
}

// ── Full-screen chrome toggle ────────────────────────────────────────────
function swEnterFullscreen() {
  const header = document.querySelector('.site-header');
  if (header) header.style.display = 'none';
  document.body.classList.add('sww-active');
  if (!swKeydownHandler) {
    swKeydownHandler = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key.toLowerCase()) {
        case ' ': e.preventDefault(); swToggleAll(); break;
        case 'm': swToggleMuteAll(); break;
        case 'l': swGoLiveAll(); break;
        case 'g': swOnGoal(); break;
      }
    };
    document.addEventListener('keydown', swKeydownHandler);
  }
}

function swExitFullscreen() {
  const header = document.querySelector('.site-header');
  if (header) header.style.display = '';
  document.body.classList.remove('sww-active');
  if (swKeydownHandler) {
    document.removeEventListener('keydown', swKeydownHandler);
    swKeydownHandler = null;
  }
}

function swShowToast(msg) {
  let t = document.getElementById('sww-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'sww-toast';
    t.className = 'sww-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('visible'), 2000);
}

// ── Picker ───────────────────────────────────────────────────────────────
function renderStreamwallPicker() {
  const liveCreators = creators.filter(c => c.isLive && c.liveVideoId);
  swPickerSelected = new Set();
  swPickLeague = '';
  swPickTeam = '';

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Live</div>
            <h1 class="page-hero-title">Streamwall</h1>
            <p class="page-hero-subtitle">Check up to ${SW_PICKER_MAX} live creators and watch them all at once in a full-screen multi-view wall. Add more streams by URL once it's open.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="container section">
      ${liveCreators.length ? `
      <div class="sc-card" style="margin-bottom:0">
        <div class="sc-head">
          <div class="sc-head-title"><span class="live-dot-sm"></span> Live Now <span class="live-count">${liveCreators.length}</span></div>
          <div id="swPickCount" style="font-size:var(--fs-sm);color:var(--text-dim)">0 / ${SW_PICKER_MAX} selected</div>
        </div>
        <div class="sc-body">
          <div class="sw-pick-filter-row" id="swPickLeagueRow">
            <span class="chip active" onclick="swFilterPickLeague('', this)">All</span>
            ${LEAGUES.filter(l => liveCreators.some(c => (c.league || getLeague(c.team)) === l.name)).map(l => `<span class="chip" onclick="swFilterPickLeague('${jsAttrStr(l.name)}', this)">${leagueChipImg(l.name)} ${escHtml(l.name)}</span>`).join('')}
          </div>
          <div class="sw-pick-filter-row" id="swPickTeamRow" style="display:none"></div>
          <div class="sw-pick-grid" id="swPickGrid"></div>
        </div>
      </div>
      <div class="sw-launch-bar">
        <button class="btn btn-primary" id="swLaunchBtn" onclick="swLaunchWall()">Open Streamwall</button>
      </div>` : `
      <div class="sc-card">
        <div class="sc-body sw-empty">
          <div class="sw-empty-icon">&#128225;</div>
          <div class="sw-empty-title">No one is live right now</div>
          <div class="sw-empty-desc">Check back during matchday, or open an empty wall and paste stream URLs directly.</div>
          <button class="btn btn-primary" onclick="swLaunchWall()">Open Empty Streamwall</button>
        </div>
      </div>`}
    </div>
    ${renderFooter()}
  `;

  if (liveCreators.length) swRenderPickGrid();
}

// League -> team narrows which live creators appear in the picker grid.
// Selections (swPickerSelected) persist across filter changes — only the
// visible set changes, matching how the Discover page's filters behave.
function swGetFilteredLiveCreators() {
  let list = creators.filter(c => c.isLive && c.liveVideoId);
  if (swPickLeague) list = list.filter(c => (c.league || getLeague(c.team)) === swPickLeague);
  if (swPickTeam) list = list.filter(c => c.team === swPickTeam);
  return list;
}

function swFilterPickLeague(league, el) {
  swPickLeague = league;
  swPickTeam = '';
  el.parentNode.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  swRenderPickTeamRow();
  swRenderPickGrid();
}

function swRenderPickTeamRow() {
  const row = document.getElementById('swPickTeamRow');
  if (!row) return;
  if (!swPickLeague) { row.style.display = 'none'; row.innerHTML = ''; return; }
  const inLeague = creators.filter(c => c.isLive && c.liveVideoId && (c.league || getLeague(c.team)) === swPickLeague);
  const teams = [...new Set(inLeague.map(c => c.team))].sort();
  if (teams.length < 2) { row.style.display = 'none'; row.innerHTML = ''; return; }
  row.style.display = 'flex';
  row.innerHTML = `<span class="chip active" onclick="swFilterPickTeam('', this)">All ${escHtml(swPickLeague)}</span>` +
    teams.map(t => `<span class="chip" onclick="swFilterPickTeam('${jsAttrStr(t)}', this)">${crestImg(t, 'crest-sm')} ${escHtml(t)}</span>`).join('');
}

function swFilterPickTeam(team, el) {
  swPickTeam = team;
  el.parentNode.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  swRenderPickGrid();
}

function swRenderPickGrid() {
  const grid = document.getElementById('swPickGrid');
  if (!grid) return;
  const list = swGetFilteredLiveCreators();
  grid.innerHTML = list.length
    ? list.map(c => swPickCardHTML(c)).join('')
    : `<div class="sw-empty" style="grid-column:1/-1"><div class="sw-empty-icon">&#128269;</div><div class="sw-empty-title">No live creators match this filter</div><div class="sw-empty-desc">Try a different league or team.</div></div>`;
}

function swPickCardHTML(c) {
  const checked = swPickerSelected.has(c.id) ? ' checked' : '';
  return `
    <label class="sw-pick-card" for="swpick-${c.id}">
      <input type="checkbox" id="swpick-${c.id}"${checked} onchange="swToggleSelect('${c.id}', this)">
      <div class="sw-pick-video">
        <img src="https://i.ytimg.com/vi/${safeId(c.liveVideoId)}/hqdefault.jpg" alt="" loading="lazy">
        <span class="sw-pick-live-badge">LIVE</span>
      </div>
      <div class="sw-pick-bar">
        <span class="sw-pick-check"></span>
        ${avatarImg(c, 'sw-pick-avatar')}
        <span class="sw-pick-info">
          <span class="sw-pick-name">${escHtml(c.name)}</span>
          <span class="sw-pick-meta">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}${c.subscriberCount ? ' &middot; ' + formatNum(c.subscriberCount) : ''}</span>
        </span>
      </div>
    </label>`;
}

function swToggleSelect(id, input) {
  if (input.checked) {
    if (swPickerSelected.size >= SW_PICKER_MAX) {
      input.checked = false;
      swShowToast(`You can select up to ${SW_PICKER_MAX} streams`);
      return;
    }
    swPickerSelected.add(id);
  } else {
    swPickerSelected.delete(id);
  }
  const counter = document.getElementById('swPickCount');
  if (counter) counter.textContent = `${swPickerSelected.size} / ${SW_PICKER_MAX} selected`;
}

function swLaunchWall() {
  const ids = [...swPickerSelected]
    .map(id => creators.find(c => c.id === id))
    .filter(Boolean)
    .map(c => c.liveVideoId);
  try { localStorage.setItem(SW_STORAGE_KEY, JSON.stringify(ids)); } catch (e) {}
  window.open('/streamwall?wall=1', '_blank');
}

// ── Wall ─────────────────────────────────────────────────────────────────
function swExtractVideoId(url) {
  url = (url || '').trim();
  let m;
  m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/); if (m) return m[1];
  m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/); if (m) return m[1];
  m = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/); if (m) return m[1];
  m = url.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/); if (m) return m[1];
  m = url.match(/^([a-zA-Z0-9_-]{11})$/); if (m) return m[1];
  return null;
}

function swEmbedUrl(videoId) {
  return `https://www.youtube-nocookie.com/embed/${safeId(videoId)}?autoplay=1&enablejsapi=1`;
}

function swPostCmd(index, func, args) {
  const f = document.getElementById('sww-iframe-' + index);
  if (f && f.contentWindow) {
    try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), '*'); } catch (e) {}
  }
}

function swSaveStreams(isClone) {
  if (isClone) return;
  try { localStorage.setItem(SW_STORAGE_KEY, JSON.stringify(swStreams.map(s => s.videoId))); } catch (e) {}
}

function renderStreamwallWall(isClone) {
  swStreams = [];
  swAllPaused = false;
  swAllMuted = false;

  try {
    const raw = localStorage.getItem(isClone ? SW_GOAL_KEY : SW_STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      ids.forEach(id => {
        if (swStreams.length < SW_WALL_MAX) swStreams.push({ videoId: id, paused: false, muted: false });
      });
    }
  } catch (e) {}

  document.getElementById('app').innerHTML = `
    <div id="sww-topbar">
      <a href="/streamwall" class="sww-back" onclick="event.preventDefault();navigate('/streamwall')" title="Back to Streamwall">&larr;</a>
      <h1>Streamwall</h1>
      ${isClone ? '<div class="sww-clone-badge"><span class="sww-live-dot"></span> LIVE CLONE</div>' : ''}
      <input id="sww-url-input" type="text" placeholder="Paste a YouTube URL and press Enter…">
      <button class="sww-btn" id="sww-toggle-all-btn">
        <span id="sww-toggle-icon">${SW_ICONS.pause}</span>
        <span id="sww-toggle-label">Pause All</span>
      </button>
      <button class="sww-btn" id="sww-live-all-btn"><span class="sww-live-dot" id="sww-live-dot"></span><span id="sww-live-label">Go Live</span></button>
      <button class="sww-btn" id="sww-mute-all-btn">
        <span id="sww-mute-all-icon">${SW_ICONS.mute}</span>
        <span id="sww-mute-all-label">Mute All</span>
      </button>
      <button class="sww-btn sww-btn-goal" id="sww-goal-btn">&#9917; Goal!</button>
      <button class="sww-btn sww-btn-clear" id="sww-clear-btn">Clear</button>
      <span class="sww-counter" id="sww-counter">${swStreams.length} / ${SW_WALL_MAX}</span>
    </div>
    <div id="sww-scroll-area">
      <div id="sww-grid"></div>
    </div>
  `;

  document.getElementById('sww-goal-btn').addEventListener('click', swOnGoal);
  document.getElementById('sww-live-all-btn').addEventListener('click', swGoLiveAll);
  document.getElementById('sww-url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') swAddStream(e.target.value, isClone);
  });
  document.getElementById('sww-toggle-all-btn').addEventListener('click', () => swToggleAll(isClone));
  document.getElementById('sww-mute-all-btn').addEventListener('click', () => swToggleMuteAll(isClone));
  document.getElementById('sww-clear-btn').addEventListener('click', () => {
    if (!swStreams.length) return;
    confirmDialog(`Remove all ${swStreams.length} stream(s)?`, () => {
      swStreams = [];
      swAllPaused = false;
      swAllMuted = false;
      swUpdateToggleAllBtn();
      swUpdateMuteAllBtn();
      swRenderGrid(isClone);
      swSaveStreams(isClone);
    }, { title: 'Clear Streamwall', confirmLabel: 'Clear' });
  });

  swUpdateToggleAllBtn();
  swUpdateMuteAllBtn();
  swRenderGrid(isClone);

  // Clone tabs: seek everyone to the live edge shortly after the iframes load.
  if (isClone && swStreams.length) {
    setTimeout(() => {
      swStreams.forEach((s, i) => { swPostCmd(i, 'seekTo', [99999, true]); swPostCmd(i, 'playVideo'); });
    }, 2500);

    try {
      const bc = new BroadcastChannel('frfc-streamwall-goal');
      bc.onmessage = e => {
        if (swStreams.length > 0) return;
        try {
          const ids = JSON.parse(e.data);
          ids.forEach(id => { if (swStreams.length < SW_WALL_MAX) swStreams.push({ videoId: id, paused: false, muted: false }); });
          swRenderGrid(true);
          setTimeout(() => {
            swStreams.forEach((s, i) => { swPostCmd(i, 'seekTo', [99999, true]); swPostCmd(i, 'playVideo'); });
          }, 2000);
        } catch (e) {}
      };
    } catch (e) {}
  }
}

function swUpdateToggleAllBtn() {
  const btn = document.getElementById('sww-toggle-all-btn');
  const icon = document.getElementById('sww-toggle-icon');
  const label = document.getElementById('sww-toggle-label');
  if (!btn) return;
  if (swAllPaused) {
    icon.innerHTML = SW_ICONS.play; label.textContent = 'Play All'; btn.classList.remove('playing');
  } else {
    icon.innerHTML = SW_ICONS.pause; label.textContent = 'Pause All'; btn.classList.add('playing');
  }
}

function swToggleAll(isClone) {
  if (!swStreams.length) return;
  swAllPaused = !swAllPaused;
  swStreams.forEach((s, i) => { s.paused = swAllPaused; swPostCmd(i, swAllPaused ? 'pauseVideo' : 'playVideo'); });
  document.querySelectorAll('.sww-tile').forEach(tile => {
    const pb = tile.querySelector('.sww-t-btn[data-role="pause"]');
    if (pb) { pb.innerHTML = SW_ICONS[swAllPaused ? 'play' : 'pause']; pb.title = swAllPaused ? 'Play' : 'Pause'; }
  });
  swUpdateToggleAllBtn();
}

function swUpdateMuteAllBtn() {
  const btn = document.getElementById('sww-mute-all-btn');
  const icon = document.getElementById('sww-mute-all-icon');
  const label = document.getElementById('sww-mute-all-label');
  if (!btn) return;
  if (swAllMuted) {
    icon.innerHTML = SW_ICONS.unmute; label.textContent = 'Unmute All'; btn.classList.add('muted');
  } else {
    icon.innerHTML = SW_ICONS.mute; label.textContent = 'Mute All'; btn.classList.remove('muted');
  }
}

function swToggleMuteAll(isClone) {
  if (!swStreams.length) return;
  swAllMuted = !swAllMuted;
  swStreams.forEach((s, i) => { s.muted = swAllMuted; swPostCmd(i, swAllMuted ? 'mute' : 'unMute'); });
  document.querySelectorAll('.sww-tile').forEach(tile => {
    const mb = tile.querySelector('.sww-t-btn[data-role="mute"]');
    if (mb) { mb.innerHTML = SW_ICONS[swAllMuted ? 'unmute' : 'mute']; mb.title = swAllMuted ? 'Unmute' : 'Mute'; }
  });
  swUpdateMuteAllBtn();
}

function swMakeTBtn(iconKey, title, onClick, extraClass, role) {
  const b = document.createElement('button');
  b.className = 'sww-t-btn' + (extraClass ? ' ' + extraClass : '');
  b.title = title;
  b.innerHTML = SW_ICONS[iconKey];
  if (role) b.dataset.role = role;
  b.addEventListener('click', onClick);
  return b;
}

function swRenderGrid(isClone) {
  const grid = document.getElementById('sww-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (swStreams.length === 0) {
    const es = document.createElement('div');
    es.id = 'sww-empty-state';
    es.innerHTML = `<p class="sww-empty-main">Paste a YouTube URL above to add a stream</p><p class="sww-empty-sub">youtube.com/watch?v=&hellip; &middot; youtu.be/&hellip; &middot; Keys: Space=pause&nbsp; M=mute&nbsp; L=live&nbsp; G=goal</p>`;
    grid.appendChild(es);
    const counter = document.getElementById('sww-counter');
    if (counter) counter.textContent = `0 / ${SW_WALL_MAX}`;
    return;
  }

  swStreams.forEach((s, i) => {
    const tile = document.createElement('div');
    tile.className = 'sww-tile';
    tile.draggable = true;
    tile.dataset.index = i;

    tile.addEventListener('dragstart', e => {
      swDragSrcIndex = i;
      tile.classList.add('dragging');
      document.body.classList.add('sww-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    tile.addEventListener('dragend', () => {
      tile.classList.remove('dragging');
      document.body.classList.remove('sww-dragging');
      document.querySelectorAll('.sww-tile.drag-over').forEach(t => t.classList.remove('drag-over'));
      swDragSrcIndex = null;
    });
    tile.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (swDragSrcIndex !== null && swDragSrcIndex !== i) tile.classList.add('drag-over');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
    tile.addEventListener('drop', e => {
      e.preventDefault();
      tile.classList.remove('drag-over');
      if (swDragSrcIndex === null || swDragSrcIndex === i) return;
      const moved = swStreams.splice(swDragSrcIndex, 1)[0];
      swStreams.splice(i, 0, moved);
      swDragSrcIndex = null;
      document.body.classList.remove('sww-dragging');
      swRenderGrid(isClone);
      swSaveStreams(isClone);
    });

    const overlay = document.createElement('div');
    overlay.className = 'sww-iframe-overlay';
    tile.appendChild(overlay);

    const tb = document.createElement('div');
    tb.className = 'sww-tile-toolbar';

    const handle = document.createElement('span');
    handle.className = 'sww-drag-handle';
    handle.innerHTML = SW_ICONS.drag;
    handle.title = 'Drag to reorder';
    tb.appendChild(handle);

    const num = document.createElement('span');
    num.className = 'sww-tile-num';
    num.textContent = i + 1;
    tb.appendChild(num);

    const pauseBtn = swMakeTBtn(s.paused ? 'play' : 'pause', s.paused ? 'Play' : 'Pause', () => {
      s.paused = !s.paused;
      swPostCmd(i, s.paused ? 'pauseVideo' : 'playVideo');
      pauseBtn.innerHTML = SW_ICONS[s.paused ? 'play' : 'pause'];
      pauseBtn.title = s.paused ? 'Play' : 'Pause';
    }, '', 'pause');
    tb.appendChild(pauseBtn);

    const muteBtn = swMakeTBtn(s.muted ? 'unmute' : 'mute', s.muted ? 'Unmute' : 'Mute', () => {
      s.muted = !s.muted;
      swPostCmd(i, s.muted ? 'mute' : 'unMute');
      muteBtn.innerHTML = SW_ICONS[s.muted ? 'unmute' : 'mute'];
      muteBtn.title = s.muted ? 'Unmute' : 'Mute';
    }, '', 'mute');
    tb.appendChild(muteBtn);

    const sp = document.createElement('span');
    sp.style.flex = '1';
    tb.appendChild(sp);

    tb.appendChild(swMakeTBtn('newtab', 'Open in new tab', () => {
      window.open(`https://www.youtube.com/watch?v=${safeId(s.videoId)}`, '_blank');
    }));

    tb.appendChild(swMakeTBtn('fs', 'Fullscreen', () => {
      const iframe = document.getElementById('sww-iframe-' + i);
      if (iframe) {
        const req = iframe.requestFullscreen || iframe.webkitRequestFullscreen || iframe.mozRequestFullScreen;
        if (req) req.call(iframe);
      }
    }));

    tb.appendChild(swMakeTBtn('close', 'Remove', () => {
      swStreams.splice(i, 1);
      swRenderGrid(isClone);
      swSaveStreams(isClone);
    }, 'danger'));

    tile.appendChild(tb);

    const iframe = document.createElement('iframe');
    iframe.id = 'sww-iframe-' + i;
    iframe.src = swEmbedUrl(s.videoId);
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    tile.appendChild(iframe);
    grid.appendChild(tile);
  });

  const counter = document.getElementById('sww-counter');
  if (counter) counter.textContent = `${swStreams.length} / ${SW_WALL_MAX}`;
}

function swAddStream(url, isClone) {
  const input = document.getElementById('sww-url-input');
  if (!url || !url.trim()) return;
  if (swStreams.length >= SW_WALL_MAX) { swShowToast(`Maximum ${SW_WALL_MAX} streams reached`); return; }
  const videoId = swExtractVideoId(url);
  if (!videoId) {
    if (input) { input.classList.add('error'); setTimeout(() => input.classList.remove('error'), 900); }
    swShowToast('Invalid YouTube URL');
    return;
  }
  if (swStreams.some(s => s.videoId === videoId)) {
    swShowToast('Stream already added');
    return;
  }
  swStreams.push({ videoId, paused: false, muted: false });
  swAllPaused = false;
  swUpdateToggleAllBtn();
  swRenderGrid(isClone);
  swSaveStreams(isClone);
  if (input) { input.value = ''; input.focus(); }
}

function swGoLiveAll() {
  if (!swStreams.length) return;
  swStreams.forEach((s, i) => { swPostCmd(i, 'seekTo', [99999, true]); swPostCmd(i, 'playVideo'); s.paused = false; });
  swAllPaused = false;
  swUpdateToggleAllBtn();
  document.querySelectorAll('.sww-tile').forEach(tile => {
    const pb = tile.querySelector('.sww-t-btn[data-role="pause"]');
    if (pb) { pb.innerHTML = SW_ICONS.pause; pb.title = 'Pause'; }
  });
  const btn = document.getElementById('sww-live-all-btn');
  btn.classList.add('active');
  document.getElementById('sww-live-label').textContent = 'Live';
  swShowToast('All streams jumped to live edge');
  setTimeout(() => { btn.classList.remove('active'); document.getElementById('sww-live-label').textContent = 'Go Live'; }, 3000);
}

function swOnGoal() {
  if (!swStreams.length) return;

  swStreams.forEach((s, i) => { s.paused = true; swPostCmd(i, 'pauseVideo'); });
  swAllPaused = true;
  swUpdateToggleAllBtn();
  document.querySelectorAll('.sww-tile').forEach(tile => {
    const pb = tile.querySelector('.sww-t-btn[data-role="pause"]');
    if (pb) { pb.innerHTML = SW_ICONS.play; pb.title = 'Play'; }
  });

  const videoIds = swStreams.map(s => s.videoId);
  const payload = JSON.stringify(videoIds);
  try {
    const bc = new BroadcastChannel('frfc-streamwall-goal');
    localStorage.setItem(SW_GOAL_KEY, payload);
    bc.close();
  } catch (e) {
    try { localStorage.setItem(SW_GOAL_KEY, payload); } catch (e2) {}
  }

  const base = window.location.origin + '/streamwall';
  window.open(base + '?goal=' + Date.now(), '_blank');
  swShowToast('Streams paused — new live wall opened');
}

// ── Render: Become a Creator ─────────────────────────────────────────────
function renderBecomeCreator() {
  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Free Guide</div>
            <h1 class="page-hero-title">How to Start a Football Live Streaming Channel on YouTube</h1>
            <p class="page-hero-subtitle">A free, step-by-step guide to setting up a professional YouTube watchalong channel with live scoreboards, overlays, and chat — using free tools.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="container section">
      <div class="sc-card" style="margin-bottom:24px">
        <div class="sc-body" style="padding:0;overflow:hidden">
          <div style="position:relative;aspect-ratio:16/9;width:100%;background:#000">
            ${ytFacadeHTML('RA7-Wtsk8Pg')}
          </div>
        </div>
      </div>

      <div class="tutorial-body">
        <div class="tutorial-toc">
          <div class="tutorial-toc-title">In this guide</div>
          <ol>
            <li><a href="#tut-intro">Why start a football reaction channel?</a></li>
            <li><a href="#tut-tools">The three free streaming tools you need</a></li>
            <li><a href="#tut-prism">Setting up Prism Live Studio</a></li>
            <li><a href="#tut-overlays">Creating overlays with Canva</a></li>
            <li><a href="#tut-yuno">Scoreboard &amp; live chat overlay for YouTube</a></li>
            <li><a href="#tut-golive">Going live on YouTube</a></li>
            <li><a href="#tut-tips">Tips for growing your channel</a></li>
            <li><a href="#tut-faq">FAQ</a></li>
          </ol>
        </div>

        <h2 id="tut-intro">Why Start a Football Reaction Channel?</h2>
        <p>Football live streaming and watchalongs have become one of the most popular formats on YouTube. Fan reaction channels have built massive communities around live match coverage. If you're passionate about football and want to start your own YouTube live streaming channel, the great news is you can do it today with zero budget.</p>
        <p>All you need is a computer, a webcam (even your built-in one works), a microphone, and the three free tools outlined in this guide. Whether you support a Premier League, La Liga, Serie A, Bundesliga, or Ligue 1 club — there's an audience waiting for your football fan reactions and watchalong streams.</p>

        <h2 id="tut-tools">The Three Free YouTube Live Stream Tools You Need</h2>

        <div class="tutorial-tool">
          <div class="tutorial-tool-logo">
            <img src="https://guide.prismlive.com/~gitbook/image?url=https%3A%2F%2F3567613719-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Forganizations%252FbCO3shMLhrSk9ldAM0kr%252Fsites%252Fsite_BrYGm%252Flogo%252FXToC2ZUX76co4tmjmwx7%252FPRISM%2520Live%2520Studio_logo_512x512.png%3Falt%3Dmedia%26token%3D5e61b924-c3c3-4e53-b1b8-d6c93898fbf7&width=260&dpr=3&quality=100&sign=877301fa&sv=2" alt="Prism Live Studio" onerror="this.parentNode.innerHTML='&#127916;'">
          </div>
          <div>
            <div class="tutorial-tool-name">Prism Live Studio</div>
            <div class="tutorial-tool-desc">A free streaming app that sits between StreamYard's simplicity and OBS's power. Available for Mac and Windows. Comes with built-in widgets for live chat, viewer count, and GIF stickers — no plugins needed. Includes <strong>Prism Lens</strong> for webcam management, virtual green screens, and background effects.</div>
            <a href="https://prismlive.com/en_us/" target="_blank" rel="noopener" class="tutorial-tool-link">Visit Website &rarr;</a>
          </div>
        </div>

        <div class="tutorial-tool">
          <div class="tutorial-tool-logo">
            <img src="https://yt3.googleusercontent.com/LFbmgXAoEB5oxQMNUm4kqWpallwbZVMXfFnCsH2NvB3sbOsK7EcQZblMjJR64CT-qE-O8qAokA=s900-c-k-c0x00ffffff-no-rj" alt="Uno Overlays" onerror="this.parentNode.innerHTML='&#9917;'">
          </div>
          <div>
            <div class="tutorial-tool-name">Uno Overlays</div>
            <div class="tutorial-tool-desc">Free real-time overlays purpose-built for sports streaming. Provides live scoreboards, game clocks, lineup displays, and more. The football overlays include match timers calibrated for 45-minute halves, stoppage time, extra time, and red card tracking — all controllable from your phone.</div>
            <a href="https://overlays.uno/home" target="_blank" rel="noopener" class="tutorial-tool-link">Visit Website &rarr;</a>
          </div>
        </div>

        <div class="tutorial-tool">
          <div class="tutorial-tool-logo">
            <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTGpJ8UFG03-e_wuIAfqnNlnVzUDZ-4Uxxwiw&s" alt="Canva" onerror="this.parentNode.innerHTML='&#127912;'">
          </div>
          <div>
            <div class="tutorial-tool-name">Canva</div>
            <div class="tutorial-tool-desc">The go-to tool for creating stream overlays, thumbnails, and any visual asset you need. Create transparent PNG overlays with placeholders for your webcam, chat, scoreboard, and social handles. Free tier is more than enough to get started.</div>
            <a href="https://www.canva.com/" target="_blank" rel="noopener" class="tutorial-tool-link">Visit Website &rarr;</a>
          </div>
        </div>

        <h2 id="tut-prism">Setting Up Prism Live Studio for Football Streaming</h2>
        <p>Download Prism Live Studio from their website — it's available for both Mac and Windows. Once installed, here's how to build your football watchalong streaming environment:</p>

        <h3>1. Add your camera source</h3>
        <p>Click the <strong>+</strong> button to add sources. Select your webcam, or use <strong>Prism Lens</strong> (a companion app) for virtual green screen and background effects like an animated stadium. This will be the base layer of your stream.</p>

        <h3>2. Add your overlay</h3>
        <p>Create a transparent PNG overlay in Canva with placeholders for the chat, scoreboard, lineups, and your social handles. In Prism, add it as an <strong>Image</strong> source and press <strong>Ctrl+F</strong> to snap it to full screen.</p>

        <h3>3. Add built-in widgets</h3>
        <p>Prism comes with several useful widgets out of the box — no plugins required:</p>
        <ul>
          <li><strong>Live Chat</strong> — pulls directly from your YouTube live chat with multiple layout options</li>
          <li><strong>Viewer Count</strong> — shows how many people are watching in real time</li>
          <li><strong>GIF Stickers (Giphy)</strong> — add an animated subscribe button or your club's crest as a rotating GIF</li>
        </ul>
        <p>Arrange each widget into the placeholder areas on your overlay. Lock the overlay and camera layers so they don't accidentally move.</p>

        <h2 id="tut-overlays">Creating Stream Overlays with Canva</h2>
        <p>Open Canva and create a 1920&times;1080 design (standard HD). Design your overlay with transparent areas where your webcam, chat, and scoreboard will appear. Key tips:</p>
        <ul>
          <li>Use your club's colours for branding consistency</li>
          <li>Include your X/Twitter handle, Instagram, or other social links</li>
          <li>Export as <strong>PNG with transparency</strong> (not JPG)</li>
          <li>Keep a clean layout — don't overcrowd the screen</li>
        </ul>

        <h2 id="tut-yuno">Scoreboard &amp; Live Chat Overlay for YouTube Streams</h2>
        <p>Uno Overlays provides the two most critical elements for any football watchalong: the <strong>live scoreboard</strong> and the <strong>game clock</strong>.</p>

        <h3>Finding football overlays</h3>
        <p>Uno is a US-based platform, so search for <strong>"soccer"</strong> (not "football") to find the right overlays. The soccer-specific ones include game clocks calibrated for 45-minute halves.</p>

        <h3>Customising the scoreboard</h3>
        <ul>
          <li><strong>Colours</strong> — match it to your club's kit colours</li>
          <li><strong>Team logos</strong> — upload crests in a square format so they don't get cropped</li>
          <li><strong>In-game events</strong> — add goals, substitutions, yellow cards, red cards, and VAR checks</li>
        </ul>

        <h3>Managing the game clock</h3>
        <ul>
          <li>Start from the first half, reset for halftime</li>
          <li>Always start the second half from 45:00 (not 0:00)</li>
          <li>Add stoppage time when announced</li>
          <li>Support for extra time periods if needed</li>
        </ul>

        <h3>Control from your phone</h3>
        <p>Uno generates a QR code you can scan with your phone. This gives you a mobile control panel to adjust the score, add red cards, and manage the clock — all without alt-tabbing away from your stream.</p>

        <h3>Adding to Prism</h3>
        <p>Click <strong>Copy Output URL</strong> in Uno, then in Prism add a <strong>Browser</strong> source. Paste the URL, set the dimensions to 1280×720, and press <strong>Ctrl+F</strong> for full screen. Repeat for the lineup overlay.</p>

        <h2 id="tut-golive">Going Live on YouTube</h2>
        <p>Once your environment is set up with the webcam, overlay, widgets, scoreboard, and lineups — click <strong>Go Live</strong> in Prism. Connect your YouTube channel (first-time setup walks you through it). When you're live:</p>
        <ul>
          <li>The live chat widget auto-populates with viewer comments</li>
          <li>The viewer count updates in real time</li>
          <li>Use your phone to control the scoreboard and game clock</li>
        </ul>

        <h2 id="tut-tips">Tips for Growing Your Channel</h2>
        <ul>
          <li><strong>Be consistent</strong> — stream every match day so your audience knows when to tune in</li>
          <li><strong>Start early</strong> — go live 10-15 minutes before kick-off to build the room</li>
          <li><strong>Engage the chat</strong> — read and respond to comments; it's what makes watchalongs special</li>
          <li><strong>Quality audio matters</strong> — invest in a decent microphone before upgrading anything else</li>
          <li><strong>Create clips</strong> — post reaction highlights as shorts after the match to attract new viewers</li>
          <li><strong>Cross-promote</strong> — share your stream link on X/Twitter and relevant football communities</li>
          <li><strong>Submit your channel</strong> — <a href="/submit" onclick="event.preventDefault();navigate('/submit')">add yourself to FanReactionsFC</a> so fans can discover you</li>
        </ul>

        <h2 id="tut-faq">Frequently Asked Questions</h2>
        <div class="tutorial-faq">
          <details>
            <summary>Is it free to start a football live streaming channel on YouTube?</summary>
            <p>Yes. Prism Live Studio, Uno Overlays, and Canva all have free tiers that are more than sufficient. You don't need to pay for any software to start streaming football reactions and watchalongs.</p>
          </details>
          <details>
            <summary>What equipment do I need for football live streaming?</summary>
            <p>A mid-range laptop or desktop, a webcam (even your built-in one), and a microphone. Prism Live Studio is lighter than OBS, so you don't need an expensive setup. If you experience lag, try lowering the stream resolution to 720p.</p>
          </details>
          <details>
            <summary>Can I use OBS instead of Prism Live Studio?</summary>
            <p>Absolutely. Everything in this guide (Uno Overlays, Canva overlays) works with OBS too. Prism is recommended because it's simpler for beginners and has built-in widgets that OBS requires plugins for.</p>
          </details>
          <details>
            <summary>How do I add a scoreboard and live chat overlay to my YouTube stream?</summary>
            <p>Use Uno Overlays to create a scoreboard and game clock, then add it to Prism or OBS as a browser source. The live chat widget is built into Prism Live Studio. Both integrate seamlessly with your streaming setup.</p>
          </details>
          <details>
            <summary>Can I show the football match on my live stream?</summary>
            <p>You should never rebroadcast match footage on your stream. Football watchalongs are about your <strong>reaction</strong> — your commentary, emotions, and interaction with the chat — while viewers watch the match on their own screens.</p>
          </details>
          <details>
            <summary>How many viewers do I need to start a football reaction channel?</summary>
            <p>Zero. Every football fan reaction channel starts from scratch. Even streaming to 2-3 people is valuable — those early loyal viewers become the foundation of your community.</p>
          </details>
          <details>
            <summary>Can I stream football reactions from my phone?</summary>
            <p>This guide focuses on desktop streaming for the best quality. However, you can stream directly from the YouTube mobile app for a simpler setup — you just won't have overlays, scoreboards, or the professional look.</p>
          </details>
        </div>

        <div class="tutorial-cta">
          <div class="tutorial-cta-title">Ready to start your football channel?</div>
          <p class="tutorial-cta-sub">Submit your channel to FanReactionsFC and get discovered by football fans worldwide.</p>
          <a href="/submit" class="btn btn-accent btn-pill btn-lg" onclick="event.preventDefault();navigate('/submit')">+ Submit Your Channel</a>
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;
}

// ── Feature Requests ─────────────────────────────────────────────────────
// Extracted to js/community.js (list, detail, voting, comments, follow,
// admin panel). Loaded after app.js in index.html.

// ── Footer ────────────────────────────────────────────────────────────────
function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand"><img src="/img/logo-wide.png" alt="FanReactionsFC" class="footer-logo"></div>
            <div class="footer-desc">The definitive database of football YouTubers across Europe's top leagues. Editorially curated by @fanreactionsfc.</div>
          </div>
          <div class="footer-col">
            <h4>Browse</h4>
            <a href="/discover">All Creators</a>
            <a href="/rankings">Rankings</a>
            <a href="/news">News</a>
            ${LEAGUES.slice(0, 3).map(l => `<a href="/discover?league=${encodeURIComponent(l.name)}" style="display:flex;align-items:center;gap:6px">${leagueChipImg(l.name)} ${l.name}</a>`).join('')}
          </div>
          <div class="footer-col">
            <h4>Community</h4>
            <a href="/tools/generator">Description Generator</a>
            <a href="/submit">Submit a Creator</a>
            <a href="/become-a-creator">Become a Creator</a>
            <a href="/community/features">Feature Requests</a>
            <a href="#" onclick="event.preventDefault();openModal('signin')">Sign In / Sign Up</a>
          </div>
          <div class="footer-col">
            <h4>FanReactionsFC</h4>
            <a href="https://www.youtube.com/@fanreactionsfc" target="_blank" rel="noopener">YouTube Channel</a>
            <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener">X (Twitter)</a>
            <a href="https://www.instagram.com/fanreactionsfc/" target="_blank" rel="noopener">Instagram</a>
            <a href="/streamwall">Streamwall</a>
            <a href="/contact">Contact Us</a>
          </div>
        </div>
        ${getTeams().filter(t => t && t !== 'Multi-Club / Other').length ? `
        <div class="footer-clubs">
          <h4>Clubs</h4>
          <div class="footer-club-links">
            ${getTeams().filter(t => t && t !== 'Multi-Club / Other').map(t => `<a href="${clubPath(t)}">${escHtml(t)}</a>`).join('')}
          </div>
        </div>` : ''}
        <div class="footer-bottom">
          <span>&copy; ${new Date().getFullYear()} FanReactionsFC.com</span>
          <span>${creators.length} creators &bull; Community-powered</span>
        </div>
        <div class="footer-legal">
          <a href="/privacy">Privacy Policy</a>
          <a href="/cookies">Cookie Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="#" onclick="event.preventDefault();openConsentSettings()">Cookie Preferences</a>
          <a href="#" onclick="event.preventDefault();doNotSellOptOut()">Do Not Sell or Share My Info</a>
        </div>
        <div style="text-align:center;margin-top:12px;font-size:var(--fs-xs);color:var(--text-muted)">Club crests and trademarks are the property of their respective owners and are used here for identification purposes only.</div>
      </div>
    </footer>`;
}
