// Self-service profile edits for a verified channel owner.
// POST /.netlify/functions/manage-channel
//   Authorization: Bearer <supabase access token>
//   { creatorId, action: 'update', patch: { description?, social_x?, ... } }
//   { creatorId, action: 'unclaim' }
//
// Writes do not use the service role. The function checks the caller's JWT,
// rejects anything outside the whitelist, then calls the SECURITY DEFINER
// RPCs frfc_owner_update_profile / frfc_owner_unclaim with the user's token.
// Those functions check auth.uid() and the column guard trigger restores
// is_verified, verified_until, verified, subscriber stats, slug, team, and
// every other admin column. A client-supplied patch is never trusted.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
// Publishable key. Public by design (it is in the browser). Profile writes
// must run as the signed-in user so auth.uid() is set inside the RPC.
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_iq6Dv3b9IYfNktis7WeZ-g_y7_DV0gm';

const BIO_MAX = 280;
const URL_MAX = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OWNER_EDITABLE_FIELDS = Object.freeze([
  'description',
  'social_x',
  'social_instagram',
  'social_twitch',
  'social_discord',
  'social_tiktok',
]);

// Explicit deny-list so a review can see the fields an owner must never set.
// sanitizeOwnerPatch rejects every key that is not in OWNER_EDITABLE_FIELDS,
// including these and any unknown key. A mixed patch is rejected entirely.
const OWNER_FORBIDDEN_FIELDS = Object.freeze([
  'is_verified',
  'verified_until',
  'verified',
  'subscriber_count',
  'subscriber_count_prev',
  'total_view_count',
  'video_count',
  'avg_rating_prev',
  'slug',
  'team',
  'league',
  'name',
  'status',
  'approval_status',
  'claimed_by',
  'featured',
  'featured_video_id',
  'content_types',
  'avatar_url',
  'avatar_custom',
  'channel_url',
  'live_url',
  'youtube_channel_id',
  'is_live',
  'live_video_id',
  'id',
  'created_by',
]);

function validateBio(value) {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'must be a string up to 280 characters' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > BIO_MAX) return { ok: false, error: 'must be a string up to 280 characters' };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) {
    return { ok: false, error: 'contains invalid characters' };
  }
  return { ok: true, value: trimmed };
}

function validateHttpUrl(value) {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'must be a valid http or https URL' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > URL_MAX) return { ok: false, error: 'must be at most 300 characters' };
  let url;
  try { url = new URL(trimmed); } catch { return { ok: false, error: 'must be a valid http or https URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'must be a valid http or https URL' };
  }
  if (url.username || url.password) return { ok: false, error: 'must not include credentials' };
  return { ok: true, value: url.href };
}

function sanitizeOwnerPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'patch object is required' };
  }
  const errors = {};
  const clean = {};
  for (const [field, value] of Object.entries(patch)) {
    if (!OWNER_EDITABLE_FIELDS.includes(field)) {
      errors[field] = 'not an editable field';
      continue;
    }
    const result = field === 'description' ? validateBio(value) : validateHttpUrl(value);
    if (!result.ok) errors[field] = result.error;
    else clean[field] = result.value;
  }
  if (Object.keys(errors).length) return { ok: false, error: 'Validation failed', fields: errors };
  if (!Object.keys(clean).length) return { ok: false, error: 'No valid fields to update' };
  return { ok: true, clean };
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

function publicError(data, fallback) {
  const message = data && typeof data.message === 'string' ? data.message : '';
  const error = data && typeof data.error === 'string' ? data.error : '';
  const text = message || error;
  if (!text || text.length > 200) return fallback;
  return text;
}

async function manageChannelHandler(event, deps) {
  const options = deps || {};
  const fetchImpl = options.fetch || fetch;
  const env = options.env || process.env;

  if (!event || event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  if (!anonKey) return json(500, { error: 'Server misconfigured: SUPABASE_ANON_KEY missing' });

  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json(401, { error: 'Missing auth token' });

  const userRes = await fetchJson(fetchImpl, `${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json(401, { error: 'Invalid or expired token' });
  const userId = userRes.data && userRes.data.id;
  if (!isUuid(userId)) return json(401, { error: 'Could not identify user' });

  let body;
  try { body = readBody(event); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const creatorId = body.creatorId;
  if (!isUuid(creatorId)) return json(400, { error: 'creatorId is required' });

  if (body.action === 'unclaim') {
    return callRpc(fetchImpl, supabaseUrl, anonKey, token, 'frfc_owner_unclaim', { p_creator_id: creatorId });
  }
  if (body.action !== 'update') return json(400, { error: 'Unknown action' });

  const sanitized = sanitizeOwnerPatch(body.patch);
  if (!sanitized.ok) {
    return json(400, sanitized.fields
      ? { error: sanitized.error, fields: sanitized.fields }
      : { error: sanitized.error });
  }

  return callRpc(fetchImpl, supabaseUrl, anonKey, token, 'frfc_owner_update_profile', {
    p_creator_id: creatorId,
    p_patch: sanitized.clean,
  });
}

async function callRpc(fetchImpl, supabaseUrl, anonKey, token, name, args) {
  const res = await fetchJson(fetchImpl, `${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (res.status === 404) {
    return json(503, { error: 'Profile editing is not available until the claims migration is applied.' });
  }
  if (!res.ok) {
    const message = publicError(res.data, 'Profile update was rejected.');
    const status = /not the verified owner|not authenticated|not editable|direct creator updates/i.test(message) ? 403 : 400;
    return json(status, { error: message });
  }
  const changed = res.data && Array.isArray(res.data.changed) ? res.data.changed : undefined;
  return json(200, changed ? { ok: true, changed } : { ok: true, message: 'Saved' });
}

exports.handler = (event) => manageChannelHandler(event);
exports.manageChannelHandler = manageChannelHandler;
exports.sanitizeOwnerPatch = sanitizeOwnerPatch;
exports.validateHttpUrl = validateHttpUrl;
exports.validateBio = validateBio;
exports.OWNER_EDITABLE_FIELDS = OWNER_EDITABLE_FIELDS;
exports.OWNER_FORBIDDEN_FIELDS = OWNER_FORBIDDEN_FIELDS;
exports.BIO_MAX = BIO_MAX;
