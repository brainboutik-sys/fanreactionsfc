// Netlify scheduled function — pulls fixtures from football-data.org for
// every competition FanReactionsFC covers (next 8 days, plus the previous
// 10 so finished matches can be marked), maps each
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
// football-data.org free tier: 10 requests/minute (response header
// X-RequestsAvailable is the live remainder). The daily run uses one
// request per competition (8) for a window that now includes the previous
// 10 days, so finished matches in that window are updated with no extra
// call. One optional catch-up request (GET /v4/matches over the oldest
// 10-day slice still unmarked) backfills older rows. The run stops at 9
// calls when the header is missing, and sooner when the header says the
// minute is spent. It does not sleep for a reset: a scheduled function
// cannot wait a minute.

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
  'Hull City AFC': 'Hull City',
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
  if (!apiName) return null;
  if (TEAM_NAME_MAP[apiName]) return TEAM_NAME_MAP[apiName];
  // Fallback: strip common club-suffix/prefix noise and try again — catches
  // naming drift without needing every possible variant hardcoded above.
  const stripped = String(apiName)
    .replace(/^(FC|AFC|AC|AS|SS|SSC|CD|CA|RC|RCD|SC|SV|VfL|VfB|TSG|LOSC|OGC|AJ)\s+/i, '')
    .replace(/\s+(FC|CF|AFC|SC|SAD|Calcio|1846|1848|1899|1901|1907|1909|1910|1913)$/i, '')
    .trim();
  for (const [apiKey, ours] of Object.entries(TEAM_NAME_MAP)) {
    if (apiKey.toLowerCase() === stripped.toLowerCase()) return ours;
  }
  return null;
}

// Kickoff plus 90 minutes and a typical 15 minutes of stoppage. football-data
// does not report the whistle, so this is an estimate, not a measured end.
const REGULAR_FULL_TIME_MINUTES = 105;
const EXTRA_TIME_MINUTES = 30;
const FINISHED_LOOKBACK_DAYS = 10;
const UPCOMING_DAYS = 8;
const CATCH_UP_WINDOW_DAYS = 10;
const FD_FREE_TIER_PER_MINUTE = 10;

function utcDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addUtcDays(day, days) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// dateTo is exclusive on football-data.org v4. dateFrom is today minus the
// lookback; dateTo stays today+8, the same horizon the job already used.
function fixtureWindows(now) {
  const today = utcDay(now);
  return {
    dateFrom: addUtcDays(today, -FINISHED_LOOKBACK_DAYS),
    dateTo: addUtcDays(today, UPCOMING_DAYS),
  };
}

// Oldest unfinished kickoff that sits strictly before the lookback window.
// dateTo is exclusive and never runs into the window the per-competition
// calls already fetched.
function catchUpWindow(oldestKickoffIso, alreadyFromDay) {
  if (!oldestKickoffIso || !alreadyFromDay) return null;
  const oldestDay = utcDay(oldestKickoffIso);
  if (oldestDay >= alreadyFromDay) return null;
  const spanEnd = addUtcDays(oldestDay, CATCH_UP_WINDOW_DAYS);
  const dateTo = spanEnd < alreadyFromDay ? spanEnd : alreadyFromDay;
  if (dateTo <= oldestDay) return null;
  return { dateFrom: oldestDay, dateTo };
}

function wentToExtraTime(match) {
  const duration = match && match.score && match.score.duration;
  return duration === 'EXTRA_TIME' || duration === 'PENALTY_SHOOTOUT';
}

// Null unless the match is FINISHED and utcDate parses. There is no API
// whistle field to store with full_time_source 'api': utcDate is kickoff
// and lastUpdated can be days later, so it is not the end of the match.
function fullTimeFields(match) {
  if (!match || match.status !== 'FINISHED') return null;
  const kickoffMs = Date.parse(match.utcDate);
  if (!Number.isFinite(kickoffMs)) return null;
  const extra = wentToExtraTime(match);
  const minutes = REGULAR_FULL_TIME_MINUTES + (extra ? EXTRA_TIME_MINUTES : 0);
  return {
    finished_at: new Date(kickoffMs + minutes * 60 * 1000).toISOString(),
    full_time_source: 'estimated',
    extra_time: extra,
  };
}

function fixtureFromMatch(match, competitionCode) {
  const homeRaw = match && match.homeTeam && match.homeTeam.name;
  const awayRaw = match && match.awayTeam && match.awayTeam.name;
  if (!homeRaw || !awayRaw || !match.utcDate || match.id == null || !competitionCode) return null;
  return {
    row: {
      external_id: match.id,
      competition_code: competitionCode,
      home_team: mapTeamName(homeRaw),
      away_team: mapTeamName(awayRaw),
      home_team_raw: homeRaw,
      away_team_raw: awayRaw,
      kickoff_at: match.utcDate,
      status: match.status || 'SCHEDULED',
    },
    fullTime: fullTimeFields(match),
  };
}

function canRequestFootballData(budget) {
  if (!budget || budget.used >= FD_FREE_TIER_PER_MINUTE) return false;
  if (budget.available === 0) return false;
  // No remaining-count header: leave the 10th call unused.
  if (budget.available == null && budget.used >= FD_FREE_TIER_PER_MINUTE - 1) return false;
  return true;
}

function noteFootballDataResponse(budget, res) {
  budget.used += 1;
  if (!res || !res.headers || typeof res.headers.get !== 'function') return;
  const raw = res.headers.get('X-RequestsAvailable') || res.headers.get('X-Requests-Available-Minute');
  if (raw == null || raw === '') return;
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n)) budget.available = n;
}

function isSchemaMissing(status, body) {
  if (status !== 400 && status !== 404 && status !== 406) return false;
  return /PGRST204|PGRST205|schema cache|Could not find the|column .* does not exist|relation .* does not exist/i.test(body || '');
}

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fdKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!fdKey) return ok({ error: 'FOOTBALL_DATA_API_KEY not set' }, 500);

  const windows = fixtureWindows(new Date());
  const budget = { used: 0, available: null };
  const collected = new Map();
  const unmatchedTeams = new Set();
  let catchUp = null;
  let catchUpTruncated = false;

  for (const code of COMPETITIONS) {
    if (!canRequestFootballData(budget)) break;
    try {
      const res = await fetch(
        `https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${windows.dateFrom}&dateTo=${windows.dateTo}&status=SCHEDULED,TIMED,FINISHED`,
        { headers: { 'X-Auth-Token': fdKey } }
      );
      noteFootballDataResponse(budget, res);
      if (res.status === 429) break; // minute is spent; do not burn the rest of it
      if (!res.ok) continue; // competition not in this plan, or transient error — skip, don't fail the whole run
      const data = await res.json();
      absorbMatches(collected, unmatchedTeams, data.matches || [], code);
    } catch (e) { /* one competition failing shouldn't block the others */ }
  }

  // Older than the lookback, one 10-day slice per run. The rows that come
  // back as FINISHED / POSTPONED / CANCELLED drop out of the next select,
  // so the slice advances without a stored cursor.
  if (canRequestFootballData(budget)) {
    try {
      const oldest = await oldestUnfinishedKickoff(supabaseUrl, sbKey, windows.dateFrom);
      const window = catchUpWindow(oldest, windows.dateFrom);
      if (window) {
        const params = new URLSearchParams({
          competitions: COMPETITIONS.join(','),
          dateFrom: window.dateFrom,
          dateTo: window.dateTo,
          limit: '500',
        });
        const res = await fetch(
          `https://api.football-data.org/v4/matches?${params}`,
          { headers: { 'X-Auth-Token': fdKey } }
        );
        noteFootballDataResponse(budget, res);
        catchUp = window;
        if (res.ok) {
          const data = await res.json();
          const matches = data.matches || [];
          const count = data.resultSet && data.resultSet.count;
          if (typeof count === 'number' && count > matches.length) catchUpTruncated = true;
          for (const m of matches) {
            const code = m.competition && m.competition.code;
            if (!COMPETITIONS.includes(code)) continue;
            absorbMatches(collected, unmatchedTeams, [m], code);
          }
        }
      }
    } catch (e) { /* catch-up is best-effort; the lookback window already ran */ }
  }

  const fixtures = [...collected.values()].map(entry => entry.row);
  if (!fixtures.length) {
    return ok({
      fixtures_found: 0,
      football_data_requests: budget.used,
      catch_up: catchUp,
      catch_up_truncated: catchUpTruncated,
    });
  }

  // Upsert. Omitting trigger_sent_at means repeat syncs of an already-seen
  // fixture leave its trigger state untouched — only brand-new rows get it
  // NULL by default. Full-time columns stay off this payload so a deploy
  // that lands before the migration still updates kickoff and status.
  const upsertRes = await upsertFixtures(supabaseUrl, sbKey, fixtures);
  if (!upsertRes.ok) {
    const body = await upsertRes.text();
    return ok({ error: 'upsert failed', status: upsertRes.status, body: body.slice(0, 500) }, 502);
  }

  const finished = [];
  for (const entry of collected.values()) {
    if (!entry.fullTime) continue;
    finished.push({
      external_id: entry.row.external_id,
      status: 'FINISHED',
      finished_at: entry.fullTime.finished_at,
      full_time_source: entry.fullTime.full_time_source,
      extra_time: entry.fullTime.extra_time,
    });
  }

  let migrationRequired = false;
  if (finished.length) {
    const finishedRes = await upsertFixtures(supabaseUrl, sbKey, finished);
    if (!finishedRes.ok) {
      const body = await finishedRes.text();
      if (isSchemaMissing(finishedRes.status, body)) {
        migrationRequired = true;
      } else {
        return ok({
          error: 'full-time upsert failed',
          status: finishedRes.status,
          body: body.slice(0, 500),
          fixtures_found: fixtures.length,
          football_data_requests: budget.used,
        }, 502);
      }
    }
  }

  return ok({
    fixtures_found: fixtures.length,
    finished_matches: finished.length,
    unmatched_teams: [...unmatchedTeams],
    football_data_requests: budget.used,
    catch_up: catchUp,
    catch_up_truncated: catchUpTruncated,
    migration_required: migrationRequired,
  });
};

function absorbMatches(collected, unmatchedTeams, matches, competitionCode) {
  for (const match of matches) {
    const built = fixtureFromMatch(match, competitionCode);
    if (!built) continue;
    if (!built.row.home_team) unmatchedTeams.add(built.row.home_team_raw);
    if (!built.row.away_team) unmatchedTeams.add(built.row.away_team_raw);
    const prev = collected.get(built.row.external_id);
    if (!prev || (!prev.fullTime && built.fullTime)) collected.set(built.row.external_id, built);
  }
}

async function fetchOldestKickoff(supabaseUrl, sbKey, before, filter) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?select=kickoff_at&kickoff_at=lt.${encodeURIComponent(before)}&${filter}&order=kickoff_at.asc&limit=1`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, status: res.status, body };
  }
  const rows = await res.json();
  const kickoff = Array.isArray(rows) && rows[0] && rows[0].kickoff_at;
  return { ok: true, kickoff: kickoff || null };
}

function earlierKickoff(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

// Open rows (not finished yet) and finished rows that never received a
// full-time value. The second filter 400s until the migration is applied;
// that case falls back to open rows so a deploy can land first, and the
// next run after the migration still fills finished_at.
async function oldestUnfinishedKickoff(supabaseUrl, sbKey, lookbackDay) {
  const before = `${lookbackDay}T00:00:00.000Z`;
  const open = await fetchOldestKickoff(
    supabaseUrl,
    sbKey,
    before,
    'status=not.in.(FINISHED,AWARDED,CANCELLED,POSTPONED,SUSPENDED)'
  );
  const unset = await fetchOldestKickoff(
    supabaseUrl,
    sbKey,
    before,
    'status=eq.FINISHED&finished_at=is.null'
  );
  const openKickoff = open.ok ? open.kickoff : null;
  if (unset.ok) return earlierKickoff(openKickoff, unset.kickoff);
  if (isSchemaMissing(unset.status, unset.body)) return openKickoff;
  return openKickoff;
}

async function upsertFixtures(supabaseUrl, sbKey, rows) {
  return fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?on_conflict=external_id`,
    {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    }
  );
}

exports.REGULAR_FULL_TIME_MINUTES = REGULAR_FULL_TIME_MINUTES;
exports.EXTRA_TIME_MINUTES = EXTRA_TIME_MINUTES;
exports.FINISHED_LOOKBACK_DAYS = FINISHED_LOOKBACK_DAYS;
exports.UPCOMING_DAYS = UPCOMING_DAYS;
exports.FD_FREE_TIER_PER_MINUTE = FD_FREE_TIER_PER_MINUTE;
exports.fixtureWindows = fixtureWindows;
exports.catchUpWindow = catchUpWindow;
exports.fullTimeFields = fullTimeFields;
exports.fixtureFromMatch = fixtureFromMatch;
exports.canRequestFootballData = canRequestFootballData;
exports.noteFootballDataResponse = noteFootballDataResponse;
exports.isSchemaMissing = isSchemaMissing;
exports.mapTeamName = mapTeamName;

function ok(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
