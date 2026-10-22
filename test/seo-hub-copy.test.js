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

test('article titles use the club display name and keep fan only inside 60', () => {
  const james = seo.articleSeoTitle({ title: 'Reece James out', related_team: 'chelsea' });
  // The packed line with "fan" is 61. Drop "fan"; leave the event intact.
  assert.equal(james, 'Chelsea YouTubers react: Reece James out | FanReactionsFC');
  assert.equal(james.length, 57);
  assert.doesNotMatch(james, /fan YouTubers/);

  const real = seo.articleSeoTitle({
    title: 'Chelsea YouTubers react as Reece James faces three months out',
    related_team: 'chelsea',
  });
  assert.equal(real, 'Chelsea YouTubers react: Reece James out | FanReactionsFC');
  assert.match(real, /\| FanReactionsFC$/);
  assert.doesNotMatch(real, / News$/);

  const farke = seo.articleSeoTitle({
    title: 'Leeds YouTubers react as Farke agrees a new deal in principle',
    related_team: 'leeds-united',
  });
  assert.equal(farke, 'Leeds fan YouTubers react: Farke new deal | FanReactionsFC');
  assert.ok(farke.length <= 60, farke);

  const united = seo.articleSeoTitle({
    title: 'United YouTubers react as Martinez apologises after his board outburst',
    related_team: 'manchester-united',
  });
  assert.equal(united, 'Man Utd YouTubers react: Martinez apology | FanReactionsFC');
  assert.equal(united.length, 58);

  const dortmund = seo.articleSeoTitle({
    title: 'Dortmund YouTubers react as Reus agrees a new deal in principle',
    related_team: 'borussia-dortmund',
  });
  assert.equal(dortmund, 'Dortmund fan YouTubers react: Reus new deal | FanReactionsFC');
  assert.ok(dortmund.length <= 60, dortmund);

  const two = seo.articleSeoTitle({
    title: 'Coventry and Newcastle YouTubers react to a 4-1 at the CBS Arena',
    related_team: null,
  });
  assert.match(two, /Coventry/);
  assert.match(two, /Newcastle/);
  // Both fan forms are over 60. The shorter colon line drops "fan" and lands on 60.
  assert.equal(two, 'Coventry and Newcastle YouTubers react: 4-1 | FanReactionsFC');
  assert.equal(two.length, 60);

  const hill = seo.articleSeoTitle({
    title: 'Everton and Chelsea YouTubers react to a 0-2 at the Hill Dickinson',
    related_team: null,
  });
  assert.equal(hill, 'Everton and Chelsea YouTubers react: 0-2 | FanReactionsFC');
  assert.equal(hill.length, 57);

  const fulham = seo.articleSeoTitle({
    title: 'Fulham and Wolves YouTubers react to a 1-0 at Craven Cottage tonight',
    related_team: null,
  });
  assert.equal(fulham, 'Fulham and Wolves fan YouTubers react: 1-0 | FanReactionsFC');
  assert.ok(fulham.length <= 60, fulham);

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
  assert.equal(
    seo.articleCoverAlt('chelsea', 'Chelsea YouTubers react as Reece James faces three months out'),
    'Chelsea YouTubers react as Reece James faces three months out'
  );
  assert.equal(seo.articleCoverAlt('', 'No club here'), 'No club here');
});

test('article meta leads with the club and the visible date flips when the article was edited', () => {
  const chelsea = seo.articleSeoMeta({
    title: 'Chelsea YouTubers react as Reece James faces three months out',
    related_team: 'chelsea',
    summary: 'Six directory channels react to Reece James\'s knee surgery. Chelsea confirmed on Friday 16 Oct 2026 that the captain had surgery.',
  });
  assert.equal(chelsea, 'Six directory channels react to Reece James\'s knee surgery.');
  assert.doesNotMatch(chelsea, /^Chelsea fan YouTubers react\./);
  assert.ok(chelsea.length <= 155, chelsea);
  assert.doesNotMatch(chelsea, /faces three months/);
  assert.doesNotMatch(chelsea, /…$/);

  const leeds = seo.articleSeoMeta({
    title: 'Leeds YouTubers react as Farke agrees a new deal in principle',
    related_team: 'leeds-united',
    summary: 'Five directory channels react to the report (The Athletic, Fri 16 Oct 2026) that Daniel Farke and Leeds United have reached an agreement in principle on a new contract running to 2029. Paperwork is still to be finalised.',
  });
  assert.equal(leeds, 'Five directory channels react to the report that Daniel Farke and Leeds United have reached an agreement in principle on a new contract running to 2029.');
  assert.ok(leeds.length <= 155, leeds + ' (' + leeds.length + ')');
  assert.match(leeds, /2029\.$/);

  const united = seo.articleSeoMeta({
    title: 'United YouTubers react as Martinez apologises after his board outburst',
    related_team: 'manchester-united',
    summary: 'Six directory channels react to Lisandro Martinez\'s apology. After criticising the hierarchy, he apologised.',
  });
  assert.equal(united, 'Six directory channels react to Lisandro Martinez\'s apology.');
  assert.ok(united.length <= 155, united);
  assert.doesNotMatch(united, /react to Martinez apologises/);

  const noun = seo.articleSeoMeta({
    title: 'Liverpool YouTubers react to a 6-3 win at LASK',
    related_team: 'liverpool',
    summary: 'Six directory channels react to the win.',
  });
  assert.match(noun, /^Liverpool fan YouTubers react to a 6-3 win at LASK\./);

  const same = seo.articleDateLine('2026-10-16T16:43:10Z', '2026-10-16T16:43:40Z');
  assert.match(same, /^Published /);
  const nextMorning = seo.articleDateLine('2026-10-16T16:43:10Z', '2026-10-17T08:42:38Z');
  assert.match(nextMorning, /^Published /);
  assert.doesNotMatch(nextMorning, /Updated/);
});

test('article updated date needs a gap of 3 days', () => {
  const published = '2026-10-01T12:00:00Z';

  assert.equal(seo.articleDateLine(published, null), 'Published 1 October 2026');
  assert.equal(seo.articleDateLine(published, ''), 'Published 1 October 2026');
  assert.equal(seo.articleDateModified(published, null), published);
  assert.equal(seo.articleDateModified(published, undefined), published);

  const within = '2026-10-04T11:59:59Z';
  assert.equal(seo.articleDateLine(published, within), 'Published 1 October 2026');
  assert.equal(seo.articleDateModified(published, within), published);

  const later = '2026-10-05T12:00:00Z';
  assert.equal(seo.articleDateLine(published, later), 'Updated 5 October 2026');
  assert.equal(seo.articleDateModified(published, later), later);
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
      assert.doesNotMatch(res.body, /Updated 1 October 2026/);
      const article = JSON.parse(res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).pop().replace(/<\/?script[^>]*>/g, ''));
      assert.equal(article['@type'], 'NewsArticle');
      assert.equal(article.author.name, 'FanReactionsFC');
      assert.equal(article.datePublished, '2026-10-01T00:00:00Z');
      assert.equal(article.dateModified, article.datePublished);
    });

    global.fetch = async () => ({
      ok: true,
      json: async () => [{
        title: 'Everton and Chelsea YouTubers react to a 0-2 at the Hill Dickinson',
        summary: 'Six directory channels react to the match.',
        body: 'The rooms split.\n\nMore from [GBFC](/clubs/chelsea) and [Toffee TV](/clubs/everton).',
        slug: 'everton-chelsea',
        related_team: null,
        published_at: '2026-10-17T00:00:00Z',
        updated_at: '2026-10-17T00:05:00Z',
      }],
    });
    await withCwd(async () => {
      const res = await articleFn.handler({ path: '/news/everton-chelsea' });
      assert.equal(res.statusCode, 200);
      const related = res.body.match(/<div class="news-article-related">[\s\S]*?<\/div>/);
      assert.ok(related, 'expected a related club link');
      assert.match(related[0], /href="\/clubs\/chelsea"/);
      assert.match(related[0], /More Chelsea fan YouTubers/);
      assert.doesNotMatch(related[0], /\/clubs\/everton/);
      assert.doesNotMatch(res.body, /\/clubs\/none/);
    });
  } finally {
    global.fetch = origFetch;
    if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});

test('article sentences do not split on decimals or abbreviations', () => {
  const fee = seo.articleSeoMeta({
    title: 'Chelsea YouTubers react to the fee',
    related_team: 'chelsea',
    summary: 'The deal is a £1.5m move. Nothing is signed yet.',
  });
  assert.match(fee, /The deal is a £1\.5m move\./);
  assert.doesNotMatch(fee, /£1\.(?!\d)/);

  const mr = seo.articleSeoMeta({
    title: 'Chelsea YouTubers react to the exit',
    related_team: 'chelsea',
    summary: 'Mr. Jones left the club on Friday. Fans reacted overnight.',
  });
  assert.match(mr, /Mr\. Jones left the club on Friday\./);

  const st = seo.articleSeoMeta({
    title: 'Chelsea YouTubers react to the result',
    related_team: 'chelsea',
    summary: 'St. Pauli beat the hosts away. The rooms reacted.',
  });
  assert.match(st, /St\. Pauli beat the hosts away\./);

  const vs = seo.articleSeoMeta({
    title: 'Chelsea YouTubers react to the tie',
    related_team: 'chelsea',
    summary: 'It is Chelsea vs. Arsenal on Sunday. Kick-off is early.',
  });
  assert.match(vs, /vs\. Arsenal on Sunday\./);
});

function titleCore(title) {
  return String(title || '').replace(/\s*\|\s*FanReactionsFC\s*$/, '').trim();
}

// A title is the whole headline, or a prefix that stops on a clause boundary.
function titleShape(title, headline) {
  const core = titleCore(title);
  const h = String(headline || '').replace(/\s+/g, ' ').trim();
  if (core === h) return 'headline';
  const fanless = core.replace(/ fan(?= YouTubers\b)/i, '');
  if (fanless === h || core === h + ' fan YouTubers') return 'fan-headline';
  if (h.indexOf(core) === 0) {
    const rest = h.slice(core.length);
    const marks = [':', ' – ', ' - ', ',', ' as ', ' after ', ' over ', ' amid '];
    if (marks.some((mark) => rest.toLowerCase().startsWith(mark.toLowerCase()))) return 'boundary';
  }
  if (/ v .+ preview: (?:fan )?YouTubers \| FanReactionsFC$/.test(title)) return 'preview';
  if (/ fan YouTubers react to \S+ \| FanReactionsFC$/.test(title)) return 'two-club';
  if (/ YouTubers react: \S.+ \| FanReactionsFC$/.test(title)) return 'curated';
  if (/fan YouTubers/.test(title) && / \| FanReactionsFC$/.test(title)) return 'fan-title';
  return '';
}

test('article titles and metas stay clean on the published catalogue', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/published-articles.json'), 'utf8'));
  assert.ok(rows.length >= 60, 'expected the published snapshot');
  const dangling = new Set('to a an the at on of in and fan for as with from by v vs or out up into over after can could would will may might shall than'.split(' '));

  for (const row of rows) {
    const title = seo.articleSeoTitle(row);
    const meta = seo.articleSeoMeta(row);
    const core = titleCore(title);
    const shape = titleShape(title, row.title);
    const headline = row.title.replace(/\s+/g, ' ').trim();
    assert.ok(shape, row.slug + ' title is not a whole headline, clause boundary, or complete template: ' + title);
    assert.ok(core.length >= 20, row.slug + ' title event is under 20 characters: ' + title);
    if (shape === 'boundary') assert.ok(core.length >= 25, row.slug + ' boundary cut is under 25: ' + title);
    // Sanity cap, not the 60-character SEO target.
    assert.ok(title.length <= 100, row.slug + ' title ' + title.length + ' ' + title);
    if (shape === 'headline') assert.equal(core, headline, row.slug);
    if (shape === 'boundary') {
      assert.equal(headline.indexOf(core), 0, row.slug);
      const last = (core.split(/\s+/).pop() || '').toLowerCase().replace(/[^a-z]/g, '');
      assert.equal(dangling.has(last), false, row.slug + ' title ends on ' + last + ': ' + title);
      assert.equal(/\b(?:react|preview)$/i.test(core), false, row.slug + ' boundary cut has no event: ' + title);
      assert.equal(/^(?:[\w'’.-]+\s+)+(?:fan\s+)?YouTubers$/i.test(core), false, row.slug + ' boundary cut is only the lead: ' + title);
    }
    assert.ok(meta.length <= 155 && meta.length > 0, row.slug + ' meta ' + meta.length + ' ' + meta);
    assert.match(meta, /[.!?]$/, row.slug + ' meta ' + meta);
    assert.match(meta, /[A-Za-z]/, row.slug + ' meta ' + meta);
    const metaLast = (meta.slice(0, -1).trim().split(/\s+/).pop() || '').toLowerCase().replace(/[^a-z]/g, '');
    assert.equal(dangling.has(metaLast), false, row.slug + ' meta ends on ' + metaLast + ': ' + meta);
    assert.doesNotMatch(title + '\n' + meta, /\$|undefined|null/i, row.slug);
    if (/\bpreview\b/i.test(row.title)) {
      assert.doesNotMatch(title, /\breact/i, row.slug + ' ' + title);
      assert.doesNotMatch(meta, /\breact/i, row.slug + ' ' + meta);
      assert.doesNotMatch(meta, /^Fan YouTubers react\./, row.slug);
    }
  }

  const at = (slug) => rows.find((row) => row.slug === slug);
  const alonso = at('chelsea-youtubers-react-as-alonsos-blues-hang-on-4-3');
  assert.equal(seo.articleSeoTitle(alonso), "Chelsea YouTubers React as Alonso's Blues Hang On 4-3 | FanReactionsFC");
  assert.match(seo.articleSeoMeta(alonso), /Stamford Bridge\./);
  assert.doesNotMatch(seo.articleSeoMeta(alonso), /\bat\.$/);

  const friedkin = at('everton-youtubers-react-as-the-friedkin-group-put-the-club-up-for-sale');
  assert.equal(seo.articleSeoTitle(friedkin), 'Everton YouTubers react as the Friedkin Group put the club up for sale | FanReactionsFC');
  assert.equal(seo.articleSeoMeta(friedkin), 'Everton fan YouTubers react.');

  const barcola = at('liverpool-youtubers-react-as-barcola-deal-nears');
  assert.equal(seo.articleSeoTitle(barcola), 'Liverpool YouTubers React as Barcola Deal Nears £120m | FanReactionsFC');
  assert.match(seo.articleSeoMeta(barcola), /Bradley Barcola\./);
  assert.doesNotMatch(seo.articleSeoMeta(barcola), /\bin\.$/);

  const atletico = at('liverpool-youtubers-preview-atletico-at-anfield');
  assert.equal(seo.articleSeoTitle(atletico), 'Liverpool YouTubers Preview Atlético at Anfield | FanReactionsFC');
  assert.doesNotMatch(seo.articleSeoMeta(atletico), /\breact/i);

  const ward = at('liverpool-youtubers-react-as-julian-ward-nears-sporting-director-return');
  assert.equal(seo.articleSeoTitle(ward), 'Liverpool YouTubers react as Julian Ward nears sporting director return | FanReactionsFC');
  assert.equal(titleShape(seo.articleSeoTitle(ward), ward.title), 'headline');
  assert.doesNotMatch(seo.articleSeoMeta(ward), /\bto\.$/);

  const spursReact = at('united-and-spurs-youtubers-react-as-ten-man-spurs-snatch-a-1-1-at-old-trafford');
  assert.equal(seo.articleSeoTitle(spursReact), 'United and Spurs YouTubers react as ten-man Spurs snatch a 1-1 at Old Trafford | FanReactionsFC');
  assert.equal(titleShape(seo.articleSeoTitle(spursReact), spursReact.title), 'headline');

  const burwell = at('sunderland-youtubers-react-to-tom-burwells-sudden-exit');
  assert.equal(seo.articleSeoTitle(burwell), "Sunderland YouTubers react to Tom Burwell's sudden exit | FanReactionsFC");
  assert.doesNotMatch(seo.articleSeoMeta(burwell), /\bwith\.$/);

  const madrid = at('united-youtubers-react-as-martinez-calls-out-the-board-after-a-2-0-in-madrid');
  assert.equal(seo.articleSeoTitle(madrid), 'United YouTubers react as Martinez calls out the board after a 2-0 in Madrid | FanReactionsFC');
  assert.doesNotMatch(seo.articleSeoMeta(madrid), /\bthe\.$/);

  const bridge = at('chelsea-and-bournemouth-youtubers-preview-saturday-afternoon-at-stamford-bridge');
  assert.equal(seo.articleSeoTitle(bridge), 'Chelsea v Bournemouth preview: YouTubers | FanReactionsFC');
  assert.equal(seo.articleSeoMeta(bridge), 'Chelsea v Bournemouth preview.');

  const derby = at('united-and-city-youtubers-preview-the-manchester-derby');
  assert.equal(seo.articleSeoTitle(derby), 'United and City YouTubers Preview the Manchester Derby | FanReactionsFC');
  assert.match(seo.articleSeoMeta(derby), /^United v City preview:/);
  assert.doesNotMatch(seo.articleSeoMeta(derby), /\breact/i);

  const greece = at('arsenal-youtubers-react-to-tzolis-injury-on-greece-duty');
  assert.equal(seo.articleSeoTitle(greece), 'Arsenal YouTubers react to Tzolis injury on Greece duty | FanReactionsFC');
  const germany = at('arsenal-youtubers-react-to-havertz-injury-on-germany-duty');
  assert.equal(seo.articleSeoTitle(germany), 'Arsenal YouTubers react to Havertz injury on Germany duty | FanReactionsFC');

  const draw = at('arsenal-face-real-madrid-and-bayern-as-fan-channels-react-to-the-ucl-draw');
  assert.equal(seo.articleSeoTitle(draw), 'Arsenal Face Real Madrid and Bayern as Fan Channels React to the UCL Draw | FanReactionsFC');

  const arteta = at('arsenal-youtubers-react-as-arteta-agrees-a-new-long-term-deal');
  assert.equal(seo.articleSeoTitle(arteta), 'Arsenal YouTubers react: Arteta new long-term deal | FanReactionsFC');
  const villa = at('chelsea-youtubers-react-as-villa-agree-75m-martinez-move');
  assert.equal(seo.articleSeoTitle(villa), 'Chelsea YouTubers React as Villa Agree £7.5m Martinez Move | FanReactionsFC');

  const spursPreview = at('united-and-spurs-youtubers-preview-saturday-evening-at-old-trafford');
  assert.equal(seo.articleSeoMeta(spursPreview), 'United v Spurs preview.');

  const brighton = at('brighton-and-arsenal-youtubers-react-to-a-3-0-at-the-amex');
  assert.equal(seo.articleSeoTitle(brighton), 'Brighton and Arsenal YouTubers react: 3–0 | FanReactionsFC');
  const palace = at('leeds-and-crystal-palace-youtubers-react-to-a-0-0-at-elland-road');
  assert.match(seo.articleSeoTitle(palace), /react to 0–0 \|/);

  const vitality = at('bournemouth-and-liverpool-youtubers-react-to-a-0-1-at-the-vitality');
  assert.equal(seo.articleSeoTitle(vitality), 'Bournemouth and Liverpool YouTubers react: 0–1 | FanReactionsFC');
  const carabao = at('liverpool-and-spurs-youtubers-react-to-a-3-1-carabao-at-anfield');
  assert.equal(seo.articleSeoTitle(carabao), 'Liverpool and Spurs YouTubers react: 3-1 | FanReactionsFC');
});

test('meta keeps a quoted exclamation whole and does not repeat a react prefix', () => {
  const ferdinand = seo.articleSeoMeta({
    title: 'YouTubers react to the Rio Ferdinand v SaeedTV Instagram row',
    related_team: 'manchester-united',
    summary: "Directory channels react to the Instagram exchange between Rio Ferdinand and SaeedTV, reported on Sat 17 Oct 2026 by the Daily Mail, the Mirror and GiveMeSport. After Ferdinand shared a picture with Michael Carrick, Saeed commented 'Stop yapping and call out the owners!' and Ferdinand replied with a remark about Saeed's body, which the Daily Mail and Mirror describe as a \"fat-shaming\" row. Saeed answered in a 15-minute video, 'Exposing Rio Ferdinand!'. No response or apology from Ferdinand appears in the reporting we've read. All reactions are attributed to the creators; Staffy TV and TurkishLDN say they are friends of Saeed.",
  });
  assert.equal(ferdinand, "Man United fan YouTubers react. Saeed answered in a 15-minute video, 'Exposing Rio Ferdinand!'.");
  assert.doesNotMatch(ferdinand, /owners!$/);
  assert.ok(ferdinand.length <= 155, ferdinand);
  assert.match(ferdinand, /[.!?]$/);

  const clipped = seo.seoClip('Rio said "Stop yapping and call out the owners!" after the picture.', 40);
  assert.equal(clipped, 'Rio said…');
  assert.equal((clipped.match(/"/g) || []).length % 2, 0);
  const curly = seo.seoClip('Rio said \u201cStop yapping and call out the owners!\u201d after the picture.', 28);
  assert.equal(curly, 'Rio said…');
  assert.equal((curly.match(/[\u201C\u201D"]/g) || []).length % 2, 0);
  const previous = seo.seoClip('First sentence is done. Then Rio said "call out the owners!" and more words follow here.', 50);
  assert.match(previous, /^First sentence is done\./);
  assert.equal((previous.match(/"/g) || []).length % 2, 0);

  const kept = seo.articleSeoMeta({
    title: 'Chelsea YouTubers on the captaincy',
    related_team: 'chelsea',
    summary: 'The captain had surgery on Friday. He will be out for months.',
  });
  assert.equal(kept, 'Chelsea fan YouTubers react. The captain had surgery on Friday.');

  const named = seo.articleSeoMeta({
    title: 'Chelsea YouTubers on the captaincy',
    related_team: 'chelsea',
    summary: 'Chelsea confirmed the captain had surgery on Friday. He will be out for months.',
  });
  assert.equal(named, 'Chelsea confirmed the captain had surgery on Friday.');
  assert.doesNotMatch(named, /^Chelsea fan YouTubers react\./);

  const nineties = seo.articleSeoMeta({
    title: 'Chelsea YouTubers on the kits',
    related_team: 'chelsea',
    summary: "The '90s kits are back on Friday. The away shirt follows in May.",
  });
  assert.equal(nineties, "Chelsea fan YouTubers react. The '90s kits are back on Friday.");

  const tis = seo.articleSeoMeta({
    title: 'Chelsea YouTubers on the kits',
    related_team: 'chelsea',
    summary: "'Tis the season for a new kit. The launch is Friday.",
  });
  assert.equal(tis, "Chelsea fan YouTubers react. 'Tis the season for a new kit.");
  assert.doesNotMatch(tis, /launch is Friday/);

  const inches = seo.articleSeoMeta({
    title: 'Chelsea YouTubers on the screen',
    related_team: 'chelsea',
    summary: 'He bought a 6" screen for the review. The video lands Friday.',
  });
  assert.equal(inches, 'Chelsea fan YouTubers react. He bought a 6" screen for the review.');

  const apostrophes = seo.articleSeoMeta({
    title: 'Chelsea YouTubers on the captain',
    related_team: 'chelsea',
    summary: "James's knee is fine and we don't expect surgery. He trains on Friday.",
  });
  assert.equal(apostrophes, "Chelsea fan YouTubers react. James's knee is fine and we don't expect surgery.");
});

test('a 100KB summary resolves well under a second', () => {
  let summary = '';
  while (summary.length < 100000) summary += 'The captain had surgery on Friday. ';
  const start = process.hrtime.bigint();
  const meta = seo.articleSeoMeta({
    title: 'Chelsea YouTubers on the captaincy',
    related_team: 'chelsea',
    summary: summary,
  });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 500, '100KB summary took ' + ms + 'ms');
  assert.equal(meta, 'Chelsea fan YouTubers react. The captain had surgery on Friday.');
});

test('a missing related club links the first hub only for a two-club headline', () => {
  const everton = {
    related_team: null,
    title: 'Everton and Chelsea YouTubers react to a 0-2 at the Hill Dickinson',
    body: 'Watch [GBFC](/clubs/chelsea) and [Toffee TV](/clubs/everton).',
  };
  assert.equal(seo.articleMoreClub(everton), 'Chelsea');
  assert.equal(seo.articleMoreLabel(seo.articleMoreClub(everton)), 'More Chelsea fan YouTubers');
  const none = {
    related_team: 'none',
    title: 'Everton and Chelsea YouTubers react to a 0-2 at the Hill Dickinson',
    body: 'Skip /clubs/none then /clubs/not-a-real-club and /clubs/chelsea.',
  };
  assert.equal(seo.articleMoreClub(none), 'Chelsea');
  assert.equal(seo.articleMoreClub({ related_team: 'none', title: 'Everton and Chelsea YouTubers react to a 0-2', body: 'Chelsea is named but not linked.' }), '');
  assert.equal(seo.articleMoreClub({ related_team: null, title: 'Everton and Chelsea YouTubers react to a 0-2', body: 'See /clubs/none only.' }), '');
  assert.equal(seo.articleMoreClub({ related_team: 'arsenal', title: 'Everton and Chelsea YouTubers react to a 0-2', body: 'See /clubs/chelsea first.' }), 'Arsenal');
  const noFooter = [
    ['323 Premier League Fan YouTubers, Counted Club by Club', '/clubs/arsenal'],
    ['Premier League YouTubers React to Deadline Day 2026', '/clubs/chelsea'],
    ['Premier League YouTubers react to Croatia 0–7 England in Rijeka', '/clubs/newcastle'],
    ['Premier League YouTubers react to England 2–3 Spain at Wembley', '/clubs/liverpool'],
    ['Premier League YouTubers react as Ronaldo leaves Portugal camp', '/clubs/manchester-united'],
  ];
  noFooter.forEach((row) => {
    assert.equal(seo.articleMoreClub({ related_team: null, title: row[0], body: 'See ' + row[1] + ' in the copy.' }), '', row[0]);
    assert.equal(seo.articleMoreClub({ related_team: 'none', title: row[0], body: 'See ' + row[1] + ' in the copy.' }), '', row[0]);
  });
});

test('static homepage shell does not say Loading', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<p class="subtitle">Loading/);
  assert.match(html, /The definitive database of football YouTubers\. Ranked daily\./);
  assert.match(html, /src="\/js\/lib\/seo-copy\.js"/);
});
