// Consolidated user-management function — the only place in the app that
// talks to the Supabase Auth Admin API. One file with an `action` switch
// (matching this codebase's self-contained-function convention) instead of
// 7 near-identical files each re-implementing the same JWT-verify +
// permission-check boilerplate.
// POST /admin-users  (Authorization: Bearer <supabase_access_token>)
// Body: { action, ...payload }
//
// Every action is gated on a specific permission (checked server-side via
// frfc_has_permission — the caller's role/permissions are read fresh on
// every request, never trusted from the client). Every action is logged
// to frfc_admin_log regardless of outcome.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

const ACTION_PERMISSIONS = {
  list: ['users.view'],
  invite: ['users.create'],
  update: ['users.edit'],
  deactivate: ['users.deactivate'],
  reactivate: ['users.deactivate'],
  reset_password: ['users.reset_password'],
  assign_role: ['users.assign_role'],
  // Deleting a user account is the one action in this app analogous to a
  // truly destructive, irreversible operation — it requires both the
  // specific permission and the cross-cutting destructive-actions gate.
  delete: ['users.delete', 'database.destructive_actions'],
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
    await logAdminAction(supabaseUrl, sbHeaders, callerId, action, 'user', result.targetUserId || body.userId || null, result.details);
    return res(200, Object.assign({ ok: true }, result.response));
  } catch (e) {
    await logAdminAction(supabaseUrl, sbHeaders, callerId, action + '_failed', 'user', body.userId || null, { error: e.message });
    return res(e.statusCode || 500, { error: e.message });
  }
};

async function runAction(supabaseUrl, sbHeaders, action, body) {
  if (action === 'list') {
    const [usersRes, rolesRes] = await Promise.all([
      fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, { headers: sbHeaders }),
      fetch(`${supabaseUrl}/rest/v1/frfc_admin_roles?select=user_id,role`, { headers: sbHeaders }),
    ]);
    if (!usersRes.ok) throw httpError(502, 'Failed to list users: ' + await usersRes.text());
    const usersJson = await usersRes.json();
    const roleByUser = new Map((rolesRes.ok ? await rolesRes.json() : []).map(r => [r.user_id, r.role]));
    const users = (usersJson.users || []).map(u => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      deactivated: !!(u.banned_until && new Date(u.banned_until) > new Date()),
      role: roleByUser.get(u.id) || null,
    }));
    return { response: { users } };
  }

  if (action === 'invite') {
    const email = String(body.email || '').trim();
    if (!email) throw httpError(400, 'email is required');
    const role = String(body.role || '').trim();
    if (!role) throw httpError(400, 'role is required');

    const inviteRes = await fetch(`${supabaseUrl}/auth/v1/invite`, {
      method: 'POST', headers: sbHeaders, body: JSON.stringify({ email }),
    });
    if (!inviteRes.ok) throw httpError(502, 'Failed to invite user: ' + await inviteRes.text());
    const invited = await inviteRes.json();

    const roleRes = await fetch(`${supabaseUrl}/rest/v1/frfc_admin_roles`, {
      method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: invited.id, role }),
    });
    if (!roleRes.ok) throw httpError(502, 'User invited but role assignment failed: ' + await roleRes.text());

    return { targetUserId: invited.id, details: { email, role }, response: { userId: invited.id } };
  }

  if (action === 'update') {
    const userId = body.userId;
    if (!userId) throw httpError(400, 'userId is required');
    const patch = {};
    if (body.email) patch.email = String(body.email).trim();
    if (body.userMetadata) patch.user_metadata = body.userMetadata;
    const updateRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'PUT', headers: sbHeaders, body: JSON.stringify(patch),
    });
    if (!updateRes.ok) throw httpError(502, 'Failed to update user: ' + await updateRes.text());
    return { targetUserId: userId, details: patch, response: {} };
  }

  if (action === 'deactivate' || action === 'reactivate') {
    const userId = body.userId;
    if (!userId) throw httpError(400, 'userId is required');
    const banDuration = action === 'deactivate' ? '876000h' : 'none';
    const banRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'PUT', headers: sbHeaders, body: JSON.stringify({ ban_duration: banDuration }),
    });
    if (!banRes.ok) throw httpError(502, `Failed to ${action} user: ` + await banRes.text());
    return { targetUserId: userId, details: { action }, response: {} };
  }

  if (action === 'reset_password') {
    const email = String(body.email || '').trim();
    if (!email) throw httpError(400, 'email is required');
    const recoverRes = await fetch(`${supabaseUrl}/auth/v1/recover`, {
      method: 'POST', headers: sbHeaders, body: JSON.stringify({ email }),
    });
    if (!recoverRes.ok) throw httpError(502, 'Failed to send password reset: ' + await recoverRes.text());
    return { details: { email }, response: {} };
  }

  if (action === 'assign_role') {
    const userId = body.userId;
    const role = String(body.role || '').trim();
    if (!userId) throw httpError(400, 'userId is required');
    if (!role) throw httpError(400, 'role is required');
    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/frfc_admin_roles?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, role }),
    });
    if (!upsertRes.ok) throw httpError(502, 'Failed to assign role: ' + await upsertRes.text());
    return { targetUserId: userId, details: { role }, response: {} };
  }

  if (action === 'delete') {
    const userId = body.userId;
    if (!userId) throw httpError(400, 'userId is required');
    const deleteRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE', headers: sbHeaders,
    });
    if (!deleteRes.ok) throw httpError(502, 'Failed to delete user: ' + await deleteRes.text());
    // frfc_admin_roles.user_id is ON DELETE CASCADE, so the role row is
    // already gone — no separate cleanup needed.
    return { targetUserId: userId, response: {} };
  }

  throw httpError(400, 'Unknown action: ' + action);
}

function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

// Calls the frfc_has_permission() SQL function via RPC with an explicit
// user id — SECURITY DEFINER, doesn't depend on auth.uid(), so it works
// correctly invoked with the service-role key on the caller's behalf.
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
