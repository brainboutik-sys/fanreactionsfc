const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const click = require('../netlify/functions/link-click.js');
const admin = require('../netlify/functions/admin-link-clicks.js');

const CREATOR = '22222222-2222-4222-8222-222222222222';
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

async function withClickEnv(fetchImpl, fn) {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  global.fetch = fetchImpl;
  click.resetLimits();
  try {
    return await fn();
  } finally {
    click.resetLimits();
    global.fetch = prevFetch;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
}

function post(body, extraHeaders) {
  return {
    httpMethod: 'POST',
    headers: Object.assign({
      cookie: 'sb-access-token=secret',
      'user-agent': 'TestBrowser/1.0',
      'x-forwarded-for': '203.0.113.5',
    }, extraHeaders || {}),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

test('a click stores only creator, club, link type, and path', async () => {
  const inserts = [];
  const res = await withClickEnv(async (url, options = {}) => {
    const href = String(url);
    if (href.includes('frfc_streamers')) {
      return json(200, [{ id: CREATOR, slug: 'overlap-daily' }]);
    }
    if (href.includes('frfc_link_clicks')) {
      assert.notEqual(options.method, 'DELETE');
      inserts.push(JSON.parse(options.body));
      assert.equal(options.headers.Authorization, 'Bearer ' + SERVICE);
      return json(201, null);
    }
    return json(500, { message: 'unexpected' });
  }, () => click.handler(post({
    slug: 'overlap-daily',
    link: 'channel',
    club: 'Liverpool',
    path: '/creators/overlap-daily',
    email: 'fan@example.com',
    userId: USER,
    ip: '203.0.113.5',
    userAgent: 'TestBrowser/1.0',
  })));
  assert.equal(res.statusCode, 200);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0], {
    creator_id: CREATOR,
    creator_slug: 'overlap-daily',
    club: 'Liverpool',
    link_type: 'channel',
    page_path: '/creators/overlap-daily',
  });
  assert.equal(JSON.stringify(inserts[0]).includes('203.0.113.5'), false);
  assert.equal(JSON.stringify(inserts[0]).includes('fan@example.com'), false);
  assert.equal(JSON.stringify(inserts[0]).includes(USER), false);
});

test('unknown creators, bad link types, and query strings are rejected', async () => {
  let inserts = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('frfc_streamers')) return json(200, []);
    inserts += 1;
    return json(500, { message: 'should not insert' });
  };
  const unknown = await withClickEnv(fetchImpl, () => click.handler(post({
    slug: 'not-a-creator', link: 'live', path: '/clubs/liverpool',
  })));
  assert.equal(unknown.statusCode, 400);
  assert.equal(inserts, 0);

  click.resetLimits();
  const badType = await withClickEnv(fetchImpl, () => click.handler(post({
    slug: 'overlap-daily', link: 'youtube', path: '/',
  })));
  assert.equal(badType.statusCode, 400);

  click.resetLimits();
  const query = await withClickEnv(fetchImpl, () => click.handler(post({
    slug: 'overlap-daily', link: 'live', path: '/creators/overlap-daily?email=fan@example.com',
  })));
  assert.equal(query.statusCode, 400);
  assert.equal(click.parseClick(JSON.stringify({
    slug: 'overlap-daily', link: 'channel', path: '/news/a-title', club: 'Man United',
  })).club, 'Man United');
  assert.equal(click.parseClick(JSON.stringify({
    slug: 'overlap-daily', link: 'channel', path: '/ok', club: 'fan@example.com',
  })).club, null);
});

test('the same creator and link type is rate limited without using an address', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('frfc_streamers')) return json(200, [{ id: CREATOR, slug: 'aftv' }]);
    if (String(url).includes('frfc_link_clicks')) return json(201, null);
    return json(500, { message: 'unexpected' });
  };
  await withClickEnv(fetchImpl, async () => {
    const body = { slug: 'aftv', link: 'live', path: '/', club: 'Arsenal' };
    for (let i = 0; i < click.PER_KEY_LIMIT; i++) {
      const ok = await click.handler(post(body));
      assert.equal(ok.statusCode, 200, 'click ' + i);
    }
    const blocked = await click.handler(post(body));
    assert.equal(blocked.statusCode, 429);
  });
});

function isPermissionCheck(url) {
  return String(url).includes('/rest/v1/rpc/frfc_has_permission');
}

test('a caller without settings.manage is refused and the counts are never read', async () => {
  let asked = null;
  let tableQueried = false;
  const denied = await withClickEnv(async (url, init) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) {
      asked = JSON.parse(init.body);
      assert.equal(init.method, 'POST');
      return json(200, false);
    }
    if (String(url).includes('frfc_link_click')) tableQueried = true;
    return json(500, { message: 'unexpected' });
  }, () => admin.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer user-token' } }));
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(asked, { p_user_id: USER, p_permission: 'settings.manage' });
  assert.match(JSON.parse(denied.body).error, /settings\.manage/);
  assert.equal(tableQueried, false);

  const notTrue = await withClickEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(200, null);
    if (String(url).includes('frfc_link_click')) tableQueried = true;
    return json(500, { message: 'unexpected' });
  }, () => admin.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer user-token' } }));
  assert.equal(notTrue.statusCode, 403);
  assert.equal(tableQueried, false);
});

test('a failed permission lookup is a 502 and the counts are never read', async () => {
  let tableQueried = false;
  const failed = await withClickEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(500, { message: 'down' });
    if (String(url).includes('frfc_link_click')) tableQueried = true;
    return json(500, { message: 'unexpected' });
  }, () => admin.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer user-token' } }));
  assert.equal(failed.statusCode, 502);
  assert.equal(tableQueried, false);
});

test('a caller with settings.manage can read click counts', async () => {
  const pending = await withClickEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(200, true);
    if (String(url).includes('frfc_link_click_counts')) {
      return json(404, { code: 'PGRST205', message: 'Could not find the table frfc_link_click_counts' });
    }
    return json(500, { message: 'unexpected' });
  }, () => admin.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer user-token' } }));
  assert.equal(pending.statusCode, 200);
  assert.equal(JSON.parse(pending.body).pendingMigration, true);

  const row = { creator_slug: 'aftv', club: 'Arsenal', link_type: 'live', clicks_7d: 2, clicks_30d: 5 };
  const listed = await withClickEnv(async (url) => {
    if (String(url).includes('/auth/v1/user')) return json(200, { id: USER });
    if (isPermissionCheck(url)) return json(200, true);
    if (String(url).includes('frfc_link_click_counts')) return json(200, [row]);
    return json(500, { message: 'unexpected' });
  }, () => admin.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer user-token' } }));
  assert.equal(listed.statusCode, 200);
  const body = JSON.parse(listed.body);
  assert.equal(body.pendingMigration, false);
  assert.deepEqual(body.counts, [row]);
});

test('the migration is service-role only and the client sends no visitor id', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261026110000_frfc_link_clicks.sql'), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.frfc_link_clicks from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.frfc_link_clicks to service_role/);
  assert.match(sql, /frfc_link_click_counts/);
  assert.match(sql, /interval '7 days'/);
  assert.match(sql, /interval '30 days'/);
  const table = sql.slice(sql.indexOf('create table'), sql.indexOf(');'));
  assert.doesNotMatch(table, /ip_address|user_agent|user_id|cookie/i);

  const app = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  const fn = app.match(/function sendCreatorLinkClick\(slug, link, club\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /keepalive:\s*true/);
  assert.match(fn[0], /credentials:\s*'omit'/);
  assert.match(fn[0], /location\.pathname/);
  assert.doesNotMatch(fn[0], /localStorage|sessionStorage|userAgent|currentUser|cookie|fingerprint/i);
  assert.match(app, /creatorLinkTrackAttrs\(c\.slug, 'channel', c\.team\)/);
  assert.match(app, /creatorLinkTrackAttrs\(c\.slug, 'live', c\.team\)/);
  assert.match(app, /creatorLinkTrackAttrs\(c\.slug, 'channel', club \|\| c\.team\)/);
  assert.match(app, /sendCreatorLinkClick\(match\.slug, 'live', match\.team\)/);

  const og = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/creator-og.js'), 'utf8');
  assert.match(og, /data-frfc-link="channel"/);
  const hub = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/club-og.js'), 'utf8');
  assert.match(hub, /data-frfc-link="channel" data-frfc-creator="\$\{esc\(slug\)\}"/);

  const adminJs = fs.readFileSync(path.join(__dirname, '..', 'js/admin.js'), 'utf8');
  assert.match(adminJs, /if \(can\('settings\.manage'\)\) \{ loadUnlinkedPayments\(\); loadLinkClicks\(\); \}/);
  assert.match(adminJs, /can\('settings\.manage'\)[\s\S]*Unlinked Verified payments[\s\S]*Channel and watch-live clicks/);
  assert.match(adminJs, /function loadUnlinkedPayments\(/);
  assert.match(adminJs, /function loadLinkClicks\(/);
  assert.match(sql, /90 days/);
  assert.match(sql, /retention-cleanup\.js/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/link-click.js'), 'utf8'), /frfc_link_clicks\?created_at/);
});
