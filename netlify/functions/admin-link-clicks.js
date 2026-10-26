// Read-only counts of channel and watch-live clicks.
// GET /.netlify/functions/admin-link-clicks
//   Authorization: Bearer <supabase access token>
//
// Needs the settings.manage permission (admin and super_admin by default,
// not editor). The table is service-role only, so the browser cannot
// query it directly. Nothing here writes.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const REQUIRED_PERMISSION = 'settings.manage';

function res(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (!event || event.httpMethod !== 'GET') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const headersIn = event.headers || {};
  const auth = headersIn.authorization || headersIn.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res(401, { error: 'Missing auth token' });

  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Accept: 'application/json' };
  const callerRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${token}` },
  });
  if (!callerRes.ok) return res(401, { error: 'Invalid or expired token' });
  const caller = await callerRes.json();
  if (!caller || !caller.id) return res(401, { error: 'Could not identify user' });

  // Same check admin-unlinked-payments uses. frfc_has_permission() is
  // SECURITY DEFINER and takes an explicit user id, so it works with the
  // service-role key on the caller's behalf. An editor, or a role with no
  // permissions, is refused. A failed lookup is refused too. The counts
  // table is not queried unless the check returns true.
  const permRes = await fetch(`${supabaseUrl}/rest/v1/rpc/frfc_has_permission`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, sbHeaders),
    body: JSON.stringify({ p_user_id: caller.id, p_permission: REQUIRED_PERMISSION }),
  });
  if (!permRes.ok) return res(502, { error: 'Could not check permission' });
  if ((await permRes.json()) !== true) {
    return res(403, { error: `Permission required: ${REQUIRED_PERMISSION}` });
  }

  const listRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_link_click_counts?select=creator_slug,club,link_type,clicks_7d,clicks_30d&order=clicks_7d.desc&limit=100`,
    { headers: sbHeaders }
  );
  if (listRes.status === 404) return res(200, { ok: true, pendingMigration: true, counts: [] });
  if (!listRes.ok) {
    const text = await listRes.text();
    if (/frfc_link_click|PGRST205|42P01/i.test(text)) {
      return res(200, { ok: true, pendingMigration: true, counts: [] });
    }
    return res(502, { error: 'Could not load link clicks' });
  }
  const counts = await listRes.json();
  return res(200, { ok: true, pendingMigration: false, counts: Array.isArray(counts) ? counts : [] });
};
