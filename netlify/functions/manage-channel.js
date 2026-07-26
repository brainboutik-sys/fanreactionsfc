// Self-service channel management for claimed creators.
// POST /manage-channel  (Authorization: Bearer <supabase_access_token>)
// Body: { creatorId, action: 'update', patch: {...} }
//     | { creatorId, action: 'unclaim' }
//
// frfc_streamers only allows admin-role UPDATEs via RLS (see "Admins update
// streamers" policy) — this function is the one sanctioned way a claimed
// creator can edit their own row, following the exact same
// verify-JWT-then-use-service-role pattern as claim-creator.js. Every write
// is diffed against the current row and appended to frfc_creator_edit_log
// for accountability (mirrors frfc_admin_log's pattern for admin actions).
//
// League/team are deliberately NOT editable here — changing them reshuffles
// rankings/battle groupings/club pages, which needs a review step this
// function doesn't implement yet.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

// Field -> validator. Returning a string means "invalid, here's why";
// returning null/undefined means valid. Keeps the whitelist and the
// validation in the same place so a new editable field can't be added
// without also deciding how to validate it.
const FIELD_VALIDATORS = {
  description: v => (typeof v === 'string' && v.length <= 1000) ? null : 'must be a string up to 1000 characters',
  content_types: v => (Array.isArray(v) && v.length <= 8 && v.every(t => typeof t === 'string' && t.length <= 40)) ? null : 'must be an array of up to 8 short strings',
  social_x: urlOrEmpty, social_twitch: urlOrEmpty, social_discord: urlOrEmpty, social_tiktok: urlOrEmpty, social_instagram: urlOrEmpty,
  featured_video_id: v => (v === null || v === '' || /^[A-Za-z0-9_-]{11}$/.test(v)) ? null : 'must be a valid 11-character YouTube video ID, or empty to clear',
  avatar_url: v => (v === null || v === '' || /^https:\/\/[^\s"]+$/.test(v)) ? null : 'must be a valid https URL',
};

function urlOrEmpty(v) {
  if (v === null || v === '') return null;
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) ? null : 'must be a valid URL'; }
  catch { return 'must be a valid URL'; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res(401, { error: 'Missing auth token' });

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res(401, { error: 'Invalid or expired token' });
  const { id: userId } = await userRes.json();
  if (!userId) return res(401, { error: 'Could not identify user' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON body' }); }
  const { creatorId, action } = body;
  if (!creatorId) return res(400, { error: 'creatorId is required' });

  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const creatorRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creatorId)}&select=id,claimed_by,description,content_types,social_x,social_twitch,social_discord,social_tiktok,social_instagram,featured_video_id,avatar_url,avatar_custom`,
    { headers: sbHeaders }
  );
  const rows = await creatorRes.json();
  if (!rows.length) return res(404, { error: 'Creator not found' });
  const creator = rows[0];
  if (creator.claimed_by !== userId) return res(403, { error: 'You do not manage this channel' });

  if (action === 'unclaim') {
    const patchRes = await fetch(`${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creatorId)}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ claimed_by: null }),
    });
    if (!patchRes.ok) return res(502, { error: 'Database update failed' });
    await logEdit(supabaseUrl, sbHeaders, creatorId, userId, 'claimed_by', userId, null);
    return res(200, { ok: true, message: 'Channel unclaimed' });
  }

  if (action !== 'update') return res(400, { error: 'Unknown action' });

  const patch = body.patch;
  if (!patch || typeof patch !== 'object') return res(400, { error: 'patch object is required' });

  const errors = {};
  const clean = {};
  for (const [field, value] of Object.entries(patch)) {
    const validator = FIELD_VALIDATORS[field];
    if (!validator) { errors[field] = 'not an editable field'; continue; }
    const err = validator(value);
    if (err) { errors[field] = err; continue; }
    clean[field] = value === '' ? null : value;
  }
  if (Object.keys(errors).length) return res(400, { error: 'Validation failed', fields: errors });
  if (!Object.keys(clean).length) return res(400, { error: 'No valid fields to update' });

  // Uploading a new avatar implies it's now custom-managed, so the YouTube
  // sync job (sync-background.js) stops overwriting it.
  if ('avatar_url' in clean) clean.avatar_custom = !!clean.avatar_url;

  const changed = {};
  for (const [field, value] of Object.entries(clean)) {
    const oldValue = creator[field];
    const oldCmp = Array.isArray(oldValue) ? JSON.stringify(oldValue) : oldValue;
    const newCmp = Array.isArray(value) ? JSON.stringify(value) : value;
    if (oldCmp !== newCmp) changed[field] = { old: oldValue, new: value };
  }
  if (!Object.keys(changed).length) return res(200, { ok: true, message: 'No changes' });

  const patchRes = await fetch(`${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creatorId)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(clean),
  });
  if (!patchRes.ok) return res(502, { error: 'Database update failed' });

  for (const [field, { old: o, new: n }] of Object.entries(changed)) {
    if (field === 'avatar_custom') continue; // implementation detail, not a user-facing edit
    await logEdit(supabaseUrl, sbHeaders, creatorId, userId, field, o, n);
  }

  return res(200, { ok: true, changed: Object.keys(changed) });
};

async function logEdit(supabaseUrl, sbHeaders, creatorId, userId, field, oldValue, newValue) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_creator_edit_log`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        creator_id: creatorId,
        user_id: userId,
        field,
        old_value: oldValue === null || oldValue === undefined ? null : (Array.isArray(oldValue) ? JSON.stringify(oldValue) : String(oldValue)),
        new_value: newValue === null || newValue === undefined ? null : (Array.isArray(newValue) ? JSON.stringify(newValue) : String(newValue)),
      }),
    });
  } catch { /* audit log is best-effort, never block the actual edit on it */ }
}

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
