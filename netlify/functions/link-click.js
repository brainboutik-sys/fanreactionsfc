// POST /.netlify/functions/link-click
// One row in frfc_link_clicks. The body may contain only:
//   slug  — a creator slug that exists in frfc_streamers
//   link  — "live" or "channel"
//   club  — optional page-context club name
//   path  — site path, no query string
// Anything else in the JSON is ignored and not stored. The function does
// not read Cookie, User-Agent, or client IP, and it sets no cookie.
//
// The migration supabase/migrations/20261026110000_frfc_link_clicks.sql
// is applied by hand. It is not run by deploy.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLUB_RE = /^[A-Za-z0-9][A-Za-z0-9 .&'’/-]{0,79}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOW_MS = 60 * 1000;
const PER_KEY_LIMIT = 30;
const GLOBAL_LIMIT = 200;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const buckets = new Map();
let lastCleanupMs = 0;

function res(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function rawBody(event) {
  const body = event && event.body;
  if (typeof body !== 'string' || !body) return '';
  if (body.length > 2000) return '';
  if (event.isBase64Encoded) {
    try { return Buffer.from(body, 'base64').toString('utf8'); } catch { return ''; }
  }
  return body;
}

function cleanPath(value) {
  if (typeof value !== 'string') return '';
  if (value.length < 1 || value.length > 200) return '';
  if (value[0] !== '/' || value.indexOf('//') !== -1) return '';
  if (/[?#\\@]/.test(value)) return '';
  if (!/^\/[A-Za-z0-9/._~%-]*$/.test(value)) return '';
  return value;
}

function cleanClub(value) {
  const club = typeof value === 'string' ? value.trim() : '';
  if (!club) return null;
  return CLUB_RE.test(club) ? club : null;
}

function parseClick(raw) {
  if (!raw || raw.length > 1000) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
  const link = data.link === 'live' || data.link === 'channel' ? data.link : '';
  const path = cleanPath(data.path);
  if (!SLUG_RE.test(slug) || slug.length > 80 || !link || !path) return null;
  return { slug, link, path, club: cleanClub(data.club) };
}

function hitBucket(name, limit, now) {
  let bucket = buckets.get(name);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, n: 0 };
    buckets.set(name, bucket);
  }
  bucket.n += 1;
  return bucket.n <= limit;
}

function allowClick(key, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (buckets.size > 500) {
    for (const [name, bucket] of buckets) {
      if (now - bucket.start >= WINDOW_MS) buckets.delete(name);
    }
  }
  if (!hitBucket('global', GLOBAL_LIMIT, now)) return false;
  if (key && !hitBucket('k:' + key, PER_KEY_LIMIT, now)) return false;
  return true;
}

function resetLimits() {
  buckets.clear();
  lastCleanupMs = 0;
}

// pg_cron is not enabled in this project, so a schedule in the migration
// would fail where the extension is unavailable. After a successful insert,
// at most once an hour per instance, delete rows older than 90 days.
// A failed delete is retried on a later insert. The click response does
// not depend on it.
async function deleteExpiredClicks(supabaseUrl, sbKey, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (now - lastCleanupMs < CLEANUP_INTERVAL_MS) return;
  lastCleanupMs = now;
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  try {
    const deleted = await fetch(
      `${supabaseUrl}/rest/v1/frfc_link_clicks?created_at=lt.${encodeURIComponent(cutoff)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          Prefer: 'return=minimal',
        },
      }
    );
    if (!deleted.ok && deleted.status !== 404) lastCleanupMs = 0;
  } catch {
    lastCleanupMs = 0;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

exports.handler = async (event) => {
  if (!event || event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const parsed = parseClick(rawBody(event));
  if (!parsed) {
    if (!allowClick('')) return res(429, { error: 'Too many clicks' });
    return res(400, { error: 'Invalid click' });
  }
  if (!allowClick(parsed.slug + '\n' + parsed.link)) return res(429, { error: 'Too many clicks' });

  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const found = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,slug&slug=eq.${encodeURIComponent(parsed.slug)}&limit=1`,
    { headers }
  );
  if (!found.ok) return res(502, { error: 'Could not check creator' });
  const rows = await readJson(found);
  const creator = Array.isArray(rows) ? rows[0] : null;
  const creatorId = creator && typeof creator.id === 'string' && UUID_RE.test(creator.id) ? creator.id : '';
  const slug = creator && typeof creator.slug === 'string' ? creator.slug : '';
  if (!creatorId || !SLUG_RE.test(slug)) return res(400, { error: 'Unknown creator' });

  const inserted = await fetch(`${supabaseUrl}/rest/v1/frfc_link_clicks`, {
    method: 'POST',
    headers: Object.assign({}, headers, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      creator_id: creatorId,
      creator_slug: slug,
      club: parsed.club,
      link_type: parsed.link,
      page_path: parsed.path,
    }),
  });
  if (!inserted.ok) return res(503, { error: 'Click log is not ready' });
  await deleteExpiredClicks(supabaseUrl, sbKey);
  return res(200, { ok: true });
};

exports.parseClick = parseClick;
exports.allowClick = allowClick;
exports.resetLimits = resetLimits;
exports.PER_KEY_LIMIT = PER_KEY_LIMIT;
exports.RETENTION_MS = RETENTION_MS;
exports.deleteExpiredClicks = deleteExpiredClicks;
