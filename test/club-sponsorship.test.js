const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lib = require('../js/lib/club-sponsorship.js');
const og = require('../netlify/functions/club-og.js');

const NOW = new Date('2026-10-14T12:00:00Z');
const CREATOR_ID = '11111111-1111-1111-1111-111111111111';

function assertActiveMatrix(mod) {
  assert.equal(mod.isSponsorshipActive(null, NOW), false);
  assert.equal(mod.isSponsorshipActive({}, NOW), false);
  assert.equal(mod.isSponsorshipActive({ creator_id: '' }, NOW), false);
  assert.equal(mod.isSponsorshipActive({ creator_id: CREATOR_ID }, NOW), true);
  assert.equal(mod.isSponsorshipActive({
    creator_id: CREATOR_ID,
    starts_at: null,
    ends_at: null,
  }, NOW), true);
  assert.equal(mod.isSponsorshipActive({
    creator_id: CREATOR_ID,
    starts_at: '2026-10-01T00:00:00Z',
    ends_at: '2026-11-01T00:00:00Z',
  }, NOW), true);
  assert.equal(mod.isSponsorshipActive({
    creator_id: CREATOR_ID,
    starts_at: '2026-10-20T00:00:00Z',
  }, NOW), false);
  assert.equal(mod.isSponsorshipActive({
    creator_id: CREATOR_ID,
    ends_at: '2026-10-01T00:00:00Z',
  }, NOW), false);
  assert.equal(mod.isSponsorshipActive({
    creator_id: CREATOR_ID,
    starts_at: '2026-10-14T12:00:00Z',
  }, NOW), true);
  assert.equal(mod.isSponsorshipActive({
    creator_id: CREATOR_ID,
    ends_at: '2026-10-14T12:00:00Z',
  }, NOW), false);
}

function assertSlot(mod) {
  const html = mod.sponsoredSlotHtml('Liverpool', {
    name: 'TheRedmenTV',
    slug: 'theredmentv',
    subscriber_count: 797000,
    channel_url: 'https://www.youtube.com/@TheRedmenTV',
    avatar_url: 'https://example.com/a.jpg',
    description: 'Watchalongs from the Kop. Second sentence.',
  });
  assert.match(html, /class="sponsored-slot"/);
  assert.match(html, />Sponsored</);
  assert.match(html, />Featured</);
  assert.match(html, /Sponsored: Featured Liverpool creator/);
  assert.equal((html.match(/rel="sponsored noopener"/g) || []).length, 2);
  assert.match(html, /href="\/creators\/theredmentv"/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/@TheRedmenTV" target="_blank" rel="sponsored noopener"/);
  assert.match(html, /alt="TheRedmenTV – Liverpool fan YouTuber"/);
  assert.match(html, /797\.0K subscribers/);
  assert.match(html, /Watchalongs from the Kop\./);
  assert.doesNotMatch(html, /Second sentence/);
  assert.doesNotMatch(html, /<h[1-6]/i);
  assert.doesNotMatch(html, /#\d|Rank/);

  const camel = mod.sponsoredSlotHtml('Arsenal', {
    name: 'AFTV',
    slug: 'aftvmedia',
    subscriberCount: 1500,
    channel: 'https://www.youtube.com/@AFTV',
  });
  assert.match(camel, /1\.5K subscribers/);
  assert.match(camel, /rel="sponsored noopener"/);

  const evil = mod.sponsoredSlotHtml('Arsenal', {
    name: '<script>alert(1)</script>',
    slug: 'x',
    channel_url: 'javascript:alert(1)',
    avatar_url: 'javascript:alert(1)',
    description: '<img onerror=alert(1)>',
  });
  assert.doesNotMatch(evil, /<script>/i);
  assert.match(evil, /&lt;script&gt;/);
  assert.doesNotMatch(evil, /javascript:/);
  assert.doesNotMatch(evil, /<img/i);
  assert.equal(mod.sponsoredSlotHtml('', { name: 'X' }), '');
  assert.equal(mod.sponsoredSlotHtml('Liverpool', null), '');
}

test('browser helper and club prerender share the sponsorship rules', () => {
  assert.equal(lib.isSponsorshipActive.toString(), og.isSponsorshipActive.toString());
  assert.equal(lib.sponsoredSlotHtml.toString(), og.sponsoredSlotHtml.toString());
  for (const mod of [lib, og]) {
    assertActiveMatrix(mod);
    assertSlot(mod);
  }
});

const STREAMERS = [
  { id: 'big', name: 'NathanConnorTV', slug: 'nathanconnortv', team: 'Liverpool', subscriber_count: 797000, channel_url: 'https://www.youtube.com/@NathanConnorTV', description: 'Top of the organic list.' },
  { id: 'paid', name: 'TheRedmenTV', slug: 'theredmentv', team: 'Liverpool', subscriber_count: 400000, channel_url: 'https://www.youtube.com/@TheRedmenTV', avatar_url: 'https://example.com/red.jpg', description: 'Kop watchalongs.' },
  { id: 'other', name: 'AFTVmedia', slug: 'aftvmedia', team: 'Arsenal', subscriber_count: 1800000, channel_url: 'https://www.youtube.com/@AFTVmedia', description: 'Arsenal fan TV.' },
  { id: 'united', name: 'Stretford Paddock', slug: 'stretford-paddock', team: 'Man United', subscriber_count: 500000, channel_url: 'https://www.youtube.com/@StretfordPaddock', description: 'United.' },
];

function withCwd(fn) {
  const prev = process.cwd();
  process.chdir(path.join(__dirname, '..'));
  return Promise.resolve()
    .then(fn)
    .finally(() => process.chdir(prev));
}

function installFetch(sponsorship, { sponsorshipOk = true, streamers = STREAMERS } = {}) {
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('frfc_club_sponsorships')) {
      return { ok: sponsorshipOk, json: async () => (sponsorshipOk ? sponsorship : { message: 'missing' }) };
    }
    if (u.includes('frfc_streamers')) {
      if (u.includes('id=eq.')) {
        const id = decodeURIComponent(u.split('id=eq.')[1].split('&')[0]);
        return { ok: true, json: async () => streamers.filter(s => s.id === id) };
      }
      return { ok: true, json: async () => streamers };
    }
    return { ok: false, json: async () => [] };
  };
  return calls;
}

function jsonLdOf(body) {
  const raw = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(raw, 'json-ld present');
  return JSON.parse(raw[1]);
}

function organicTable(body) {
  const start = body.indexOf('<table class="seo-table">');
  const end = body.indexOf('</table>');
  assert.ok(start > -1 && end > start);
  return body.slice(start, end);
}

describe('club hub sponsored slot prerender', { concurrency: false }, () => {
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;

  test.afterEach(() => {
    global.fetch = origFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  });

  test('active sponsorship renders above the organic ranking and stays out of ItemList', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    installFetch([{
      creator_id: 'paid',
      starts_at: '2026-10-01T00:00:00Z',
      ends_at: '2026-12-01T00:00:00Z',
    }]);
    await withCwd(async () => {
      const res = await og.handler({ path: '/clubs/liverpool' });
      assert.equal(res.statusCode, 200);
      const slotAt = res.body.indexOf('class="sponsored-slot"');
      const tableAt = res.body.indexOf('<table class="seo-table">');
      assert.ok(slotAt > -1 && tableAt > slotAt, 'sponsored box sits above the ranking table');
      assert.match(res.body, />Sponsored</);
      assert.match(res.body, />Featured</);
      assert.match(res.body, /Sponsored: Featured Liverpool creator/);
      assert.match(res.body, /rel="sponsored noopener"/);

      const table = organicTable(res.body);
      assert.doesNotMatch(table, /sponsored/i);
      const order = [...table.matchAll(/href="\/creators\/([^"]+)"/g)].map(m => m[1]);
      assert.deepEqual(order, ['nathanconnortv', 'theredmentv']);
      assert.match(table, /<td>1<\/td>[\s\S]*nathanconnortv/);
      assert.match(table, /<td>2<\/td>[\s\S]*theredmentv/);

      const jsonLd = jsonLdOf(res.body);
      assert.doesNotMatch(JSON.stringify(jsonLd), /Sponsored/);
      const page = jsonLd['@graph'].find(n => n['@type'] === 'CollectionPage');
      assert.equal(page.mainEntity['@type'], 'ItemList');
      assert.equal(page.mainEntity.numberOfItems, 2);
      assert.equal(page.mainEntity.itemListElement.length, 2);
      assert.equal(page.mainEntity.itemListElement[0].position, 1);
      assert.equal(page.mainEntity.itemListElement[0].name, 'NathanConnorTV');
      assert.equal(page.mainEntity.itemListElement[1].position, 2);
      assert.equal(page.mainEntity.itemListElement[1].name, 'TheRedmenTV');
      assert.equal(page.mainEntity.itemListElement.filter(i => i.name === 'TheRedmenTV').length, 1);
      assert.equal((jsonLd['@graph'] || []).filter(n => n['@type'] === 'ItemList').length, 0);

      const meta = res.body.match(/<meta name="description" content="([^"]*)"/);
      assert.ok(meta);
      assert.match(meta[1], /most-followed is NathanConnorTV/);
      assert.doesNotMatch(meta[1], /Sponsored|TheRedmenTV/);
      assert.match(res.body, /<title>Liverpool Football YouTubers \| FanReactionsFC<\/title>/);
    });
  });

  test('hides the card when the window has not started, has ended, or the table is missing', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const cases = [
      [{ creator_id: 'paid', starts_at: '2026-11-01T00:00:00Z' }],
      [{ creator_id: 'paid', ends_at: '2026-10-01T00:00:00Z' }],
      [],
    ];
    for (const sponsorship of cases) {
      installFetch(sponsorship);
      await withCwd(async () => {
        const res = await og.handler({ path: '/clubs/liverpool' });
        assert.equal(res.statusCode, 200);
        assert.doesNotMatch(res.body, /sponsored-slot|rel="sponsored"/);
        const table = organicTable(res.body);
        const order = [...table.matchAll(/href="\/creators\/([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(order, ['nathanconnortv', 'theredmentv']);
      });
    }
    installFetch([], { sponsorshipOk: false });
    await withCwd(async () => {
      const res = await og.handler({ path: '/clubs/liverpool' });
      assert.equal(res.statusCode, 200);
      assert.doesNotMatch(res.body, /sponsored-slot/);
      assert.match(res.body, /nathanconnortv/);
    });
  });

  test('a sponsor from another club is not inserted into the ranking or ItemList', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    installFetch([{ creator_id: 'other', starts_at: null, ends_at: null }]);
    await withCwd(async () => {
      const res = await og.handler({ path: '/clubs/liverpool' });
      assert.match(res.body, /Sponsored: Featured Liverpool creator/);
      assert.match(res.body, /href="\/creators\/aftvmedia" rel="sponsored noopener"/);
      const table = organicTable(res.body);
      assert.doesNotMatch(table, /aftvmedia/);
      const page = jsonLdOf(res.body)['@graph'].find(n => n['@type'] === 'CollectionPage');
      assert.equal(page.mainEntity.numberOfItems, 2);
      assert.ok(page.mainEntity.itemListElement.every(i => i.name !== 'AFTVmedia'));
    });
  });

  test('sponsored and verified boxes are siblings above the organic ranking', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    installFetch([{ creator_id: 'paid', starts_at: null, ends_at: null }], {
      streamers: [
        { id: 'big', name: 'NathanConnorTV', slug: 'nathanconnortv', team: 'Liverpool', subscriber_count: 797000, channel_url: 'https://www.youtube.com/@NathanConnorTV', description: 'Top of the organic list.', is_verified: true, verified_until: '2020-01-01T00:00:00Z' },
        { id: 'paid', name: 'TheRedmenTV', slug: 'theredmentv', team: 'Liverpool', subscriber_count: 400000, channel_url: 'https://www.youtube.com/@TheRedmenTV', avatar_url: 'https://example.com/red.jpg', description: 'Kop watchalongs.', is_verified: true, verified_until: null },
        { id: 'other', name: 'AFTVmedia', slug: 'aftvmedia', team: 'Arsenal', subscriber_count: 1800000, channel_url: 'https://www.youtube.com/@AFTVmedia', description: 'Arsenal fan TV.' },
        { id: 'united', name: 'Stretford Paddock', slug: 'stretford-paddock', team: 'Man United', subscriber_count: 500000, channel_url: 'https://www.youtube.com/@StretfordPaddock', description: 'United.' },
      ],
    });
    await withCwd(async () => {
      const res = await og.handler({ path: '/clubs/liverpool' });
      assert.equal(res.statusCode, 200);
      const sponsoredAt = res.body.indexOf('class="sponsored-slot"');
      const verifiedAt = res.body.indexOf('class="club-verified-slot"');
      const tableAt = res.body.indexOf('<table class="seo-table">');
      assert.ok(sponsoredAt > -1 && verifiedAt > sponsoredAt && tableAt > verifiedAt);
      const verified = res.body.match(/<section class="club-verified-slot"[\s\S]*?<\/section>/)[0];
      const sponsored = res.body.slice(sponsoredAt, verifiedAt);
      assert.match(verified, /TheRedmenTV/);
      assert.doesNotMatch(verified, /NathanConnorTV/);
      assert.doesNotMatch(verified, /sponsored-slot/);
      assert.doesNotMatch(sponsored, /club-verified-slot/);
      const table = organicTable(res.body);
      const order = [...table.matchAll(/href="\/creators\/([^"]+)"/g)].map(m => m[1]);
      assert.deepEqual(order, ['nathanconnortv', 'theredmentv']);
      const page = jsonLdOf(res.body)['@graph'].find(n => n['@type'] === 'CollectionPage');
      assert.deepEqual(page.mainEntity.itemListElement.map(i => i.name), ['NathanConnorTV', 'TheRedmenTV']);
      assert.equal(page.mainEntity.numberOfItems, 2);
      assert.doesNotMatch(JSON.stringify(page.mainEntity), /Sponsored/);
    });
  });

  test('videos hub and inactive lookup do not advertise a sponsorship', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const calls = installFetch([{ creator_id: 'paid' }]);
    await withCwd(async () => {
      const res = await og.handler({ path: '/clubs/liverpool/videos' });
      assert.equal(res.statusCode, 200);
      assert.doesNotMatch(res.body, /sponsored-slot|rel="sponsored"/);
      assert.equal(calls.some(u => u.includes('frfc_club_sponsorships')), false);
    });
  });

  test('looks up the canonical club slug', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const calls = installFetch([{ creator_id: 'united' }]);
    await withCwd(async () => {
      const res = await og.handler({ path: '/clubs/manchester-united' });
      assert.equal(res.statusCode, 200);
      assert.ok(calls.some(u => u.includes('frfc_club_sponsorships?club_slug=eq.manchester-united')));
      assert.match(res.body, /Sponsored: Featured Man United creator/);
      const table = organicTable(res.body);
      assert.match(table, /stretford-paddock/);
      assert.doesNotMatch(table, /rel="sponsored"/);
    });
  });
});

test('migration defines one sponsorship row per club and does not grant client writes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261014090000_frfc_club_sponsorships.sql'), 'utf8');
  assert.match(sql, /create table public\.frfc_club_sponsorships/i);
  assert.match(sql, /unique \(club_slug\)/);
  assert.match(sql, /creator_id uuid not null references public\.frfc_streamers/i);
  assert.match(sql, /starts_at timestamptz/);
  assert.match(sql, /ends_at timestamptz/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /for select/);
  assert.match(sql, /revoke insert, update, delete/i);
  assert.match(sql, /insert into public\.frfc_club_sponsorships/i);
});
