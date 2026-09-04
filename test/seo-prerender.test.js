const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function withCwd(fn) {
  const prev = process.cwd();
  process.chdir(path.join(__dirname, '..'));
  return Promise.resolve()
    .then(fn)
    .finally(() => process.chdir(prev));
}

test('club-og 301s legacy spaced/cased URLs onto hyphenated slugs', async () => {
  const { handler } = require('../netlify/functions/club-og.js');
  await withCwd(async () => {
    const arsenal = await handler({ path: '/clubs/Arsenal' });
    assert.equal(arsenal.statusCode, 301);
    assert.equal(arsenal.headers.Location, 'https://fanreactionsfc.com/clubs/arsenal');

    const united = await handler({ path: '/clubs/Man%20United' });
    assert.equal(united.statusCode, 301);
    assert.equal(united.headers.Location, 'https://fanreactionsfc.com/clubs/manchester-united');

    const forest = await handler({ path: '/clubs/Nottm%20Forest' });
    assert.equal(forest.statusCode, 301);
    assert.equal(forest.headers.Location, 'https://fanreactionsfc.com/clubs/nottingham-forest');

    const slash = await handler({ path: '/clubs/arsenal/' });
    assert.equal(slash.statusCode, 301);
    assert.equal(slash.headers.Location, 'https://fanreactionsfc.com/clubs/arsenal');
  });
});

test('club-og prerenders unique H1/canonical for /clubs/arsenal without homepage fallback', async () => {
  const { handler } = require('../netlify/functions/club-og.js');
  await withCwd(async () => {
    const res = await handler({ path: '/clubs/arsenal' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">Arsenal Football YouTubers<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/clubs\/arsenal"/);
    assert.match(res.body, /<title>Arsenal Football YouTubers/);
    assert.doesNotMatch(res.body, /Discover the best football/);
    assert.match(res.body, /ItemList/);
    assert.match(res.body, /SportsTeam/);
    assert.match(res.body, /href="\/rankings"/);
  });
});

test('club-og JSON-LD has ItemList only as CollectionPage.mainEntity, not twice in @graph', async () => {
  const { handler } = require('../netlify/functions/club-og.js');
  await withCwd(async () => {
    const res = await handler({ path: '/clubs/arsenal' });
    const raw = res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(raw, 'json-ld script present');
    const serialized = raw[1];
    const itemListMarks = serialized.match(/"@type":"ItemList"/g) || [];
    assert.equal(itemListMarks.length, 1, 'ItemList appears once in the serialized graph');
    const jsonLd = JSON.parse(serialized);
    const graph = jsonLd['@graph'] || [];
    assert.equal(graph.filter(n => n && n['@type'] === 'ItemList').length, 0);
    const page = graph.find(n => n && n['@type'] === 'CollectionPage');
    assert.ok(page);
    assert.equal(page.mainEntity && page.mainEntity['@type'], 'ItemList');
  });
});

test('club-og 404s unknown clubs', async () => {
  const { handler } = require('../netlify/functions/club-og.js');
  await withCwd(async () => {
    const res = await handler({ path: '/clubs/not-a-real-club' });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /Page not found/);
    assert.doesNotMatch(res.body, /href="https:\/\/fanreactionsfc.com\/"/);
  });
});

test('creator-og 301s trailing slash', async () => {
  const { handler } = require('../netlify/functions/creator-og.js');
  await withCwd(async () => {
    const res = await handler({ path: '/creators/famzonetv/' });
    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.Location, 'https://fanreactionsfc.com/creators/famzonetv');
  });
});

test('not-found returns HTTP 404 with unique H1 and no homepage canonical', async () => {
  const { handler } = require('../netlify/functions/not-found.js');
  await withCwd(async () => {
    const res = await handler({ path: '/about' });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /<h1 class="es-title">Page not found<\/h1>/);
    assert.match(res.body, /noindex/);
    assert.doesNotMatch(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/"/);
  });
});

test('fan rankings filter keeps club channels and drops journalists/streamers', () => {
  const { isFanRankingsChannel } = require('../netlify/functions/rankings.js');
  assert.equal(isFanRankingsChannel({ slug: 'aftvmedia', team: 'Arsenal' }), true);
  assert.equal(isFanRankingsChannel({ slug: 'unitedstand', team: 'Man United', content_types: ['News'] }), true);
  assert.equal(isFanRankingsChannel({ slug: 'thatsfootball', team: 'Multi-Club / Other', content_types: ['Watchalong'] }), true);
  assert.equal(isFanRankingsChannel({ slug: 'fabrizio-romano', team: 'Multi-Club / Other', content_types: [] }), false);
  assert.equal(isFanRankingsChannel({ slug: 'thogden', team: 'Multi-Club / Other' }), false);
  assert.equal(isFanRankingsChannel({ slug: 'live-djmariio', team: 'Real Madrid' }), false);
  assert.equal(isFanRankingsChannel({ slug: 'bydiegox10', team: 'Real Madrid' }), false);
});

test('rankings prerender has unique H1, canonical, ItemList, and a table', async () => {
  const { handler } = require('../netlify/functions/rankings.js');
  await withCwd(async () => {
    const res = await handler({ path: '/rankings', queryStringParameters: {} });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">Best Football Fan YouTubers Ranked<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/rankings"/);
    assert.match(res.body, /ItemList/);
    assert.doesNotMatch(res.body, /Discover the best football/);
  });
});

test('rankings JSON-LD has ItemList only as CollectionPage.mainEntity, not twice in @graph', async () => {
  const { handler } = require('../netlify/functions/rankings.js');
  await withCwd(async () => {
    const res = await handler({ path: '/rankings', queryStringParameters: {} });
    const raw = res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(raw, 'json-ld script present');
    const serialized = raw[1];
    const itemListMarks = serialized.match(/"@type":"ItemList"/g) || [];
    assert.equal(itemListMarks.length, 1, 'ItemList appears once in the serialized graph');
    const jsonLd = JSON.parse(serialized);
    const graph = jsonLd['@graph'] || [];
    assert.equal(graph.filter(n => n && n['@type'] === 'ItemList').length, 0);
    const page = graph.find(n => n && n['@type'] === 'CollectionPage');
    assert.ok(page);
    assert.equal(page.mainEntity && page.mainEntity['@type'], 'ItemList');
  });
});

test('two ranking rows with the same slug collapse to one', () => {
  const { dedupeRankedCreators } = require('../netlify/functions/rankings.js');
  const rows = [
    { name: 'Total Saints Podcast', slug: 'total-saints-podcast', team: 'Southampton', subscriber_count: 12000 },
    { name: 'Total Saints Podcast', slug: 'total-saints-podcast', team: 'Southampton', subscriber_count: 11900 },
    { name: 'AFTVmedia', slug: 'aftvmedia', team: 'Arsenal', subscriber_count: 1800000 },
  ];
  const out = dedupeRankedCreators(rows);
  assert.equal(out.length, 2);
  assert.equal(out.filter(c => c.slug === 'total-saints-podcast').length, 1);
  assert.equal(out[0].subscriber_count, 12000);
});

test('ranking de-dupe falls back to channel_url then name', () => {
  const { dedupeRankedCreators } = require('../netlify/functions/rankings.js');
  const byUrl = dedupeRankedCreators([
    { name: 'Total Saints Podcast', slug: '', channel_url: 'https://youtube.com/@totalsaints', team: 'Southampton' },
    { name: 'Total Saints Podcast', slug: '', channel_url: 'https://youtube.com/@totalsaints', team: 'Southampton' },
  ]);
  assert.equal(byUrl.length, 1);
  const byName = dedupeRankedCreators([
    { name: 'Total Saints Podcast', slug: '', team: 'Southampton' },
    { name: 'Total Saints Podcast', slug: '', team: 'Southampton' },
  ]);
  assert.equal(byName.length, 1);
});

test('rankings handler table lists a duplicate slug once', async () => {
  const { handler } = require('../netlify/functions/rankings.js');
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => [
      { name: 'Total Saints Podcast', slug: 'total-saints-podcast', team: 'Southampton', league: 'Premier League', subscriber_count: 12000, video_count: 100, content_types: ['Watchalong'] },
      { name: 'Total Saints Podcast', slug: 'total-saints-podcast', team: 'Southampton', league: 'Premier League', subscriber_count: 11900, video_count: 99, content_types: ['Watchalong'] },
    ],
  });
  try {
    await withCwd(async () => {
      const res = await handler({ path: '/rankings', queryStringParameters: {} });
      assert.equal(res.statusCode, 200);
      const tableLinks = res.body.match(/href="\/creators\/total-saints-podcast"/g) || [];
      assert.equal(tableLinks.length, 1);
      const jsonLd = JSON.parse(res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      const page = jsonLd['@graph'].find(n => n['@type'] === 'CollectionPage');
      assert.equal(page.mainEntity.numberOfItems, 1);
      assert.equal((jsonLd['@graph'] || []).filter(n => n['@type'] === 'ItemList').length, 0);
    });
  } finally {
    global.fetch = origFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('homepage prerender has unique H1/canonical, directory links, and no Loading subtitle', async () => {
  const { handler } = require('../netlify/functions/home.js');
  await withCwd(async () => {
    const res = await handler({ path: '/' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.Location, undefined);
    assert.match(res.body, /<h1>Discover the best football/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/"/);
    assert.match(res.body, /<title>FanReactionsFC — Discover the Best Football YouTubers<\/title>/);
    assert.match(res.body, /href="\/rankings"/);
    assert.match(res.body, /href="\/discover"/);
    assert.match(res.body, /href="\/news"/);
    assert.match(res.body, /href="\/become-a-creator"/);
    assert.match(res.body, /href="\/clubs\//);
    assert.match(res.body, /href="\/creators\//);
    assert.doesNotMatch(res.body, /<p class="subtitle">Loading(\.\.\.|…)<\/p>/);
    assert.match(res.body, /<p class="subtitle">The definitive database of football YouTubers\. Ranked daily\.<\/p>/);
    assert.match(res.body, /footer-club-links/);
  });
});

test('streamwall prerender has unique H1/canonical and no Loading subtitle', async () => {
  const { handler } = require('../netlify/functions/streamwall.js');
  await withCwd(async () => {
    const res = await handler({ path: '/streamwall' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">Watch Live Football Creators<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/streamwall"/);
    assert.match(res.body, /<title>Streamwall — Watch Live Football Creators/);
    assert.doesNotMatch(res.body, /Discover the best football/);
    assert.doesNotMatch(res.body, /<p class="subtitle">Loading/);
  });
});

test('tools-generator prerender has unique H1/canonical and no Loading subtitle', async () => {
  const { handler } = require('../netlify/functions/tools-generator.js');
  await withCwd(async () => {
    const res = await handler({ path: '/tools/generator' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">YouTube Description Generator/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/tools\/generator"/);
    assert.match(res.body, /<title>Description Generator \| FanReactionsFC<\/title>/);
    assert.doesNotMatch(res.body, /Discover the best football/);
    assert.doesNotMatch(res.body, /<p class="subtitle">Loading/);
  });
});

test('community-features prerender has unique H1/canonical, not the homepage canonical', async () => {
  const { handler } = require('../netlify/functions/community-features.js');
  await withCwd(async () => {
    const res = await handler({ path: '/community/features' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">Feature Requests<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/community\/features"/);
    assert.doesNotMatch(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/"/);
    assert.doesNotMatch(res.body, /Discover the best football/);
    assert.doesNotMatch(res.body, /<p class="subtitle">Loading/);
  });
});

test('discover prerender is an index, not a second rankings H1', async () => {
  const { handler } = require('../netlify/functions/discover.js');
  await withCwd(async () => {
    const res = await handler({ path: '/discover', queryStringParameters: {} });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">Discover Football Creators<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/discover"/);
    assert.doesNotMatch(res.body, /Best Football Fan YouTubers Ranked/);
  });
});

test('become-a-creator prerender includes the guide H1 and body', async () => {
  const { handler } = require('../netlify/functions/become-a-creator.js');
  await withCwd(async () => {
    const res = await handler({ path: '/become-a-creator' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /How to Start a Football Live Streaming Channel on YouTube/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/become-a-creator"/);
    assert.match(res.body, /Prism Live Studio/);
    assert.match(res.body, /href="\/submit"/);
  });
});

test('news hub prerender has unique H1 and canonical', async () => {
  const { handler } = require('../netlify/functions/news.js');
  await withCwd(async () => {
    const res = await handler({ path: '/news' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">FanReactionsFC News<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/news"/);
  });
});

test('sitemap omits lastmod on static URLs and stays 200 without a service key', async () => {
  const { handler } = require('../netlify/functions/sitemap.js');
  const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await handler();
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<loc>https:\/\/fanreactionsfc.com\/become-a-creator<\/loc>/);
    assert.match(res.body, /<loc>https:\/\/fanreactionsfc.com\/rankings<\/loc>/);
    const staticBlock = res.body.split('<url>')[1];
    assert.doesNotMatch(res.body.split('</urlset>')[0].match(/<url>[\s\S]*?<\/url>/)[0], /<lastmod>/);
    assert.match(res.body, /<urlset /);
  } finally {
    if (prev !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});

test('sitemap omits lastmod for creators and clubs even when last_youtube_sync is set (not a trustworthy content-change signal)', async () => {
  const { handler } = require('../netlify/functions/sitemap.js');
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  global.fetch = async (url) => {
    if (String(url).includes('frfc_streamers')) {
      return { ok: true, json: async () => [
        { slug: 'aftvmedia', name: 'AFTVmedia', team: 'Arsenal', last_youtube_sync: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
      ] };
    }
    if (String(url).includes('frfc_articles')) {
      return { ok: true, json: async () => [
        { slug: 'some-article', published_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-21T00:00:00Z' },
      ] };
    }
    return { ok: true, json: async () => [] };
  };
  try {
    const res = await handler();
    assert.equal(res.statusCode, 200);
    const creatorUrl = res.body.match(/<url>\s*<loc>[^<]*\/creators\/aftvmedia<\/loc>[\s\S]*?<\/url>/)[0];
    assert.doesNotMatch(creatorUrl, /<lastmod>/);
    const clubUrl = res.body.match(/<url>\s*<loc>[^<]*\/clubs\/arsenal<\/loc>[\s\S]*?<\/url>/)[0];
    assert.doesNotMatch(clubUrl, /<lastmod>/);
    const articleUrl = res.body.match(/<url>\s*<loc>[^<]*\/news\/some-article<\/loc>[\s\S]*?<\/url>/)[0];
    assert.match(articleUrl, /<lastmod>2026-08-21<\/lastmod>/);
  } finally {
    global.fetch = origFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('index.html sitewide JSON-LD includes Organization.sameAs', () => {
  assert.match(indexHtml, /"@type": "Organization"/);
  assert.match(indexHtml, /youtube.com\/@fanreactionsfc/);
  assert.match(indexHtml, /instagram.com\/fanreactionsfc/);
  assert.match(indexHtml, /club-slugs.js/);
});
