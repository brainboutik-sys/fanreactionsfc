const { test } = require('node:test');
const assert = require('node:assert/strict');

const admin = require('../netlify/functions/admin-unlinked-payments.js');

const USER = '11111111-1111-4111-8111-111111111111';
const SERVICE = 'service-role-test-key';

function json(status, data) {
  const text = data == null ? '' : (typeof data === 'string' ? data : JSON.stringify(data));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (text ? JSON.parse(text) : null),
    text: async () => text,
  };
}

async function withEnv(fetchImpl, fn) {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  global.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    global.fetch = prevFetch;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
}

function event() {
  return { httpMethod: 'GET', headers: { authorization: 'Bearer user-token' } };
}

function isPermissionCheck(url) {
  return String(url).includes('/rest/v1/rpc/frfc_has_permission');
}

test('a caller without settings.manage is refused and the table is never read', async () => {
  let asked = null;
  let tableQueried = false;
  const denied = await withEnv(async (url, init) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) {
      asked = JSON.parse(init.body);
      return json(200, false);
    }
    if (String(url).includes('frfc_stripe_unlinked_invoices')) tableQueried = true;
    return json(500, { message: 'unexpected' });
  }, () => admin.handler(event()));
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(asked, { p_user_id: USER, p_permission: 'settings.manage' });
  assert.match(JSON.parse(denied.body).error, /settings\.manage/);
  assert.equal(tableQueried, false);
});

test('a failed permission lookup is refused, not treated as allowed', async () => {
  let tableQueried = false;
  const failed = await withEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(500, { message: 'down' });
    if (String(url).includes('frfc_stripe_unlinked_invoices')) tableQueried = true;
    return json(500, { message: 'unexpected' });
  }, () => admin.handler(event()));
  assert.equal(failed.statusCode, 502);
  assert.equal(tableQueried, false);

  const notTrue = await withEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(200, null);
    return json(500, { message: 'unexpected' });
  }, () => admin.handler(event()));
  assert.equal(notTrue.statusCode, 403);
});

test('a missing or invalid token is a 401', async () => {
  const noToken = await withEnv(async () => json(500, { message: 'unexpected' }),
    () => admin.handler({ httpMethod: 'GET', headers: {} }));
  assert.equal(noToken.statusCode, 401);

  const badToken = await withEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(401, { message: 'bad jwt' });
    return json(500, { message: 'unexpected' });
  }, () => admin.handler(event()));
  assert.equal(badToken.statusCode, 401);
});

test('a permitted caller sees a missing review table reported and the rows listed', async () => {
  const pending = await withEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(200, true);
    if (String(url).includes('frfc_stripe_unlinked_invoices')) {
      return json(404, { code: 'PGRST205', message: 'Could not find the table frfc_stripe_unlinked_invoices' });
    }
    return json(500, { message: 'unexpected' });
  }, () => admin.handler(event()));
  assert.equal(pending.statusCode, 200);
  assert.deepEqual(JSON.parse(pending.body), { ok: true, pendingMigration: true, payments: [] });

  const row = {
    event_id: 'evt_1',
    stripe_subscription_id: 'sub_123',
    stripe_customer_id: 'cus_123',
    invoice_id: 'in_123',
    event_created_at: '2026-10-26T00:00:00Z',
    logged_at: '2026-10-26T02:00:00Z',
  };
  const listed = await withEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(200, true);
    if (String(url).includes('frfc_stripe_unlinked_invoices')) return json(200, [row]);
    return json(500, { message: 'unexpected' });
  }, () => admin.handler(event()));
  assert.equal(listed.statusCode, 200);
  const body = JSON.parse(listed.body);
  assert.equal(body.pendingMigration, false);
  assert.deepEqual(body.payments, [row]);
});
