// Claim this channel.
// POST /.netlify/functions/claim-creator
//   Authorization: Bearer <supabase access token>
//   { action: 'issue', creatorId }
//   { action: 'verify', creatorId, code }
//
// issue  — authenticated user receives a short random code (shown once).
//          Only the HMAC-SHA256 is stored, with a 24h expiry. Issuing is
//          rate-limited. A new code supersedes that user's pending code.
// verify — the function reads the channel description with YouTube Data
//          API v3 (YOUTUBE_API_KEY, server-side only). The code must match
//          the stored hash AND appear in the description. On success the
//          service role records one verified owner (frfc_creator_claims)
//          and sets frfc_streamers.claimed_by. The browser cannot write
//          either of those; see supabase/migrations/20261014120000_frfc_creator_claims.sql.
//
// The plaintext code is never logged and never written to the database.

const crypto = require('crypto');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_BODY_LENGTH = 8;
const CODE_TTL_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ISSUE_LIMIT_PER_HOUR = 5;
const CHECK_LIMIT_PER_HOUR = 10;
const CHECK_LIMIT_PER_CODE = 8;
const CHECK_LIMIT_PER_CREATOR_HOUR = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_RE = new RegExp(`^FRFC-[${CODE_ALPHABET}]{${CODE_BODY_LENGTH}}$`);
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

function generateVerificationCode(randomBytes) {
  const bytes = (randomBytes || crypto.randomBytes)(CODE_BODY_LENGTH);
  let body = '';
  for (let i = 0; i < CODE_BODY_LENGTH; i++) {
    body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `FRFC-${body}`;
}

function claimPepper(env) {
  return (env && (env.CLAIM_CODE_PEPPER || env.SUPABASE_SERVICE_ROLE_KEY)) || '';
}

function hashVerificationCode(code, pepper) {
  return crypto.createHmac('sha256', String(pepper)).update(String(code), 'utf8').digest('hex');
}

function hashesMatch(storedHash, code, pepper) {
  if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const next = hashVerificationCode(code, pepper);
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(next, 'hex'));
}

function codeAppearsInDescription(description, code) {
  if (typeof description !== 'string' || !CODE_RE.test(code)) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(description);
}

function isExpired(expiresAt, nowMs) {
  const t = Date.parse(expiresAt);
  return !Number.isFinite(t) || t <= nowMs;
}

function countRecentIssues(rows, nowMs) {
  return (rows || []).filter(row => {
    const t = Date.parse(row && row.created_at);
    return Number.isFinite(t) && nowMs - t < HOUR_MS;
  }).length;
}

function countRecentChecks(rows, nowMs) {
  let n = 0;
  for (const row of rows || []) {
    const times = row && Array.isArray(row.check_times) ? row.check_times : [];
    for (const stamp of times) {
      const t = Date.parse(stamp);
      if (Number.isFinite(t) && nowMs - t < HOUR_MS) n += 1;
    }
  }
  return n;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function readBody(event) {
  if (!event || event.body == null || event.body === '') return {};
  if (typeof event.body === 'object') return event.body;
  return JSON.parse(event.body);
}

async function fetchJson(fetchImpl, url, options) {
  const res = await fetchImpl(url, options);
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { ok: res.ok, status: res.status, data };
}

function serviceHeaders(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }, extra || {});
}

async function claimCreatorHandler(event, deps) {
  const options = deps || {};
  const fetchImpl = options.fetch || fetch;
  const nowMs = typeof options.now === 'number' ? options.now : Date.now();
  const env = options.env || process.env;
  const randomBytes = options.randomBytes || crypto.randomBytes;

  if (!event || event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = env.YOUTUBE_API_KEY;
  const pepper = claimPepper(env);
  if (!sbKey) return json(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });
  if (!ytKey) return json(500, { error: 'Server misconfigured: YOUTUBE_API_KEY missing' });
  if (!pepper) return json(500, { error: 'Server misconfigured: claim code pepper missing' });

  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json(401, { error: 'Missing auth token' });

  const userRes = await fetchJson(fetchImpl, `${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json(401, { error: 'Invalid or expired token' });
  const userId = userRes.data && userRes.data.id;
  if (!isUuid(userId)) return json(401, { error: 'Could not identify user' });

  let body;
  try { body = readBody(event); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const action = body.action === 'verify' || body.action === 'check' ? 'verify' : body.action;
  const creatorId = body.creatorId;
  if (!isUuid(creatorId)) return json(400, { error: 'creatorId is required' });
  if (action !== 'issue' && action !== 'verify') return json(400, { error: 'Unknown action' });

  const sb = serviceHeaders(sbKey);
  const creatorRes = await fetchJson(
    fetchImpl,
    `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${creatorId}&select=id,channel_url,youtube_channel_id,claimed_by`,
    { headers: sb }
  );
  const creators = Array.isArray(creatorRes.data) ? creatorRes.data : [];
  if (!creatorRes.ok || !creators.length) return json(404, { error: 'Creator not found' });
  const creator = creators[0];

  const claimsRes = await fetchJson(
    fetchImpl,
    `${supabaseUrl}/rest/v1/frfc_creator_claims?or=(user_id.eq.${userId},creator_id.eq.${creatorId})&select=id,creator_id,user_id,status,created_at,expires_at,check_count,check_times,code_hash&order=created_at.desc&limit=80`,
    { headers: sb }
  );
  if (!claimsRes.ok || !Array.isArray(claimsRes.data)) return json(502, { error: 'Could not load claim status' });
  const claims = claimsRes.data;
  const verified = claims.find(row => row.creator_id === creatorId && row.status === 'verified');

  if (verified && verified.user_id === userId) {
    if (creator.claimed_by !== userId) {
      await fetchJson(fetchImpl, `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${creatorId}`, {
        method: 'PATCH',
        headers: serviceHeaders(sbKey, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ claimed_by: userId }),
      });
    }
    return json(200, { ok: true, message: 'Already claimed by you' });
  }
  if (verified && verified.user_id !== userId) return json(409, { error: 'This profile is already claimed by another account' });
  if (creator.claimed_by && creator.claimed_by !== userId) {
    return json(409, { error: 'This profile is already claimed by another account' });
  }
  if (action === 'issue' && creator.claimed_by === userId) {
    return json(200, { ok: true, message: 'Already claimed by you' });
  }

  if (action === 'issue') return issueCode({
    fetchImpl, supabaseUrl, sbKey, pepper, randomBytes, nowMs, userId, creatorId, claims,
  });
  return verifyCode({
    fetchImpl, supabaseUrl, sbKey, ytKey, pepper, nowMs, userId, creatorId, creator, claims, code: body.code,
  });
}

async function issueCode(ctx) {
  const mine = ctx.claims.filter(row => row.user_id === ctx.userId);
  if (countRecentIssues(mine, ctx.nowMs) >= ISSUE_LIMIT_PER_HOUR) {
    return json(429, { error: 'Too many verification codes requested. Try again in an hour.' });
  }

  const code = generateVerificationCode(ctx.randomBytes);
  const codeHash = hashVerificationCode(code, ctx.pepper);

  await fetchJson(
    ctx.fetchImpl,
    `${ctx.supabaseUrl}/rest/v1/frfc_creator_claims?creator_id=eq.${ctx.creatorId}&user_id=eq.${ctx.userId}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: serviceHeaders(ctx.sbKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ status: 'superseded' }),
    }
  );

  const insert = await fetchJson(ctx.fetchImpl, `${ctx.supabaseUrl}/rest/v1/frfc_creator_claims`, {
    method: 'POST',
    headers: serviceHeaders(ctx.sbKey, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      creator_id: ctx.creatorId,
      user_id: ctx.userId,
      code_hash: codeHash,
      status: 'pending',
    }),
  });
  if (insert.status === 409) return json(429, { error: 'A code is already being issued. Try again.' });
  const row = Array.isArray(insert.data) ? insert.data[0] : null;
  if (!insert.ok || !row || !row.expires_at) return json(502, { error: 'Could not issue a verification code' });

  return json(200, {
    ok: true,
    code,
    expiresAt: row.expires_at,
    message: 'Add this code to your YouTube channel description, then verify.',
  });
}

async function verifyCode(ctx) {
  if (!CODE_RE.test(ctx.code)) return json(400, { error: 'Enter the verification code you were given.' });

  const pending = ctx.claims.find(row =>
    row.creator_id === ctx.creatorId && row.user_id === ctx.userId && row.status === 'pending'
  );
  if (!pending) return json(400, { error: 'Request a verification code first.' });
  if (isExpired(pending.expires_at, ctx.nowMs)) {
    await fetchJson(ctx.fetchImpl, `${ctx.supabaseUrl}/rest/v1/frfc_creator_claims?id=eq.${pending.id}&status=eq.pending`, {
      method: 'PATCH',
      headers: serviceHeaders(ctx.sbKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ status: 'expired' }),
    });
    return json(410, { error: 'This code has expired. Request a new one.' });
  }

  const userRows = ctx.claims.filter(row => row.user_id === ctx.userId);
  const creatorRows = ctx.claims.filter(row => row.creator_id === ctx.creatorId);
  if (Number(pending.check_count) >= CHECK_LIMIT_PER_CODE) {
    return json(429, { error: 'Too many attempts for this code. Request a new one.' });
  }
  if (countRecentChecks(userRows, ctx.nowMs) >= CHECK_LIMIT_PER_HOUR) {
    return json(429, { error: 'Too many verification attempts. Try again in an hour.' });
  }
  if (countRecentChecks(creatorRows, ctx.nowMs) >= CHECK_LIMIT_PER_CREATOR_HOUR) {
    return json(429, { error: 'This channel is temporarily locked for verification. Try again in an hour.' });
  }

  const priorTimes = Array.isArray(pending.check_times) ? pending.check_times : [];
  const checkTimes = priorTimes
    .filter(stamp => {
      const t = Date.parse(stamp);
      return Number.isFinite(t) && ctx.nowMs - t < 25 * HOUR_MS;
    })
    .slice(-39);
  checkTimes.push(new Date(ctx.nowMs).toISOString());

  const noted = await fetchJson(
    ctx.fetchImpl,
    `${ctx.supabaseUrl}/rest/v1/frfc_creator_claims?id=eq.${pending.id}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: serviceHeaders(ctx.sbKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        check_count: Number(pending.check_count || 0) + 1,
        check_times: checkTimes,
        last_checked_at: new Date(ctx.nowMs).toISOString(),
      }),
    }
  );
  if (!noted.ok) return json(502, { error: 'Could not record the verification attempt' });

  if (!hashesMatch(pending.code_hash, ctx.code, ctx.pepper)) {
    return json(403, { error: 'That code does not match the one issued for this channel. Request a new code and try again.' });
  }

  let channelId = CHANNEL_ID_RE.test(ctx.creator.youtube_channel_id) ? ctx.creator.youtube_channel_id : '';
  if (!channelId) {
    const resolved = await resolveChannelId(ctx.fetchImpl, ctx.ytKey, ctx.creator.channel_url || '');
    if (!resolved.ok) return json(resolved.status, { error: resolved.error });
    channelId = resolved.channelId;
  }

  const described = await fetchChannelDescription(ctx.fetchImpl, ctx.ytKey, channelId);
  if (!described.ok) return json(described.status, { error: described.error });
  if (!codeAppearsInDescription(described.description, ctx.code)) {
    return json(403, { error: 'That code is not in the YouTube channel description yet. Add it, save, and try again.' });
  }

  const verifiedAt = new Date(ctx.nowMs).toISOString();
  const mark = await fetchJson(
    ctx.fetchImpl,
    `${ctx.supabaseUrl}/rest/v1/frfc_creator_claims?id=eq.${pending.id}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: serviceHeaders(ctx.sbKey, { Prefer: 'return=representation' }),
      body: JSON.stringify({ status: 'verified', verified_at: verifiedAt }),
    }
  );
  const marked = Array.isArray(mark.data) ? mark.data[0] : null;
  if (mark.status === 409 || (mark.ok && !marked)) {
    return json(409, { error: 'This profile is already claimed by another account' });
  }
  if (!mark.ok || !marked) return json(502, { error: 'Could not record the claim' });

  const own = await fetchJson(
    ctx.fetchImpl,
    `${ctx.supabaseUrl}/rest/v1/frfc_streamers?id=eq.${ctx.creatorId}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(ctx.sbKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ claimed_by: ctx.userId }),
    }
  );
  if (!own.ok) return json(502, { error: 'Claim recorded, but the profile link failed. Try verify again.' });

  return json(200, { ok: true, message: 'Channel verified and profile claimed' });
}

async function resolveChannelId(fetchImpl, ytKey, channelUrl) {
  const handle = String(channelUrl).match(/@([\w.-]{3,30})/);
  const idMatch = String(channelUrl).match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (idMatch) return { ok: true, channelId: idMatch[1] };
  if (!handle) return { ok: false, status: 422, error: 'Could not resolve the YouTube channel. Check the channel URL on this profile.' };
  const found = await fetchJson(
    fetchImpl,
    `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle[1])}&key=${encodeURIComponent(ytKey)}`
  );
  const channelId = found.data && found.data.items && found.data.items[0] && found.data.items[0].id;
  if (!found.ok || !CHANNEL_ID_RE.test(channelId)) {
    return { ok: false, status: 422, error: 'Could not resolve the YouTube channel. Check the channel URL on this profile.' };
  }
  return { ok: true, channelId };
}

async function fetchChannelDescription(fetchImpl, ytKey, channelId) {
  if (!CHANNEL_ID_RE.test(channelId)) {
    return { ok: false, status: 422, error: 'Could not resolve the YouTube channel. Check the channel URL on this profile.' };
  }
  const res = await fetchJson(
    fetchImpl,
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(ytKey)}`
  );
  if (!res.ok || !res.data || !Array.isArray(res.data.items) || !res.data.items.length) {
    return { ok: false, status: 502, error: 'YouTube did not return this channel. Try again shortly.' };
  }
  const description = res.data.items[0] && res.data.items[0].snippet && res.data.items[0].snippet.description;
  return { ok: true, description: typeof description === 'string' ? description : '' };
}

exports.handler = (event) => claimCreatorHandler(event);
exports.claimCreatorHandler = claimCreatorHandler;
exports.generateVerificationCode = generateVerificationCode;
exports.hashVerificationCode = hashVerificationCode;
exports.hashesMatch = hashesMatch;
exports.codeAppearsInDescription = codeAppearsInDescription;
exports.isExpired = isExpired;
exports.countRecentIssues = countRecentIssues;
exports.countRecentChecks = countRecentChecks;
exports.CODE_TTL_MS = CODE_TTL_MS;
exports.ISSUE_LIMIT_PER_HOUR = ISSUE_LIMIT_PER_HOUR;
exports.CHECK_LIMIT_PER_HOUR = CHECK_LIMIT_PER_HOUR;
exports.CHECK_LIMIT_PER_CODE = CHECK_LIMIT_PER_CODE;
exports.CHECK_LIMIT_PER_CREATOR_HOUR = CHECK_LIMIT_PER_CREATOR_HOUR;
exports.CODE_RE = CODE_RE;
