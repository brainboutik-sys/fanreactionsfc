const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'main.css'), 'utf8');
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');

function withCwd(fn) {
  const prev = process.cwd();
  process.chdir(root);
  return Promise.resolve().then(fn).finally(() => process.chdir(prev));
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1]));
}

test('homepage H1 has a space between football and creators', async () => {
  assert.match(indexHtml, /football<br> creators/);
  assert.doesNotMatch(indexHtml, /football<br>creators/);
  assert.match(appJs, /football<br> creators/);
  const { handler } = require('../netlify/functions/home.js');
  await withCwd(async () => {
    const res = await handler({ path: '/' });
    assert.match(res.body, /football<br> creators/);
    assert.match(res.headers['Cache-Control'], /max-age=0/);
    assert.match(res.headers['Cache-Control'], /must-revalidate/);
    assert.match(res.headers['Netlify-CDN-Cache-Control'], /s-maxage=/);
  });
});

test('skip link targets main and the menu button exposes its state', () => {
  assert.match(indexHtml, /<a class="skip-link" href="#app">Skip to content<\/a>/);
  assert.match(indexHtml, /<main id="app">/);
  assert.match(css, /\.skip-link:focus\{[^}]*transform:none/);
  assert.match(indexHtml, /id="navToggle"[^>]*aria-label="Open menu"/);
  assert.match(indexHtml, /aria-controls="navLinks"/);
  assert.match(indexHtml, /aria-expanded="false"/);
  assert.match(indexHtml, /onclick="toggleNav\(\)"/);
  assert.match(appJs, /function toggleNav\(\)/);
  assert.match(appJs, /setAttribute\('aria-expanded'/);
  assert.match(appJs, /setAttribute\('aria-label', open \? 'Close menu' : 'Open menu'\)/);
});

test('shared head and prerendered pages include og:site_name and twitter:title', async () => {
  assert.match(indexHtml, /<meta property="og:site_name" content="FanReactionsFC">/);
  assert.match(indexHtml, /<meta name="twitter:title" content="FanReactionsFC — Discover the Best Football YouTubers">/);
  const pages = [
    ['../netlify/functions/home.js', { path: '/' }, /Discover the Best Football YouTubers/],
    ['../netlify/functions/rankings.js', { path: '/rankings', queryStringParameters: {} }, /Best Football Fan YouTubers Ranked/],
    ['../netlify/functions/discover.js', { path: '/discover' }, /Discover/],
    ['../netlify/functions/news.js', { path: '/news' }, /FanReactionsFC News/],
    ['../netlify/functions/tools.js', { path: '/tools' }, /Tools \| FanReactionsFC/],
    ['../netlify/functions/submit.js', { path: '/submit' }, /Submit a Creator \| FanReactionsFC/],
    ['../netlify/functions/club-og.js', { path: '/clubs/arsenal' }, /Best Arsenal Fan YouTubers/],
    ['../netlify/functions/become-a-creator.js', { path: '/become-a-creator' }, /FanReactionsFC/],
    ['../netlify/functions/streamwall.js', { path: '/streamwall' }, /Streamwall/],
    ['../netlify/functions/community-features.js', { path: '/community/features' }, /Community/],
    ['../netlify/functions/tools-generator.js', { path: '/tools/generator' }, /Description Generator/],
  ];
  await withCwd(async () => {
    for (const [mod, event, title] of pages) {
      const { handler } = require(mod);
      const res = await handler(event);
      assert.equal(res.statusCode, 200, mod);
      assert.match(res.body, /property="og:site_name" content="FanReactionsFC"/, mod);
      assert.match(res.body, title, mod + ' twitter/title');
      const tw = res.body.match(/<meta name="twitter:title" content="([^"]*)">/);
      assert.ok(tw, mod + ' twitter:title');
      assert.match(tw[1], title, mod);
    }
  });
});

test('/clubs/multi-club is a CollectionPage and not a SportsTeam', async () => {
  const { handler } = require('../netlify/functions/club-og.js');
  const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await withCwd(async () => {
      const res = await handler({ path: '/clubs/multi-club' });
      assert.equal(res.statusCode, 200);
      const graph = jsonLdBlocks(res.body).flatMap(b => b['@graph'] || [b]);
      const page = graph.find(n => n && n['@type'] === 'CollectionPage');
      assert.ok(page);
      assert.equal(page.url, 'https://fanreactionsfc.com/clubs/multi-club');
      assert.equal(page.name, 'Multi-club football creators');
      assert.equal(graph.some(n => n && n['@type'] === 'SportsTeam'), false);
      assert.match(res.body, /property="og:site_name" content="FanReactionsFC"/);
    });
  } finally {
    if (prev !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});

test('NewsArticle JSON-LD names FanReactionsFC as the author', async () => {
  const { handler } = require('../netlify/functions/news-article.js');
  const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => [{
      title: 'Arsenal watchalong roundup',
      summary: 'A short summary of the watchalong.',
      body: 'The creators went live.',
      slug: 'arsenal-watchalong',
      published_at: '2026-08-01T00:00:00Z',
      tags: ['Arsenal'],
    }],
  });
  try {
    await withCwd(async () => {
      const res = await handler({ path: '/news/arsenal-watchalong' });
      assert.equal(res.statusCode, 200);
      const article = jsonLdBlocks(res.body).find(b => b && b['@type'] === 'NewsArticle');
      assert.ok(article);
      assert.equal(article.author['@type'], 'Organization');
      assert.equal(article.author.name, 'FanReactionsFC');
      assert.equal(article.author.url, 'https://fanreactionsfc.com');
      assert.match(res.body, /<meta name="twitter:title" content="Arsenal watchalong roundup \| FanReactionsFC">/);
      assert.match(res.body, /property="og:site_name" content="FanReactionsFC"/);
    });
  } finally {
    global.fetch = origFetch;
    if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});

test('creator and stats prerenders set twitter:title and og:site_name', async () => {
  const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('frfc_video_metrics')) return { ok: true, json: async () => [] };
    if (u.includes('frfc_streamers')) {
      return { ok: true, json: async () => [{
        id: 'c1',
        name: 'AFTVmedia',
        slug: 'aftvmedia',
        team: 'Arsenal',
        description: 'Arsenal fan channel.',
        subscriber_count: 1200,
        is_verified: true,
        channel_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      }] };
    }
    return { ok: true, json: async () => [] };
  };
  try {
    await withCwd(async () => {
      const creator = await require('../netlify/functions/creator-og.js').handler({ path: '/creators/aftvmedia' });
      assert.equal(creator.statusCode, 200);
      assert.match(creator.body, /property="og:site_name" content="FanReactionsFC"/);
      assert.match(creator.body, /<meta name="twitter:title" content="AFTVmedia — Football creator on FanReactionsFC">/);
      const stats = await require('../netlify/functions/creator-stats.js').handler({ path: '/creators/aftvmedia/stats' });
      assert.equal(stats.statusCode, 200);
      assert.match(stats.body, /property="og:site_name" content="FanReactionsFC"/);
      assert.match(stats.body, /<meta name="twitter:title" content="[^"]*FanReactionsFC[^"]*">/);
    });
  } finally {
    global.fetch = origFetch;
    if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});

test('/privacy and /cookies are real documents, not the homepage shell', async () => {
  const phrases = ['Supabase', 'Netlify', 'YouTube Data API', 'do not use Stripe'];
  for (const phrase of phrases) {
    assert.ok(appJs.includes(phrase), phrase);
  }
  await withCwd(async () => {
    const privacy = require('../netlify/functions/privacy.js');
    const cookies = require('../netlify/functions/cookies.js');
    const slash = await privacy.handler({ path: '/privacy/' });
    assert.equal(slash.statusCode, 301);
    assert.equal(slash.headers.Location, 'https://fanreactionsfc.com/privacy');

    const priv = await privacy.handler({ path: '/privacy' });
    assert.equal(priv.statusCode, 200);
    assert.match(priv.body, /<h1 class="page-hero-title">Privacy Policy<\/h1>/);
    assert.match(priv.body, /<title>Privacy Policy \| FanReactionsFC<\/title>/);
    assert.match(priv.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/privacy"/);
    assert.doesNotMatch(priv.body, /Discover the best football/);
    assert.doesNotMatch(priv.body, /<p class="subtitle">Loading/);
    for (const phrase of phrases) assert.ok(priv.body.includes(phrase), phrase);
    assert.match(priv.body, /property="og:site_name" content="FanReactionsFC"/);
    assert.match(priv.body, /<meta name="twitter:title" content="Privacy Policy \| FanReactionsFC">/);

    const cookSlash = await cookies.handler({ path: '/cookies/' });
    assert.equal(cookSlash.statusCode, 301);
    const cook = await cookies.handler({ path: '/cookies' });
    assert.equal(cook.statusCode, 200);
    assert.match(cook.body, /<h1 class="page-hero-title">Cookie Policy<\/h1>/);
    assert.match(cook.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/cookies"/);
    assert.doesNotMatch(cook.body, /Discover the best football/);
    assert.doesNotMatch(cook.body, /<p class="subtitle">Loading/);
    assert.match(cook.body, /YouTube/);
    assert.match(cook.body, /Supabase/);
    assert.match(cook.body, /do not use Stripe/);
    assert.notEqual(priv.body, cook.body);
  });
});

test('/account and /admin are noindex shells that still boot the SPA', async () => {
  assert.match(appJs, /updatePageMeta\('Account \| FanReactionsFC'[\s\S]*?noindex: true, nofollow: true/);
  assert.match(appJs, /updatePageMeta\('Admin \| FanReactionsFC'[\s\S]*?noindex: true, nofollow: true/);
  assert.match(appJs, /function renderAccount\(/);
  assert.match(appJs, /function renderAdmin\(/);
  assert.match(appJs, /script\.src = '\/js\/admin\.js'/);
  const { handler } = require('../netlify/functions/private-pages.js');
  await withCwd(async () => {
    const accountSlash = await handler({ path: '/account/' });
    assert.equal(accountSlash.statusCode, 301);
    assert.equal(accountSlash.headers.Location, 'https://fanreactionsfc.com/account');

    const account = await handler({ path: '/account' });
    assert.equal(account.statusCode, 200);
    assert.equal(account.headers['X-Robots-Tag'], 'noindex, nofollow');
    assert.match(account.body, /name="robots" content="noindex, nofollow"/);
    assert.match(account.body, /<h1 class="page-hero-title">Account<\/h1>/);
    assert.match(account.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/account"/);
    assert.match(account.body, /src="\/js\/app\.js"/);
    assert.doesNotMatch(account.body, /Discover the best football/);
    assert.doesNotMatch(account.body, /<p class="subtitle">Loading/);

    const admin = await handler({ path: '/admin/creators' });
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.headers['X-Robots-Tag'], 'noindex, nofollow');
    assert.match(admin.body, /<h1 class="page-hero-title">Admin<\/h1>/);
    assert.match(admin.body, /src="\/js\/app\.js"/);
    assert.match(admin.body, /name="robots" content="noindex, nofollow"/);
  });
});

test('netlify.toml prerenders legal pages, noindexes private pages, and caches hashed assets only', () => {
  assert.match(toml, /command = "node netlify\/fingerprint-assets\.js"/);
  assert.match(toml, /from = "\/privacy"\s+to = "\/\.netlify\/functions\/privacy"\s+status = 200\s+force = true/);
  assert.match(toml, /from = "\/cookies"\s+to = "\/\.netlify\/functions\/cookies"\s+status = 200\s+force = true/);
  assert.match(toml, /from = "\/account"\s+to = "\/\.netlify\/functions\/private-pages"\s+status = 200\s+force = true/);
  assert.match(toml, /from = "\/admin"\s+to = "\/\.netlify\/functions\/private-pages"\s+status = 200\s+force = true/);
  assert.doesNotMatch(toml, /from = "\/privacy"\s+to = "\/index\.html"/);
  assert.doesNotMatch(toml, /from = "\/cookies"\s+to = "\/index\.html"/);
  assert.doesNotMatch(toml, /from = "\/account"\s+to = "\/index\.html"/);
  assert.doesNotMatch(toml, /from = "\/admin"\s+to = "\/index\.html"/);
  assert.match(toml, /for = "\/assets\/\*"[\s\S]*?Cache-Control = "public, max-age=31536000, immutable"/);
  assert.match(toml, /for = "\/js\/\*"[\s\S]*?Cache-Control = "public, max-age=0, must-revalidate"/);
  assert.match(toml, /for = "\/css\/\*"[\s\S]*?Cache-Control = "public, max-age=0, must-revalidate"/);
});
