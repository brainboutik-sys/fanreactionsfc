const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const claim = require('../netlify/functions/claim-creator.js');
const manage = require('../netlify/functions/manage-channel.js');
const { escHtml, safeUrl } = require('../js/lib/html.js');
const { renderClaimModalHtml } = require('../js/lib/claim-ui.js');

const CREATOR = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CHANNEL = 'UCabcdefghijklmnopqrstuv';
const PEPPER = 'pepper-test';
const YT_KEY = 'yt-test-key-should-not-leak';
const SERVICE = 'service-role-test-key';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  YOUTUBE_API_KEY: YT_KEY,
  CLAIM_CODE_PEPPER: PEPPER,
};

function fixedCode() {
  return claim.generateVerificationCode(() => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
}

function scriptedFetch(handlers) {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    const call = {
      url: String(url),
      method: (options.method || 'GET').toUpperCase(),
      options,
    };
    calls.push(call);
    for (const handler of handlers) {
      if (handler.when(call)) {
        const status = handler.status || 200;
        const body = typeof handler.body === 'function' ? handler.body(call) : handler.body;
        const text = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
        return { ok: status >= 200 && status < 300, status, text: async () => text };
      }
    }
    return {
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: `unhandled ${call.method} ${call.url}` }),
    };
  }
  return { fetchImpl, calls };
}

function event(body, token = 'user-token') {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  };
}

function authOk() {
  return { when: (c) => c.url.includes('/auth/v1/user'), status: 200, body: { id: USER } };
}

function streamer(row) {
  return {
    when: (c) => c.url.includes('/frfc_streamers') && c.method === 'GET',
    status: 200,
    body: [Object.assign({
      id: CREATOR,
      channel_url: 'https://www.youtube.com/@ExampleFC',
      youtube_channel_id: CHANNEL,
      claimed_by: null,
    }, row)],
  };
}

function claims(rows) {
  return {
    when: (c) => c.url.includes('/frfc_creator_claims') && c.method === 'GET',
    status: 200,
    body: rows,
  };
}

test('verification codes are short, random, and not derived from a user id', () => {
  const code = fixedCode();
  assert.equal(code, 'FRFC-ABCDEFGH');
  assert.match(code, claim.CODE_RE);
  const other = claim.generateVerificationCode(() => Buffer.from([8, 9, 10, 11, 12, 13, 14, 15]));
  assert.notEqual(code, other);
  assert.equal(claim.CODE_TTL_MS, 24 * 60 * 60 * 1000);
});

test('codes are stored as an HMAC, not the plaintext', () => {
  const code = fixedCode();
  const hash = claim.hashVerificationCode(code, PEPPER);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, code);
  assert.equal(hash.includes(code), false);
  assert.notEqual(hash, claim.hashVerificationCode(code, 'other-pepper'));
  assert.equal(claim.hashesMatch(hash, code, PEPPER), true);
  assert.equal(claim.hashesMatch(hash, 'FRFC-AAAAAAA2', PEPPER), false);
  assert.equal(claim.hashesMatch('abcd', code, PEPPER), false);
});

test('description match requires the whole code, not a prefix or different case', () => {
  const code = 'FRFC-ABCDEFGH';
  assert.equal(claim.codeAppearsInDescription(code, code), true);
  assert.equal(claim.codeAppearsInDescription(`About the channel\n${code}\nThanks`, code), true);
  assert.equal(claim.codeAppearsInDescription(`(${code})`, code), true);
  assert.equal(claim.codeAppearsInDescription(`${code}X`, code), false);
  assert.equal(claim.codeAppearsInDescription(`X${code}`, code), false);
  assert.equal(claim.codeAppearsInDescription(code.toLowerCase(), code), false);
  assert.equal(claim.codeAppearsInDescription('', code), false);
  assert.equal(claim.codeAppearsInDescription(null, code), false);
});

test('codes expire after their timestamp and rate limits count the recent window', () => {
  const now = Date.parse('2026-10-14T12:00:00.000Z');
  assert.equal(claim.isExpired('2026-10-14T11:00:00.000Z', now), true);
  assert.equal(claim.isExpired('2026-10-15T12:00:00.000Z', now), false);
  assert.equal(claim.isExpired('not-a-date', now), true);

  const recent = new Date(now - 60 * 1000).toISOString();
  const old = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const rows = [
    { created_at: recent, check_times: [recent, recent] },
    { created_at: recent, check_times: [old] },
    { created_at: old, check_times: [] },
    { created_at: old, check_times: [] },
    { created_at: old, check_times: [] },
  ];
  assert.equal(claim.countRecentIssues(rows, now), 2);
  assert.equal(claim.countRecentChecks(rows, now), 2);
  assert.equal(claim.ISSUE_LIMIT_PER_HOUR, 5);
  assert.equal(claim.CHECK_LIMIT_PER_HOUR, 10);
  assert.equal(claim.CHECK_LIMIT_PER_CODE, 8);
});

test('issue returns the plaintext once and stores only the hash', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    authOk(),
    streamer(),
    claims([]),
    { when: (c) => c.url.includes('/frfc_creator_claims') && c.method === 'PATCH', status: 204, body: '' },
    {
      when: (c) => c.url.includes('/frfc_creator_claims') && c.method === 'POST',
      status: 201,
      body: [{ id: '44444444-4444-4444-8444-444444444444', expires_at: '2026-10-15T12:00:00.000Z', status: 'pending' }],
    },
  ]);
  const res = await claim.claimCreatorHandler(event({ action: 'issue', creatorId: CREATOR }), {
    fetch: fetchImpl,
    env: ENV,
    now: Date.parse('2026-10-14T12:00:00.000Z'),
    randomBytes: () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
  });
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.code, 'FRFC-ABCDEFGH');
  assert.equal(payload.expiresAt, '2026-10-15T12:00:00.000Z');
  assert.equal(Object.hasOwn(payload, 'code_hash'), false);
  assert.equal(res.body.includes(YT_KEY), false);
  assert.equal(res.body.includes(SERVICE), false);

  const insert = calls.find(c => c.method === 'POST' && c.url.includes('/frfc_creator_claims'));
  const stored = JSON.parse(insert.options.body);
  assert.deepEqual(Object.keys(stored).sort(), ['code_hash', 'creator_id', 'status', 'user_id']);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.code_hash, claim.hashVerificationCode(payload.code, PEPPER));
  assert.equal(stored.code_hash.includes(payload.code), false);
  assert.equal(insert.options.headers.Authorization, `Bearer ${SERVICE}`);
});

test('verify records the claim only when the description contains the issued code', async () => {
  const code = fixedCode();
  const hash = claim.hashVerificationCode(code, PEPPER);
  const pending = {
    id: '44444444-4444-4444-8444-444444444444',
    creator_id: CREATOR,
    user_id: USER,
    status: 'pending',
    created_at: '2026-10-14T11:00:00.000Z',
    expires_at: '2026-10-15T11:00:00.000Z',
    check_count: 0,
    check_times: [],
    code_hash: hash,
  };
  const { fetchImpl, calls } = scriptedFetch([
    authOk(),
    streamer(),
    claims([pending]),
    { when: (c) => c.url.includes('/frfc_creator_claims') && c.method === 'PATCH' && c.url.includes('status=eq.pending'), status: 200, body: [{ ...pending, status: 'verified' }] },
    { when: (c) => c.url.includes('/frfc_streamers') && c.method === 'PATCH', status: 204, body: '' },
    { when: (c) => c.url.includes('youtube/v3/channels'), status: 200, body: { items: [{ snippet: { description: `Fan channel\n${code}\n` } }] } },
  ]);
  const res = await claim.claimCreatorHandler(event({ action: 'verify', creatorId: CREATOR, code }), {
    fetch: fetchImpl,
    env: ENV,
    now: Date.parse('2026-10-14T12:00:00.000Z'),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(res.body.includes(YT_KEY), false);

  const youtube = calls.find(c => c.url.includes('googleapis.com'));
  assert.ok(youtube);
  assert.match(youtube.url, new RegExp(`id=${CHANNEL}`));
  assert.match(youtube.url, new RegExp(`key=${encodeURIComponent(YT_KEY)}`));

  const verified = calls.find(c => c.method === 'PATCH' && c.url.includes('/frfc_creator_claims') && c.options.body.includes('verified'));
  assert.equal(JSON.parse(verified.options.body).status, 'verified');
  const owned = calls.find(c => c.method === 'PATCH' && c.url.includes('/frfc_streamers'));
  assert.deepEqual(JSON.parse(owned.options.body), { claimed_by: USER });
});

test('a wrong code does not call YouTube or mark the profile claimed', async () => {
  const pending = {
    id: '44444444-4444-4444-8444-444444444444',
    creator_id: CREATOR,
    user_id: USER,
    status: 'pending',
    created_at: '2026-10-14T11:00:00.000Z',
    expires_at: '2026-10-15T11:00:00.000Z',
    check_count: 0,
    check_times: [],
    code_hash: claim.hashVerificationCode(fixedCode(), PEPPER),
  };
  const { fetchImpl, calls } = scriptedFetch([
    authOk(),
    streamer(),
    claims([pending]),
    { when: (c) => c.method === 'PATCH', status: 204, body: '' },
  ]);
  const res = await claim.claimCreatorHandler(event({ action: 'verify', creatorId: CREATOR, code: 'FRFC-ZZZZZZZ2' }), {
    fetch: fetchImpl,
    env: ENV,
    now: Date.parse('2026-10-14T12:00:00.000Z'),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(calls.some(c => c.url.includes('googleapis.com')), false);
  assert.equal(calls.some(c => c.options.body && c.options.body.includes('claimed_by')), false);
  assert.equal(calls.some(c => c.options.body && c.options.body.includes('"status":"verified"')), false);
});

test('expired codes and hourly issue limits stop before a new challenge is stored', async () => {
  const now = Date.parse('2026-10-14T12:00:00.000Z');
  const expired = {
    id: '44444444-4444-4444-8444-444444444444',
    creator_id: CREATOR,
    user_id: USER,
    status: 'pending',
    created_at: '2026-10-13T10:00:00.000Z',
    expires_at: '2026-10-13T11:00:00.000Z',
    check_count: 0,
    check_times: [],
    code_hash: claim.hashVerificationCode(fixedCode(), PEPPER),
  };
  const expiredFetch = scriptedFetch([
    authOk(),
    streamer(),
    claims([expired]),
    { when: (c) => c.method === 'PATCH', status: 204, body: '' },
  ]);
  const expiredRes = await claim.claimCreatorHandler(event({ action: 'verify', creatorId: CREATOR, code: fixedCode() }), {
    fetch: expiredFetch.fetchImpl,
    env: ENV,
    now,
  });
  assert.equal(expiredRes.statusCode, 410);
  assert.equal(expiredFetch.calls.some(c => c.url.includes('googleapis.com')), false);

  const recent = new Date(now - 1000).toISOString();
  const issued = Array.from({ length: 5 }, () => ({ user_id: USER, creator_id: CREATOR, created_at: recent, status: 'superseded' }));
  const limited = scriptedFetch([authOk(), streamer(), claims(issued)]);
  const limitedRes = await claim.claimCreatorHandler(event({ action: 'issue', creatorId: CREATOR }), {
    fetch: limited.fetchImpl,
    env: ENV,
    now,
    randomBytes: () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
  });
  assert.equal(limitedRes.statusCode, 429);
  assert.equal(limited.calls.some(c => c.method === 'POST'), false);
});

test('a channel already verified by someone else cannot be re-issued', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    authOk(),
    streamer({ claimed_by: OTHER }),
    claims([{ creator_id: CREATOR, user_id: OTHER, status: 'verified' }]),
  ]);
  const res = await claim.claimCreatorHandler(event({ action: 'issue', creatorId: CREATOR }), {
    fetch: fetchImpl,
    env: ENV,
    now: Date.parse('2026-10-14T12:00:00.000Z'),
  });
  assert.equal(res.statusCode, 409);
  assert.equal(calls.some(c => c.method === 'POST'), false);
});

test('malformed creator ids never reach the database filter', async () => {
  const { fetchImpl, calls } = scriptedFetch([authOk()]);
  const res = await claim.claimCreatorHandler(event({ action: 'issue', creatorId: 'not-a-uuid' }), {
    fetch: fetchImpl,
    env: ENV,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.some(c => c.url.includes('not-a-uuid')), false);
});

test('owner edits accept a short bio and http(s) links, and reject protected fields outright', () => {
  const ok = manage.sanitizeOwnerPatch({
    description: '  Match day reactions. ',
    social_x: 'https://x.com/example',
    social_instagram: '',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.clean.description, 'Match day reactions.');
  assert.equal(ok.clean.social_x, 'https://x.com/example');
  assert.equal(ok.clean.social_instagram, null);

  assert.equal(manage.validateBio('x'.repeat(281)).ok, false);
  assert.equal(manage.validateHttpUrl('javascript:alert(1)').ok, false);
  assert.equal(manage.validateHttpUrl('data:text/html,hi').ok, false);
  assert.equal(manage.validateHttpUrl('ftp://example.com').ok, false);
  assert.equal(manage.validateHttpUrl('http://user:pass@example.com').ok, false);
  assert.equal(manage.validateHttpUrl('https://example.com/path').ok, true);

  for (const field of manage.OWNER_FORBIDDEN_FIELDS) {
    const mixed = manage.sanitizeOwnerPatch({ description: 'ok', [field]: 'pwned' });
    assert.equal(mixed.ok, false, field);
    assert.equal(mixed.fields[field], 'not an editable field');
    assert.equal(Object.hasOwn(mixed, 'clean'), false);
  }
  assert.equal(manage.sanitizeOwnerPatch({ not_a_field: 'x' }).ok, false);
  assert.ok(manage.OWNER_FORBIDDEN_FIELDS.includes('is_verified'));
  assert.ok(manage.OWNER_FORBIDDEN_FIELDS.includes('verified_until'));
  assert.ok(manage.OWNER_FORBIDDEN_FIELDS.includes('verified'));
  assert.ok(manage.OWNER_FORBIDDEN_FIELDS.includes('subscriber_count'));
  assert.ok(manage.OWNER_FORBIDDEN_FIELDS.includes('slug'));
  assert.ok(manage.OWNER_FORBIDDEN_FIELDS.includes('team'));
  assert.ok(manage.OWNER_FORBIDDEN_FIELDS.includes('approval_status'));
});

test('profile updates call the owner RPC as the user and drop forbidden fields first', async () => {
  const anon = 'sb_publishable_test';
  const blocked = scriptedFetch([
    { when: (c) => c.url.includes('/auth/v1/user'), status: 200, body: { id: USER } },
  ]);
  const blockedRes = await manage.manageChannelHandler(event({
    creatorId: CREATOR,
    action: 'update',
    patch: { description: 'Hello', verified: true, slug: 'stolen' },
  }), { fetch: blocked.fetchImpl, env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_ANON_KEY: anon } });
  assert.equal(blockedRes.statusCode, 400);
  assert.equal(blocked.calls.some(c => c.url.includes('/rpc/')), false);

  const saved = scriptedFetch([
    { when: (c) => c.url.includes('/auth/v1/user'), status: 200, body: { id: USER } },
    { when: (c) => c.url.includes('/rpc/frfc_owner_update_profile'), status: 200, body: { ok: true, changed: ['description'] } },
  ]);
  const savedRes = await manage.manageChannelHandler(event({
    creatorId: CREATOR,
    action: 'update',
    patch: { description: 'Hello', social_x: 'https://x.com/example' },
  }), { fetch: saved.fetchImpl, env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_ANON_KEY: anon } });
  assert.equal(savedRes.statusCode, 200);
  const rpc = saved.calls.find(c => c.url.includes('/rpc/frfc_owner_update_profile'));
  const sent = JSON.parse(rpc.options.body);
  assert.deepEqual(sent.p_patch, { description: 'Hello', social_x: 'https://x.com/example' });
  assert.equal(rpc.options.headers.Authorization, 'Bearer user-token');
  assert.equal(rpc.options.headers.apikey, anon);
  assert.equal(rpc.options.headers.apikey.includes('service'), false);

  const unclaim = scriptedFetch([
    { when: (c) => c.url.includes('/auth/v1/user'), status: 200, body: { id: USER } },
    { when: (c) => c.url.includes('/rpc/frfc_owner_unclaim'), status: 200, body: { ok: true } },
  ]);
  const unclaimRes = await manage.manageChannelHandler(event({ creatorId: CREATOR, action: 'unclaim' }), {
    fetch: unclaim.fetchImpl,
    env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_ANON_KEY: anon },
  });
  assert.equal(unclaimRes.statusCode, 200);
  assert.deepEqual(JSON.parse(unclaim.calls.find(c => c.url.includes('unclaim')).options.body), { p_creator_id: CREATOR });
  assert.equal(unclaim.calls.some(c => c.url.includes('/frfc_streamers')), false);
});

test('manage-channel does not use the service role key', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/manage-channel.js'), 'utf8');
  assert.equal(source.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(source.includes('frfc_owner_update_profile'), true);
  assert.equal(source.includes('frfc_owner_unclaim'), true);
});

test('user content is escaped and only http(s) URLs are kept for rendering', () => {
  const nasty = '<img src=x onerror="alert(1)">';
  assert.equal(escHtml(nasty).includes('<'), false);
  assert.match(escHtml(nasty), /&lt;img/);
  assert.equal(escHtml(`'quoted' & "double"`), '&#39;quoted&#39; &amp; &quot;double&quot;');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,hi'), '');
  assert.equal(safeUrl('https://user:secret@example.com/a'), '');
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');

  const html = renderClaimModalHtml({
    state: 'ready',
    creatorName: nasty,
    code: '<script>',
    expiresLabel: '<b>now</b>',
  });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<b>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});

test('the claims migration encodes the security model and is not applied from code', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20261014120000_frfc_creator_claims.sql'),
    'utf8'
  );
  assert.match(sql, /create table public\.frfc_creator_claims/i);
  assert.match(sql, /code_hash/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /where status = 'verified'/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /revoke all on table public\.frfc_creator_claims from public, anon, authenticated/i);
  assert.match(sql, /revoke insert, update, delete on table public\.frfc_streamers from anon/i);
  assert.match(sql, /direct creator updates are not allowed/);
  assert.doesNotMatch(sql, /for insert/i);
  assert.doesNotMatch(sql, /for update/i);
  assert.doesNotMatch(sql, /for delete/i);

  const grant = sql.match(/grant select \(([\s\S]*?)\) on table public\.frfc_creator_claims/i);
  assert.ok(grant);
  assert.doesNotMatch(grant[1], /code_hash/);
  assert.doesNotMatch(grant[1], /check_times/);

  const allowed = sql.match(/v_allowed text\[\] := array\[([\s\S]*?)\]/);
  assert.ok(allowed);
  assert.match(allowed[1], /description/);
  assert.match(allowed[1], /social_x/);
  assert.doesNotMatch(allowed[1], /is_verified|verified_until|subscriber_count|slug|team|approval/);

  for (const column of ['is_verified', 'verified_until', 'verified', 'subscriber_count', 'slug', 'team']) {
    assert.match(sql, new RegExp(`new\\.${column} := old\\.${column}`));
  }

  const repo = fs.readFileSync(path.join(__dirname, '../netlify/functions/claim-creator.js'), 'utf8');
  assert.equal(repo.includes('apply_migration'), false);
  assert.equal(repo.includes("action: 'apply'"), false);
});
