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

function updateNavActive(path) {
  const links = { navHome: '/', navDiscover: '/discover', navRankings: '/rankings' };
  Object.entries(links).forEach(([id, prefix]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const isActive = prefix === '/' ? (path === '/' || path === '/index.html') : path.startsWith(prefix);
    el.classList.toggle('active', isActive);
  });
}

function handleRoute() {
  const path = location.pathname;
  const app = document.getElementById('app');
  closeModal();
  if (typeof Gen !== 'undefined' && Gen.cleanup) Gen.cleanup();
  window.scrollTo(0, 0);

  // Update nav active state
  updateNavActive(path);

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
    const club = decodeURIComponent(path.split('/clubs/')[1].replace(/\/$/, ''));
    currentRoute = { page: 'club', club };
    renderClubPage(club);
  } else if (path === '/rankings') {
    currentRoute = { page: 'rankings' };
    renderRankings();
  } else if (path === '/tools/generator') {
    currentRoute = { page: 'generator' };
    renderGenerator();
  } else {
    currentRoute = { page: 'home' };
    renderHome();
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
      await loadFavorites();
    } else {
      favorites = new Set();
    }
  } catch (e) { console.error('refreshAuth:', e); }
  updateAuthUI();
}

function updateAuthUI() {
  const btn = document.getElementById('authBtn');
  if (!btn) return;
  if (currentUser) {
    const initial = (currentUser.email || '?')[0].toUpperCase();
    btn.innerHTML = `<span class="review-avatar">${initial}</span>`;
    btn.onclick = () => showUserMenu();
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
  menu.innerHTML = `
    <div style="padding:8px 16px;font-size:.82rem;color:var(--text-dim);border-bottom:1px solid var(--border)">${currentUser.email}</div>
    <a href="/tools/generator" style="display:block;padding:8px 16px;font-size:.85rem;color:var(--text)">Description Generator</a>
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
  if (error) { console.error(error); creators = []; return; }
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
}

async function loadFavorites() {
  if (!currentUser) return;
  try {
    const { data, error } = await sb.from('frfc_streamer_favorites').select('streamer_id').eq('user_id', currentUser.id);
    if (error) { console.error('loadFavorites:', error.message); return; }
    favorites = new Set((data || []).map(r => r.streamer_id));
  } catch (e) { console.error('loadFavorites:', e); }
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
  } catch (e) { console.error('toggleFavorite:', e.message || e); }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
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

// ── Search ────────────────────────────────────────────────────────────────
function initSearch() {
  document.addEventListener('input', e => {
    if (!e.target.classList.contains('search-input')) return;
    const q = e.target.value.trim().toLowerCase();
    const box = e.target.closest('.search-wrap').querySelector('.search-results');
    if (q.length < 2) { box.classList.remove('open'); return; }
    const matches = creators.filter(c =>
      c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q) ||
      c.contentTypes.some(t => t.toLowerCase().includes(q))
    ).slice(0, 8);
    if (!matches.length) { box.classList.remove('open'); return; }
    box.innerHTML = matches.map(c => `
      <a href="${creatorLink(c)}" class="search-result">
        ${avatarImg(c, 'cc-avatar')}
        <div>
          <div class="sr-name">${escHtml(c.name)}</div>
          <div class="sr-team">${escHtml(c.team)}</div>
        </div>
      </a>`).join('');
    box.classList.add('open');
  });
  document.addEventListener('focusout', e => {
    if (e.target.classList.contains('search-input')) {
      setTimeout(() => {
        const box = e.target.closest('.search-wrap')?.querySelector('.search-results');
        if (box) box.classList.remove('open');
      }, 200);
    }
  });
}

// ── Render: Home ──────────────────────────────────────────────────────────
function renderHome() {
  const activeLeagues = getLeagues();
  const topRated = [...creators].filter(c => c.ratingCount > 0).sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount).slice(0, 10);
  const topByRating = [...creators].sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount).slice(0, 8);

  // Top 20 clubs by creator count, across all leagues
  const clubCounts = {};
  creators.forEach(c => {
    if (c.team && c.team !== 'Multi-Club / Other') clubCounts[c.team] = (clubCounts[c.team] || 0) + 1;
  });
  const topClubs = Object.entries(clubCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
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

    <!-- FRFC Channel banner -->
    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="frfc-banner">
          <img src="/img/logo.png" alt="FanReactionsFC" class="frfc-banner-logo" onerror="this.style.display='none'">
          <div style="flex:1;min-width:240px">
            <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#F6BE06;margin-bottom:4px">Curated by</div>
            <div style="font-size:1.15rem;font-weight:700;margin-bottom:4px;color:#fff">@fanreactionsfc</div>
            <div style="color:#b0b8d0;font-size:.85rem;line-height:1.5">Post-match fan reactions, compilation videos, and rankings every matchday. The editorial voice behind this platform.</div>
          </div>
          <a href="https://www.youtube.com/@fanreactionsfc?sub_confirmation=1" target="_blank" rel="noopener" class="btn" style="background:#F6BE06;color:#061A5D;font-weight:700">Subscribe on YouTube</a>
        </div>
      </div>
    </section>

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
                <div class="trending-name">${escHtml(c.name)} ${c.verified ? '<span style="color:var(--blue);font-size:.8rem">&#10003;</span>' : ''}</div>
                <div class="trending-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)} <span style="opacity:.5;font-size:.68rem">${leagueFlag(c.league || getLeague(c.team))}</span></div>
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
        <div class="club-grid">
          ${topClubs.map(({ team, count, league }) => {
            const l = LEAGUES.find(lg => lg.name === league);
            return `<a href="/clubs/${encodeURIComponent(team)}" class="club-tile">
              ${crestImg(team)}
              <div class="club-name">${escHtml(team)}</div>
              <div class="club-meta">${l ? `<img src="${l.logo}" alt="" class="club-league-badge" onerror="this.style.display='none'">` : ''} ${count} creator${count !== 1 ? 's' : ''}</div>
            </a>`;
          }).join('')}
        </div>
      </div>
    </section>

    <!-- Top Creators by Rating -->
    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">Top Creators</h2>
          <a href="/discover?sort=rating" class="section-link">Browse all &rarr;</a>
        </div>
        <div class="card-grid">
          ${topByRating.map(c => creatorCard(c)).join('')}
        </div>
      </div>
    </section>

    ${renderFooter()}
  `;
}

// ── Render: Creator Card ──────────────────────────────────────────────────
function creatorCard(c) {
  return `
    <a href="${creatorLink(c)}" class="creator-card">
      <div class="cc-top">
        ${avatarImg(c, 'cc-avatar')}
        <div class="cc-info">
          <div class="cc-name">${escHtml(c.name)} ${c.verified ? '<span class="verified">&#10003;</span>' : ''}</div>
          <div class="cc-team">${crestImg(c.team, 'cc-crest')} ${escHtml(c.team)} <span style="opacity:.5;font-size:.68rem">${leagueFlag(c.league || getLeague(c.team))}</span></div>
        </div>
      </div>
      <div class="cc-stats">
        ${c.ratingCount > 0 ? `<span class="cc-rating">★ ${c.avgRating}</span> <span>(${c.ratingCount} rating${c.ratingCount !== 1 ? 's' : ''})</span>` : '<span>Not yet rated</span>'}
      </div>
      ${c.contentTypes.length ? `<div class="cc-tags">${c.contentTypes.map(t => `<span class="cc-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
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

  if (sort === 'rating') filtered.sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);
  else if (sort === 'reviews') filtered.sort((a, b) => b.ratingCount - a.ratingCount);
  else filtered.sort((a, b) => a.name.localeCompare(b.name));

  // Build accordion: which league should be open?
  const openLeague = leagueFilter || (teamFilter ? getLeague(teamFilter) : '');

  document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:32px">
      <h1 style="font-size:1.6rem;font-weight:800;margin-bottom:4px">Discover Creators</h1>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:24px">${creators.length} creators across ${activeLeagues.length} leagues and ${teams.length} clubs</p>

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
            <span class="filter-chip ${sort === 'reviews' ? 'active' : ''}" onclick="applyFilter('sort','${sort === 'reviews' ? 'name' : 'reviews'}')">&#128172; Most Reviewed</span>
            <span class="bar-sep"></span>
            <span class="bar-label">Type</span>
            ${CONTENT_TYPES.slice(0, 6).map(t =>
              `<span class="filter-chip ${typeFilter === t ? 'active' : ''}" onclick="applyFilter('type','${typeFilter === t ? '' : t}')">${t}${typeFilter === t ? ' <span class=chip-x>&times;</span>' : ''}</span>`
            ).join('')}
          </div>

          <!-- Active filters + result count -->
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <span class="discover-result-count">${filtered.length} creator${filtered.length !== 1 ? 's' : ''}</span>
            ${leagueFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('league','')">${leagueFlag(leagueFilter)} ${escHtml(leagueFilter)} &times;</span>` : ''}
            ${teamFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('team','')">${escHtml(teamFilter)} &times;</span>` : ''}
            ${typeFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('type','')">${escHtml(typeFilter)} &times;</span>` : ''}
            ${favOnly ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('favs','')">Favorites &times;</span>` : ''}
          </div>

          <div class="card-grid">
            ${filtered.length ? filtered.map(c => creatorCard(c)).join('') :
              '<div class="empty-state"><div class="es-icon">&#128269;</div><div class="es-title">No creators found</div><p>Try adjusting your filters</p></div>'}
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
              ${escHtml(c.name)}
              ${c.verified ? '<span class="badge badge-green">Verified</span>' : ''}
              ${c.claimed ? '<span class="badge badge-dim">Claimed</span>' : ''}
            </h1>
            <div class="profile-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
            ${c.description ? `<div class="profile-desc">${escHtml(c.description)}</div>` : ''}
            <div class="profile-actions">
              ${c.channel ? `<a href="${escHtml(c.channel)}" target="_blank" rel="noopener" class="btn btn-primary">Watch on YouTube</a>` : ''}
              ${c.live ? `<a href="${escHtml(c.live)}" target="_blank" rel="noopener" class="btn btn-secondary">Live / Streams</a>` : ''}
              <button class="btn btn-secondary" onclick="handleFavorite('${c.id}')" id="favBtn">${isFav ? '&#9733; Favorited' : '&#9734; Favorite'}</button>
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
          ${c.subscriberCount ? `<div class="ps-item"><div class="ps-num">${formatNum(c.subscriberCount)}</div><div class="ps-label">Subscribers</div></div>` : ''}
        </div>
      </div>
    </div>

    <div class="container" style="padding-top:24px">
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
        ${reviews.length ? reviews.map(r => `
          <div class="review">
            <div class="review-head">
              <div class="review-avatar">${(r.user_id || '?').charAt(0).toUpperCase()}</div>
              <span class="review-user">Fan</span>
              <span class="review-date">${new Date(r.created_at).toLocaleDateString()}</span>
              <span class="review-stars">${stars(r.rating)}</span>
            </div>
            ${r.review_text ? `<div class="review-text">${escHtml(r.review_text)}</div>` : ''}
          </div>
        `).join('') : '<div style="color:var(--text-dim);font-size:.88rem">No reviews yet. Be the first to rate this creator!</div>'}
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
    </div>
    ${renderFooter()}
  `;

  selectedRating = 0;
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
  const clubCreators = creators.filter(c => c.team === club).sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);
  const clubLeague = getLeague(club);
  const leagueInfo = LEAGUES.find(l => l.name === clubLeague);

  document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:40px">
      <a href="/discover${clubLeague !== 'Other' ? '?league=' + encodeURIComponent(clubLeague) : ''}" style="font-size:.82rem;color:var(--text-dim);display:inline-block;margin-bottom:12px">&larr; ${clubLeague !== 'Other' ? escHtml(clubLeague) : 'All clubs'}</a>
      <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:12px">${crestImg(club, 'crest-xl')} ${escHtml(club)}</h1>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:28px">${leagueInfo ? leagueInfo.flag + ' ' : ''}${escHtml(clubLeague)} &bull; ${clubCreators.length} creator${clubCreators.length !== 1 ? 's' : ''}</p>
      <div class="card-grid">
        ${clubCreators.length ? clubCreators.map(c => creatorCard(c)).join('') :
          '<div class="empty-state"><div class="es-title">No creators yet</div><p style="color:var(--text-dim)">Know a great channel? <a href="/discover">Suggest one</a>.</p></div>'}
      </div>
    </div>
    ${renderFooter()}
  `;
}

// ── Render: Rankings ──────────────────────────────────────────────────────
function renderRankings() {
  const params = new URLSearchParams(location.search);
  const leagueFilter = params.get('league') || '';
  let ranked = [...creators].filter(c => c.ratingCount > 0);
  if (leagueFilter) ranked = ranked.filter(c => (c.league || getLeague(c.team)) === leagueFilter);
  ranked.sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);

  document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:40px">
      <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:4px">Creator Rankings</h1>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:12px">Ranked by community ratings. Rate your favorites to influence the leaderboard.</p>
      <div class="chip-row" style="justify-content:flex-start;margin-bottom:24px">
        <span class="chip ${!leagueFilter ? 'active' : ''}" onclick="navigate('/rankings')">All leagues</span>
        ${LEAGUES.map(l =>
          `<span class="chip ${leagueFilter === l.name ? 'active' : ''}" onclick="navigate('/rankings?league=${encodeURIComponent(l.name)}')">${l.flag} ${l.name}</span>`
        ).join('')}
      </div>
      ${ranked.length ? `<div class="trending-list">${ranked.map((c, i) => `
        <a href="${creatorLink(c)}" class="trending-row">
          <span class="trending-rank">${i + 1}</span>
          ${avatarImg(c, 'trending-avatar')}
          <div class="trending-info">
            <div class="trending-name">${escHtml(c.name)} ${c.verified ? '<span style="color:var(--blue);font-size:.8rem">&#10003;</span>' : ''}</div>
            <div class="trending-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
          </div>
          <div class="trending-score">${stars(c.avgRating)} <span style="color:var(--text-dim);font-weight:400;font-size:.78rem">${c.avgRating} (${c.ratingCount})</span></div>
        </a>
      `).join('')}</div>` :
        '<div class="empty-state"><div class="es-icon">&#127942;</div><div class="es-title">No ratings yet</div><p style="color:var(--text-dim)">Be the first to rate a creator and start the rankings!</p></div>'}
    </div>
    ${renderFooter()}
  `;
}

// ── Render: Generator ────────────────────────────────────────────────────
async function renderGenerator() {
  if (!creators.length) await loadCreators();
  document.getElementById('app').innerHTML = Gen.renderHTML() + renderFooter();
  Gen.init();
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
            ${LEAGUES.slice(0, 3).map(l => `<a href="/discover?league=${encodeURIComponent(l.name)}">${l.flag} ${l.name}</a>`).join('')}
          </div>
          <div class="footer-col">
            <h4>Community</h4>
            <a href="/tools/generator">Description Generator</a>
            <a href="#" onclick="event.preventDefault();openModal('signin')">Sign In / Sign Up</a>
          </div>
          <div class="footer-col">
            <h4>FanReactionsFC</h4>
            <a href="https://www.youtube.com/@fanreactionsfc" target="_blank" rel="noopener">YouTube Channel</a>
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
