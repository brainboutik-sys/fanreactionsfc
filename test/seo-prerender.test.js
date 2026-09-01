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

test('index.html sitewide JSON-LD includes Organization.sameAs', () => {
  assert.match(indexHtml, /"@type": "Organization"/);
  assert.match(indexHtml, /youtube.com\/@fanreactionsfc/);
  assert.match(indexHtml, /instagram.com\/fanreactionsfc/);
  assert.match(indexHtml, /club-slugs.js/);
});
