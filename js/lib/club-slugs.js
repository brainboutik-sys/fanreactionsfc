/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — club URL slugs
   Loaded after slugify.js and teams.js (see index.html). Canonical club
   paths are lowercase hyphenated slugs: /clubs/manchester-united, not
   /clubs/Man%20United. Abbreviated display names (Man United, Nottm Forest)
   expand to the full-name slug so crawlers and humans share one URL.

   Keep the override map in sync with the copies inside the Netlify
   prerender functions (they cannot share a module).
   ═══════════════════════════════════════════════════════════════════════════ */

// Display name → canonical URL slug. Only names whose slugify(name) would
// be a different (worse) slug need an override. Everyone else is slugify().
const CLUB_SLUG_OVERRIDES = {
  'Man United': 'manchester-united',
  'Man City': 'manchester-city',
  'Nottm Forest': 'nottingham-forest',
  'Oxford Utd': 'oxford-united',
  'Sheffield Utd': 'sheffield-united',
  'Sheffield Wed': 'sheffield-wednesday',
  'West Brom': 'west-bromwich-albion',
  'Multi-Club / Other': 'multi-club',
};

// Extra inbound aliases (old slugify forms, common nicknames) → display name.
const CLUB_SLUG_ALIASES = {
  'man-united': 'Man United',
  'man-utd': 'Man United',
  'manutd': 'Man United',
  'manchester-united': 'Man United',
  'man-city': 'Man City',
  'manchester-city': 'Man City',
  'nottm-forest': 'Nottm Forest',
  'nottingham-forest': 'Nottm Forest',
  'notts-forest': 'Nottm Forest',
  'oxford-utd': 'Oxford Utd',
  'oxford-united': 'Oxford Utd',
  'sheffield-utd': 'Sheffield Utd',
  'sheffield-united': 'Sheffield Utd',
  'sheffield-wed': 'Sheffield Wed',
  'sheffield-wednesday': 'Sheffield Wed',
  'west-brom': 'West Brom',
  'west-bromwich-albion': 'West Brom',
  'psg': 'PSG',
  'paris-saint-germain': 'PSG',
  'multi-club': 'Multi-Club / Other',
  'multi-club-other': 'Multi-Club / Other',
};

// Known display names so /clubs/arsenal resolves before any creator fetch.
// Mirrors TEAM_CRESTS keys in js/data/teams.js plus Multi-Club / Other.
const CLUB_DISPLAY_NAMES = [
  'Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Chelsea','Coventry','Crystal Palace','Everton','Fulham','Hull City','Ipswich','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham',
  'Birmingham','Blackburn','Bristol City','Burnley','Charlton','Derby','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','West Ham','Wolves','Wrexham','Luton',
  'Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes',
  'Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como',
  'Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli',
  'PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne',
  'Multi-Club / Other',
];

function _slugifyLocal(s) {
  if (typeof slugify === 'function') return slugify(s);
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function clubDisplayNames(extra) {
  const set = new Set(CLUB_DISPLAY_NAMES);
  if (typeof TEAM_CRESTS === 'object' && TEAM_CRESTS) {
    Object.keys(TEAM_CRESTS).forEach(t => set.add(t));
  }
  (extra || []).forEach(t => { if (t) set.add(t); });
  return set;
}

function clubSlug(team) {
  if (!team) return '';
  return CLUB_SLUG_OVERRIDES[team] || _slugifyLocal(team);
}

function clubPath(team, suffix) {
  const slug = clubSlug(team);
  if (!slug) return '/discover';
  return '/clubs/' + slug + (suffix || '');
}

function decodeClubSegment(raw) {
  if (raw == null) return '';
  let s = String(raw).replace(/\+/g, ' ').trim();
  try { s = decodeURIComponent(s); } catch { /* already decoded */ }
  return s.replace(/\/+$/, '').trim();
}

function resolveClub(raw, extraTeams) {
  const input = decodeClubSegment(raw);
  if (!input) return null;
  const known = clubDisplayNames(extraTeams);

  if (known.has(input)) return input;
  const lower = input.toLowerCase();
  for (const name of known) {
    if (name.toLowerCase() === lower) return name;
  }

  const slugged = _slugifyLocal(input);
  if (!slugged) return null;
  if (CLUB_SLUG_ALIASES[slugged] && known.has(CLUB_SLUG_ALIASES[slugged])) {
    return CLUB_SLUG_ALIASES[slugged];
  }
  for (const [name, slug] of Object.entries(CLUB_SLUG_OVERRIDES)) {
    if (slug === slugged && known.has(name)) return name;
  }
  for (const name of known) {
    if (_slugifyLocal(name) === slugged) return name;
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CLUB_SLUG_OVERRIDES,
    CLUB_SLUG_ALIASES,
    CLUB_DISPLAY_NAMES,
    clubSlug,
    clubPath,
    decodeClubSegment,
    resolveClub,
  };
}
