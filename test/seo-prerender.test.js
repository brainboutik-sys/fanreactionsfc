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
    assert.match(res.body, /<h1 class="page-hero-title">Best Arsenal Fan YouTubers<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/clubs\/arsenal"/);
    assert.match(res.body, /<title>Best Arsenal Fan YouTubers/);
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

test('tools hub prerender links to the generator and streamwall', async () => {
  const { handler } = require('../netlify/functions/tools.js');
  await withCwd(async () => {
    const slash = await handler({ path: '/tools/' });
    assert.equal(slash.statusCode, 301);
    assert.equal(slash.headers.Location, 'https://fanreactionsfc.com/tools');

    const res = await handler({ path: '/tools' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">Tools<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/tools"/);
    assert.match(res.body, /<title>Tools \| FanReactionsFC<\/title>/);
    assert.match(res.body, /href="\/tools\/generator"/);
    assert.match(res.body, /href="\/streamwall"/);
    assert.match(res.body, /Description Generator/);
    assert.match(res.body, /Streamwall/);
    assert.doesNotMatch(res.body, /Discover the best football/);
    assert.doesNotMatch(res.body, /<p class="subtitle">Loading/);
  });
});

test('submit prerender is the creator form, not the homepage shell', async () => {
  const { handler } = require('../netlify/functions/submit.js');
  await withCwd(async () => {
    const slash = await handler({ path: '/submit/' });
    assert.equal(slash.statusCode, 301);
    assert.equal(slash.headers.Location, 'https://fanreactionsfc.com/submit');

    const res = await handler({ path: '/submit' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="page-hero-title">Submit a Creator<\/h1>/);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/submit"/);
    assert.match(res.body, /<title>Submit a Creator \| FanReactionsFC<\/title>/);
    assert.match(res.body, /id="sub_channel"/);
    assert.match(res.body, /id="sub_league"/);
    assert.match(res.body, /id="sub_team"/);
    assert.match(res.body, /Submit for Review/);
    assert.match(res.body, /Arsenal/);
    assert.doesNotMatch(res.body, /Discover the best football/);
    assert.doesNotMatch(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/"/);
    assert.doesNotMatch(res.body, /<p class="subtitle">Loading/);
  });
});

test('netlify.toml 301s /directory to /discover and prerenders /tools and /submit', () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.match(toml, /from = "\/directory"\s+to = "\/discover"\s+status = 301/);
  assert.match(toml, /from = "\/directory\/"\s+to = "\/discover"\s+status = 301/);
  assert.match(toml, /from = "\/tools"\s+to = "\/\.netlify\/functions\/tools"\s+status = 200\s+force = true/);
  assert.match(toml, /from = "\/submit"\s+to = "\/\.netlify\/functions\/submit"\s+status = 200\s+force = true/);
  assert.doesNotMatch(toml, /from = "\/submit"\s+to = "\/index.html"/);
  assert.doesNotMatch(toml, /from = "\/tools"\s+to = "\/index.html"/);
});

test('client router renders the tools hub, submit form, and directory alias', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /path === '\/tools' \|\| path === '\/tools\/'/);
  assert.match(app, /function renderTools\(/);
  assert.match(app, /path === '\/submit' \|\| path === '\/submit\/'/);
  assert.match(app, /function renderSubmit\(/);
  assert.match(app, /path === '\/directory' \|\| path === '\/directory\/'/);
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
    assert.match(res.body, /<loc>https:\/\/fanreactionsfc.com\/tools<\/loc>/);
    assert.match(res.body, /<loc>https:\/\/fanreactionsfc.com\/tools\/generator<\/loc>/);
    assert.match(res.body, /<loc>https:\/\/fanreactionsfc.com\/submit<\/loc>/);
    assert.doesNotMatch(res.body, /<loc>https:\/\/fanreactionsfc.com\/directory<\/loc>/);
    assert.doesNotMatch(res.body, /<loc>https:\/\/fanreactionsfc.com\/tools\/<\/loc>/);
    const staticBlock = res.body.split('<url>')[1];
    assert.doesNotMatch(res.body.split('</urlset>')[0].match(/<url>[\s\S]*?<\/url>/)[0], /<lastmod>/);
    assert.match(res.body, /<urlset /);
  } finally {
    if (prev !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});

test('sitemap lastmod uses creator sync, club max(sync, article), and omits dates it does not have', async () => {
  const { handler } = require('../netlify/functions/sitemap.js');
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  global.fetch = async (url) => {
    if (String(url).includes('frfc_streamers')) {
      return { ok: true, json: async () => [
        { slug: 'aftvmedia', name: 'AFTVmedia', team: 'Arsenal', last_youtube_sync: '2026-09-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_verified: true },
        { slug: 'other-arsenal', name: 'Other Arsenal', team: 'Arsenal', last_youtube_sync: '2026-08-01T00:00:00Z' },
        { slug: 'no-dates', name: 'No Dates', team: 'Chelsea' },
        { slug: 'updated-only', name: 'Updated Only', team: 'Liverpool', updated_at: '2026-07-04T12:00:00Z' },
        { slug: 'multi', name: 'Multi', team: 'Multi-Club / Other', last_youtube_sync: '2026-06-01T00:00:00Z' },
      ] };
    }
    if (String(url).includes('frfc_articles')) {
      return { ok: true, json: async () => [
        { slug: 'some-article', published_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-21T00:00:00Z', related_team: 'Arsenal' },
        { slug: 'newer-arsenal', published_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-03T00:00:00Z', related_team: 'Arsenal' },
        { slug: 'undated', published_at: null, updated_at: null },
      ] };
    }
    return { ok: true, json: async () => [] };
  };
  try {
    const res = await handler();
    assert.equal(res.statusCode, 200);
    const block = (loc) => {
      const found = res.body.match(new RegExp(`<url>\\s*<loc>https://fanreactionsfc.com${loc}</loc>[\\s\\S]*?</url>`));
      assert.ok(found, 'missing sitemap url ' + loc);
      return found[0];
    };
    assert.match(block('/creators/aftvmedia'), /<lastmod>2026-09-01<\/lastmod>/);
    assert.match(block('/creators/aftvmedia/stats'), /<lastmod>2026-09-01<\/lastmod>/);
    assert.match(block('/creators/updated-only'), /<lastmod>2026-07-04<\/lastmod>/);
    assert.doesNotMatch(block('/creators/no-dates'), /<lastmod>/);
    assert.match(block('/creators/multi'), /<lastmod>2026-06-01<\/lastmod>/);
    assert.match(block('/clubs/arsenal'), /<lastmod>2026-10-03<\/lastmod>/);
    assert.match(block('/clubs/liverpool'), /<lastmod>2026-07-04<\/lastmod>/);
    assert.doesNotMatch(block('/clubs/chelsea'), /<lastmod>/);
    assert.doesNotMatch(res.body, /\/clubs\/multi-club</);
    assert.match(block('/news/some-article'), /<lastmod>2026-08-21<\/lastmod>/);
    assert.doesNotMatch(block('/news/undated'), /<lastmod>/);
    assert.doesNotMatch(block('/rankings'), /<lastmod>/);
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

const seoCopy = require('../js/lib/seo-copy.js');

test('clubsInHeadline keeps the earliest alias in headline order', () => {
  assert.deepEqual(
    seoCopy.clubsInHeadline('Spurs and Coventry YouTubers react to a 3-1 at Tottenham'),
    ['Tottenham', 'Coventry']
  );
  assert.deepEqual(
    seoCopy.clubsInHeadline('Bayern and Arsenal YouTubers react to a 2-2 at the Allianz Arena'),
    ['Bayern Munich', 'Arsenal']
  );
  assert.deepEqual(
    seoCopy.clubsInHeadline('Nottingham Forest and Arsenal YouTubers react to a 0-1 at the City Ground'),
    ['Nottm Forest', 'Arsenal']
  );
});

test('a derby nickname is not Derby County and a headline Fan is kept', () => {
  const derby = 'United and City YouTubers React to a 0-1 Manchester Derby';
  assert.deepEqual(seoCopy.clubsInHeadline(derby), []);
  assert.deepEqual(
    seoCopy.clubsInHeadline('Arsenal and Chelsea YouTubers React to a 2-1 Emirates Derby'),
    ['Arsenal', 'Chelsea']
  );
  assert.deepEqual(seoCopy.clubsInHeadline('Derby YouTubers react to a 1-0'), ['Derby']);
  assert.equal(
    seoCopy.articleSeoTitle({ title: derby, related_team: null }),
    derby + ' | FanReactionsFC'
  );
  const counted = '323 Premier League Fan YouTubers, Counted Club by Club';
  assert.equal(
    seoCopy.articleSeoTitle({ title: counted, related_team: null }),
    counted + ' | FanReactionsFC'
  );
});

test('articleSeoTitle keeps fan only when the suffixed title fits in 60', () => {
  const cases = [
    [{ title: 'Spurs and Coventry YouTubers react to a 3-1 at Tottenham', related_team: null },
      'Spurs and Coventry fan YouTubers react: 3-1 | FanReactionsFC'],
    [{ title: 'Bayern and Arsenal YouTubers react to a 2-2 at the Allianz Arena', related_team: null },
      'Bayern and Arsenal fan YouTubers react: 2-2 | FanReactionsFC'],
    [{ title: 'Nottingham Forest and Arsenal YouTubers react to a 0-1 at the City Ground', related_team: null },
      'Forest and Arsenal fan YouTubers react: 0-1 | FanReactionsFC'],
    [{ title: 'Liverpool YouTubers react to a 4-3 win over Villarreal', related_team: 'liverpool' },
      'Liverpool YouTubers react: 4-3 win over Villarreal | FanReactionsFC'],
    [{ title: 'Manchester United YouTubers react as Ten Hag turns on INEOS', related_team: 'manchester-united' },
      'Man Utd YouTubers react as Ten Hag turns on INEOS | FanReactionsFC'],
  ];
  for (const [article, expected] of cases) {
    const title = seoCopy.articleSeoTitle(article);
    assert.equal(title, expected);
    assert.match(title, / \| FanReactionsFC$/);
    if (title.length <= 60) assert.match(title, /fan YouTubers/);
    else assert.doesNotMatch(title, /fan YouTubers/);
  }
  const preview = seoCopy.articleSeoTitle({
    title: 'Manchester City v Liverpool preview: Wednesday night',
    related_team: 'manchester-city',
  });
  assert.equal(preview, 'Man City v Liverpool preview: fan YouTubers | FanReactionsFC');
});

test('article H1 render uses the stored title, not the SEO title', async () => {
  const { handler } = require('../netlify/functions/news-article.js');
  const stored = 'Spurs and Coventry YouTubers react to a 3-1 at Tottenham';
  const seoTitle = 'Spurs and Coventry fan YouTubers react: 3-1 | FanReactionsFC';
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => [{
      title: stored,
      dek: '',
      summary: 'A summary.',
      body: 'Body text.',
      cover_image_url: null,
      tags: [],
      related_team: null,
      published_at: '2026-10-20T00:00:00Z',
      updated_at: '2026-10-20T00:00:00Z',
      slug: 'spurs-coventry',
    }],
  });
  try {
    await withCwd(async () => {
      const res = await handler({ path: '/news/spurs-coventry' });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, new RegExp('<h1 class="page-hero-title">' + stored + '</h1>'));
      assert.match(res.body, new RegExp('<title>' + seoTitle.replace(/[|]/g, '\\|') + '</title>'));
      assert.doesNotMatch(res.body, new RegExp('<h1 class="page-hero-title">' + seoTitle.replace(/[|]/g, '\\|') + '</h1>'));
    });
  } finally {
    global.fetch = origFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('club hub FAQPage matches the visible FAQ and omits watchalongs when none are tagged', async () => {
  const { handler } = require('../netlify/functions/club-og.js');
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const clubs = [
    ['arsenal', 'Arsenal', 'AFTV'],
    ['liverpool', 'Liverpool', 'Anfield Voice'],
    ['manchester-city', 'Man City', 'CityXtra'],
  ];
  global.fetch = async (url) => {
    const team = clubs.find((row) => String(url).includes('team=eq.' + encodeURIComponent(row[1])));
    if (String(url).includes('frfc_streamers')) {
      return {
        ok: true,
        json: async () => clubs.map((row, i) => ({
          id: 'c' + i,
          name: row[2],
          slug: row[0] + '-tv',
          team: row[1],
          subscriber_count: 1500000 - i,
          content_types: ['Reactions'],
          description: 'Match reactions.',
        })),
      };
    }
    return { ok: true, json: async () => [] };
  };
  function decodeEntities(s) {
    return String(s)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  try {
    await withCwd(async () => {
      for (const [slug, club] of clubs) {
        const res = await handler({ path: '/clubs/' + slug });
        assert.equal(res.statusCode, 200, slug);
        const scripts = [...res.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
        const pages = [];
        for (const script of scripts) {
          const json = JSON.parse(script[1]);
          const nodes = json['@graph'] || [json];
          nodes.forEach((node) => {
            if (node && node['@type'] === 'FAQPage') pages.push(node);
          });
        }
        assert.equal(pages.length, 1, slug + ' FAQPage count');
        const questions = pages[0].mainEntity;
        assert.equal(questions.some((q) => /watchalong/i.test(q.name)), false, slug);
        const block = res.body.match(/<dl class="hub-faq">([\s\S]*?)<\/dl>/);
        assert.ok(block, slug + ' visible FAQ');
        const visible = [...block[1].matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => ({
          q: decodeEntities(m[1].replace(/<[^>]+>/g, '')),
          a: decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
        }));
        assert.equal(visible.length, questions.length, slug);
        questions.forEach((q, i) => {
          assert.equal(visible[i].q, q.name, slug);
          assert.equal(visible[i].a, q.acceptedAnswer.text, slug);
        });
        assert.match(res.body, new RegExp('Best ' + club.replace(/ /g, ' ') + ' Fan YouTubers'));
      }
    });
  } finally {
    global.fetch = origFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('netlify.toml 301s /creators/shane-gooner to /clubs/arsenal before the creators splat', () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const from = toml.indexOf('from = "/creators/shane-gooner"');
  const splat = toml.indexOf('from = "/creators/*"');
  assert.ok(from > 0 && splat > from);
  assert.match(toml, /from = "\/creators\/shane-gooner"\s+to = "\/clubs\/arsenal"\s+status = 301\s+force = true/);
});
