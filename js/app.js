/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC.com — SPA Application
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Supabase ──────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iq6Dv3b9IYfNktis7WeZ-g_y7_DV0gm';

// ── Raw REST helpers (bypass supabase-js client which hangs with publishable key) ──
// Session stored in localStorage — mirrors supabase-js v2 storage format.
const _SB_SESSION_KEY = 'sb-dsxijgrpxsfywxuffbmt-auth-token';

function _getSession() {
  try {
    const raw = localStorage.getItem(_SB_SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

function _saveSession(session) {
  try { localStorage.setItem(_SB_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
}

function _clearSession() {
  try { localStorage.removeItem(_SB_SESSION_KEY); } catch (_) {}
}

function _getAccessToken() {
  const s = _getSession();
  return (s && s.access_token) || SUPABASE_KEY;
}

// When a user is signed in, use their JWT so RLS policies work for writes.
function _sbAuthHeaders() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${_getAccessToken()}`, 'Content-Type': 'application/json' };
}

// ── Raw Auth helpers (bypass supabase-js auth which also hangs) ──
async function _authPost(endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { data: null, error: { message: data.error_description || data.msg || data.error || res.statusText } };
  return { data, error: null };
}

async function _authGet(endpoint, token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { data: null, error: { message: data.error_description || data.msg || data.error || res.statusText } };
  return { data, error: null };
}

/** GET from Supabase REST – returns { data, error } */
async function sbGet(path) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: _sbAuthHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: { message: body.message || body.error || res.statusText, status: res.status } };
    }
    return { data: await res.json(), error: null };
  } catch (e) { return { data: null, error: e }; }
}

/** POST to Supabase REST (insert or RPC) – returns { data, error } */
async function sbPost(path, body, opts = {}) {
  try {
    const h = _sbAuthHeaders();
    if (opts.prefer) h['Prefer'] = opts.prefer;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({}));
      return { data: null, error: { message: rb.message || rb.error || res.statusText, status: res.status } };
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : null;
    return { data, error: null };
  } catch (e) { return { data: null, error: e }; }
}

/** DELETE from Supabase REST – returns { error } */
async function sbDelete(path) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers: _sbAuthHeaders() });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({}));
      return { error: { message: rb.message || rb.error || res.statusText, status: res.status } };
    }
    return { error: null };
  } catch (e) { return { error: e }; }
}

/** Call Supabase RPC – returns { data, error } */
async function sbRpc(fn, params = {}) {
  return sbPost(`rpc/${fn}`, params);
}

// ── State ─────────────────────────────────────────────────────────────────
let creators = [];
// reviews removed
let favorites = new Set();
let favouriteCounts = new Map();
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
  { name: 'Premier League', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', code: 'PL',  logo: '/img/leagues/premier-league.png' },
  { name: 'La Liga',         flag: '🇪🇸', code: 'LL',  logo: '/img/leagues/la-liga.png' },
  { name: 'Serie A',         flag: '🇮🇹', code: 'SA',  logo: '/img/leagues/serie-a.png' },
  { name: 'Bundesliga',      flag: '🇩🇪', code: 'BL',  logo: '/img/leagues/bundesliga.png' },
  { name: 'Ligue 1',         flag: '🇫🇷', code: 'L1',  logo: '/img/leagues/ligue-1.png' },
  { name: 'Championship',   flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', code: 'ELC', logo: '/img/leagues/championship.png' }
];

// ── Club crests (football-data.org SVGs) ──────────────────────────────────
const TEAM_CRESTS = {
  // ── Premier League ──
  'Arsenal': 'https://crests.football-data.org/57.svg',
  'Aston Villa': 'https://crests.football-data.org/58.svg',
  'Bournemouth': 'https://crests.football-data.org/1044.svg',
  'Brentford': 'https://a.espncdn.com/i/teamlogos/soccer/500/337.png',
  'Brighton': 'https://crests.football-data.org/397.svg',
  'Burnley': 'https://crests.football-data.org/328.svg',
  'Chelsea': 'https://crests.football-data.org/61.svg',
  'Crystal Palace': 'https://crests.football-data.org/354.svg',
  'Everton': 'https://crests.football-data.org/62.svg',
  'Fulham': 'https://crests.football-data.org/63.svg',
  'Leeds United': 'https://crests.football-data.org/341.svg',
  'Liverpool': 'https://crests.football-data.org/64.svg',
  'Man City': 'https://crests.football-data.org/65.svg',
  'Man United': 'https://crests.football-data.org/66.svg',
  'Newcastle': 'https://crests.football-data.org/67.svg',
  'Nottm Forest': 'https://crests.football-data.org/351.svg',
  'Sunderland': 'https://a.espncdn.com/i/teamlogos/soccer/500/366.png',
  'Tottenham': 'https://crests.football-data.org/73.svg',
  'West Ham': 'https://crests.football-data.org/563.svg',
  'Wolves': 'https://crests.football-data.org/76.svg',
  // ── Championship (EFL) ──
  'Birmingham': 'https://a.espncdn.com/i/teamlogos/soccer/500/392.png',
  'Blackburn': 'https://a.espncdn.com/i/teamlogos/soccer/500/365.png',
  'Bristol City': 'https://a.espncdn.com/i/teamlogos/soccer/500/333.png',
  'Charlton': 'https://a.espncdn.com/i/teamlogos/soccer/500/372.png',
  'Coventry': 'https://a.espncdn.com/i/teamlogos/soccer/500/388.png',
  'Derby': 'https://a.espncdn.com/i/teamlogos/soccer/500/374.png',
  'Hull': 'https://a.espncdn.com/i/teamlogos/soccer/500/306.png',
  'Ipswich': 'https://crests.football-data.org/349.svg',
  'Leicester': 'https://crests.football-data.org/338.svg',
  'Middlesbrough': 'https://a.espncdn.com/i/teamlogos/soccer/500/369.png',
  'Millwall': 'https://a.espncdn.com/i/teamlogos/soccer/500/391.png',
  'Norwich': 'https://a.espncdn.com/i/teamlogos/soccer/500/381.png',
  'Oxford Utd': 'https://a.espncdn.com/i/teamlogos/soccer/500/311.png',
  'Portsmouth': 'https://a.espncdn.com/i/teamlogos/soccer/500/385.png',
  'Preston': 'https://a.espncdn.com/i/teamlogos/soccer/500/394.png',
  'QPR': 'https://a.espncdn.com/i/teamlogos/soccer/500/334.png',
  'Sheffield Utd': 'https://crests.football-data.org/356.svg',
  'Sheffield Wed': 'https://a.espncdn.com/i/teamlogos/soccer/500/399.png',
  'Southampton': 'https://crests.football-data.org/340.svg',
  'Stoke': 'https://a.espncdn.com/i/teamlogos/soccer/500/336.png',
  'Swansea': 'https://a.espncdn.com/i/teamlogos/soccer/500/318.png',
  'Watford': 'https://a.espncdn.com/i/teamlogos/soccer/500/395.png',
  'West Brom': 'https://a.espncdn.com/i/teamlogos/soccer/500/383.png',
  'Wrexham': 'https://a.espncdn.com/i/teamlogos/soccer/500/352.png',
  // Luton Town — recently relegated; crest kept so legacy creator rows
  // still render a logo even though Luton isn't in either league list.
  'Luton': 'https://crests.football-data.org/389.svg',
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
  'Roma': 'https://a.espncdn.com/i/teamlogos/soccer/500/104.png',
  'Lazio': 'https://crests.football-data.org/110.svg',
  'Atalanta': 'https://crests.football-data.org/102.svg',
  'Fiorentina': 'https://crests.football-data.org/99.svg',
  'Bologna': 'https://crests.football-data.org/103.svg',
  'Torino': 'https://crests.football-data.org/586.svg',
  'Udinese': 'https://crests.football-data.org/115.svg',
  'Monza': 'https://crests.football-data.org/5890.svg',
  'Empoli': 'https://a.espncdn.com/i/teamlogos/soccer/500/102.png',
  'Genoa': 'https://crests.football-data.org/107.svg',
  'Cagliari': 'https://crests.football-data.org/104.svg',
  'Lecce': 'https://a.espncdn.com/i/teamlogos/soccer/500/113.png',
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
  'Monaco': 'https://a.espncdn.com/i/teamlogos/soccer/500/174.png',
  'Lille': 'https://crests.football-data.org/521.svg',
  'Nice': 'https://a.espncdn.com/i/teamlogos/soccer/500/2502.png',
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
  'Saint-Etienne': 'https://a.espncdn.com/i/teamlogos/soccer/500/178.png'
};

// ── Team → League mapping ─────────────────────────────────────────────────
const TEAM_TO_LEAGUE = {};
(function buildLeagueMap() {
  const map = {
    'Premier League': ['Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Burnley','Chelsea','Crystal Palace','Everton','Fulham','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham','West Ham','Wolves'],
    'Championship': ['Birmingham','Blackburn','Bristol City','Charlton','Coventry','Derby','Hull','Ipswich','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','Wrexham'],
    'La Liga': ['Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes'],
    'Serie A': ['Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como'],
    'Bundesliga': ['Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli'],
    'Ligue 1': ['PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne']
  };
  for (const [league, teams] of Object.entries(map)) {
    teams.forEach(t => TEAM_TO_LEAGUE[t] = league);
  }
})();

// ── Team brand colours (primary, secondary) ─────────────────────────────
const TEAM_COLORS = {
  'Arsenal':['#EF0107','#FFFFFF'],'Aston Villa':['#670E36','#95BFE5'],'Bournemouth':['#DA291C','#000000'],'Brentford':['#E30613','#FBB800'],
  'Brighton':['#0057B8','#FFFFFF'],'Burnley':['#6C1D45','#99D6EA'],'Chelsea':['#034694','#FFFFFF'],'Crystal Palace':['#1B458F','#C4122E'],
  'Everton':['#003399','#FFFFFF'],'Fulham':['#000000','#FFFFFF'],'Leeds United':['#1D428A','#FFCD00'],'Liverpool':['#C8102E','#FFFFFF'],
  'Man City':['#6CABDD','#1C2C5B'],'Man United':['#DA291C','#FBE122'],'Newcastle':['#241F20','#FFFFFF'],'Nottm Forest':['#DD0000','#FFFFFF'],
  'Sunderland':['#EB172B','#FFFFFF'],'Tottenham':['#132257','#FFFFFF'],'West Ham':['#7A263A','#1BB1E7'],'Wolves':['#FDB913','#231F20'],
  'Barcelona':['#A50044','#004D98'],'Real Madrid':['#FEBE10','#00529F'],'Atletico Madrid':['#CB3524','#FFFFFF'],
  'Sevilla':['#D6001C','#FFFFFF'],'Real Betis':['#00954C','#FFFFFF'],'Villarreal':['#FFCD00','#005187'],
  'Juventus':['#000000','#FFFFFF'],'AC Milan':['#FB090B','#000000'],'Inter Milan':['#010E80','#FCBB09'],
  'Napoli':['#12A0D7','#FFFFFF'],'Roma':['#8E1F2F','#F0BC42'],'Lazio':['#87D8F7','#FFFFFF'],
  'Bayern Munich':['#DC052D','#FFFFFF'],'Borussia Dortmund':['#FDE100','#000000'],'RB Leipzig':['#DD0741','#FFFFFF'],
  'Bayer Leverkusen':['#E32221','#000000'],'Eintracht Frankfurt':['#E1000F','#000000'],
  'PSG':['#004170','#DA291C'],'Marseille':['#2FAEE0','#FFFFFF'],'Lyon':['#1A3C8F','#ED1C24'],
  'Monaco':['#E7001E','#FFFFFF'],'Lille':['#D20026','#FFFFFF'],
  'Leicester':['#003090','#FDBE11'],'Southampton':['#D71920','#FFFFFF'],'Sheffield Utd':['#EE2737','#FFFFFF'],
  'Ipswich':['#0044AA','#FFFFFF'],'Norwich':['#00A650','#FFF200'],'Watford':['#FBEE23','#ED2127'],
  'Birmingham':['#0000FF','#FFFFFF'],'Derby':['#000000','#FFFFFF'],'Stoke':['#E03A3E','#1B449C'],
  'QPR':['#1D5BA4','#FFFFFF'],'Swansea':['#000000','#FFFFFF'],'West Brom':['#122F67','#FFFFFF'],
  'Multi-Club / Other':['#F6BE06','#061A5D']
};

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
  try {
    initTheme();
    showLoading();
    await loadCreators();
    loadFavouriteCounts(); // fire-and-forget; non-critical
    // Show sign-in button immediately (before auth resolves)
    updateAuthUI();
    // Auth: don't let it block page render — 5s timeout
    try {
      const authTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('auth timeout')), 5000));
      await Promise.race([refreshAuth(), authTimeout]);
    } catch (_) { updateAuthUI(); /* auth timed out — ensure button shows */ }
    // Session changes are handled by our raw auth helpers — no onAuthStateChange needed
    handleRoute();
    window.addEventListener('popstate', handleRoute);
    initSearch();
  } catch (e) {
    console.error('Init failed:', e);
    document.getElementById('app').innerHTML = '<div class="container" style="padding:60px 20px;text-align:center"><h2>Something went wrong</h2><p style="color:var(--text-dim)">' + escHtml(e.message || '') + '</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div>';
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
  const links = { navHome: '/', navDiscover: '/discover', navRankings: '/rankings', navBecome: '/become-a-creator', navCommunity: '/community' };
  Object.entries(links).forEach(([id, prefix]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const isActive = prefix === '/' ? (path === '/' || path === '/index.html') : path.startsWith(prefix);
    el.classList.toggle('active', isActive);
  });
}

function updatePageMeta(title, description) {
  document.title = title;
  let meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', description);
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
    } else if (path === '/streamwall') {
      currentRoute = { page: 'streamwall' };
      updatePageMeta('Streamwall — Watch Live Football Creators | FanReactionsFC', 'Watch multiple football creators streaming live on YouTube, all at once. Live watchalongs, reactions, and match day content.');
      renderStreamwall();
    } else if (path === '/become-a-creator') {
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
    const session = _getSession();
    if (session && session.access_token) {
      const { data: user, error } = await _authGet('user', session.access_token);
      if (error || !user || !user.id) {
        // Token expired or invalid — try refresh
        if (session.refresh_token) {
          const { data: refreshed, error: rErr } = await _authPost('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
          if (!rErr && refreshed && refreshed.access_token) {
            _saveSession(refreshed);
            const { data: u2 } = await _authGet('user', refreshed.access_token);
            currentUser = (u2 && u2.id) ? u2 : null;
          } else {
            _clearSession();
            currentUser = null;
          }
        } else {
          _clearSession();
          currentUser = null;
        }
      } else {
        currentUser = user;
      }
    } else {
      currentUser = null;
    }
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
  const { data, error } = await _authPost('token?grant_type=password', { email, password });
  if (error) return error.message;
  if (data && data.access_token) {
    _saveSession(data);
    await refreshAuth();
    closeModal();
  }
  return null;
}

async function signUp(email, password) {
  const { data, error } = await _authPost('signup', { email, password });
  if (error) return error.message;
  // If auto-confirm is off, user gets a confirmation email
  if (data && data.access_token) _saveSession(data);
  return null;
}

async function signOut() {
  try {
    const token = _getAccessToken();
    if (token !== SUPABASE_KEY) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  } catch (_) {}
  _clearSession();
  currentUser = null;
  currentProfile = null;
  favorites = new Set();
  updateAuthUI();
  handleRoute();
}

// ── Data loading ──────────────────────────────────────────────────────────
const CREATOR_CACHE_KEY = 'frfc_creators_cache';
const CREATOR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function mapCreatorRow(r) {
  return {
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
    subscriberCountPrev: r.subscriber_count_prev || 0
  };
}

async function loadCreators() {
  // 1. Try localStorage cache first for instant render
  try {
    const cached = localStorage.getItem(CREATOR_CACHE_KEY);
    if (cached) {
      const { ts, rows } = JSON.parse(cached);
      if (Date.now() - ts < CREATOR_CACHE_TTL && rows && rows.length) {
        creators = rows.map(mapCreatorRow);
        updateLiveCountChip();
        // Revalidate in background (stale-while-revalidate pattern)
        _revalidateCreators();
        return;
      }
    }
  } catch (_) {}

  // 2. No valid cache — fetch and wait
  await _fetchCreators();
}

async function _fetchCreators() {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase query timed out')), 15000));
  let data, error;
  try {
    const result = await Promise.race([sbGet('frfc_streamers?select=*&order=team,name'), timeout]);
    data = result.data;
    error = result.error;
  } catch (e) {
    console.error('loadCreators failed:', e);
    if (!creators.length) creators = [];
    return;
  }
  if (error) { console.error('loadCreators error:', error); if (!creators.length) creators = []; return; }
  creators = data.map(mapCreatorRow);
  updateLiveCountChip();
  // Cache raw rows for next visit
  try { localStorage.setItem(CREATOR_CACHE_KEY, JSON.stringify({ ts: Date.now(), rows: data })); } catch (_) {}
}

function _revalidateCreators() {
  _fetchCreators().then(() => {
    // If route is already rendered, live status may have changed — update chip
    updateLiveCountChip();
  }).catch(() => {});
}

async function loadFavorites() {
  if (!currentUser) return;
  try {
    const { data, error } = await sbGet(`frfc_streamer_favorites?select=streamer_id&user_id=eq.${currentUser.id}`);
    if (error) return;
    favorites = new Set((data || []).map(r => r.streamer_id));
  } catch (e) { /* favorites load failed — non-critical */ }
}

async function loadFavouriteCounts() {
  try {
    const { data, error } = await sbRpc('get_favourite_counts');
    if (error || !data) return;
    favouriteCounts = new Map(data.map(r => [r.streamer_id, Number(r.fav_count)]));
  } catch (e) { /* non-critical */ }
}

async function toggleFavorite(id) {
  if (!currentUser) { openModal('signin'); return; }
  try {
    if (favorites.has(id)) {
      const { error } = await sbDelete(`frfc_streamer_favorites?user_id=eq.${currentUser.id}&streamer_id=eq.${id}`);
      if (error) throw error;
      favorites.delete(id);
    } else {
      const { error } = await sbPost('frfc_streamer_favorites', { user_id: currentUser.id, streamer_id: id }, { prefer: 'return=minimal' });
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

  document.getElementById('app').innerHTML = `
    <!-- Hero -->
    <section class="hero">
      <div class="container">
        <h1>Discover the best football<br>creators on <span class="accent">YouTube</span></h1>
        <p class="subtitle">The definitive database of football YouTubers. Ranked weekly.</p>
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
      </div>
    </section>

    <!-- Platform stats bar -->
    <div class="platform-stat-bar">
      <div class="container">
        <div class="platform-stats">
          <div class="platform-stat">
            <div class="platform-stat-icon">🎬</div>
            <div class="platform-stat-num">${creators.length}</div>
            <div class="platform-stat-label">Creators indexed</div>
          </div>
          <div class="platform-stat">
            <div class="platform-stat-icon">⚽</div>
            <div class="platform-stat-num">${totalClubs}</div>
            <div class="platform-stat-label">Clubs covered</div>
          </div>
          <div class="platform-stat">
            <div class="platform-stat-icon">🏆</div>
            <div class="platform-stat-num">${LEAGUES.length}</div>
            <div class="platform-stat-label">Leagues</div>
          </div>
          <div class="platform-stat">
            <div class="platform-stat-icon">${totalLive ? '📡' : '🔄'}</div>
            <div class="platform-stat-num ${totalLive ? 'platform-stat-num--live' : ''}">${totalLive || 'Weekly'}</div>
            <div class="platform-stat-label" style="${totalLive ? 'color:var(--red)' : ''}">${totalLive ? '● Live now' : 'Rankings updated'}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Live Now -->
    ${liveNow.length ? `
    <div class="container" style="padding-top:28px">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title"><span class="live-dot-sm"></span> Live Now <span class="live-count">${liveNow.length}</span></div>
          ${liveNow.length > 4 ? '<a href="/discover?live=1" class="sc-head-link">View all &rarr;</a>' : ''}
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

    <!-- Upcoming streams -->
    ${upcoming.length ? `
    <div class="container" style="padding-top:24px">
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

    <!-- 1. Top Clubs -->
    <div class="container" style="padding-top:${liveNow.length || upcoming.length ? '24' : '28'}px">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title">&#127942; Top Clubs</div>
          <div class="sc-head-right">
            <div class="club-filter-row" style="margin:0;gap:6px">
              <span class="chip club-filter active" style="font-size:.72rem;padding:4px 12px" onclick="filterClubs(this,'')">All</span>
              ${LEAGUES.map(l => `<span class="chip club-filter" style="font-size:.72rem;padding:4px 10px" onclick="filterClubs(this,'${escHtml(l.name)}')"><img src="${l.logo}" alt="" class="chip-league-logo" onerror="this.style.display='none'"> ${escHtml(l.name)}</span>`).join('')}
            </div>
            <a href="/discover" class="sc-head-link">View all &rarr;</a>
          </div>
        </div>
        <div class="sc-body">
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
      </div>
    </div>

    <!-- 2. Curated By / FRFC Channel banner -->
    <div class="container" style="padding-top:24px">
      <div class="frfc-banner">
        <div class="frfc-banner-logo-wrap">
          <img src="/img/logo.png" alt="FanReactionsFC" class="frfc-banner-logo" onerror="this.parentNode.style.display='none'">
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
          <a href="https://www.youtube.com/@fanreactionsfc?sub_confirmation=1" target="_blank" rel="noopener" class="btn btn-yellow">&#9654; Subscribe on YouTube</a>
          <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener" class="btn-banner-secondary">Follow on X</a>
        </div>
      </div>
    </div>

    <!-- 3. Creator Battle -->
    <div class="container battle-section">
      <div class="battle-wrap">
        <div class="battle-top">
          <div class="battle-title">&#9876;&#65039; Creator Battle</div>
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
        <div class="battle-hot" id="battleHot" style="display:none">
          <div class="battle-hot-title">&#128293; Hot Creators</div>
          <div class="battle-hot-strip" id="battleHotStrip"></div>
        </div>
      </div>
    </div>

    <!-- 4. Become a Creator -->
    <div class="container" style="padding-top:24px">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title">&#127916; Become a Creator</div>
        </div>
        <div class="sc-body">
          <div class="become-section">
            <div class="become-video">
              <iframe src="https://www.youtube.com/embed/RA7-Wtsk8Pg" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
            </div>
            <div class="become-text">
              <h3>Start Your Watchalong Journey</h3>
              <p>Learn how to set up a professional streaming environment for football watchalongs — completely free. Prism Live Studio, Uno Overlays, live scoreboards, and more.</p>
              <a href="/become-a-creator" class="btn-yellow" onclick="event.preventDefault();navigate('/become-a-creator')">Read the Full Guide &rarr;</a>
            </div>
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
          <a href="/submit" class="btn-cta-band">+ Suggest a Creator</a>
        </div>
      </div>
    </div>

    <!-- 5. Top Creators -->
    <div class="container" style="padding-top:24px;padding-bottom:60px">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title">&#11088; Top Creators</div>
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

  // Init Creator Battle
  battleInit();
}

// ── Creator Battle ──────────────────────────────────────────────────────────
const battleSeen = new Set();
let battlePair = [null, null];
let battleVoteCount = 0;
let battleLeaderboard = [];
let battleSessionVotes = 0;
let battleSignupDismissed = false;

const BATTLE_TAGS = [
  'Passionate','Tactical','Funny','Matchday Vibes','Entertaining',
  'Knowledgeable','High Energy','Underrated','Fan Favourite','Rising Star'
];

function battleFingerprint() {
  let fp = localStorage.getItem('frfc_fp');
  if (!fp) { fp = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('frfc_fp', fp); }
  return fp;
}

function battleGetTags(c) {
  // Deterministic pseudo-random tags from creator id
  const hash = c.id.split('').reduce((h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0, 0);
  const idx1 = Math.abs(hash) % BATTLE_TAGS.length;
  const idx2 = Math.abs(hash * 7 + 3) % BATTLE_TAGS.length;
  const tags = [BATTLE_TAGS[idx1]];
  if (idx2 !== idx1) tags.push(BATTLE_TAGS[idx2]);
  return tags;
}

function battleInit() {
  battlePopulateClubs();
  battleNextMatchup();
  battleLoadMeta();
}

async function battleLoadMeta() {
  try {
    const [totalRes, lbRes] = await Promise.all([
      sbRpc('get_battle_total'),
      sbRpc('get_battle_leaderboard', { lim: 8 })
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
      ${c.avatar ? `<img class="battle-hot-av" src="${c.avatar}" alt="">` : ''}
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
    <div class="battle-vs"><div class="battle-vs-text">VS</div></div>
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
    ${crestUrl ? `<img class="battle-crest-bg" src="${crestUrl}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="battle-team-row">
      ${crestUrl ? `<img class="battle-crest" src="${crestUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="battle-team-name">${escHtml(c.team)}</span>
    </div>
    <div class="battle-avatar-wrap">
      ${c.avatar ? `<img class="battle-avatar" src="${c.avatar}" alt="" onerror="this.style.display='none'">` : '<div class="battle-avatar"></div>'}
      ${streak}
    </div>
    <div class="battle-name">${escHtml(c.name)}</div>
    <div class="battle-subs">${formatNum(c.subscriberCount)} subs</div>
    <button class="battle-vote-btn" onclick="battleVote(${idx})">Vote</button>
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

  // Record vote via RPC (SECURITY DEFINER bypasses publishable-key restrictions)
  const { error: voteErr } = await sbRpc('record_battle_vote', {
    w_id: winner.id, l_id: loser.id, fp: battleFingerprint(),
    v_id: currentUser ? currentUser.id : null
  });
  if (voteErr) console.error('Battle vote insert failed:', voteErr);
  battleVoteCount++;

  // Signup prompt for anonymous users after 3 votes
  if (!currentUser) {
    battleSessionVotes++;
    if (battleSessionVotes >= 3 && !battleSignupDismissed) showBattleSignupPrompt();
  }
  const totalEl = document.getElementById('battleTotalVotes');
  if (totalEl) totalEl.textContent = '🗳 ' + formatNum(battleVoteCount) + ' votes cast';

  // Get total battle wins for each creator
  try {
    const [winnerStats, loserStats] = await Promise.all([
      sbRpc('get_creator_battle_stats', { cid: winner.id }),
      sbRpc('get_creator_battle_stats', { cid: loser.id })
    ]);
    const winnerWins = (winnerStats.data && winnerStats.data.length ? Number(winnerStats.data[0].wins) : 0) + 1;
    const loserWins = loserStats.data && loserStats.data.length ? Number(loserStats.data[0].wins) : 0;
    const total = winnerWins + loserWins;
    const winnerPct = total ? Math.round(winnerWins / total * 100) : 100;

    document.getElementById('bpct' + winIdx).textContent = winnerWins + ' wins';
    document.getElementById('bpct' + (1 - winIdx)).textContent = loserWins + ' wins';
    document.getElementById('bfill' + winIdx).style.width = winnerPct + '%';
    document.getElementById('bfill' + (1 - winIdx)).style.width = (100 - winnerPct) + '%';
  } catch (e) {
    document.getElementById('bpct' + winIdx).textContent = '✓';
  }

  setTimeout(() => battleNextMatchup(), 1800);
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

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  const c = code.toUpperCase();
  return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
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

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Database</div>
            <h1 class="page-hero-title">Discover Creators</h1>
            <p class="page-hero-subtitle">${creators.length} creators across ${activeLeagues.length} leagues and ${teams.length} clubs</p>
          </div>
          <a href="/submit" class="btn-cta-band btn-cta-band--yellow" style="flex-shrink:0">+ Suggest a Creator</a>
        </div>
      </div>
    </div>

    <div class="container" style="padding-top:28px;padding-bottom:60px">
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
            <span class="filter-chip ${sort === 'subs' ? 'active' : ''}" onclick="applyFilter('sort','subs')">&#128200; Most Subs</span>
            <span class="filter-chip ${sort === 'name' ? 'active' : ''}" onclick="applyFilter('sort','name')">&#9398; A–Z</span>
            <span class="filter-chip ${favOnly ? 'active' : ''}" onclick="applyFilter('favs','${favOnly ? '' : '1'}')">&#9733; Favorites${favOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>
            <span class="filter-chip ${activeOnly ? 'active' : ''}" onclick="applyFilter('active','${activeOnly ? '' : '1'}')">&#9889; Active (30d)${activeOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>
            ${creators.some(c => c.isLive) ? `<span class="filter-chip ${liveOnly ? 'active' : ''}" onclick="applyFilter('live','${liveOnly ? '' : '1'}')"><span class="live-dot-sm"></span> Live Now${liveOnly ? ' <span class=chip-x>&times;</span>' : ''}</span>` : ''}
          </div>

          <!-- Active filters + result count -->
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <span class="discover-result-count">${filtered.length} creator${filtered.length !== 1 ? 's' : ''}</span>
            ${leagueFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('league','')">${leagueChipImg(leagueFilter)} ${escHtml(leagueFilter)} &times;</span>` : ''}
            ${teamFilter ? `<span class="chip active" style="font-size:.78rem;padding:4px 12px" onclick="applyFilter('team','')">${escHtml(teamFilter)} &times;</span>` : ''}
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

  const isFav = favorites.has(c.id);
  const similar = creators.filter(s => s.team === c.team && s.id !== c.id).slice(0, 4);

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
              ${c.verified ? '<span class="badge badge-green" style="font-size:.7rem;vertical-align:middle">Verified</span>' : ''}
              ${c.isLive ? '<span class="badge badge-live" style="vertical-align:middle">● LIVE</span>' : ''}
            </h1>
            ${c.description ? `<p class="cp-hero-desc">${escHtml(c.description)}</p>` : ''}
            <div class="cp-hero-actions">
              ${c.channel ? `<a href="${safeUrl(c.channel)}" target="_blank" rel="noopener" class="btn btn-yellow cp-cta">▶ Watch on YouTube</a>` : ''}
              ${c.live ? `<a href="${safeUrl(c.live)}" target="_blank" rel="noopener" class="btn btn-ghost-white">📡 Live / Streams</a>` : ''}
              <button class="btn btn-ghost-white${isFav ? ' btn-favourited' : ''}" onclick="handleFavorite('${c.id}')" id="favBtn">${isFav ? '★ Favourited' : '☆ Favourite'}${(favouriteCounts.get(c.id) || 0) > 0 ? ' <span class="fav-count-badge" id="favCount">' + (favouriteCounts.get(c.id)) + '</span>' : ''}</button>
              <button class="cp-report-link" onclick="openReportModal('${c.id}',${JSON.stringify(c.name)})">Report issue</button>
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
            <a href="/clubs/${encodeURIComponent(c.team)}" class="cp-section-link">View all &rarr;</a>
          </div>
          <div class="card-grid">${similar.map(s => creatorCard(s)).join('')}</div>
        </div>` : ''}

        <div class="cta-band" style="border-radius:var(--radius);margin-top:4px;padding:24px 28px">
          <div class="cta-band-inner" style="padding:0">
            <div>
              <div class="cta-band-title">Know a great ${escHtml(c.team)} creator?</div>
              <p class="cta-band-sub">Help us grow the database — submissions reviewed within 24h.</p>
            </div>
            <a href="/submit" class="btn-cta-band">+ Suggest a Creator</a>
          </div>
        </div>
      </div>

      <!-- ── Sidebar ──────────────────────────────────────────────────────── -->
      <aside class="cp-sidebar">
        ${c.subscriberCount ? `
        <div class="cp-sidebar-card">
          <div class="cp-sidebar-title">Subscriber Growth <span style="font-size:.68rem;color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">— last 30 days</span></div>
          <div id="subSparkline" style="padding:12px 0 4px;text-align:center;color:var(--text-muted);font-size:.82rem">Loading…</div>
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
            ${c.live ? `<a href="${safeUrl(c.live)}" target="_blank" rel="noopener" class="cp-link-btn cp-link-live">📡 Live / Streams</a>` : ''}
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
              <div style="font-size:2.4rem;font-weight:800;color:${color};letter-spacing:-.03em;line-height:1">${sign}${formatNum(Math.abs(growth))}</div>
              <div style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-top:6px">subscribers</div>
            </div>`;
        } else {
          sparkEl.innerHTML = `<div style="padding:12px 0;text-align:center;color:var(--text-muted);font-size:.82rem">Not enough data yet</div>`;
        }
      }
    });
  }

  // Async: load battle wins
  sbRpc('get_creator_battle_stats', { cid: c.id }).then(({ data, error }) => {
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
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
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
  const clubUrl = '/clubs/' + encodeURIComponent(club);

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <a href="/discover${clubLeague !== 'Other' ? '?league=' + encodeURIComponent(clubLeague) : ''}" class="page-hero-back">&larr; ${clubLeague !== 'Other' ? escHtml(clubLeague) : 'All clubs'}</a>
        <div class="page-hero-inner">
          ${crestImg(club, 'page-hero-crest')}
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">${leagueInfo ? escHtml(clubLeague) : 'Football Club'}</div>
            <h1 class="page-hero-title">${escHtml(club)}</h1>
            <div class="page-hero-meta">
              <span class="page-hero-tag">${clubCreators.length} creator${clubCreators.length !== 1 ? 's' : ''}</span>
              ${clubCreators.filter(c => c.isLive).length ? `<span class="page-hero-tag" style="background:rgba(230,57,70,.2);border-color:rgba(230,57,70,.3);color:#ff8080">● ${clubCreators.filter(c => c.isLive).length} live</span>` : ''}
            </div>
          </div>
          <div class="page-hero-actions">
            <a href="/clubs/${encodeURIComponent(club)}/videos" class="btn btn-ghost-white btn-sm">📺 Videos</a>
            <a href="/submit" class="btn-cta-band btn-cta-band--yellow" style="padding:8px 18px;font-size:.82rem">+ Suggest</a>
          </div>
        </div>
      </div>
    </div>

    <div class="container" style="padding-top:28px;padding-bottom:60px">
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
          <a href="/submit" class="btn-cta-band">+ Suggest a Creator</a>
        </div>
      </div>
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

    <div class="container" style="padding-top:28px;padding-bottom:60px">
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-head-title">${crestImg(club, 'crest-sm')} Recent Uploads</div>
          <span style="font-size:.82rem;color:var(--text-muted)">${videos.length} video${videos.length !== 1 ? 's' : ''}</span>
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
async function renderRankings() {
  const params = new URLSearchParams(location.search);
  const leagueFilter = params.get('league') || '';
  const teamFilter = params.get('team') || '';
  const mode = params.get('mode') || 'winpct';
  if (mode === 'voters') return renderVoterLeaderboard();

  // Fetch battle stats for all creators (5s timeout to avoid blocking render)
  let battleMap = {};
  try {
    const bTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('battle stats timeout')), 5000));
    const { data: bStats } = await Promise.race([sbRpc('get_all_battle_stats'), bTimeout]);
    if (bStats) bStats.forEach(s => {
      battleMap[s.creator_id] = { wins: Number(s.wins) || 0, losses: Number(s.losses) || 0, total: Number(s.total) || 0, winPct: Number(s.win_pct) || 0 };
    });
  } catch (_) {}

  let ranked = [...creators].filter(c => c.subscriberCount > 0);
  if (leagueFilter) ranked = ranked.filter(c => (c.league || getLeague(c.team)) === leagueFilter);
  if (teamFilter) ranked = ranked.filter(c => c.team === teamFilter);

  // Attach battle stats to each creator for sorting
  ranked.forEach(c => {
    c._battle = battleMap[c.id] || { wins: 0, losses: 0, total: 0, winPct: 0 };
  });

  // Sort based on mode
  if (mode === 'wins') {
    ranked.sort((a, b) => b._battle.wins - a._battle.wins || b._battle.winPct - a._battle.winPct || b.subscriberCount - a.subscriberCount);
  } else if (mode === 'winpct') {
    // Win % sort: require at least 1 battle, then sort by % desc, wins desc as tiebreaker
    ranked.sort((a, b) => {
      const aHas = a._battle.total > 0 ? 1 : 0;
      const bHas = b._battle.total > 0 ? 1 : 0;
      if (bHas !== aHas) return bHas - aHas;
      if (aHas && bHas) return b._battle.winPct - a._battle.winPct || b._battle.wins - a._battle.wins || b.subscriberCount - a.subscriberCount;
      return b.subscriberCount - a.subscriberCount;
    });
  } else {
    ranked.sort((a, b) => b.subscriberCount - a.subscriberCount);
  }

  // Build team strip
  const stripTeams = [];
  if (leagueFilter) {
    Object.entries(TEAM_TO_LEAGUE).filter(([t, lg]) => lg === leagueFilter).forEach(([t]) => stripTeams.push(t));
  } else {
    Object.keys(TEAM_TO_LEAGUE).forEach(t => stripTeams.push(t));
  }
  stripTeams.sort();

  // Build sort URL helper
  function sortUrl(s) {
    const p = new URLSearchParams();
    if (leagueFilter) p.set('league', leagueFilter);
    if (teamFilter) p.set('team', teamFilter);
    if (s !== 'winpct') p.set('mode', s);
    return '/rankings' + (p.toString() ? '?' + p.toString() : '');
  }

  // Subtitle based on mode
  const subtitles = { subs: 'Ranked by YouTube subscriber count.', wins: 'Ranked by Creator Battle wins.', winpct: 'Ranked by Creator Battle win percentage.' };
  const scoreLabels = { subs: 'subscribers', wins: 'wins', winpct: 'win %' };

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">&#127942; Weekly Rankings</div>
            <h1 class="page-hero-title">Creator Rankings</h1>
            <p class="page-hero-subtitle">${subtitles[mode] || subtitles.winpct}</p>
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

    <div class="container" style="padding-top:28px;padding-bottom:60px">
      ${ranked.length ? `
      <div class="sc-card" style="margin-bottom:0">
        <div class="sc-head" style="flex-wrap:wrap;gap:8px">
          <div class="sc-head-title">&#127942; ${teamFilter ? escHtml(teamFilter) : (leagueFilter ? escHtml(leagueFilter) : 'All Leagues')}</div>
          <div class="rk-sort-row">
            <span class="rk-sort-label">Sort by</span>
            <button class="rk-sort-btn${mode === 'winpct' ? ' rk-sort-btn--active' : ''}" onclick="navigate('${sortUrl('winpct')}')">Win %</button>
            <button class="rk-sort-btn${mode === 'wins' ? ' rk-sort-btn--active' : ''}" onclick="navigate('${sortUrl('wins')}')">Battles Won</button>
            <button class="rk-sort-btn${mode === 'subs' ? ' rk-sort-btn--active' : ''}" onclick="navigate('${sortUrl('subs')}')">Subscribers</button>
          </div>
        </div>
        <div class="sc-body--tight">
      <div class="rankings-card" style="border:none;border-radius:0;box-shadow:none">${ranked.map((c, i) => {
        const rankClass = i < 3 ? ' rk-row--top rk-row--top' + (i + 1) : '';
        const b = c._battle;
        const currentRank = i + 1;
        // Score display based on sort mode
        let scoreHtml = '';
        if (mode === 'winpct') {
          scoreHtml = b.total > 0
            ? `<div class="rk-score-num">${b.winPct}%</div><div class="rk-score-label">${b.wins}W–${b.losses}L</div>`
            : `<div class="rk-score-num" style="color:var(--text-muted)">–</div><div class="rk-score-label">no battles</div>`;
        } else if (mode === 'wins') {
          scoreHtml = `<div class="rk-score-num">${b.wins}</div><div class="rk-score-label">${b.total > 0 ? b.winPct + '% win' : 'no battles'}</div>`;
        } else {
          scoreHtml = `<div class="rk-score-num">${formatNum(c.subscriberCount)}</div><div class="rk-score-label">subscribers</div>`;
        }
        // Battle mini-stat for subs mode
        const battleMini = mode === 'subs' && b.total > 0 ? `<span class="rk-battle-mini" title="${b.wins}W–${b.losses}L (${b.winPct}%)">⚔ ${b.wins}W ${b.winPct}%</span>` : '';
        return `
        <a href="${creatorLink(c)}" class="rk-row${rankClass}${c.isLive ? ' rk-row--live' : ''}">
          <div class="rk-rank">${currentRank}</div>
          <span class="av-wrap">${avatarImg(c, 'rk-avatar')}</span>
          <div class="rk-info">
            <div class="rk-name">${liveDot(c.isLive)}${escHtml(c.name)}${c.verified ? ' <span class="rk-verified" title="Verified">&#10003;</span>' : ''}</div>
            <div class="rk-team">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)}</div>
          </div>
          <div class="rk-meta">${battleMini || (b.total > 0 && mode !== 'subs' ? formatNum(c.subscriberCount) + ' subs' : '')}</div>
          <div class="rk-score">${scoreHtml}</div>
          <span class="rk-arrow">&rsaquo;</span>
        </a>
      `;}).join('')}</div>
        </div>
      </div>` :
        `<div class="empty-state"><div class="es-icon">&#127942;</div><div class="es-title">No rankings yet</div><p style="color:var(--text-dim)">No subscriber data available.</p></div>`}
    </div>
    ${renderFooter()}
  `;
}

// ── Render: Voter Leaderboard ─────────────────────────────────────────────
async function renderVoterLeaderboard() {
  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">&#127942; Weekly Rankings</div>
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
    <div class="container" style="padding-top:28px;padding-bottom:60px">
      <div id="voterLbBody"><div class="empty-state" style="padding:40px 0"><div style="color:var(--text-dim)">Loading leaderboard…</div></div></div>
    </div>${renderFooter()}`;

  const { data: voters, error } = await sbRpc('get_top_voters', { lim: 50 });
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
        <div style="font-size:.82rem;color:var(--text-dim)">${voters.length} voter${voters.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="sc-body--tight">
        <div class="rankings-card" style="border:none;border-radius:0;box-shadow:none">
          ${voters.map((v, i) => {
            const rankClass = i < 3 ? ' rk-row--top rk-row--top' + (i + 1) : '';
            return `<div class="rk-row${rankClass}" style="cursor:default">
              <div class="rk-rank">${i + 1}</div>
              <span class="av-wrap"><div class="rk-avatar avatar-fallback" style="width:40px;height:40px;font-size:.8rem">${(v.display_name || '?')[0].toUpperCase()}</div></span>
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

    <div class="container" style="max-width:560px;padding-top:28px;padding-bottom:60px">
      <div id="submitForm">
        <div class="sc-card" style="margin-bottom:0">
          <div class="sc-head"><div class="sc-head-title">Creator details</div></div>
          <div class="sc-body">
          <div style="margin-bottom:14px">
            <label class="field-label">YouTube Channel URL</label>
            <input type="text" id="sub_channel" class="admin-form-input" placeholder="e.g. https://www.youtube.com/@AFTVmedia" oninput="checkDuplicateChannel(this.value)">
            <div id="channelDupeWarn" class="dupe-warn"></div>
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">We'll fetch the channel name automatically.</div>
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
          <button class="btn-generate" onclick="submitCreator()" style="margin-top:8px">Submit for Review</button>
          <div id="submitMsg" style="text-align:center;margin-top:12px;font-size:.85rem"></div>
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

  document.getElementById('submitForm').innerHTML = '<div style="text-align:center;padding:40px 0"><div style="font-size:2rem;margin-bottom:12px">&#10003;</div><h2 style="font-size:1.2rem;font-weight:700;margin-bottom:6px">Thank you!</h2><p style="color:var(--text-dim);font-size:.9rem;margin-bottom:20px">Your submission is under review. If approved, the creator will appear on the site.</p><a href="/discover" class="btn btn-primary">Browse Creators</a></div>';
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
    <div class="container" style="max-width:720px;padding-top:28px;padding-bottom:60px">
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
      sbRpc('get_voter_stats', { uid: currentUser.id }),
      sbRpc('get_voter_preferred_creators', { uid: currentUser.id, lim: 5 })
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
              <span id="acctAvatarMsg" style="font-size:.78rem;color:var(--text-muted)"></span>
            </div>
            <div style="font-size:.72rem;color:var(--text-muted)">JPG, PNG, WebP or GIF — up to 2MB.</div>
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
    const _avToken = _getAccessToken();
    if (_avToken === SUPABASE_KEY) { msg.textContent = 'Please sign in again.'; msg.style.color = 'var(--red)'; return; }
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${_avToken}`,
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
    if (preview) preview.innerHTML = `<img src="${escHtml(publicUrl)}" alt="">`;
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
  const token = _getAccessToken();
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
      { headers: _sbAuthHeaders() }
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
  if (type === 'reset') {
    modal.innerHTML = `
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <h2>Reset your password</h2>
      <p class="modal-sub">Enter your email and we'll send you a link to reset your password.</p>
      <label>Email</label>
      <input type="email" id="authEmail" placeholder="you@example.com">
      <button class="btn btn-primary" onclick="handleResetPassword()">Send Reset Link</button>
      <div class="auth-msg" id="authMsg"></div>
      <div class="switch-link">
        <a href="#" onclick="event.preventDefault();openModal('signin')">Back to Sign In</a>
      </div>`;
    overlay.classList.add('open');
    return;
  }
  const isSignIn = type === 'signin';
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2>${isSignIn ? 'Welcome back' : 'Create an account'}</h2>
    <p class="modal-sub">${isSignIn ? 'Sign in to follow and favourite creators.' : 'Join the community of football YouTube fans.'}</p>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@example.com">
    <label>Password</label>
    <input type="password" id="authPass" placeholder="${isSignIn ? 'Your password' : 'Choose a password'}">
    ${isSignIn ? '<a href="#" class="forgot-link" onclick="event.preventDefault();openModal(\'reset\')">Forgot your password?</a>' : ''}
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

async function handleResetPassword() {
  const email = document.getElementById('authEmail').value.trim();
  const msg = document.getElementById('authMsg');
  if (!email) { msg.textContent = 'Please enter your email address.'; return; }
  try {
    const { error } = await _authPost('recover', {
      email,
      gotrue_meta_security: { captcha_token: '' },
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
let _swLeague = '';
let _swMuted = false;

function swFilterLeague(el, league) {
  _swLeague = league;
  el.parentNode.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filterStreamwall();
}

function filterStreamwall() {
  const q = (document.getElementById('swSearch') || {}).value || '';
  const ql = q.toLowerCase();
  const grid = document.getElementById('swCardGrid');
  if (!grid) return;
  let filtered = creators.slice();
  if (_swLeague) filtered = filtered.filter(c => (c.league || getLeague(c.team)) === _swLeague);
  if (ql) filtered = filtered.filter(c => c.name.toLowerCase().includes(ql) || c.team.toLowerCase().includes(ql) || (c.league || '').toLowerCase().includes(ql));
  filtered.sort((a, b) => (b.isLive ? 1 : 0) - (a.isLive ? 1 : 0) || b.subscriberCount - a.subscriberCount);
  grid.innerHTML = filtered.length
    ? filtered.map(c => creatorCard(c)).join('')
    : '<div class="sw-empty"><div class="sw-empty-icon">&#128269;</div><div class="sw-empty-title">No creators found</div><div class="sw-empty-desc">Try a different search or filter.</div></div>';
}

function swMuteAll() {
  _swMuted = !_swMuted;
  document.querySelectorAll('.sw-tile-video iframe').forEach(iframe => {
    try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: _swMuted ? 'mute' : 'unMute', args: [] }), '*'); } catch (e) {}
  });
  const btn = document.getElementById('swMuteBtn');
  if (btn) btn.innerHTML = _swMuted ? '&#128266; Unmute All' : '&#128263; Mute All';
}

function swSeekLive() {
  document.querySelectorAll('.sw-tile-video iframe').forEach(iframe => {
    try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [99999, true] }), '*'); } catch (e) {}
  });
}

function renderStreamwall() {
  const liveCreators = creators.filter(c => c.isLive && c.liveVideoId);
  const sorted = [...creators].sort((a, b) => (b.isLive ? 1 : 0) - (a.isLive ? 1 : 0) || b.subscriberCount - a.subscriberCount);
  _swLeague = '';
  _swMuted = false;

  document.getElementById('app').innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Live</div>
            <h1 class="page-hero-title">Streamwall</h1>
            <p class="page-hero-subtitle">Watch multiple football creators streaming live, all at once. Filter by league, search by name, or browse all ${creators.length} creators.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="container" style="padding-top:28px;padding-bottom:60px">
      <!-- Toolbar -->
      <div class="sw-toolbar">
        <div class="sw-search-wrap">
          <span class="sw-search-icon">&#128269;</span>
          <input class="sw-search-input" type="text" placeholder="Search creators by name or club..." id="swSearch" oninput="filterStreamwall()">
        </div>
        <div class="sw-filter-row">
          <span class="chip active" onclick="swFilterLeague(this,'')">All</span>
          ${LEAGUES.map(l => `<span class="chip" onclick="swFilterLeague(this,'${escHtml(l.name)}')">${leagueChipImg(l.name)} ${escHtml(l.name)}</span>`).join('')}
        </div>
        ${liveCreators.length ? `
        <div class="sw-controls">
          <button class="sw-ctrl-btn" onclick="swMuteAll()" id="swMuteBtn">&#128263; Mute All</button>
          <button class="sw-ctrl-btn" onclick="swSeekLive()">&#128308; Go Live</button>
        </div>` : ''}
        <div class="sw-stats"><strong>${creators.length}</strong> creators${liveCreators.length ? ` &middot; <strong style="color:var(--red,#e53935)">${liveCreators.length}</strong> live now` : ''}</div>
      </div>

      ${liveCreators.length ? `
      <!-- Live Section -->
      <div class="sw-section">
        <div class="sw-section-head">
          <div class="sw-section-title"><span class="live-dot-sm"></span> Live Now <span class="sw-live-count">${liveCreators.length}</span></div>
        </div>
        <div class="sw-live-grid">
          ${liveCreators.slice(0, 8).map(c => `
            <div class="sw-tile">
              <div class="sw-tile-video">
                <iframe src="https://www.youtube.com/embed/${safeId(c.liveVideoId)}?autoplay=0&enablejsapi=1" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
              </div>
              <div class="sw-tile-bar">
                ${avatarImg(c, 'sw-tile-avatar')}
                <div class="sw-tile-info">
                  <div class="sw-tile-name"><a href="${creatorLink(c)}">${escHtml(c.name)}</a></div>
                  <div class="sw-tile-meta">${crestImg(c.team, 'crest-sm')} ${escHtml(c.team)} ${c.subscriberCount ? '&middot; ' + formatNum(c.subscriberCount) + ' subs' : ''}</div>
                </div>
                <a href="https://youtube.com/watch?v=${safeId(c.liveVideoId)}" target="_blank" rel="noopener" class="btn btn-sm" style="background:var(--red,#e53935);color:#fff;flex-shrink:0;font-size:.72rem">Watch &rarr;</a>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : `
      <div class="sc-card" style="margin-bottom:24px">
        <div class="sc-body sw-empty">
          <div class="sw-empty-icon">&#128225;</div>
          <div class="sw-empty-title">No one is live right now</div>
          <div class="sw-empty-desc">When football creators go live, their streams will appear here in a multi-view grid. Browse all creators below.</div>
        </div>
      </div>`}

      <!-- Browse All Creators -->
      <div class="sw-section">
        <div class="sw-section-head">
          <div class="sw-section-title">All Creators</div>
        </div>
        <div class="sw-card-grid" id="swCardGrid">
          ${sorted.map(c => creatorCard(c)).join('')}
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;
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

    <div class="container" style="padding-top:28px;padding-bottom:60px">
      <div class="sc-card" style="margin-bottom:24px">
        <div class="sc-body" style="padding:0;overflow:hidden">
          <div style="aspect-ratio:16/9;width:100%;background:#000">
            <iframe src="https://www.youtube.com/embed/RA7-Wtsk8Pg" style="width:100%;height:100%;border:0" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
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
          <a href="/submit" class="btn-yellow" onclick="event.preventDefault();navigate('/submit')">+ Submit Your Channel</a>
        </div>
      </div>
    </div>
    ${renderFooter()}
  `;
}

// ── Feature Requests ─────────────────────────────────────────────────────

const FR_CATEGORIES = [
  'Website Features','Mobile Experience','Watch Along Features','Community Features',
  'Statistics & Data','User Profiles','Notifications','Fantasy & Prediction Games','Other'
];

const FR_STATUSES = {
  open:           { label: 'Open',           color: 'var(--blue,#3b82f6)' },
  under_review:   { label: 'Under Review',   color: 'var(--yellow,#f59e0b)' },
  planned:        { label: 'Planned',        color: 'var(--purple,#8b5cf6)' },
  in_development: { label: 'In Development', color: 'var(--orange,#f97316)' },
  released:       { label: 'Released',       color: 'var(--green,#22c55e)' },
  declined:       { label: 'Declined',       color: 'var(--red,#ef4444)' }
};

function frStatusBadge(status) {
  const s = FR_STATUSES[status] || FR_STATUSES.open;
  return `<span class="fr-status" style="--fr-status-color:${s.color}">${s.label}</span>`;
}

function frTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ── Feature Requests: Listing Page ───────────────────────────────────────

async function renderFeatureRequests() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="fr-hero">
      <div class="container">
        <h1>Community Feature Requests</h1>
        <p class="fr-hero-sub">Help shape the future of Fan Reactions FC.</p>
        <button class="btn btn-primary fr-suggest-btn" onclick="openFeatureSubmitModal()">+ Suggest a Feature</button>
      </div>
    </div>
    <div class="container fr-container">
      <div class="fr-toolbar">
        <div class="fr-search-wrap">
          <input type="text" class="fr-search" id="frSearch" placeholder="Search ideas..." oninput="filterFeatureRequests()">
        </div>
        <div class="fr-filters">
          <select id="frCategoryFilter" class="fr-select" onchange="filterFeatureRequests()">
            <option value="">All Categories</option>
            ${FR_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <select id="frStatusFilter" class="fr-select" onchange="filterFeatureRequests()">
            <option value="">All Statuses</option>
            ${Object.entries(FR_STATUSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
          </select>
          <select id="frSort" class="fr-select" onchange="filterFeatureRequests()">
            <option value="popular">Most Popular</option>
            <option value="newest">Newest</option>
            <option value="trending">Trending</option>
            <option value="updated">Recently Updated</option>
          </select>
        </div>
      </div>
      <div id="frList" class="fr-list"><div class="fr-loading">Loading ideas...</div></div>
    </div>
    ${renderFooter()}`;
  await loadFeatureRequests();
}

let _frCache = [];
let _frUserVotes = new Set();

async function loadFeatureRequests() {
  const { data, error } = await sbGet('frfc_feature_requests?select=*&merged_into=is.null&order=is_pinned.desc,vote_count.desc,created_at.desc');
  if (error) {
    document.getElementById('frList').innerHTML = '<div class="fr-empty">Could not load feature requests.</div>';
    return;
  }
  _frCache = data || [];

  if (currentUser) {
    const { data: votes } = await sbGet(`frfc_feature_votes?select=feature_id&user_id=eq.${currentUser.id}`);
    _frUserVotes = new Set((votes || []).map(v => v.feature_id));
  } else {
    _frUserVotes = new Set();
  }

  filterFeatureRequests();
}

function filterFeatureRequests() {
  const search = (document.getElementById('frSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('frCategoryFilter')?.value || '';
  const status = document.getElementById('frStatusFilter')?.value || '';
  const sort = document.getElementById('frSort')?.value || 'popular';

  let filtered = _frCache.filter(r => {
    if (cat && r.category !== cat) return false;
    if (status && r.status !== status) return false;
    if (search && !r.title.toLowerCase().includes(search) && !r.description.toLowerCase().includes(search)) return false;
    return true;
  });

  if (sort === 'popular') filtered.sort((a, b) => (b.is_pinned - a.is_pinned) || (b.vote_count - a.vote_count));
  else if (sort === 'newest') filtered.sort((a, b) => (b.is_pinned - a.is_pinned) || new Date(b.created_at) - new Date(a.created_at));
  else if (sort === 'trending') filtered.sort((a, b) => {
    const aAge = (Date.now() - new Date(a.created_at).getTime()) / 3600000;
    const bAge = (Date.now() - new Date(b.created_at).getTime()) / 3600000;
    return (b.is_pinned - a.is_pinned) || ((b.vote_count / (bAge + 2)) - (a.vote_count / (aAge + 2)));
  });
  else if (sort === 'updated') filtered.sort((a, b) => (b.is_pinned - a.is_pinned) || new Date(b.updated_at) - new Date(a.updated_at));

  const list = document.getElementById('frList');
  if (!list) return;

  if (!filtered.length) {
    list.innerHTML = '<div class="fr-empty">No feature requests found.</div>';
    return;
  }

  list.innerHTML = filtered.map(r => {
    const voted = _frUserVotes.has(r.id);
    return `
      <div class="fr-card ${r.is_pinned ? 'fr-card--pinned' : ''}">
        <div class="fr-vote-col">
          <button class="fr-vote-btn ${voted ? 'fr-vote-btn--active' : ''}" onclick="event.stopPropagation();toggleFeatureVote('${r.id}')" title="${voted ? 'Remove vote' : 'Upvote'}">
            <svg width="14" height="10" viewBox="0 0 14 10"><path d="M7 0l7 10H0z" fill="currentColor"/></svg>
          </button>
          <span class="fr-vote-count">${r.vote_count}</span>
        </div>
        <div class="fr-card-body" onclick="navigate('/community/features/${r.id}')">
          <div class="fr-card-header">
            ${r.is_pinned ? '<span class="fr-pin" title="Pinned">📌</span>' : ''}
            <h3 class="fr-card-title">${escHtml(r.title)}</h3>
            ${frStatusBadge(r.status)}
          </div>
          <p class="fr-card-desc">${escHtml(r.description.length > 140 ? r.description.slice(0, 140) + '…' : r.description)}</p>
          <div class="fr-card-meta">
            <span class="fr-card-cat">${escHtml(r.category)}</span>
            <span>💬 ${r.comment_count}</span>
            <span>${frTimeAgo(r.created_at)}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Feature Requests: Vote Toggle ────────────────────────────────────────

async function toggleFeatureVote(featureId) {
  if (!currentUser) { openModal('signin'); return; }

  const hasVote = _frUserVotes.has(featureId);
  const card = _frCache.find(r => r.id === featureId);

  if (hasVote) {
    _frUserVotes.delete(featureId);
    if (card) card.vote_count = Math.max(0, card.vote_count - 1);
    filterFeatureRequests();
    updateDetailVoteUI(featureId, false, card?.vote_count);
    await sbDelete(`frfc_feature_votes?feature_id=eq.${featureId}&user_id=eq.${currentUser.id}`);
    await sbRpc('frfc_feature_vote_down', { p_feature_id: featureId });
  } else {
    _frUserVotes.add(featureId);
    if (card) card.vote_count++;
    filterFeatureRequests();
    updateDetailVoteUI(featureId, true, card?.vote_count);
    await sbPost('frfc_feature_votes', { feature_id: featureId, user_id: currentUser.id });
    await sbRpc('frfc_feature_vote_up', { p_feature_id: featureId });
  }
}

function updateDetailVoteUI(featureId, voted, count) {
  const btn = document.querySelector('.fr-detail-vote-btn');
  const countEl = document.querySelector('.fr-detail-vote-count');
  if (btn) {
    btn.classList.toggle('fr-vote-btn--active', voted);
    btn.title = voted ? 'Remove vote' : 'Upvote this idea';
  }
  if (countEl && count !== undefined) countEl.textContent = count;
}

// ── Feature Requests: Submission Modal ───────────────────────────────────

function openFeatureSubmitModal() {
  if (!currentUser) { openModal('signin'); return; }
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2>Suggest a Feature</h2>
    <p class="modal-sub">Describe your idea and the community will vote on it.</p>
    <label>Title</label>
    <input type="text" id="frTitle" placeholder="Short, descriptive title" maxlength="120">
    <label>Category</label>
    <select id="frCategory" class="fr-select" style="width:100%;margin-bottom:14px">
      ${FR_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
    <label>Description</label>
    <textarea id="frDesc" placeholder="Explain what you'd like and why it matters..." style="width:100%;min-height:120px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.88rem;resize:vertical;margin-bottom:14px"></textarea>
    <button class="btn btn-primary" style="width:100%" onclick="submitFeatureRequest()">Submit Idea</button>
    <div class="auth-msg" id="frMsg"></div>`;
  overlay.classList.add('open');
}

async function submitFeatureRequest() {
  const title = document.getElementById('frTitle')?.value.trim();
  const category = document.getElementById('frCategory')?.value;
  const description = document.getElementById('frDesc')?.value.trim();
  const msg = document.getElementById('frMsg');

  if (!title || title.length < 5) { msg.textContent = 'Title must be at least 5 characters.'; msg.style.color = 'var(--red)'; return; }
  if (!description || description.length < 20) { msg.textContent = 'Description must be at least 20 characters.'; msg.style.color = 'var(--red)'; return; }

  msg.textContent = 'Submitting...'; msg.style.color = 'var(--text-dim)';

  const { data, error } = await sbPost('frfc_feature_requests', {
    user_id: currentUser.id,
    title,
    description,
    category
  }, { prefer: 'return=representation' });

  if (error) {
    msg.textContent = error.message || 'Failed to submit.';
    msg.style.color = 'var(--red)';
    return;
  }

  closeModal();
  if (currentRoute.page === 'features') {
    await loadFeatureRequests();
  } else {
    navigate('/community/features');
  }
}

// ── Feature Requests: Detail Page ────────────────────────────────────────

async function renderFeatureDetail(featureId) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="container" style="padding:60px 20px;text-align:center"><div style="color:var(--text-dim)">Loading...</div></div>`;

  const { data, error } = await sbGet(`frfc_feature_requests?select=*&id=eq.${featureId}&limit=1`);
  if (error || !data || !data.length) {
    app.innerHTML = `<div class="container" style="padding:60px 20px;text-align:center"><div class="empty-state"><div class="es-icon">&#128269;</div><div class="es-title">Feature request not found</div><a href="/community/features" class="btn btn-primary" style="margin-top:12px">Back to Features</a></div></div>${renderFooter()}`;
    return;
  }

  if (data[0].merged_into) {
    navigate(`/community/features/${data[0].merged_into}`, false);
    return;
  }

  const r = data[0];
  updatePageMeta(`${r.title} | Feature Requests | FanReactionsFC`, r.description.slice(0, 160));

  if (currentUser) {
    const { data: votes } = await sbGet(`frfc_feature_votes?select=feature_id&user_id=eq.${currentUser.id}&feature_id=eq.${featureId}`);
    _frUserVotes = new Set((votes || []).map(v => v.feature_id));
  }

  const voted = _frUserVotes.has(r.id);

  let isAdmin = false;
  if (currentUser) {
    try {
      const adminRes = await fetch(`${SUPABASE_URL}/rest/v1/frfc_admin_roles?select=role&user_id=eq.${currentUser.id}`, { headers: _sbAuthHeaders() });
      if (adminRes.ok) { const rows = await adminRes.json(); isAdmin = rows.length > 0; }
    } catch {}
  }

  let statusLog = [];
  const { data: logData } = await sbGet(`frfc_feature_status_log?select=*&feature_id=eq.${featureId}&order=created_at.desc`);
  statusLog = logData || [];

  app.innerHTML = `
    <div class="container fr-detail-container">
      <a href="/community/features" class="fr-back-link">← All Feature Requests</a>

      <div class="fr-detail">
        <div class="fr-detail-sidebar">
          <button class="fr-vote-btn fr-detail-vote-btn ${voted ? 'fr-vote-btn--active' : ''}" onclick="toggleFeatureVote('${r.id}')" title="${voted ? 'Remove vote' : 'Upvote this idea'}">
            <svg width="18" height="12" viewBox="0 0 14 10"><path d="M7 0l7 10H0z" fill="currentColor"/></svg>
          </button>
          <span class="fr-detail-vote-count">${r.vote_count}</span>
          <span class="fr-detail-vote-label">votes</span>
        </div>

        <div class="fr-detail-main">
          <div class="fr-detail-header">
            <h1 class="fr-detail-title">${escHtml(r.title)}</h1>
            ${frStatusBadge(r.status)}
          </div>
          <div class="fr-detail-meta">
            <span class="fr-card-cat">${escHtml(r.category)}</span>
            <span>${frTimeAgo(r.created_at)}</span>
            <span>💬 ${r.comment_count} comments</span>
          </div>
          <div class="fr-detail-desc">${escHtml(r.description).replace(/\n/g, '<br>')}</div>

          ${r.admin_response ? `
            <div class="fr-official-response">
              <div class="fr-official-label">Official Response</div>
              <p>${escHtml(r.admin_response).replace(/\n/g, '<br>')}</p>
              ${r.admin_response_at ? `<div class="fr-official-time">${frTimeAgo(r.admin_response_at)}</div>` : ''}
            </div>` : ''}

          ${statusLog.length ? `
            <div class="fr-status-timeline">
              <h3>Status History</h3>
              ${statusLog.map(l => `
                <div class="fr-status-event">
                  ${frStatusBadge(l.new_status)}
                  ${l.note ? `<span class="fr-status-note">${escHtml(l.note)}</span>` : ''}
                  <span class="fr-status-time">${frTimeAgo(l.created_at)}</span>
                </div>`).join('')}
            </div>` : ''}

          ${isAdmin ? renderFeatureAdminPanel(r) : ''}

          <div class="fr-comments-section" id="frComments">
            <h3>Discussion</h3>
            ${r.is_locked ? '<p class="fr-locked-notice">🔒 This discussion is locked.</p>' : ''}
            <div id="frCommentList"><div style="color:var(--text-dim);font-size:.85rem">Loading comments...</div></div>
            ${!r.is_locked ? `
              <div class="fr-comment-form" id="frCommentForm">
                <textarea id="frCommentBody" placeholder="${currentUser ? 'Add a comment...' : 'Sign in to comment'}" ${currentUser ? '' : 'disabled'} style="width:100%;min-height:80px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.88rem;resize:vertical"></textarea>
                <button class="btn btn-primary" style="margin-top:8px" onclick="postFeatureComment('${r.id}')" ${currentUser ? '' : 'disabled'}>Post Comment</button>
                <span class="auth-msg" id="frCommentMsg"></span>
              </div>` : ''}
          </div>
        </div>
      </div>
    </div>
    ${renderFooter()}`;

  loadFeatureComments(featureId);
}

// ── Feature Requests: Admin Panel ────────────────────────────────────────

function renderFeatureAdminPanel(r) {
  return `
    <div class="fr-admin-panel">
      <h3>Admin Actions</h3>
      <div class="fr-admin-row">
        <label>Status</label>
        <select id="frAdminStatus" class="fr-select">
          ${Object.entries(FR_STATUSES).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <input type="text" id="frAdminStatusNote" placeholder="Note (optional)" class="fr-admin-note-input">
        <button class="btn btn-primary btn-sm" onclick="adminUpdateFeatureStatus('${r.id}')">Update Status</button>
      </div>
      <div class="fr-admin-row">
        <label>Official Response</label>
        <textarea id="frAdminResponse" style="width:100%;min-height:60px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.85rem;resize:vertical">${r.admin_response ? escHtml(r.admin_response) : ''}</textarea>
        <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="adminPostOfficialResponse('${r.id}')">Save Response</button>
      </div>
      <div class="fr-admin-row fr-admin-toggles">
        <button class="btn btn-sm ${r.is_pinned ? 'btn-ghost' : 'btn-ghost'}" onclick="adminToggleFeaturePin('${r.id}', ${!r.is_pinned})">${r.is_pinned ? '📌 Unpin' : '📌 Pin'}</button>
        <button class="btn btn-sm btn-ghost" onclick="adminToggleFeatureLock('${r.id}', ${!r.is_locked})">${r.is_locked ? '🔓 Unlock' : '🔒 Lock'}</button>
        <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="adminDeleteFeatureRequest('${r.id}')">🗑 Delete</button>
      </div>
      <div class="fr-admin-row">
        <label>Merge Into (paste target feature ID)</label>
        <input type="text" id="frMergeTarget" placeholder="Target feature ID" style="flex:1">
        <button class="btn btn-sm btn-ghost" onclick="adminMergeFeature('${r.id}')">Merge</button>
      </div>
      <div class="auth-msg" id="frAdminMsg"></div>
    </div>`;
}

async function adminUpdateFeatureStatus(featureId) {
  const newStatus = document.getElementById('frAdminStatus')?.value;
  const note = document.getElementById('frAdminStatusNote')?.value.trim();
  const msg = document.getElementById('frAdminMsg');
  if (!newStatus) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/frfc_feature_requests?id=eq.${featureId}`, {
    method: 'PATCH',
    headers: _sbAuthHeaders(),
    body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() })
  });

  if (!res.ok) {
    msg.textContent = 'Failed to update status.'; msg.style.color = 'var(--red)'; return;
  }

  await sbPost('frfc_feature_status_log', { feature_id: featureId, new_status: newStatus, changed_by: currentUser.id, note: note || null });
  msg.textContent = 'Status updated!'; msg.style.color = 'var(--green)';
  setTimeout(() => renderFeatureDetail(featureId), 800);
}

async function adminPostOfficialResponse(featureId) {
  const body = document.getElementById('frAdminResponse')?.value.trim();
  const msg = document.getElementById('frAdminMsg');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/frfc_feature_requests?id=eq.${featureId}`, {
    method: 'PATCH',
    headers: _sbAuthHeaders(),
    body: JSON.stringify({ admin_response: body || null, admin_response_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  });

  if (!res.ok) { msg.textContent = 'Failed to save response.'; msg.style.color = 'var(--red)'; return; }
  msg.textContent = 'Response saved!'; msg.style.color = 'var(--green)';
  setTimeout(() => renderFeatureDetail(featureId), 800);
}

async function adminToggleFeaturePin(featureId, pinned) {
  await fetch(`${SUPABASE_URL}/rest/v1/frfc_feature_requests?id=eq.${featureId}`, {
    method: 'PATCH', headers: _sbAuthHeaders(), body: JSON.stringify({ is_pinned: pinned })
  });
  renderFeatureDetail(featureId);
}

async function adminToggleFeatureLock(featureId, locked) {
  await fetch(`${SUPABASE_URL}/rest/v1/frfc_feature_requests?id=eq.${featureId}`, {
    method: 'PATCH', headers: _sbAuthHeaders(), body: JSON.stringify({ is_locked: locked })
  });
  renderFeatureDetail(featureId);
}

async function adminDeleteFeatureRequest(featureId) {
  if (!confirm('Delete this feature request permanently?')) return;
  await sbDelete(`frfc_feature_requests?id=eq.${featureId}`);
  navigate('/community/features');
}

async function adminMergeFeature(sourceId) {
  const targetId = document.getElementById('frMergeTarget')?.value.trim();
  const msg = document.getElementById('frAdminMsg');
  if (!targetId) { msg.textContent = 'Enter target feature ID.'; msg.style.color = 'var(--red)'; return; }
  await sbRpc('frfc_feature_merge', { p_source_id: sourceId, p_target_id: targetId });
  msg.textContent = 'Merged! Redirecting...'; msg.style.color = 'var(--green)';
  setTimeout(() => navigate(`/community/features/${targetId}`), 800);
}

// ── Feature Requests: Comments ───────────────────────────────────────────

async function loadFeatureComments(featureId) {
  const { data } = await sbGet(`frfc_feature_comments?select=*&feature_id=eq.${featureId}&order=created_at.asc`);
  const comments = data || [];

  let userLikes = new Set();
  if (currentUser) {
    const commentIds = comments.map(c => c.id);
    if (commentIds.length) {
      const { data: likes } = await sbGet(`frfc_feature_comment_likes?select=comment_id&user_id=eq.${currentUser.id}&comment_id=in.(${commentIds.join(',')})`);
      userLikes = new Set((likes || []).map(l => l.comment_id));
    }
  }

  // Build threaded structure
  const topLevel = comments.filter(c => !c.parent_id);
  const replies = {};
  comments.filter(c => c.parent_id).forEach(c => {
    if (!replies[c.parent_id]) replies[c.parent_id] = [];
    replies[c.parent_id].push(c);
  });

  const list = document.getElementById('frCommentList');
  if (!list) return;

  if (!comments.length) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:.85rem">No comments yet. Be the first to share your thoughts!</p>';
    return;
  }

  function renderComment(c, isReply = false) {
    const liked = userLikes.has(c.id);
    return `
      <div class="fr-comment ${isReply ? 'fr-comment--reply' : ''} ${c.is_official ? 'fr-comment--official' : ''}">
        <div class="fr-comment-header">
          ${c.is_official ? '<span class="fr-official-badge">Official</span>' : ''}
          <span class="fr-comment-time">${frTimeAgo(c.created_at)}</span>
        </div>
        <div class="fr-comment-body">${escHtml(c.body).replace(/\n/g, '<br>')}</div>
        <div class="fr-comment-actions">
          <button class="fr-like-btn ${liked ? 'fr-like-btn--active' : ''}" onclick="toggleCommentLike('${c.id}','${featureId}')">
            ${liked ? '❤️' : '🤍'} ${c.like_count}
          </button>
          ${!isReply && currentUser ? `<button class="fr-reply-btn" onclick="showReplyForm('${c.id}','${featureId}')">Reply</button>` : ''}
        </div>
        <div id="replyForm_${c.id}"></div>
        ${(replies[c.id] || []).map(r => renderComment(r, true)).join('')}
      </div>`;
  }

  list.innerHTML = topLevel.map(c => renderComment(c)).join('');
}

function showReplyForm(parentId, featureId) {
  const container = document.getElementById(`replyForm_${parentId}`);
  if (!container) return;
  if (container.innerHTML.trim()) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="fr-reply-form">
      <textarea id="replyBody_${parentId}" placeholder="Write a reply..." style="width:100%;min-height:50px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.84rem;resize:vertical"></textarea>
      <button class="btn btn-primary btn-sm" style="margin-top:4px" onclick="postFeatureComment('${featureId}','${parentId}')">Reply</button>
    </div>`;
}

async function postFeatureComment(featureId, parentId) {
  if (!currentUser) { openModal('signin'); return; }

  const isReply = !!parentId;
  const bodyEl = isReply ? document.getElementById(`replyBody_${parentId}`) : document.getElementById('frCommentBody');
  const body = bodyEl?.value.trim();
  const msg = document.getElementById('frCommentMsg');

  if (!body) {
    if (msg) { msg.textContent = 'Comment cannot be empty.'; msg.style.color = 'var(--red)'; }
    return;
  }

  let isAdmin = false;
  try {
    const ar = await fetch(`${SUPABASE_URL}/rest/v1/frfc_admin_roles?select=role&user_id=eq.${currentUser.id}`, { headers: _sbAuthHeaders() });
    if (ar.ok) { const rows = await ar.json(); isAdmin = rows.length > 0; }
  } catch {}

  const { error } = await sbPost('frfc_feature_comments', {
    feature_id: featureId,
    user_id: currentUser.id,
    parent_id: parentId || null,
    body,
    is_official: isAdmin || false
  });

  if (error) {
    if (msg) { msg.textContent = error.message || 'Failed to post comment.'; msg.style.color = 'var(--red)'; }
    return;
  }

  await sbRpc('frfc_feature_comment_added', { p_feature_id: featureId });
  bodyEl.value = '';
  loadFeatureComments(featureId);
}

async function toggleCommentLike(commentId, featureId) {
  if (!currentUser) { openModal('signin'); return; }

  const btn = event.target.closest('.fr-like-btn');
  const isLiked = btn?.classList.contains('fr-like-btn--active');

  if (isLiked) {
    await sbDelete(`frfc_feature_comment_likes?comment_id=eq.${commentId}&user_id=eq.${currentUser.id}`);
    await fetch(`${SUPABASE_URL}/rest/v1/frfc_feature_comments?id=eq.${commentId}`, {
      method: 'PATCH', headers: _sbAuthHeaders(),
      body: JSON.stringify({ like_count: Math.max(0, parseInt(btn.textContent.trim().match(/\d+/)?.[0] || 0) - 1) })
    });
  } else {
    await sbPost('frfc_feature_comment_likes', { comment_id: commentId, user_id: currentUser.id });
    await fetch(`${SUPABASE_URL}/rest/v1/frfc_feature_comments?id=eq.${commentId}`, {
      method: 'PATCH', headers: _sbAuthHeaders(),
      body: JSON.stringify({ like_count: parseInt(btn.textContent.trim().match(/\d+/)?.[0] || 0) + 1 })
    });
  }

  loadFeatureComments(featureId);
}

// ── Footer ────────────────────────────────────────────────────────────────
function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand"><span style="color:var(--yellow)">Fan</span><span style="color:var(--navy)">Reactions</span><span style="color:var(--yellow)">FC</span></div>
            <div class="footer-desc">The definitive database of football YouTubers across Europe's top leagues. Editorially curated by @fanreactionsfc.</div>
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
            <a href="/become-a-creator">Become a Creator</a>
            <a href="/community/features">Feature Requests</a>
            <a href="#" onclick="event.preventDefault();openModal('signin')">Sign In / Sign Up</a>
          </div>
          <div class="footer-col">
            <h4>FanReactionsFC</h4>
            <a href="https://www.youtube.com/@fanreactionsfc" target="_blank" rel="noopener">YouTube Channel</a>
            <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener">X (Twitter)</a>
            <a href="/streamwall">Streamwall</a>
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
