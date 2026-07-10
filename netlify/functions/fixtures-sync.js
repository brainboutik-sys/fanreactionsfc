// Netlify scheduled function — pulls upcoming fixtures (next 8 days) from
// football-data.org for every competition FanReactionsFC covers, maps each
// team name to our internal club names (see js/data/teams.js), and upserts
// into frfc_fixtures. live-check-fixtures.js reads that table to trigger a
// live-check 5 minutes before kickoff for creators tied to the two clubs
// playing, instead of blanket-polling all creators on a fixed schedule.
//
// Required env vars:
//   FOOTBALL_DATA_API_KEY       — free-tier key from football-data.org
//   SUPABASE_URL                — optional, falls back to hardcoded
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase secret key so writes bypass RLS
//
// football-data.org free tier: 10 requests/minute. We make one request per
// competition (8 total), well within that.

exports.config = { schedule: '30 4 * * *' }; // once a day, 04:30 UTC

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

// Competitions FanReactionsFC covers, and their football-data.org codes.
const COMPETITIONS = ['PL', 'ELC', 'PD', 'SA', 'BL1', 'FL1', 'CL', 'WC'];

// football-data.org team name -> our internal club name (js/data/teams.js
// TEAM_TO_LEAGUE keys). Built from football-data.org's well-established
// naming conventions (official/Wikipedia-derived names). Fixtures for teams
// not in this map are still stored (home_team/away_team left null) but
// won't trigger a live-check, since we have no creator to tie them to.
const TEAM_NAME_MAP = {
  // ── Premier League ──
  'Arsenal FC': 'Arsenal',
  'Aston Villa FC': 'Aston Villa',
  'AFC Bournemouth': 'Bournemouth',
  'Brentford FC': 'Brentford',
  'Brighton & Hove Albion FC': 'Brighton',
  'Burnley FC': 'Burnley',
  'Chelsea FC': 'Chelsea',
  'Crystal Palace FC': 'Crystal Palace',
  'Everton FC': 'Everton',
  'Fulham FC': 'Fulham',
  'Leeds United FC': 'Leeds United',
  'Liverpool FC': 'Liverpool',
  'Manchester City FC': 'Man City',
  'Manchester United FC': 'Man United',
  'Newcastle United FC': 'Newcastle',
  'Nottingham Forest FC': 'Nottm Forest',
  'Sunderland AFC': 'Sunderland',
  'Tottenham Hotspur FC': 'Tottenham',
  'West Ham United FC': 'West Ham',
  'Wolverhampton Wanderers FC': 'Wolves',
  // ── Championship ──
  'Birmingham City FC': 'Birmingham',
  'Blackburn Rovers FC': 'Blackburn',
  'Bristol City FC': 'Bristol City',
  'Charlton Athletic FC': 'Charlton',
  'Coventry City FC': 'Coventry',
  'Derby County FC': 'Derby',
  'Hull City AFC': 'Hull',
  'Ipswich Town FC': 'Ipswich',
  'Leicester City FC': 'Leicester',
  'Middlesbrough FC': 'Middlesbrough',
  'Millwall FC': 'Millwall',
  'Norwich City FC': 'Norwich',
  'Oxford United FC': 'Oxford Utd',
  'Portsmouth FC': 'Portsmouth',
  'Preston North End FC': 'Preston',
  'Queens Park Rangers FC': 'QPR',
  'Sheffield United FC': 'Sheffield Utd',
  'Sheffield Wednesday FC': 'Sheffield Wed',
  'Southampton FC': 'Southampton',
  'Stoke City FC': 'Stoke',
  'Swansea City AFC': 'Swansea',
  'Watford FC': 'Watford',
  'West Bromwich Albion FC': 'West Brom',
  'Wrexham AFC': 'Wrexham',
  // ── La Liga ──
  'FC Barcelona': 'Barcelona',
  'Real Madrid CF': 'Real Madrid',
  'Club Atlético de Madrid': 'Atletico Madrid',
  'Sevilla FC': 'Sevilla',
  'Real Betis Balompié': 'Real Betis',
  'Real Sociedad de Fútbol': 'Real Sociedad',
  'Villarreal CF': 'Villarreal',
  'Athletic Club': 'Athletic Bilbao',
  'Valencia CF': 'Valencia',
  'RC Celta de Vigo': 'Celta Vigo',
  'RCD Espanyol de Barcelona': 'Espanyol',
  'Getafe CF': 'Getafe',
  'CA Osasuna': 'Osasuna',
  'RCD Mallorca': 'Mallorca',
  'Rayo Vallecano de Madrid': 'Rayo Vallecano',
  'Girona FC': 'Girona',
  'UD Las Palmas': 'Las Palmas',
  'Deportivo Alavés': 'Alaves',
  'Real Valladolid CF': 'Valladolid',
  'CD Leganés': 'Leganes',
  // ── Serie A ──
  'Juventus FC': 'Juventus',
  'AC Milan': 'AC Milan',
  'FC Internazionale Milano': 'Inter Milan',
  'SSC Napoli': 'Napoli',
  'AS Roma': 'Roma',
  'SS Lazio': 'Lazio',
  'Atalanta BC': 'Atalanta',
  'ACF Fiorentina': 'Fiorentina',
  'Bologna FC 1909': 'Bologna',
  'Torino FC': 'Torino',
  'Udinese Calcio': 'Udinese',
  'AC Monza': 'Monza',
  'Empoli FC': 'Empoli',
  'Genoa CFC': 'Genoa',
  'Cagliari Calcio': 'Cagliari',
  'US Lecce': 'Lecce',
  'Hellas Verona FC': 'Hellas Verona',
  'Parma Calcio 1913': 'Parma',
  'Venezia FC': 'Venezia',
  'Como 1907': 'Como',
  // ── Bundesliga ──
  'FC Bayern München': 'Bayern Munich',
  'Borussia Dortmund': 'Borussia Dortmund',
  'RB Leipzig': 'RB Leipzig',
  'Bayer 04 Leverkusen': 'Bayer Leverkusen',
  '1. FC Union Berlin': 'Union Berlin',
  'SC Freiburg': 'Freiburg',
  'Eintracht Frankfurt': 'Eintracht Frankfurt',
  'VfL Wolfsburg': 'Wolfsburg',
  '1. FSV Mainz 05': 'Mainz',
  'Borussia Mönchengladbach': 'Borussia Monchengladbach',
  'TSG 1899 Hoffenheim': 'Hoffenheim',
  'SV Werder Bremen': 'Werder Bremen',
  'FC Augsburg': 'Augsburg',
  'VfL Bochum 1848': 'Bochum',
  '1. FC Heidenheim 1846': 'Heidenheim',
  'VfB Stuttgart': 'Stuttgart',
  'Holstein Kiel': 'Holstein Kiel',
  'FC St. Pauli 1910': 'St. Pauli',
  // ── Ligue 1 ──
  'Paris Saint-Germain FC': 'PSG',
  'Olympique de Marseille': 'Marseille',
  'Olympique Lyonnais': 'Lyon',
  'AS Monaco FC': 'Monaco',
  'Lille OSC': 'Lille',
  'OGC Nice': 'Nice',
  'Stade Rennais FC 1901': 'Rennes',
  'Racing Club de Lens': 'Lens',
  'RC Strasbourg Alsace': 'Strasbourg',
  'FC Nantes': 'Nantes',
  'Montpellier HSC': 'Montpellier',
  'Toulouse FC': 'Toulouse',
  'Stade Brestois 29': 'Brest',
  'Stade de Reims': 'Reims',
  'Le Havre AC': 'Le Havre',
  'AJ Auxerre': 'Auxerre',
  'Angers SCO': 'Angers',
  'AS Saint-Étienne': 'Saint-Etienne',
};

function mapTeamName(apiName) {
  if (TEAM_NAME_MAP[apiName]) return TEAM_NAME_MAP[apiName];
  // Fallback: strip common club-suffix/prefix noise and try again — catches
  // naming drift without needing every possible variant hardcoded above.
  const stripped = apiName
    .replace(/^(FC|AFC|AC|AS|SS|SSC|CD|CA|RC|RCD|SC|SV|VfL|VfB|TSG|LOSC|OGC|AJ)\s+/i, '')
    .replace(/\s+(FC|CF|AFC|SC|SAD|Calcio|1846|1848|1899|1901|1907|1909|1910|1913)$/i, '')
    .trim();
  for (const [apiKey, ours] of Object.entries(TEAM_NAME_MAP)) {
    if (apiKey.toLowerCase() === stripped.toLowerCase()) return ours;
  }
  return null;
}

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fdKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!fdKey) return ok({ error: 'FOOTBALL_DATA_API_KEY not set' }, 500);

  const dateFrom = new Date().toISOString().slice(0, 10);
  const dateTo = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const fixtures = [];
  let unmatchedTeams = new Set();

  for (const code of COMPETITIONS) {
    try {
      const res = await fetch(
        `https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED,TIMED`,
        { headers: { 'X-Auth-Token': fdKey } }
      );
      if (!res.ok) continue; // competition not in this plan, or transient error — skip, don't fail the whole run
      const data = await res.json();
      for (const m of data.matches || []) {
        const homeRaw = m.homeTeam && m.homeTeam.name;
        const awayRaw = m.awayTeam && m.awayTeam.name;
        if (!homeRaw || !awayRaw || !m.utcDate) continue;
        const homeTeam = mapTeamName(homeRaw);
        const awayTeam = mapTeamName(awayRaw);
        if (!homeTeam) unmatchedTeams.add(homeRaw);
        if (!awayTeam) unmatchedTeams.add(awayRaw);
        fixtures.push({
          external_id: m.id,
          competition_code: code,
          home_team: homeTeam,
          away_team: awayTeam,
          home_team_raw: homeRaw,
          away_team_raw: awayRaw,
          kickoff_at: m.utcDate,
          status: m.status || 'SCHEDULED',
        });
      }
    } catch (e) { /* one competition failing shouldn't block the others */ }
  }

  if (!fixtures.length) return ok({ fixtures_found: 0 });

  // Upsert. Omitting trigger_sent_at means repeat syncs of an already-seen
  // fixture leave its trigger state untouched — only brand-new rows get it
  // NULL by default.
  const upsertRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?on_conflict=external_id`,
    {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(fixtures),
    }
  );
  if (!upsertRes.ok) {
    const body = await upsertRes.text();
    return ok({ error: 'upsert failed', status: upsertRes.status, body: body.slice(0, 500) }, 502);
  }

  return ok({
    fixtures_found: fixtures.length,
    unmatched_teams: [...unmatchedTeams],
  });
};

function ok(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
