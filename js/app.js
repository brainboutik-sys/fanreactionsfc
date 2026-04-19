/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC.com — SPA Application
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Supabase ──────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iq6Dv3b9IYfNktis7WeZ-g_y7_DV0gm';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ─────────────────────────────────────────────────────────────────
let creators = [];
let reviews = [];
let favorites = new Set();
let currentUser = null;
let currentProfile = null;  // frfc_user_profiles row for the signed-in user
let currentRoute = { page: 'home' };

// ── Content types ─────────────────────────────────────────────────────────
const CONTENT_TYPES = [
  'Reactions', 'Watchalong', 'Match Review', 'Tactical',
  'Banter', 'News', 'Podcast', 'Highlights', 'Fan Cam', 'Compilation'
];

// ── Leagues ───────────────────────────────────────────────────────────────
const LEAGUES = [
  { name: 'Premier League', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', code: 'PL', logo: 'https://crests.football-data.org/PL.png' },
  { name: 'La Liga', flag: '🇪🇸', code: 'LL', logo: 'https://crests.football-data.org/PD.png' },
  { name: 'Serie A', flag: '🇮🇹', code: 'SA', logo: 'https://crests.football-data.org/SA.png' },
  { name: 'Bundesliga', flag: '🇩🇪', code: 'BL', logo: 'https://crests.football-data.org/BL1.png' },
  { name: 'Ligue 1', flag: '🇫🇷', code: 'L1', logo: 'https://crests.football-data.org/FL1.png' }
];

// ── Club crests (football-data.org SVGs) ──────────────────────────────────
const TEAM_CRESTS = {
  // ── Premier League ──
  'Arsenal': 'https://crests.football-data.org/57.svg',
  'Aston Villa': 'https://crests.football-data.org/58.svg',
  'Bournemouth': 'https://crests.football-data.org/1044.svg',
  'Brighton': 'https://crests.football-data.org/397.svg',
  'Burnley': 'https://crests.football-data.org/328.svg',
  'Chelsea': 'https://crests.football-data.org/61.svg',
  'Crystal Palace': 'https://crests.football-data.org/354.svg',
  'Everton': 'https://crests.football-data.org/62.svg',
  'Fulham': 'https://crests.football-data.org/63.svg',
  'Ipswich': 'https://crests.football-data.org/349.svg',
  'Leeds United': 'https://crests.football-data.org/341.svg',
  'Leicester': 'https://crests.football-data.org/338.svg',
  'Liverpool': 'https://crests.football-data.org/64.svg',
  'Luton': 'https://crests.football-data.org/389.svg',
  'Man City': 'https://crests.football-data.org/65.svg',
  'Man United': 'https://crests.football-data.org/66.svg',
  'Newcastle': 'https://crests.football-data.org/67.svg',
  'Nottm Forest': 'https://crests.football-data.org/351.svg',
  'Sheffield Utd': 'https://crests.football-data.org/356.svg',
  'Southampton': 'https://crests.football-data.org/340.svg',
  'Tottenham': 'https://crests.football-data.org/73.svg',
  'West Ham': 'https://crests.football-data.org/563.svg',
  'Wolves': 'https://crests.football-data.org/76.svg',
  // ── La Liga ──
  'Barcelona': 'https://crests.football-data.org/81.svg',
  'Real Madrid': 'https://crests.football-data.org/86.svg',
  'Atletico Madrid': 'https://crests.football-data.org/78.svg',
  'Sevilla': 'https://crests.football-data.org/559.svg',
  'Real Betis': 'https://crests.football-data.org/90.svg',
  'Real Sociedad': 'https://crests.football-data.org/92.svg',
  'Villarreal': 'https://crests.football-data.org/94.svg',
  'Athletic Bilbao': 'https://crests.football-data.org/77.svg',
  'Valencia': 'https://crests.football-data.org/95.svg',
  'Celta Vigo': 'https://crests.football-data.org/558.svg',
  'Espanyol': 'https://crests.football-data.org/80.svg',
  'Getafe': 'https://crests.football-data.org/82.svg',
  'Osasuna': 'https://crests.football-data.org/79.svg',
  'Mallorca': 'https://crests.football-data.org/89.svg',
  'Rayo Vallecano': 'https://crests.football-data.org/87.svg',
  'Girona': 'https://crests.football-data.org/298.svg',
  'Las Palmas': 'https://crests.football-data.org/275.svg',
  'Alaves': 'https://crests.football-data.org/263.svg',
  'Valladolid': 'https://crests.football-data.org/250.svg',
  'Leganes': 'https://crests.football-data.org/745.svg',
  // ── Serie A ──
  'Juventus': 'https://crests.football-data.org/109.svg',
  'AC Milan': 'https://crests.football-data.org/98.svg',
  'Inter Milan': 'https://crests.football-data.org/108.svg',
  'Napoli': 'https://crests.football-data.org/113.png',
  'Roma': 'https://crests.football-data.org/100.svg',
  'Lazio': 'https://crests.football-data.org/110.svg',
  'Atalanta': 'https://crests.football-data.org/102.svg',
  'Fiorentina': 'https://crests.football-data.org/99.svg',
  'Bologna': 'https://crests.football-data.org/103.svg',
  'Torino': 'https://crests.football-data.org/586.svg',
  'Udinese': 'https://crests.football-data.org/115.svg',
  'Monza': 'https://crests.football-data.org/5890.svg',
  'Empoli': 'https://crests.football-data.org/445.svg',
  'Genoa': 'https://crests.football-data.org/107.svg',
  'Cagliari': 'https://crests.football-data.org/104.svg',
  'Lecce': 'https://crests.football-data.org/5911.svg',
  'Hellas Verona': 'https://crests.football-data.org/450.svg',
  'Parma': 'https://crests.football-data.org/112.svg',
  'Venezia': 'https://crests.football-data.org/454.svg',
  'Como': 'https://crests.football-data.org/472.svg',
  // ── Bundesliga ──
  'Bayern Munich': 'https://crests.football-data.org/5.svg',
  'Borussia Dortmund': 'https://crests.football-data.org/4.svg',
  'RB Leipzig': 'https://crests.football-data.org/721.svg',
  'Bayer Leverkusen': 'https://crests.football-data.org/3.svg',
  'Union Berlin': 'https://crests.football-data.org/28.svg',
  'Freiburg': 'https://crests.football-data.org/17.svg',
  'Eintracht Frankfurt': 'https://crests.football-data.org/19.svg',
  'Wolfsburg': 'https://crests.football-data.org/11.svg',
  'Mainz': 'https://crests.football-data.org/15.svg',
  'Borussia Monchengladbach': 'https://crests.football-data.org/18.svg',
  'Hoffenheim': 'https://crests.football-data.org/2.svg',
  'Werder Bremen': 'https://crests.football-data.org/12.svg',
  'Augsburg': 'https://crests.football-data.org/16.svg',
  'Bochum': 'https://crests.football-data.org/36.svg',
  'Heidenheim': 'https://crests.football-data.org/44.svg',
  'Stuttgart': 'https://crests.football-data.org/10.svg',
  'Holstein Kiel': 'https://crests.football-data.org/720.svg',
  'St. Pauli': 'https://crests.football-data.org/20.svg',
  // ── Ligue 1 ──
  'PSG': 'https://crests.football-data.org/524.svg',
  'Marseille': 'https://crests.football-data.org/516.svg',
  'Lyon': 'https://crests.football-data.org/523.svg',
  'Monaco': 'https://crests.football-data.org/548.svg',
  'Lille': 'https://crests.football-data.org/521.svg',
  'Nice': 'https://crests.football-data.org/522.svg',
  'Rennes': 'https://crests.football-data.org/529.svg',
  'Lens': 'https://crests.football-data.org/546.svg',
  'Strasbourg': 'https://crests.football-data.org/576.svg',
  'Nantes': 'https://crests.football-data.org/543.svg',
  'Montpellier': 'https://crests.football-data.org/518.svg',
  'Toulouse': 'https://crests.football-data.org/511.svg',
  'Brest': 'https://crests.football-data.org/512.svg',
  'Reims': 'https://crests.football-data.org/547.svg',
  'Le Havre': 'https://crests.football-data.org/545.svg',
  'Auxerre': 'https://crests.football-data.org/519.svg',
  'Angers': 'https://crests.football-data.org/532.svg',
  'Saint-Etienne': 'https://crests.football-data.org/527.svg'
};

// ── Team → League mapping ─────────────────────────────────────────────────
const TEAM_TO_LEAGUE = {};
(function buildLeagueMap() {
  const map = {
    'Premier League': ['Arsenal','Aston Villa','Bournemouth','Brighton','Burnley','Chelsea','Crystal Palace','Everton','Fulham','Ipswich','Leeds United','Leicester','Liverpool','Luton','Man City','Man United','Newcastle','Nottm Forest','Sheffield Utd','Southampton','Tottenham','West Ham','Wolves'],
    'La Liga': ['Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes'],
    'Serie A': ['Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como'],
    'Bundesliga': ['Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli'],
    'Ligue 1': ['PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne']
  };
  for (const [league, teams] of Object.entries(map)) {
    teams.forEach(t => TEAM_TO_LEAGUE[t] = league);
  }
})();

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

// ── Theme ─────────────────────────────────────────────────────────────────
function initTheme() { /* light-only, no toggle needed */ }

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

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  showLoading();
  await loadCreators();
  await refreshAuth();
  sb.auth.onAuthStateChange(() => refreshAuth());
  handleRoute();
  window.addEventListener('popstate', handleRoute);
  initSearch();
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
    <div class="container" style="padding:60px 20px;text-align:center">
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
  const links = { navHome: '/', navDiscover: '/discover', navRankings: '/rankings' };
  Object.entries(links).forEach(([id, prefix]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const isActive = prefix === '/' ? (path === '/' || path === '/index.html') : path.startsWith(prefix);
    el.classList.toggle('active', isActive);
  });
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
  if (typeof Gen !== 'undefined' && Gen.cleanup) Gen.cleanup();
  window.scrollTo(0, 0);

  // Update nav active state
  updateNavActive(path);

  try {
    if (path === '/' || path === '/index.html') {
      currentRoute = { page: 'home' };
      renderHome();
    } else if (path === '/discover' || path.startsWith('/discover')) {
      currentRoute = { page: 'discover', params: new URLSearchParams(location.search) };
      renderDiscover();
    } else if (path.startsWith('/creators/')) {
      const slug = path.split('/creators/')[1].replace(/\/$/, '');
      currentRoute = { page: 'profile', slug };
      renderProfile(slug);
    } else if (path.startsWith('/clubs/')) {
      const tail = path.split('/clubs/')[1].replace(/\/$/, '');
      // /clubs/:team/videos -> team videos page; otherwise the club page
      if (tail.endsWith('/videos')) {
        const club = decodeURIComponent(tail.slice(0, -'/videos'.length));
        currentRoute = { page: 'clubVideos', club };
        renderClubVideos(club);
      } else {
        const club = decodeURIComponent(tail);
        currentRoute = { page: 'club', club };
        renderClubPage(club);
      }
    } else if (path === '/rankings') {
      currentRoute = { page: 'rankings' };
      renderRankings();
    } else if (path === '/tools/generator') {
      currentRoute = { page: 'generator' };
      renderGenerator();
    } else if (path === '/submit') {
      currentRoute = { page: 'submit' };
      renderSubmit();
    } else if (path === '/account') {
      currentRoute = { page: 'account' };
      renderAccount();
    } else if (path.startsWith('/admin')) {
      currentRoute = { page: 'admin' };
      renderAdmin();
    } else {
      // Unknown route — show a 404 rather than falling back to Home
      // silently, which used to make broken links feel invisible.
      currentRoute = { page: 'notfound' };
      app.innerHTML = `
        <div class="container" style="padding:60px 20px;text-align:center">
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
      <div class="container" style="padding:60px 20px;text-align:center">
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
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (href.startsWith('/') && !href.startsWith('//') && !a.hasAttribute('target')) {
    e.preventDefault();
    navigate(href);
  }
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
      ${displayName ? `<div style="font-size:.88rem;font-weight:600;color:var(--text)">${escHtml(displayName)}</div>` : ''}
      <div style="font-size:.78rem;color:var(--text-dim)">${escHtml(currentUser.email)}</div>
    </div>
    <a href="/account" style="display:block;padding:8px 16px;font-size:.85rem;color:var(--text)">Account settings</a>
    <a href="/tools/generator" style="display:block;padding:8px 16px;font-size:.85rem;color:var(--text)">Description Generator</a>
    <a href="/admin" style="display:block;padding:8px 16px;font-size:.85rem;color:var(--text)">Admin Panel</a>
    <button onclick="signOut()" style="display:block;width:100%;text-align:left;padding:8px 16px;font-size:.85rem;color:var(--accent);background:none;border:none;border-top:1px solid var(--border)">Sign Out</button>`;
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

async function signUp(email, password) {
  const { error } = await sb.auth.signUp({ email, password });
  if (error) return error.message;
  return null;
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null;
  favorites = new Set();
  updateAuthUI();
  handleRoute();
}

// ── Data loading ──────────────────────────────────────────────────────────
async function loadCreators() {
  const { data, error } = await sb.from('frfc_streamers').select('*').order('team').order('name');
  if (error) { creators = []; return; }
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
    claimed: !!r.claimed_by,
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
    avgRatingPrev: r.avg_rating_prev != null ? Number(r.avg_rating_prev) : 0,
    avgRating: 0,
    ratingCount: 0
  }));
  // Load ratings
  const { data: revs } = await sb.from('frfc_reviews').select('creator_id, rating');
  if (revs && revs.length) {
    const map = {};
    revs.forEach(r => {
      if (!map[r.creator_id]) map[r.creator_id] = [];
      map[r.creator_id].push(r.rating);
    });
    creators.forEach(c => {
      const ratings = map[c.id];
      if (ratings) {
        c.avgRating = +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1);
        c.ratingCount = ratings.length;
      }
    });
  }
  updateLiveCountChip();
}

async function loadFavorites() {
  if (!currentUser) return;
  try {
    const { data, error } = await sb.from('frfc_streamer_favorites').select('streamer_id').eq('user_id', currentUser.id);
    if (error) return;
    favorites = new Set((data || []).map(r => r.streamer_id));
  } catch (e) { /* favorites load failed — non-critical */ }
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
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function safeId(s) { return (s || '').replace(/[^A-Za-z0-9_-]/g, ''); }
function safeUrl(s) { try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
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
function stars(n, max = 5) { return Array.from({ length: max }, (_, i) => `<span class="star ${i < Math.round(n) ? 'filled' : ''}">★</span>`).join(''); }
function avatarUrl(c) { return c.avatar || ''; }
function avatarInitials(name) { return (name || '?').split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase(); }
function avatarOnerror(img, name) { img.onerror=null; img.style.display='none'; const el=document.createElement('div'); el.className=img.className+' avatar-fallback'; el.textContent=avatarInitials(name); img.parentNode.insertBefore(el,img); }
function avatarImg(c, cls = 'cc-avatar') {
  const url = avatarUrl(c);
  if (!url) return `<div class="${cls} avatar-fallback">${avatarInitials(c.name)}</div>`;
  return `<img class="${cls}" src="${url}" alt="" loading="lazy" onerror="avatarOnerror(this,'${escHtml(c.name.replace(/'/g, "\\'"))}')">`;
}
function creatorLink(c) { return `/creators/${c.slug || slugify(c.name)}`; }

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  const cc = code.toLowerCase();
  const up = code.toUpperCase();
  // Use flagcdn.com SVG instead of Unicode flag emoji — Windows Chrome/Edge
  // don't render flag emojis and fall back to showing the country code.
  return `<img src="https://flagcdn.com/${cc}.svg" alt="${up}" title="${up}" class="country-flag">`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
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

  if (!creatorMatches.length && !clubMatches.length) {
    box.innerHTML = '<div class="search-empty">No results found</div>';
    box.classList.add('open');
    return;
  }

  let html = '';
  if (creatorMatches.length) {
    html += '<div class="search-group-head">Creators</div>';
    html += creatorMatches.map(c => `
      <a href="${creatorLink(c)}" class="search-result">
        ${avatarImg(c, 'cc-avatar')}
        <div class="sr-info">
          <div class="sr-name">${liveDot(c.isLive)}${escHtml(c.name)}</div>
          <div class="sr-team">${escHtml(c.team)}</div>
        </div>
        ${c.avgRating > 0 ? `<span class="sr-meta">&#9733; ${c.avgRating}</span>` : ''}
      </a>`).join('');
  }
  if (clubMatches.length) {
    html += '<div class="search-group-head">Clubs</div>';
    html += clubMatches.map(([team, count]) => `
      <a href="/clubs/${encodeURIComponent(team)}" class="search-result">
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
  const topRated = [...creators].filter(c => c.ratingCount > 0).sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount).slice(0, 10);
  const topByRating = [...creators].sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount).slice(0, 8);
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

  document.getElementById('app').innerHTML = `
    <!-- Hero -->
    <section class="hero">
      <div class="container">
        <h1>Discover the best football<br>creators on <span class="accent">YouTube</span></h1>
        <p class="subtitle">Rated by fans. Ranked weekly. The definitive database of football YouTubers.</p>
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
          ${['Watchalongs', 'Reactions', 'Tactical'].map(t =>
            `<span class="chip" onclick="navigate('/discover?q=${encodeURIComponent(t)}')">${t}</span>`
          ).join('')}
        </div>
      </div>
    </section>

    <!-- Live Now -->
    ${liveNow.length ? `
    <section class="section" style="padding-top:0;padding-bottom:0">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title"><span class="live-dot-sm"></span> Live Now <span class="live-count">${liveNow.length}</span></h2>
          ${liveNow.length > 4 ? '<a href="/discover?live=1" class="section-link">View all &rarr;</a>' : ''}
        </div>
        <div class="live-strip">
          ${liveNow.map(c => `
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
    </section>` : ''}

    <!-- FRFC Channel banner -->
    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="frfc-banner">
          <div class="frfc-banner-logo-wrap">
            <img src="/img/logo.png" alt="FanReactionsFC" class="frfc-banner-logo" onerror="this.parentNode.style.display='none'">
          </div>
          <div class="frfc-banner-main">
            <div class="frfc-banner-eyebrow">Curated by</div>
            <div class="frfc-banner-title">@fanreactionsfc</div>
            <div class="frfc-banner-desc">Post-match fan reactions, compilation videos, and rankings every matchday. The editorial voice behind this platform.</div>
            <div class="frfc-banner-stats">
              <div class="frfc-stat"><b>${creators.length}</b>creators tracked</div>
              <div class="frfc-stat"><b>${getLeagues().length}</b>leagues covered</div>
              <div class="frfc-stat"><b>Every 5 min</b>live status</div>
            </div>
          </div>
          <div class="frfc-banner-cta">
            <a href="https://www.youtube.com/@fanreactionsfc?sub_confirmation=1" target="_blank" rel="noopener" class="btn btn-yellow">&#9654; Subscribe on YouTube</a>
            <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener" class="btn-banner-secondary">Follow on X</a>
          </div>
        </div>
      </div>
    </section>

    <!-- Upcoming streams -->
    ${upcoming.length ? `
    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">&#128197; Upcoming streams</h2>
        </div>
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
    </section>` : ''}

    <!-- Top Rated -->
    ${topRated.length ? `
    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">Top Rated Creators</h2>
          <a href="/rankings" class="section-link">View all rankings &rarr;</a>
        </div>
        <div class="trending-list">
          ${topRated.map((c, i) => `
            <a href="${creatorLink(c)}" class="trending-row">
              <span class="trending-rank">${i + 1}</span>
              ${avatarImg(c, 'trending-avatar')}
              <div class="trending-info">
                <div class="trending-name">${liveDot(c.isLive)}${escHtml(c.name)} ${c.verified ? '<span style="color:var(--blue);font-size:.8rem">&#10003;</span>' : ''}</div>
                <div class="trending-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
              </div>
              <div class="trending-score">${stars(c.avgRating)} <span style="color:var(--text-dim);font-weight:400;font-size:.78rem">(${c.ratingCount})</span></div>
            </a>
          `).join('')}
        </div>
      </div>
    </section>` : ''}

    <!-- Top Clubs -->
    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">Top Clubs</h2>
          <a href="/discover" class="section-link">View all &rarr;</a>
        </div>
        <div class="club-filter-row">
          <span class="chip club-filter active" onclick="filterClubs(this,'')">All leagues</span>
          ${LEAGUES.map(l => `<span class="chip club-filter" onclick="filterClubs(this,'${escHtml(l.name)}')"><img src="${l.logo}" alt="" class="chip-league-logo" onerror="this.style.display='none'"> ${escHtml(l.name)}</span>`).join('')}
        </div>
        <div class="club-grid" id="topClubsGrid">
          ${allClubs.map(({ team, count, league }) => {
            return `<a href="/clubs/${encodeURIComponent(team)}" class="club-tile" data-league="${escHtml(league || '')}">
              ${crestImg(team)}
              <div class="club-name">${escHtml(team)}</div>
              <div class="club-meta"><strong>${count} creator${count !== 1 ? 's' : ''}</strong></div>
            </a>`;
          }).join('')}
        </div>
      </div>
    </section>

    <!-- Top Creators -->
    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">Top Creators</h2>
          <div style="display:flex;align-items:center;gap:12px">
            <a href="/submit" class="btn btn-secondary btn-sm" style="font-size:.72rem">+ Suggest</a>
            <a href="/discover?sort=rating" class="section-link">Browse all &rarr;</a>
          </div>
        </div>
        <div class="top-creators-tabs">
          <button class="top-creators-tab active" onclick="switchTopCreators('subs',this)">By Subscribers</button>
          <button class="top-creators-tab" onclick="switchTopCreators('rating',this)">By Rating</button>
        </div>
        <div class="card-grid" id="topCreatorsGrid">
          ${topBySubs.map(c => creatorCard(c)).join('')}
        </div>
      </div>
    </section>

    ${renderFooter()}
  `;

  // Cap Top Clubs to ~2 rows on initial render (matches filterClubs MAX_VISIBLE).
  const defaultClubFilter = document.querySelector('.club-filter.active');
  if (defaultClubFilter) filterClubs(defaultClubFilter, '');
}

function switchTopCreators(mode, btn) {
  document.querySelectorAll('.top-creators-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const grid = document.getElementById('topCreatorsGrid');
  let list;
  if (mode === 'subs') {
    list = [...creators].filter(c => c.subscriberCount > 0).sort((a, b) => b.subscriberCount - a.subscriberCount).slice(0, 8);
  } else {
    list = [...creators].sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount).slice(0, 8);
  }
  grid.innerHTML = list.map(c => creatorCard(c)).join('');
}

// Filter Top Clubs tiles by league, capping visible tiles to ~2 rows.
function filterClubs(el, league) {
  document.querySelectorAll('.club-filter').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const tiles = document.querySelectorAll('#topClubsGrid .club-tile');
  const MAX_VISIBLE = 18;
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
        ${c.ratingCount > 0 ? `<span class="cc-rating">★ ${c.avgRating} <span class="cc-rating-count">(${c.ratingCount})</span></span>` : ''}
        ${subsStr ? `<span class="cc-subs">${subsStr}</span>` : ''}
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
  const sort = params.get('sort') || 'name';
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

  if (sort === 'rating') filtered.sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);
  else if (sort === 'reviews') filtered.sort((a, b) => b.ratingCount - a.ratingCount);
  else if (sort === 'subs') filtered.sort((a, b) => b.subscriberCount - a.subscriberCount);
  else filtered.sort((a, b) => a.name.localeCompare(b.name));

  // Build accordion: which league should be open?
  const openLeague = leagueFilter || (teamFilter ? getLeague(teamFilter) : '');

  document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:32px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap">
        <div>
          <h1 style="font-size:1.6rem;font-weight:800;margin-bottom:4px">Discover Creators</h1>
          <p style="color:var(--text-dim);font-size:.9rem">${creators.length} creators across ${activeLeagues.length} leagues and ${teams.length} clubs</p>
        </div>
        <a href="/submit" class="btn btn-secondary btn-sm">+ Suggest a Creator</a>
      </div>

      <div class="discover-layout">
        <!-- Left sidebar: League/Club accordion -->
        <aside class="filter-sidebar" id="filterSidebar">
          <div class="league-accordion">
            <div class="league-acc-item">
              <div class="league-acc-header ${!leagueFilter && !teamFilter ? 'active' : ''}" onclick="applyFilter('league','')">
                <span style="font-size:.9rem">⚽</span> All Leagues
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
                  <div class="league-acc-header ${leagueFilter === l.name && !teamFilter ? 'active' : ''} ${isOpen ? 'open' : ''}" onclick="toggleAccordion(this, '${escHtml(l.name)}')">
                    <img src="${l.logo}" alt="" class="acc-league-logo" onerror="this.style.display='none'"> ${escHtml(l.name)}
                    <span class="acc-count">${cnt}</span>
                    <span class="acc-arrow">&#9654;</span>
                  </div>
                  <div class="league-acc-body ${isOpen ? 'open' : ''}">
                    ${allLeagueTeams.map(t => {
                      const tCnt = creators.filter(c => c.team === t).length;
                      return `<div class="acc-club ${teamFilter === t ? 'active' : ''}" onclick="applyFilter('team','${escHtml(t)}')">${crestImg(t, 'crest-sm')} ${escHtml(t)} <span class="count">${tCnt || ''}</span></div>`;
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
            <span class="filter-chip ${favOnly ? 'active' : ''}" onclick="applyFilter('favs','${favOnly ? '' : '1'}')">&#9733; Favorites${favOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>
            <span class="filter-chip ${sort === 'rating' ? 'active' : ''}" onclick="applyFilter('sort','${sort === 'rating' ? 'name' : 'rating'}')">&#127942; Top Rated</span>
            <span class="filter-chip ${sort === 'subs' ? 'active' : ''}" onclick="applyFilter('sort','${sort === 'subs' ? 'name' : 'subs'}')">&#128200; Most Subs</span>
            <span class="filter-chip ${activeOnly ? 'active' : ''}" onclick="applyFilter('active','${activeOnly ? '' : '1'}')">&#9889; Active (30d)${activeOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>
            ${creators.some(c => c.isLive) ? `<span class="filter-chip ${liveOnly ? 'active' : ''}" onclick="applyFilter('live','${liveOnly ? '' : '1'}')"><span class="live-dot-sm"></span> Live Now${liveOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>` : ''}
            <span class="bar-sep"></span>
            <span class="bar-label">Type</span>
            ${CONTENT_TYPES.slice(0, 6).map(t =>
              `<span class="filter-chip ${typeFilter === t ? 'active' : ''}" onclick="applyFilter('type','${typeFilter === t ? '' : t}')">${t}${typeFilter === t ? ' <span class=chip-x>&times;</span>' : ''}</span>`
            ).join('')}
          </div>

          <!-- Active filters + result count -->
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <span class="discover-result-count">${filtered.length} creator${filtered.length !== 1 ? 's' : ''}</span>
            ${leagueFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('league','')">${leagueChipImg(leagueFilter)} ${escHtml(leagueFilter)} &times;</span>` : ''}
            ${teamFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('team','')">${escHtml(teamFilter)} &times;</span>` : ''}
            ${typeFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('type','')">${escHtml(typeFilter)} &times;</span>` : ''}
            ${favOnly ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('favs','')">Favorites &times;</span>` : ''}
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

// ── Render: Creator Profile ───────────────────────────────────────────────
async function renderProfile(slug) {
  const c = creators.find(cr => (cr.slug || slugify(cr.name)) === slug);
  if (!c) {
    document.getElementById('app').innerHTML = '<div class="container" style="padding-top:60px"><div class="empty-state"><div class="es-title">Creator not found</div><a href="/discover" class="btn btn-primary" style="margin-top:12px">Browse creators</a></div></div>';
    return;
  }

  // Load reviews for this creator
  const { data: revData } = await sb.from('frfc_reviews').select('*').eq('creator_id', c.id).order('created_at', { ascending: false });
  reviews = revData || [];

  // Enrich reviews with reviewer profiles (display_name + avatar_url).
  // Uses a single batched fetch with a user_id IN(...) filter.
  const reviewerIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))];
  const profiles = {};
  if (reviewerIds.length) {
    try {
      const ids = reviewerIds.map(encodeURIComponent).join(',');
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/frfc_user_profiles?select=user_id,display_name,avatar_url,reviews_public&user_id=in.(${ids})`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (pRes.ok) (await pRes.json()).forEach(p => { profiles[p.user_id] = p; });
    } catch {}
  }
  // Hide reviews whose author has opted out of public display.
  reviews = reviews.filter(r => {
    const p = profiles[r.user_id];
    return !p || p.reviews_public !== false;
  });

  const isFav = favorites.has(c.id);
  const similar = creators.filter(s => s.team === c.team && s.id !== c.id).slice(0, 4);

  // Rating distribution
  const dist = [0, 0, 0, 0, 0];
  reviews.forEach(r => dist[r.rating - 1]++);
  const maxDist = Math.max(...dist, 1);

  document.getElementById('app').innerHTML = `
    <div class="profile-header">
      <div class="container">
        <div class="profile-top">
          ${avatarImg(c, 'profile-avatar')}
          <div class="profile-info">
            <h1 class="profile-name">
              ${liveDot(c.isLive)}${escHtml(c.name)}
              ${c.verified ? '<span class="badge badge-green">Verified</span>' : ''}
              ${c.claimed ? '<span class="badge badge-dim">Claimed</span>' : ''}
            </h1>
            <div class="profile-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
            ${c.description ? `<div class="profile-desc">${escHtml(c.description)}</div>` : ''}
            <div class="profile-actions">
              ${c.channel ? `<a href="${safeUrl(c.channel)}" target="_blank" rel="noopener" class="btn btn-primary">Watch on YouTube</a>` : ''}
              ${c.live ? `<a href="${safeUrl(c.live)}" target="_blank" rel="noopener" class="btn btn-secondary">Live / Streams</a>` : ''}
              <button class="btn btn-secondary" onclick="handleFavorite('${c.id}')" id="favBtn">${isFav ? '&#9733; Favorited' : '&#9734; Favorite'}</button>
              <button class="btn btn-ghost btn-sm report-link" onclick="openReportModal('${c.id}','${escHtml(c.name).replace(/'/g, "\\'")}')">Report issue</button>
            </div>
          </div>
        </div>
        <div class="profile-stats">
          <div class="ps-item">
            <div class="ps-num" style="color:var(--star)">${c.avgRating > 0 ? c.avgRating : '—'}</div>
            <div class="ps-label">Avg Rating</div>
          </div>
          <div class="ps-item">
            <div class="ps-num">${c.ratingCount}</div>
            <div class="ps-label">Reviews</div>
          </div>
          ${c.subscriberCount ? `<div class="ps-item"><div class="ps-num">${formatNum(c.subscriberCount)} <span id="subGrowth" class="ps-growth"></span></div><div class="ps-label">Subscribers</div></div>` : ''}
          ${c.totalViews ? `<div class="ps-item"><div class="ps-num">${formatNum(c.totalViews)}</div><div class="ps-label">Total Views</div></div>` : ''}
          ${c.videoCount ? `<div class="ps-item"><div class="ps-num">${formatNum(c.videoCount)}</div><div class="ps-label">Videos</div></div>` : ''}
          ${c.uploadFrequency && c.uploadFrequency !== 'Unknown' ? `<div class="ps-item"><div class="ps-num ps-num-sm">${c.uploadFrequency}</div><div class="ps-label">Uploads</div></div>` : ''}
          ${c.channelCreatedAt ? `<div class="ps-item"><div class="ps-num ps-num-sm">${channelYear(c.channelCreatedAt)}</div><div class="ps-label">Channel</div></div>` : ''}
          ${c.channelCountry ? `<div class="ps-item"><div class="ps-num ps-num-sm">${countryFlag(c.channelCountry)}</div><div class="ps-label">Based in</div></div>` : ''}
        </div>
        ${c.subscriberCount ? '<div id="subSparkline" class="sub-sparkline-wrap"></div>' : ''}
      </div>
    </div>

    <div class="container" style="padding-top:24px">
      ${c.isLive ? `
      <div class="live-banner">
        <span class="live-dot-sm"></span> <strong>${escHtml(c.name)} is live now</strong>
        <a href="https://youtube.com/watch?v=${safeId(c.liveVideoId)}" target="_blank" rel="noopener" class="btn btn-sm" style="background:var(--red);color:#fff;margin-left:auto">Watch Live</a>
      </div>` : ''}

      ${c.latestVideoId ? `
      <div class="latest-video-section">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:12px">Latest Video</h3>
        <a href="https://youtube.com/watch?v=${safeId(c.latestVideoId)}" target="_blank" rel="noopener" class="latest-video-card">
          <img src="${c.latestVideoThumbnail || ''}" alt="" class="lv-thumb" loading="lazy">
          <div class="lv-info">
            <div class="lv-title">${escHtml(c.latestVideoTitle || '')}</div>
            <div class="lv-meta">${c.latestVideoViews ? formatNum(c.latestVideoViews) + ' views' : ''} ${c.latestVideoDate ? '&middot; ' + timeAgo(c.latestVideoDate) : ''}</div>
          </div>
        </a>
      </div>` : ''}

      <!-- Rating distribution + write review -->
      <div class="profile-rating-grid">
        <div>
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:12px">Ratings</h3>
          <div class="rating-dist">
            ${[5,4,3,2,1].map(n => `
              <div class="rd-row">
                <span class="rd-label">${n}</span>
                <div class="rd-bar"><div class="rd-fill" style="width:${(dist[n-1]/maxDist*100)}%"></div></div>
                <span class="rd-count">${dist[n-1]}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div>
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:12px">Rate this creator</h3>
          ${currentUser ? `
            <div class="star-row" id="rateStars" style="margin-bottom:12px">
              ${[1,2,3,4,5].map(n => `<span class="star" data-val="${n}" onclick="setRating(${n})" onmouseenter="hoverRating(${n})" onmouseleave="resetRatingHover()">★</span>`).join('')}
            </div>
            <textarea id="reviewText" placeholder="Write your review (optional)..." style="width:100%;padding:10px 14px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-input);color:var(--text);font-size:.88rem;resize:vertical;min-height:80px;margin-bottom:10px"></textarea>
            <button class="btn btn-primary btn-sm" onclick="submitReview('${c.id}')">Submit Review</button>
            <div id="reviewMsg" style="font-size:.8rem;color:var(--red);margin-top:6px"></div>
          ` : `
            <p style="color:var(--text-dim);font-size:.88rem;margin-bottom:12px">Sign in to rate and review this creator.</p>
            <button class="btn btn-primary btn-sm" onclick="openModal('signin')">Sign In</button>
          `}
        </div>
      </div>

      <!-- Reviews list -->
      <div style="margin-bottom:32px">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:12px">Reviews (${reviews.length})</h3>
        ${reviews.length ? reviews.map(r => {
          const p = profiles[r.user_id];
          const name = (p && p.display_name) || 'Fan';
          const avatar = p && p.avatar_url
            ? `<img class="review-avatar" src="${escHtml(p.avatar_url)}" alt="">`
            : `<div class="review-avatar">${escHtml(avatarInitials(name))}</div>`;
          return `
          <div class="review">
            <div class="review-head">
              ${avatar}
              <span class="review-user">${escHtml(name)}</span>
              <span class="review-date">${new Date(r.created_at).toLocaleDateString()}</span>
              <span class="review-stars">${stars(r.rating)}</span>
            </div>
            ${r.review_text ? `<div class="review-text">${escHtml(r.review_text)}</div>` : ''}
          </div>`;
        }).join('') : '<div style="color:var(--text-dim);font-size:.88rem">No reviews yet. Be the first to rate this creator!</div>'}
      </div>

      ${!c.claimed ? `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:32px;text-align:center">
        <div style="font-size:.95rem;font-weight:700;margin-bottom:4px">Is this your channel?</div>
        <div style="color:var(--text-dim);font-size:.82rem;margin-bottom:12px">Claim your profile to manage your bio, respond to reviews, and access analytics.</div>
        <button class="btn btn-secondary btn-sm" onclick="alert('Creator claim flow coming soon. Contact @fanreactionsfc on YouTube.')">Claim this profile</button>
      </div>` : ''}

      <!-- Similar creators -->
      ${similar.length ? `
      <div style="margin-bottom:32px">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:12px">More ${escHtml(c.team)} creators</h3>
        <div class="card-grid">${similar.map(s => creatorCard(s)).join('')}</div>
      </div>` : ''}
      <a href="/submit" class="suggest-cta"><span class="suggest-icon">+</span> Know a great ${escHtml(c.team)} creator we should add? Suggest them here</a>
    </div>
    ${renderFooter()}
  `;

  selectedRating = 0;

  // Async: load subscriber history for growth delta + sparkline
  if (c.subscriberCount) {
    loadSubscriberHistory(c.id).then(series => {
      if (!series.length) return;
      if (series.length >= 2) {
        const growth = series[series.length - 1].subscriber_count - series[0].subscriber_count;
        const el = document.getElementById('subGrowth');
        if (el) {
          const dir = growth >= 0 ? 'up' : 'down';
          el.className = 'ps-growth ' + dir;
          el.textContent = (growth >= 0 ? '+' : '') + formatNum(Math.abs(growth));
        }
      }
      const sparkEl = document.getElementById('subSparkline');
      if (sparkEl) {
        const svg = subscriberSparkline(series);
        if (svg) sparkEl.innerHTML = `<div class="sub-sparkline-label">Last 30 days</div>${svg}`;
      }
    });
  }
}

let selectedRating = 0;
function setRating(n) { selectedRating = n; updateStars(n); }
function hoverRating(n) { updateStars(n); }
function resetRatingHover() { updateStars(selectedRating); }
function updateStars(n) {
  document.querySelectorAll('#rateStars .star').forEach(s => {
    s.classList.toggle('filled', +s.dataset.val <= n);
  });
}

async function submitReview(creatorId) {
  const msg = document.getElementById('reviewMsg');
  if (!selectedRating) { msg.textContent = 'Please select a rating.'; return; }
  const text = document.getElementById('reviewText')?.value.trim() || null;
  const { error } = await sb.from('frfc_reviews').upsert({
    creator_id: creatorId, user_id: currentUser.id, rating: selectedRating, review_text: text, updated_at: new Date().toISOString()
  }, { onConflict: 'creator_id,user_id' });
  if (error) { msg.textContent = error.message; return; }
  msg.textContent = 'Review submitted! Thank you.';
  msg.style.color = 'var(--green)';
  await loadCreators();
  setTimeout(() => renderProfile(currentRoute.slug), 800);
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

async function handleFavorite(id) {
  await toggleFavorite(id);
  const btn = document.getElementById('favBtn');
  if (btn) btn.innerHTML = favorites.has(id) ? '&#9733; Favorited' : '&#9734; Favorite';
}

// ── Render: Club Page ─────────────────────────────────────────────────────
function renderClubPage(club) {
  const params = new URLSearchParams(location.search);
  const sort = params.get('sort') || 'subs';
  let clubCreators = creators.filter(c => c.team === club);

  if (sort === 'name') clubCreators.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'rating') clubCreators.sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);
  else if (sort === 'recent') clubCreators.sort((a, b) => new Date(b.latestVideoDate || 0) - new Date(a.latestVideoDate || 0));
  else clubCreators.sort((a, b) => b.subscriberCount - a.subscriberCount);

  const clubLeague = getLeague(club);
  const leagueInfo = LEAGUES.find(l => l.name === clubLeague);
  const clubUrl = '/clubs/' + encodeURIComponent(club);

  document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:40px">
      <a href="/discover${clubLeague !== 'Other' ? '?league=' + encodeURIComponent(clubLeague) : ''}" style="font-size:.82rem;color:var(--text-dim);display:inline-block;margin-bottom:12px">&larr; ${clubLeague !== 'Other' ? escHtml(clubLeague) : 'All clubs'}</a>
      <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:12px">${crestImg(club, 'crest-xl')} ${escHtml(club)}</h1>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:16px;display:flex;align-items:center;gap:6px">${leagueInfo ? leagueChipImg(clubLeague) : ''} ${escHtml(clubLeague)} &bull; ${clubCreators.length} creator${clubCreators.length !== 1 ? 's' : ''}</p>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div class="top-creators-tabs">
          <button class="top-creators-tab ${sort === 'subs' ? 'active' : ''}" onclick="navigate('${clubUrl}?sort=subs')">By Subscribers</button>
          <button class="top-creators-tab ${sort === 'name' ? 'active' : ''}" onclick="navigate('${clubUrl}?sort=name')">A&ndash;Z</button>
          <button class="top-creators-tab ${sort === 'rating' ? 'active' : ''}" onclick="navigate('${clubUrl}?sort=rating')">By Rating</button>
          <button class="top-creators-tab ${sort === 'recent' ? 'active' : ''}" onclick="navigate('${clubUrl}?sort=recent')">Latest Upload</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/clubs/${encodeURIComponent(club)}/videos" class="btn btn-secondary btn-sm">📺 Latest videos</a>
          <a href="/submit" class="btn btn-secondary btn-sm">+ Suggest a Creator</a>
        </div>
      </div>
      <div class="card-grid">
        ${clubCreators.length ? clubCreators.map(c => creatorCard(c)).join('') :
          '<div class="empty-state"><div class="es-title">No creators yet</div><p style="color:var(--text-dim)">Know a great ${escHtml(club)} YouTuber?</p><a href="/submit" class="btn btn-primary" style="margin-top:12px">Suggest a Creator</a></div>'}
      </div>
      <a href="/submit" class="suggest-cta"><span class="suggest-icon">+</span> Know a ${escHtml(club)} YouTuber we're missing? Suggest them here</a>
    </div>
    ${renderFooter()}
  `;
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
  const clubUrl = '/clubs/' + encodeURIComponent(club);

  document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:40px">
      <a href="${clubUrl}" style="font-size:.82rem;color:var(--text-dim);display:inline-block;margin-bottom:12px">&larr; ${escHtml(club)}</a>
      <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:12px">${crestImg(club, 'crest-xl')} Latest ${escHtml(club)} videos</h1>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:24px">${videos.length} recent upload${videos.length !== 1 ? 's' : ''} from ${clubCreators.length} creator${clubCreators.length !== 1 ? 's' : ''}${clubLeague !== 'Other' ? ' in ' + escHtml(clubLeague) : ''}.</p>

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
    ${renderFooter()}
  `;
}

// ── Render: Rankings ──────────────────────────────────────────────────────
function renderRankings() {
  const params = new URLSearchParams(location.search);
  const leagueFilter = params.get('league') || '';
  const mode = params.get('mode') || 'subs';

  let ranked;
  if (mode === 'rating') {
    ranked = [...creators].filter(c => c.ratingCount > 0);
    if (leagueFilter) ranked = ranked.filter(c => (c.league || getLeague(c.team)) === leagueFilter);
    ranked.sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);
  } else {
    ranked = [...creators].filter(c => c.subscriberCount > 0);
    if (leagueFilter) ranked = ranked.filter(c => (c.league || getLeague(c.team)) === leagueFilter);
    ranked.sort((a, b) => b.subscriberCount - a.subscriberCount);
  }

  // Compute previous ranks from the same filtered set, sorted by the
  // snapshot column, so we can show week-over-week movement.
  const prevRanks = {};
  const prevField = mode === 'rating' ? 'avgRatingPrev' : 'subscriberCountPrev';
  [...ranked]
    .filter(c => c[prevField] > 0)
    .sort((a, b) => b[prevField] - a[prevField])
    .forEach((c, i) => { prevRanks[c.id] = i + 1; });

  const modeParam = mode === 'rating' ? '&mode=rating' : '';

  document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:40px">
      <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:4px">Creator Rankings</h1>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:12px">${mode === 'subs' ? 'Ranked by YouTube subscriber count.' : 'Ranked by community ratings. Rate your favorites to influence the leaderboard.'}</p>
      <div class="top-creators-tabs" style="margin-bottom:16px">
        <button class="top-creators-tab ${mode === 'subs' ? 'active' : ''}" onclick="navigate('/rankings${leagueFilter ? '?league=' + encodeURIComponent(leagueFilter) : ''}')">By Subscribers</button>
        <button class="top-creators-tab ${mode === 'rating' ? 'active' : ''}" onclick="navigate('/rankings?mode=rating${leagueFilter ? '&league=' + encodeURIComponent(leagueFilter) : ''}')">By Rating</button>
      </div>
      <div class="chip-row" style="justify-content:flex-start;margin-bottom:24px">
        <span class="chip ${!leagueFilter ? 'active' : ''}" onclick="navigate('/rankings${mode === 'rating' ? '?mode=rating' : ''}')">All leagues</span>
        ${LEAGUES.map(l =>
          `<span class="chip ${leagueFilter === l.name ? 'active' : ''}" onclick="navigate('/rankings?league=${encodeURIComponent(l.name)}${modeParam}')">${leagueChipImg(l.name)} ${l.name}</span>`
        ).join('')}
      </div>
      ${ranked.length ? `
      <div class="rankings-summary">
        <span><strong>${ranked.length}</strong> creator${ranked.length !== 1 ? 's' : ''}${leagueFilter ? ` in ${escHtml(leagueFilter)}` : ''}</span>
        ${mode === 'subs' ? `<span>Combined <strong>${formatNum(ranked.reduce((a, c) => a + (c.subscriberCount || 0), 0))}</strong> subscribers</span>` : `<span><strong>${ranked.reduce((a, c) => a + (c.ratingCount || 0), 0)}</strong> reviews total</span>`}
      </div>
      <div class="rankings-card">${ranked.map((c, i) => {
        const rankClass = i < 3 ? ' rk-row--top rk-row--top' + (i + 1) : '';
        const freq = c.uploadFrequency && c.uploadFrequency !== 'Unknown' && c.uploadFrequency !== 'Inactive' ? c.uploadFrequency : '';
        const videos = c.videoCount ? formatNum(c.videoCount) + ' videos' : '';
        const metaParts = [freq, videos].filter(Boolean);
        const currentRank = i + 1;
        const prev = prevRanks[c.id];
        let move = '';
        if (prev == null) {
          if (c[prevField] <= 0) move = '<span class="rk-move rk-move--new">NEW</span>';
        } else if (prev > currentRank) {
          move = `<span class="rk-move rk-move--up">&uarr;${prev - currentRank}</span>`;
        } else if (prev < currentRank) {
          move = `<span class="rk-move rk-move--down">&darr;${currentRank - prev}</span>`;
        }
        return `
        <a href="${creatorLink(c)}" class="rk-row${rankClass}${c.isLive ? ' rk-row--live' : ''}">
          <div class="rk-rank">${currentRank}${move}</div>
          <span class="av-wrap">${avatarImg(c, 'rk-avatar')}</span>
          <div class="rk-info">
            <div class="rk-name">${liveDot(c.isLive)}${escHtml(c.name)}${c.verified ? ' <span class="rk-verified" title="Verified">&#10003;</span>' : ''}</div>
            <div class="rk-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
          </div>
          <div class="rk-meta">${metaParts.join(' &middot; ')}</div>
          <div class="rk-score">
            ${mode === 'subs'
              ? `<div class="rk-score-num">${formatNum(c.subscriberCount)}</div><div class="rk-score-label">subscribers</div>`
              : `<div class="rk-score-num">${c.avgRating || '—'} <span class="rk-score-star">&#9733;</span></div><div class="rk-score-label">${c.ratingCount} review${c.ratingCount !== 1 ? 's' : ''}</div>`}
          </div>
          <span class="rk-arrow">&rsaquo;</span>
        </a>
      `;}).join('')}</div>` :
        `<div class="empty-state"><div class="es-icon">&#127942;</div><div class="es-title">No rankings yet</div><p style="color:var(--text-dim)">${mode === 'subs' ? 'No subscriber data available.' : 'Be the first to rate a creator and start the rankings!'}</p></div>`}
    </div>
    ${renderFooter()}
  `;
}

// ── Render: Generator ────────────────────────────────────────────────────
async function renderGenerator() {
  if (typeof Gen === 'undefined') {
    document.getElementById('app').innerHTML = '<div class="container" style="padding:60px 20px;text-align:center"><p>Generator module not loaded.</p></div>' + renderFooter();
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
    var leagueOrder = ['Premier League','La Liga','Serie A','Bundesliga','Ligue 1'];
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
    <div class="container" style="max-width:560px;padding-top:48px;padding-bottom:60px">
      <div style="text-align:center;margin-bottom:32px">
        <h1 style="font-size:1.6rem;font-weight:800;margin-bottom:6px">Submit a Creator</h1>
        <p style="color:var(--text-dim);font-size:.9rem">Know a great football YouTuber? Suggest them for the database. Submissions are reviewed before being published.</p>
      </div>
      <div id="submitForm">
        <div class="gen-card" style="margin-bottom:0">
          <div style="margin-bottom:14px">
            <label class="field-label">YouTube Channel URL</label>
            <input type="text" id="sub_channel" class="admin-form-input" placeholder="e.g. https://www.youtube.com/@AFTVmedia">
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">We'll fetch the channel name automatically.</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div>
              <label class="field-label">League</label>
              <select id="sub_league" class="admin-form-select" onchange="document.getElementById('sub_team').innerHTML = submitTeamOpts(this.value)">
                <option>Premier League</option><option>La Liga</option><option>Serie A</option><option>Bundesliga</option><option>Ligue 1</option>
              </select>
            </div>
            <div>
              <label class="field-label">Team</label>
              <select id="sub_team" class="admin-form-select">${teamSelect()}</select>
            </div>
          </div>
          <button class="btn-generate" onclick="submitCreator()" style="margin-top:8px">Submit for Review</button>
          <div id="submitMsg" style="text-align:center;margin-top:12px;font-size:.85rem"></div>
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

  document.getElementById('submitForm').innerHTML = '<div style="text-align:center;padding:40px 0"><div style="font-size:2rem;margin-bottom:12px">&#10003;</div><h2 style="font-size:1.2rem;font-weight:700;margin-bottom:6px">Thank you!</h2><p style="color:var(--text-dim);font-size:.9rem;margin-bottom:20px">Your submission is under review. If approved, the creator will appear on the site.</p><a href="/discover" class="btn btn-primary">Browse Creators</a></div>';
}

// ── Render: Account settings ──────────────────────────────────────────────

// Fetches the user's profile row (or returns an empty template so the form
// can still render on first visit).
async function loadUserProfile(userId) {
  const emptyProfile = {
    user_id: userId, display_name: '', avatar_url: '', favourite_team: '',
    country: '', bio: '', notify_live: false, notify_weekly: true, reviews_public: true,
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
  app.innerHTML = `<div class="container" style="max-width:720px;padding-top:48px;padding-bottom:60px">
    <h1 style="font-size:1.6rem;font-weight:800;margin-bottom:6px">Account settings</h1>
    <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:28px">Update how you appear on FanReactionsFC.</p>
    <div id="accountBody"><div class="empty-state" style="padding:40px 0"><div style="color:var(--text-dim)">Loading…</div></div></div>
  </div>${renderFooter()}`;

  const profile = await loadUserProfile(currentUser.id);
  const memberSince = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';

  // Reviews + favorites count
  let reviewsCount = 0, favCount = 0;
  try {
    const [rRes, fRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/frfc_reviews?select=id&user_id=eq.${currentUser.id}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact' } }),
      fetch(`${SUPABASE_URL}/rest/v1/frfc_streamer_favorites?select=streamer_id&user_id=eq.${currentUser.id}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact' } }),
    ]);
    reviewsCount = (await rRes.json()).length;
    favCount = (await fRes.json()).length;
  } catch {}

  // Team options grouped by league (same logic as submit form)
  let teamOpts = '<option value="">No favourite</option>';
  const leagueOrder = ['Premier League','La Liga','Serie A','Bundesliga','Ligue 1'];
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
    <div class="gen-card" style="margin-bottom:16px">
      <div class="acct-avatar-row">
        <div id="acctAvatarPreview" class="acct-avatar">${avatarPreview ? `<img src="${escHtml(avatarPreview)}" alt="">` : `<div class="avatar-fallback">${escHtml(initials)}</div>`}</div>
        <div>
          <label class="field-label">Profile picture</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label for="acctAvatarFile" class="btn btn-secondary btn-sm" style="cursor:pointer">Upload new photo</label>
            <input type="file" id="acctAvatarFile" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
            ${avatarPreview ? '<button class="btn btn-ghost btn-sm" onclick="removeAvatar()" type="button">Remove</button>' : ''}
            <span id="acctAvatarMsg" style="font-size:.78rem;color:var(--text-muted)"></span>
          </div>
          <div style="font-size:.72rem;color:var(--text-muted);margin-top:6px">JPG, PNG, WebP or GIF — up to 2MB.</div>
        </div>
      </div>
    </div>

    <div class="gen-card" style="margin-bottom:16px">
      <div class="gen-card-title">Identity</div>
      <div style="margin-bottom:14px">
        <label class="field-label">Display name</label>
        <input id="acctName" class="admin-form-input" placeholder="How you'll appear on reviews" value="${escHtml(profile.display_name || '')}">
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

    <div class="gen-card" style="margin-bottom:16px">
      <div class="gen-card-title">Account</div>
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

    <div class="gen-card" style="margin-bottom:16px">
      <div class="gen-card-title">Notifications</div>
      <label class="acct-check"><input type="checkbox" id="acctNotifyLive" ${profile.notify_live ? 'checked' : ''}> Email me when a favourite creator goes live</label>
      <label class="acct-check"><input type="checkbox" id="acctNotifyWeekly" ${profile.notify_weekly ? 'checked' : ''}> Send me the weekly digest</label>
    </div>

    <div class="gen-card" style="margin-bottom:16px">
      <div class="gen-card-title">Privacy</div>
      <label class="acct-check"><input type="checkbox" id="acctReviewsPublic" ${profile.reviews_public ? 'checked' : ''}> Show my reviews publicly</label>
    </div>

    <div class="gen-card" style="margin-bottom:16px">
      <div class="gen-card-title">Activity</div>
      <div style="display:flex;gap:32px;flex-wrap:wrap">
        <div><div style="font-size:1.4rem;font-weight:800">${reviewsCount}</div><div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Reviews written</div></div>
        <div><div style="font-size:1.4rem;font-weight:800">${favCount}</div><div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Creators favourited</div></div>
      </div>
    </div>

    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="saveAccount()">Save changes</button>
      <button class="btn btn-ghost" onclick="signOut()">Sign out</button>
      <span id="acctSaveMsg" style="font-size:.85rem"></span>
    </div>
  `;

  // Wire up file input
  const fileInput = document.getElementById('acctAvatarFile');
  if (fileInput) fileInput.addEventListener('change', handleAvatarUpload);
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
    reviews_public: document.getElementById('acctReviewsPublic').checked,
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

// ── Render: Admin ────────────────────────────────────────────────────────
async function renderAdmin() {
  if (!currentUser) return renderAuthRequired('open the admin panel');
  if (typeof Admin === 'undefined') { document.getElementById('app').innerHTML = '<div class="container" style="padding:60px 20px;text-align:center"><p>Admin module not loaded.</p></div>'; return; }

  // Show an immediate loading state so the user knows the click registered,
  // even while the async admin-role check is in flight.
  document.getElementById('app').innerHTML = '<div class="container" style="padding:60px 20px;text-align:center"><div style="color:var(--text-dim);font-size:.9rem">Loading admin…</div></div>';

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
    document.getElementById('app').innerHTML = '<div class="container" style="padding:60px 20px;text-align:center"><div class="empty-state"><div class="es-icon">&#128274;</div><div class="es-title">Access Denied</div><p style="color:var(--text-dim)">You do not have admin privileges.</p><a href="/" class="btn btn-primary" style="margin-top:12px">Back to Home</a></div></div>';
    return;
  }
  // Render admin chrome, then hand off to the Admin module for data loading.
  document.getElementById('app').innerHTML = Admin.renderHTML();
  try {
    await Admin.init();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="container" style="padding:60px 20px;text-align:center"><div class="empty-state"><div class="es-icon">&#9888;</div><div class="es-title">Admin failed to load</div><p style="color:var(--text-dim);margin-bottom:16px">${escHtml(e.message || String(e))}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div></div>`;
  }
}

// ── Auth Modal ────────────────────────────────────────────────────────────
function openModal(type = 'signin') {
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  const isSignIn = type === 'signin';
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2>${isSignIn ? 'Welcome back' : 'Create an account'}</h2>
    <p class="modal-sub">${isSignIn ? 'Sign in to rate, review, and follow creators.' : 'Join the community and start rating creators.'}</p>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@example.com">
    <label>Password</label>
    <input type="password" id="authPass" placeholder="${isSignIn ? 'Your password' : 'Choose a password'}">
    <button class="btn btn-primary" onclick="handleAuth('${type}')">${isSignIn ? 'Sign In' : 'Create Account'}</button>
    <div class="auth-msg" id="authMsg"></div>
    <div class="switch-link">
      ${isSignIn ? "Don't have an account? <a href=\"#\" onclick=\"event.preventDefault();openModal('signup')\">Sign up</a>" :
        "Already have an account? <a href=\"#\" onclick=\"event.preventDefault();openModal('signin')\">Sign in</a>"}
    </div>`;
  overlay.classList.add('open');
}

function closeModal() {
  document.getElementById('authOverlay')?.classList.remove('open');
}

// Report-issue modal — reuses the auth modal overlay DOM so we don't need
// to add a second overlay to index.html.
function openReportModal(creatorId, creatorName) {
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  if (!overlay || !modal) return;
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()">&times;</button>
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
    <textarea id="reportDetails" placeholder="Anything that would help us verify..." style="width:100%;min-height:80px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.88rem;resize:vertical;margin-bottom:14px"></textarea>
    <button class="btn btn-primary" onclick="submitReport('${creatorId}')">Submit report</button>
    <div class="auth-msg" id="reportMsg"></div>`;
  overlay.classList.add('open');
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

// ── Footer ────────────────────────────────────────────────────────────────
function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand"><span style="color:var(--yellow)">Fan</span><span style="color:var(--navy)">Reactions</span><span style="color:var(--yellow)">FC</span></div>
            <div class="footer-desc">The definitive database of football YouTubers across Europe's top 5 leagues. Community-rated, creator-claimed, editorially curated by @fanreactionsfc.</div>
          </div>
          <div class="footer-col">
            <h4>Browse</h4>
            <a href="/discover">All Creators</a>
            <a href="/rankings">Rankings</a>
            ${LEAGUES.slice(0, 3).map(l => `<a href="/discover?league=${encodeURIComponent(l.name)}" style="display:flex;align-items:center;gap:6px">${leagueChipImg(l.name)} ${l.name}</a>`).join('')}
          </div>
          <div class="footer-col">
            <h4>Community</h4>
            <a href="/tools/generator">Description Generator</a>
            <a href="/submit">Submit a Creator</a>
            <a href="#" onclick="event.preventDefault();openModal('signin')">Sign In / Sign Up</a>
          </div>
          <div class="footer-col">
            <h4>FanReactionsFC</h4>
            <a href="https://www.youtube.com/@fanreactionsfc" target="_blank" rel="noopener">YouTube Channel</a>
            <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener">X (Twitter)</a>
            <a href="https://frfcstreamwall.netlify.app/" target="_blank" rel="noopener">Streamwall</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; ${new Date().getFullYear()} FanReactionsFC.com</span>
          <span>${creators.length} creators &bull; Community-powered</span>
        </div>
        <div style="text-align:center;margin-top:12px;font-size:.68rem;color:var(--text-muted)">Club crests and trademarks are the property of their respective owners and are used here for identification purposes only.</div>
      </div>
    </footer>`;
}
