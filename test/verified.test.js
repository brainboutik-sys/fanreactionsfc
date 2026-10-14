const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lib = require('../js/lib/verified.js');
const statsFn = require('../netlify/functions/creator-stats.js');

function withCwd(fn) {
  const prev = process.cwd();
  process.chdir(path.join(__dirname, '..'));
  return Promise.resolve()
    .then(fn)
    .finally(() => process.chdir(prev));
}

test('a creator is verified only while the paid flag is on and the period has not ended', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(lib.isCurrentlyVerified(null, now), false);
  assert.equal(lib.isCurrentlyVerified({ is_verified: false, verified_until: null }, now), false);
  assert.equal(lib.isCurrentlyVerified({ is_verified: true, verified_until: null }, now), true);
  assert.equal(lib.isCurrentlyVerified({ is_verified: true }, now), true);
  assert.equal(lib.isCurrentlyVerified({ isVerified: true, verifiedUntil: null }, now), true);
  assert.equal(lib.isCurrentlyVerified({ is_verified: true, verified_until: '2099-01-01T00:00:00Z' }, now), true);
  assert.equal(lib.isCurrentlyVerified({ is_verified: true, verified_until: '2020-01-01T00:00:00Z' }, now), false);
  assert.equal(lib.isCurrentlyVerified({ is_verified: true, verified_until: 'not-a-date' }, now), false);
  assert.equal(lib.isCurrentlyVerified({ isVerified: false, is_verified: true }, now), false);
  assert.equal(lib.verifiedBadgeHTML({ is_verified: false }, now), '');
  assert.match(lib.verifiedBadgeHTML({ is_verified: true, verified_until: null }, now), /badge-verified/);
});

test('verified-first sort keeps each group in its original order', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const input = [
    { name: 'a', is_verified: false },
    { name: 'b', is_verified: true, verified_until: null },
    { name: 'c', is_verified: false },
    { name: 'd', is_verified: true, verified_until: '2020-01-01T00:00:00Z' },
    { name: 'e', is_verified: true, verified_until: '2099-01-01T00:00:00Z' },
  ];
  const sorted = lib.sortVerifiedFirst(input, now);
  assert.deepEqual(sorted.map(c => c.name), ['b', 'e', 'a', 'c', 'd']);
  assert.deepEqual(input.map(c => c.name), ['a', 'b', 'c', 'd', 'e']);
});

test('stats share copy matches between the client helper and the stats function', () => {
  const sample = {
    name: 'Pinned Channel',
    subscriberCount: 1200,
    videoCount: 40,
    monthLabel: 'October 2026',
    latestTitle: 'Match reaction',
  };
  assert.deepEqual(statsFn.statsShareCopy(sample), lib.statsShareCopy(sample));
  assert.equal(lib.statsMonthLabel('2026-10-02T00:00:00Z'), 'October 2026');
  assert.equal(statsFn.statsMonthLabel('2026-10-02T00:00:00Z'), 'October 2026');
  assert.match(lib.statsShareCopy(sample).description, /1\.2K subscribers/);
  assert.match(lib.statsShareCopy(sample).description, /no channel analytics/);
  assert.equal(lib.VERIFIED_PRICE_LABEL, 'CHF 4/month');
});

test('the Stripe Payment Link is a single placeholder constant', () => {
  const config = statsFn.readVerifiedConfig();
  assert.equal(config.link, lib.VERIFIED_STRIPE_PAYMENT_LINK);
  assert.equal(config.price, lib.VERIFIED_PRICE_LABEL);
  assert.match(config.link, /TODO_REPLACE_WITH_LIVE_VERIFIED_PAYMENT_LINK/);

  const root = path.join(__dirname, '..');
  const hits = [];
  for (const dir of ['js', 'netlify']) {
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const text = fs.readFileSync(full, 'utf8');
          if (text.includes('https://buy.stripe.com/TODO_REPLACE_WITH_LIVE_VERIFIED_PAYMENT_LINK')) {
            hits.push(path.relative(root, full));
          }
        }
      }
    };
    walk(path.join(root, dir));
  }
  assert.deepEqual(hits, ['js/lib/verified.js']);
});

test('the YouTube sync patch does not write the paid Verified columns', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/sync-background.js'), 'utf8');
  assert.doesNotMatch(src, /is_verified\s*:/);
  assert.doesNotMatch(src, /verified_until\s*:/);
  assert.match(src, /Do not add is_verified or verified_until/);
});

test('stats route is registered ahead of the creator splat', () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const statsAt = toml.indexOf('from = "/creators/*/stats"');
  const splatAt = toml.indexOf('from = "/creators/*"');
  assert.ok(statsAt > 0 && splatAt > statsAt);
});

test('creator-stats 301s a trailing slash and 404s a non-stats path', async () => {
  const { handler } = require('../netlify/functions/creator-stats.js');
  await withCwd(async () => {
    const slash = await handler({ path: '/creators/aftv/stats/' });
    assert.equal(slash.statusCode, 301);
    assert.equal(slash.headers.Location, 'https://fanreactionsfc.com/creators/aftv/stats');

    const missing = await handler({ path: '/creators/aftv' });
    assert.equal(missing.statusCode, 404);
  });
});

test('club pin and streamwall order do not rewrite organic ranking', async () => {
  const prevFetch = global.fetch;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const clubRows = [
    { name: 'Big Channel', slug: 'big-channel', team: 'Arsenal', subscriber_count: 500000, is_verified: false, verified_until: null },
    { name: 'Pinned Channel', slug: 'pinned-channel', team: 'Arsenal', subscriber_count: 1200, is_verified: true, verified_until: null },
    { name: 'Expired Channel', slug: 'expired-channel', team: 'Arsenal', subscriber_count: 900000, is_verified: true, verified_until: '2020-01-01T00:00:00Z' },
  ];
  const liveRows = [
    { name: 'Bigger Live', slug: 'bigger-live', team: 'Arsenal', subscriber_count: 100, is_verified: false, verified_until: null },
    { name: 'Verified Live', slug: 'verified-live', team: 'Chelsea', subscriber_count: 10, is_verified: true, verified_until: null },
  ];
  const verifiedCreator = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Pinned Channel',
    slug: 'pinned-channel',
    team: 'Arsenal',
    subscriber_count: 1200,
    video_count: 40,
    latest_video_id: 'abcdefghijk',
    latest_video_title: 'Match reaction',
    latest_video_views: 80,
    latest_video_thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    last_youtube_sync: '2026-10-02T00:00:00Z',
    is_verified: true,
    verified_until: null,
    avatar_url: 'https://example.com/avatar.jpg',
  };

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('frfc_video_metrics')) {
      return jsonOk([
        { video_id: 'abcdefghijk', views: 80, recorded_at: '2026-10-02T00:00:00Z' },
        { video_id: 'zzzzzzzzzzz', views: 15, recorded_at: '2026-10-01T00:00:00Z' },
      ]);
    }
    if (u.includes('is_verified') && u.includes('is_live=eq.true')) return jsonOk(liveRows);
    if (u.includes('is_live=eq.true')) return jsonOk(liveRows);
    if (u.includes('frfc_streamers') && u.includes('pinned-channel') === false && u.includes('is_verified') && u.includes('subscriber_count')) {
      return jsonOk(clubRows);
    }
    if (u.includes('slug.eq.pinned-channel') || u.includes('slug.eq.')) return jsonOk([verifiedCreator]);
    return jsonOk([]);
  };

  try {
    await withCwd(async () => {
      const club = require('../netlify/functions/club-og.js');
      const res = await club.handler({ path: '/clubs/arsenal' });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /class="club-verified-slot"/);
      assert.match(res.body, /id="club-verified-heading">Verified creators/);
      assert.doesNotMatch(res.body, /class="sponsored-slot"/);
      const raw = res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      const jsonLd = JSON.parse(raw[1]);
      const page = jsonLd['@graph'].find(n => n && n['@type'] === 'CollectionPage');
      const names = page.mainEntity.itemListElement.map(item => item.name);
      assert.deepEqual(names, ['Expired Channel', 'Big Channel', 'Pinned Channel']);
      const tbody = res.body.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
      const tableNames = [...tbody.matchAll(/creators\/[^"]+">([^<]+)</g)].map(m => m[1]);
      assert.deepEqual(tableNames, ['Expired Channel', 'Big Channel', 'Pinned Channel']);
      const slot = res.body.match(/<section class="club-verified-slot"[\s\S]*?<\/section>/)[0];
      assert.match(slot, /Pinned Channel/);
      assert.doesNotMatch(slot, /Expired Channel/);
      assert.doesNotMatch(slot, /Big Channel/);
      assert.match(res.body, /The most-followed is Expired Channel/);

      const wall = require('../netlify/functions/streamwall.js');
      const live = await wall.handler({ path: '/streamwall' });
      const list = live.body.match(/<ul class="seo-list">([\s\S]*?)<\/ul>/)[1];
      const liveNames = [...list.matchAll(/\/creators\/[^"]+">([^<]+)</g)].map(m => m[1]);
      assert.deepEqual(liveNames, ['Verified Live', 'Bigger Live']);

      const stats = require('../netlify/functions/creator-stats.js');
      const card = await stats.handler({ path: '/creators/pinned-channel/stats' });
      assert.equal(card.statusCode, 200);
      assert.match(card.body, /Pinned Channel — October 2026 YouTube stats/);
      assert.match(card.body, /1\.2K subscribers and 40 videos/);
      assert.match(card.body, /Latest upload: Match reaction/);
      assert.match(card.body, /property="og:image" content="https:\/\/i\.ytimg\.com\/vi\/abcdefghijk\/hqdefault\.jpg"/);
      assert.match(card.body, /zzzzzzzzzzz/);
      assert.doesNotMatch(card.body, /name="robots" content="noindex/);
      assert.match(card.body, /id="creator-stats-card"/);
    });
  } finally {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('stats card stays locked when the creator is not verified, including before the migration', async () => {
  const prevFetch = global.fetch;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  let creatorCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('frfc_streamers')) return jsonOk([]);
    creatorCalls += 1;
    if (u.includes('is_verified')) return { ok: false, status: 400, json: async () => ({}) };
    return jsonOk([{
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Plain Channel',
      slug: 'plain-channel',
      team: 'Arsenal',
      subscriber_count: 99999,
      video_count: 3,
    }]);
  };
  try {
    await withCwd(async () => {
      const { handler } = require('../netlify/functions/creator-stats.js');
      const res = await handler({ path: '/creators/plain-channel/stats' });
      assert.equal(res.statusCode, 200);
      assert.ok(creatorCalls >= 2);
      assert.match(res.body, /name="robots" content="noindex, follow"/);
      assert.match(res.body, /Get Verified — CHF 4\/month/);
      assert.match(res.body, /TODO_REPLACE_WITH_LIVE_VERIFIED_PAYMENT_LINK/);
      assert.doesNotMatch(res.body, /99,999|99999|100\.0K/);
      assert.doesNotMatch(res.body, /id="creator-stats-card"/);
    });
  } finally {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

function jsonOk(body) {
  return { ok: true, status: 200, json: async () => body };
}
