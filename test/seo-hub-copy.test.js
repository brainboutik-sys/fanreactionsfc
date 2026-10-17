const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const seo = require('../js/lib/seo-copy.js');
const root = path.join(__dirname, '..');

function seoBlock(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const start = src.indexOf('// SEO_COPY_START');
  const end = src.indexOf('// SEO_COPY_END');
  assert.ok(start >= 0 && end > start, rel + ' is missing the SEO copy block');
  return src.slice(start, end);
}

test('hub and article copy blocks match the browser file', () => {
  const lib = seoBlock('js/lib/seo-copy.js');
  for (const rel of [
    'netlify/functions/club-og.js',
    'netlify/functions/news-article.js',
    'netlify/functions/news.js',
  ]) {
    assert.equal(seoBlock(rel), lib, rel);
  }
});

test('club hub title falls back once the ranked form exceeds 60 characters', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const city = seo.hubTitle('Man City', now);
  assert.equal(city, 'Best Man City Fan YouTubers (2026) – Ranked | FanReactionsFC');
  // The template string is 60 characters. The worked example said 58.
  assert.equal(city.length, 60);
  const dortmund = seo.hubTitle('Borussia Dortmund', now);
  assert.equal(dortmund, 'Best Borussia Dortmund Fan YouTubers 2026 | FanReactionsFC');
  assert.ok(dortmund.length <= 60, dortmund + ' (' + dortmund.length + ')');
  assert.equal(seo.hubH1('Man City'), 'Best Man City Fan YouTubers');
});

test('hub meta and FAQ are filled from data and skip a sponsored #1', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const meta = seo.hubMeta('Man City', 24, 'CityXtra', now);
  assert.equal(meta, 'The 24 best Man City fan YouTubers ranked: watchalongs, reactions and fan TV. #1 is CityXtra. Updated October 2026.');
  assert.ok(meta.length <= 155);
  const liverpool = seo.hubMeta('Liverpool', 34, 'NathanConnorTV', now);
  assert.equal(liverpool, 'The 34 best Liverpool fan YouTubers ranked: watchalongs, reactions and fan TV. #1 is NathanConnorTV. Updated October 2026.');

  const creators = [
    { id: 'paid', name: 'Paid TV', subscriber_count: 900 },
    { id: 'next', name: 'Organic TV', subscriber_count: 400 },
  ];
  assert.equal(seo.hubClaimTop(creators, { id: 'paid' }), null);
  assert.equal(seo.hubClaimTop(creators, { id: 'other' }).name, 'Paid TV');
  assert.equal(seo.hubMeta('Man City', 2, null, now).includes('#1'), false);
  assert.equal(seo.hubIntro('Man City', 2, null), '');

  const faqs = seo.buildHubFaqs({
    club: 'Man City',
    topName: 'CityXtra',
    subs: '96.7K',
    watchNames: ['EsteemedKompany', 'TypicalCity', 'JSGC'],
  });
  assert.equal(faqs[0].q, 'Who is the biggest Man City fan YouTuber?');
  assert.equal(faqs[0].a, 'CityXtra is the most-followed Man City fan channel in our directory, with 96.7K subscribers.');
  assert.match(faqs[1].a, /EsteemedKompany, TypicalCity and JSGC do Man City watchalongs/);
  assert.equal(faqs[2].a, seo.HUB_COPY.faqHowA);
  assert.equal(faqs[3].a, seo.HUB_COPY.faqListA);
  const skipped = seo.buildHubFaqs({ club: 'Como', topName: 'Solo', subs: '1.2K', watchNames: [] });
  assert.equal(skipped.some(f => /watchalongs/.test(f.q)), false);
});

test('article titles use the club display name and stay within 60 characters', () => {
  const james = seo.articleSeoTitle({ title: 'Reece James out', related_team: 'chelsea' });
  // "Reece James out" makes the hand example 61 characters, so the last word is clipped.
  assert.equal(james, 'Chelsea fan YouTubers react: Reece James | FanReactionsFC');
  assert.equal(james.length, 57);
  assert.ok(james.length <= 60);

  const real = seo.articleSeoTitle({
    title: 'Chelsea YouTubers react as Reece James faces three months out',
    related_team: 'chelsea',
  });
  assert.ok(real.length <= 60, real + ' (' + real.length + ')');
  assert.match(real, /^Chelsea fan YouTubers react: /);
  assert.match(real, /\| FanReactionsFC$/);
  assert.doesNotMatch(real, / News$/);

  const united = seo.articleSeoTitle({
    title: 'United YouTubers react as Martinez apologises after his board outburst',
    related_team: 'manchester-united',
  });
  assert.match(united, /^Man United fan YouTubers react: /);
  assert.ok(united.length <= 60, united);

  const two = seo.articleSeoTitle({
    title: 'Coventry and Newcastle YouTubers react to a 4-1 at the CBS Arena',
    related_team: null,
  });
  assert.match(two, /Coventry/);
  assert.match(two, /Newcastle/);
  assert.match(two, /fan YouTubers/);
  assert.ok(two.length <= 60, two + ' (' + two.length + ')');

  const preview = seo.articleSeoTitle({
    title: 'Manchester City v Liverpool preview: Wednesday night',
    related_team: 'manchester-city',
  });
  assert.match(preview, /^Man City v Liverpool preview: fan YouTubers \| FanReactionsFC$/);

  const none = seo.articleSeoTitle({ title: 'Arsenal watchalong roundup', related_team: 'none' });
  assert.equal(none, 'Arsenal watchalong roundup | FanReactionsFC');
  assert.equal(seo.articleMoreLabel('none'), '');
  assert.equal(seo.articleMoreLabel(''), '');
  assert.equal(seo.articleMoreLabel('multi-club'), '');
  assert.equal(seo.articleMoreLabel('chelsea'), 'More Chelsea fan YouTubers');
  assert.equal(seo.articleClubName('leeds-united'), 'Leeds United');
  assert.equal(seo.articleCoverAlt('chelsea', 'Reece James out'), 'Chelsea fan YouTubers react: Reece James out');
  assert.equal(seo.articleCoverAlt('', 'No club here'), 'No club here');
});

test('article meta leads with the club and the visible date flips when the article was edited', () => {
  const meta = seo.articleSeoMeta({
    title: 'Chelsea YouTubers react as Reece James faces three months out',
    related_team: 'chelsea',
    summary: 'Six directory channels react to Reece James\'s knee surgery.',
  });
  assert.match(meta, /^Chelsea fan YouTubers react to Reece James faces three months out\./);
  assert.ok(meta.length <= 155, meta + ' (' + meta.length + ')');
  assert.match(meta, /knee surgery/);

  const same = seo.articleDateLine('2026-10-16T16:43:10Z', '2026-10-16T16:43:40Z');
  assert.match(same, /^Published /);
  const edited = seo.articleDateLine('2026-10-16T16:43:10Z', '2026-10-17T08:42:38Z');
  assert.match(edited, /^Updated /);
});

function withCwd(fn) {
  const prev = process.cwd();
  process.chdir(root);
  return Promise.resolve().then(fn).finally(() => process.chdir(prev));
}

test('prerendered hub canonical ignores sort and format queries', async () => {
  const { handler } = require('../netlify/functions/club-og.js');
  await withCwd(async () => {
    const res = await handler({ path: '/clubs/arsenal', queryStringParameters: { sort: 'name', format: 'watchalong' } });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /canonical" id="canonicalLink" href="https:\/\/fanreactionsfc.com\/clubs\/arsenal"/);
    assert.doesNotMatch(res.body, /rel="canonical"[^>]*[?&]sort=/);
    assert.match(res.body, /<h1 class="page-hero-title">Best Arsenal Fan YouTubers<\/h1>/);
    const raw = res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const jsonLd = JSON.parse(raw[1]);
    const itemLists = JSON.stringify(jsonLd).match(/"@type":"ItemList"/g) || [];
    assert.equal(itemLists.length, 1);
  });
});

test('multi-club hub copy is unchanged and articles do not link to /clubs/none', async () => {
  const club = require('../netlify/functions/club-og.js');
  const articleFn = require('../netlify/functions/news-article.js');
  const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;
  try {
    await withCwd(async () => {
      const multi = await club.handler({ path: '/clubs/multi-club' });
      assert.equal(multi.statusCode, 200);
      assert.match(multi.body, /<h1 class="page-hero-title">Multi-Club \/ Other Football YouTubers<\/h1>/);
      assert.match(multi.body, /<title>Multi-Club \/ Other Football YouTubers \| FanReactionsFC<\/title>/);
      assert.doesNotMatch(multi.body, /Best Multi-Club/);
      const graph = JSON.parse(multi.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
      assert.equal(graph.find(n => n['@type'] === 'CollectionPage').name, 'Multi-club football creators');
      assert.equal(graph.some(n => n['@type'] === 'FAQPage'), false);
    });

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    global.fetch = async () => ({
      ok: true,
      json: async () => [{
        title: 'A note with no club',
        summary: 'Short summary.',
        body: 'Locked editorial body. Chelsea is mentioned but must not be auto-linked.',
        slug: 'no-club',
        related_team: 'none',
        published_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:05:00Z',
        cover_image_url: 'https://dsxijgrpxsfywxuffbmt.supabase.co/storage/v1/object/public/article-covers/2026/no-club.jpg',
      }],
    });
    await withCwd(async () => {
      const res = await articleFn.handler({ path: '/news/no-club' });
      assert.equal(res.statusCode, 200);
      assert.doesNotMatch(res.body, /\/clubs\/none/);
      assert.doesNotMatch(res.body, /More on/);
      assert.match(res.body, /alt="A note with no club"/);
      assert.match(res.body, /Locked editorial body\. Chelsea is mentioned but must not be auto-linked\./);
      assert.match(res.body, /Published 1 October 2026/);
      const article = JSON.parse(res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).pop().replace(/<\/?script[^>]*>/g, ''));
      assert.equal(article['@type'], 'NewsArticle');
      assert.equal(article.author.name, 'FanReactionsFC');
      assert.ok(article.datePublished);
      assert.ok(article.dateModified);
    });
  } finally {
    global.fetch = origFetch;
    if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});

test('static homepage shell does not say Loading', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<p class="subtitle">Loading/);
  assert.match(html, /The definitive database of football YouTubers\. Ranked daily\./);
  assert.match(html, /src="\/js\/lib\/seo-copy\.js"/);
});
