// Admin actions for newsletter subscriber management (P1.1 of the
// MailerLite plan). Reads happen directly from the client via sb.from(...)
// (frfc_newsletter_subscribers/_consent_log/_webhook_errors all have a
// newsletter.manage read policy) — this function exists only for the two
// writes, since frfc_newsletter_subscribers has no client-writable policy
// at all (writes only ever happen via a service-role Netlify function, the
// same trust-root pattern as frfc_admin_roles).
// POST /admin-newsletter  (Authorization: Bearer <supabase_access_token>)
// Body: { action: 'suppress' | 'resync', ...payload }

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const MAILERLITE_API = 'https://connect.mailerlite.com/api/subscribers';
const ACTION_PERMISSIONS = {
  suppress: ['newsletter.manage'],
  resync: ['newsletter.manage'],
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res(401, { error: 'Missing auth token' });

  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };

  const callerRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: sbKey, Authorization: `Bearer ${token}` } });
  if (!callerRes.ok) return res(401, { error: 'Invalid or expired token' });
  const { id: callerId } = await callerRes.json();
  if (!callerId) return res(401, { error: 'Could not identify user' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON body' }); }
  const action = body.action;
  const requiredPermissions = ACTION_PERMISSIONS[action];
  if (!requiredPermissions) return res(400, { error: 'Unknown action: ' + action });

  for (const perm of requiredPermissions) {
    if (!(await hasPermission(supabaseUrl, sbHeaders, callerId, perm))) {
      return res(403, { error: 'Permission required: ' + perm });
    }
  }

  try {
    const result = await runAction(supabaseUrl, sbHeaders, action, body);
    await logAdminAction(supabaseUrl, sbHeaders, callerId, action, 'newsletter_subscriber', result.targetEmail || body.email || null, result.details);
    return res(200, Object.assign({ ok: true }, result.response));
  } catch (e) {
    await logAdminAction(supabaseUrl, sbHeaders, callerId, action + '_failed', 'newsletter_subscriber', body.email || null, { error: e.message });
    return res(e.statusCode || 500, { error: e.message });
  }
};

async function runAction(supabaseUrl, sbHeaders, action, body) {
  const mlToken = process.env.MAILERLITE_API_TOKEN;

  if (action === 'suppress') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) throw httpError(400, 'email is required');

    const patchRes = await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_subscribers?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    if (!patchRes.ok) throw httpError(502, 'Failed to suppress subscriber: ' + await patchRes.text());

    await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_consent_log`, {
      method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ email, action: 'opt_out', notice_version: 'n/a', source: 'admin' }),
    });

    if (mlToken) {
      await fetch(MAILERLITE_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mlToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, status: 'unsubscribed' }),
      }).catch(() => {});
    }

    return { targetEmail: email, response: {} };
  }

  if (action === 'resync') {
    if (!mlToken) throw httpError(500, 'Server misconfigured: MAILERLITE_API_TOKEN missing');
    const groupNewsletter = process.env.MAILERLITE_GROUP_NEWSLETTER_ONLY;
    const groupSiteMembers = process.env.MAILERLITE_GROUP_SITE_MEMBERS;

    let targets;
    if (body.all) {
      const listRes = await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_subscribers?select=email,is_site_member&status=eq.active`, { headers: sbHeaders });
      if (!listRes.ok) throw httpError(502, 'Failed to list active subscribers: ' + await listRes.text());
      targets = await listRes.json();
    } else {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) throw httpError(400, 'email is required');
      targets = [{ email, is_site_member: !!body.isSiteMember }];
    }

    let ok = 0, fail = 0;
    for (const t of targets) {
      const groups = [groupNewsletter, t.is_site_member ? groupSiteMembers : null].filter(Boolean);
      try {
        const mlRes = await fetch(MAILERLITE_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${mlToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: t.email, groups, status: 'active' }),
        });
        if (mlRes.ok) ok++; else fail++;
      } catch { fail++; }
    }

    return { targetEmail: body.all ? null : targets[0].email, details: { count: targets.length, ok, fail }, response: { count: targets.length, ok, fail } };
  }

  throw httpError(400, 'Unknown action: ' + action);
}

function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

async function hasPermission(supabaseUrl, sbHeaders, userId, permission) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/frfc_has_permission`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({ p_user_id: userId, p_permission: permission }),
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch (e) { return false; }
}

async function logAdminAction(supabaseUrl, sbHeaders, userId, action, entityType, entityId, details) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_admin_log`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, action, entity_type: entityType, entity_id: entityId, details: details || null }),
    });
  } catch (e) { /* non-critical */ }
}

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
