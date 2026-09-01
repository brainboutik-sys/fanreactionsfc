// Server-renders `/` so crawlers see a unique title/H1/canonical and
// directory links instead of the SPA shell subtitle "Loading...".
// The SPA still hydrates #app (see renderHome() in js/app.js).
// Canonical is trailing-slash https://fanreactionsfc.com/ — this
// function must not 301 `/` to a slash-less or different host path.

const fs = require('fs');
const path = require('path');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';

const CLUB_SLUG_OVERRIDES = {
  'Man United': 'manchester-united',
  'Man City': 'manchester-city',
  'Nottm Forest': 'nottingham-forest',
  'Oxford Utd': 'oxford-united',
  'Sheffield Utd': 'sheffield-united',
  'Sheffield Wed': 'sheffield-wednesday',
  'West Brom': 'west-bromwich-albion',
  'Multi-Club / Other': 'multi-club',
};
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function clubPath(team) { return '/clubs/' + (CLUB_SLUG_OVERRIDES[team] || slugify(team)); }

// Always-on crawlable directory so `/` has club/creator links even when
// Supabase is unset. These are existing /clubs/* and /creators/* pages —
// not invented "best [club] YouTubers" blog URLs.
const FALLBACK_CLUBS = [
  { name: 'Arsenal', href: '/clubs/arsenal' },
  { name: 'Man United', href: '/clubs/manchester-united' },
  { name: 'Liverpool', href: '/clubs/liverpool' },
  { name: 'Chelsea', href: '/clubs/chelsea' },
  { name: 'Tottenham', href: '/clubs/tottenham' },
  { name: 'Man City', href: '/clubs/manchester-city' },
];
const FALLBACK_CREATORS = [
  { name: 'AFTVmedia', href: '/creators/aftvmedia' },
  { name: 'UnitedStand', href: '/creators/unitedstand' },
  { name: 'FamZoneTV', href: '/creators/famzonetv' },
  { name: 'ThatsFootball', href: '/creators/thatsfootball' },
];

let indexHtmlCache = null;
function readIndexHtml() {
  if (indexHtmlCache) return indexHtmlCache;
  const candidates = [
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, '..', '..', 'index.html'),
    path.join(__dirname, '..', '..', '..', 'index.html'),
  ];
  for (const p of candidates) {
    try {
      indexHtmlCache = fs.readFileSync(p, 'utf8');
      return indexHtmlCache;
    } catch {}
  }
  return null;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatNum(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function applyPage(html, { title, description, url, bodyHtml, jsonLd }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  out = out.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${bodyHtml}</main>`);
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  return out;
}

function ssrFooter(clubs) {
  const clubLinks = (clubs || []).slice(0, 40).map(t => {
    const href = t.href || clubPath(t.name || t);
    const name = t.name || t;
    return `<a href="${esc(href)}">${esc(name)}</a>`;
  }).join('');
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand"><img src="/img/logo-wide.png" alt="FanReactionsFC" class="footer-logo"></div>
            <div class="footer-desc">The definitive database of football YouTubers across Europe's top leagues.</div>
          </div>
          <div class="footer-col">
            <h4>Browse</h4>
            <a href="/discover">Discover Creators</a>
            <a href="/rankings">Rankings</a>
            <a href="/news">News</a>
            <a href="/become-a-creator">Become a Creator</a>
          </div>
          <div class="footer-col">
            <h4>FanReactionsFC</h4>
            <a href="https://www.youtube.com/@fanreactionsfc" target="_blank" rel="noopener">YouTube</a>
            <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener">X</a>
            <a href="https://www.instagram.com/fanreactionsfc/" target="_blank" rel="noopener">Instagram</a>
          </div>
        </div>
        ${clubLinks ? `<div class="footer-clubs"><h4>Clubs</h4><div class="footer-club-links">${clubLinks}</div></div>` : ''}
      </div>
    </footer>`;
}

function siteGraph() {
  return [
    {
      '@type': 'Organization',
      '@id': SITE_URL + '/#organization',
      name: 'FanReactionsFC',
      url: SITE_URL,
      logo: SITE_URL + '/img/logo-wide.png',
      sameAs: [
        'https://www.youtube.com/@fanreactionsfc',
        'https://x.com/fanreactionsfc',
        'https://www.instagram.com/fanreactionsfc/',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': SITE_URL + '/#website',
      name: 'FanReactionsFC',
      url: SITE_URL,
      publisher: { '@id': SITE_URL + '/#organization' },
      potentialAction: {
        '@type': 'SearchAction',
        target: SITE_URL + '/discover?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let creators = [];
  if (sbKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team,league,subscriber_count&order=subscriber_count.desc.nullslast&limit=40`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res.ok) creators = await res.json();
    } catch { /* fallbacks below still give crawlable directory links */ }
  }

  const liveClubs = [...new Set(creators.map(c => c.team).filter(t => t && t !== 'Multi-Club / Other'))]
    .sort()
    .map(t => ({ name: t, href: clubPath(t) }));
  const clubs = liveClubs.length ? liveClubs : FALLBACK_CLUBS;

  const liveCreators = creators
    .filter(c => c.name && (c.slug || c.name))
    .slice(0, 16)
    .map(c => ({ name: c.name, href: '/creators/' + (c.slug || slugify(c.name)), team: c.team, subscriber_count: c.subscriber_count }));
  const featuredCreators = liveCreators.length ? liveCreators : FALLBACK_CREATORS;

  const title = 'FanReactionsFC — Discover the Best Football YouTubers';
  const h1 = 'Discover the best football creators on YouTube';
  const subtitle = 'The definitive database of football YouTubers. Ranked daily.';
  const description = 'The definitive database of football YouTubers. Rated by fans. Ranked daily. Premier League, Championship, La Liga, Serie A, Bundesliga, Ligue 1.';
  const url = SITE_URL + '/';

  const clubLinks = clubs.map(t => `<a href="${esc(t.href)}">${esc(t.name)}</a>`).join(' · ');
  const creatorRows = featuredCreators.map(c => `
    <tr>
      <td><a href="${esc(c.href)}">${esc(c.name)}</a></td>
      <td>${c.team ? `<a href="${esc(clubPath(c.team))}">${esc(c.team)}</a>` : '—'}</td>
      <td>${c.subscriber_count ? formatNum(c.subscriber_count) : '—'}</td>
    </tr>`).join('');

  const bodyHtml = `
    <section class="hero">
      <div class="container">
        <img src="/img/logo-wide.png" alt="FanReactionsFC" class="hero-logo">
        <h1>Discover the best football<br>creators on <span class="accent">YouTube</span></h1>
        <p class="subtitle">${esc(subtitle)}</p>
        <p class="seo-more-links home-dir-links">
          <a href="/rankings">Rankings</a> ·
          <a href="/discover">Discover</a> ·
          <a href="/news">News</a> ·
          <a href="/become-a-creator">Become a Creator</a>
        </p>
      </div>
    </section>
    <div class="container section">
      <h2>Clubs</h2>
      <p class="seo-filter-links">${clubLinks}</p>
      <h2>Creators</h2>
      <table class="seo-table">
        <thead><tr><th>Creator</th><th>Club</th><th>Subscribers</th></tr></thead>
        <tbody>${creatorRows}</tbody>
      </table>
      <p class="seo-more-links">
        <a href="/rankings">Best football fan YouTubers ranked</a> ·
        <a href="/discover">Browse the full directory</a> ·
        <a href="/news">News</a> ·
        <a href="/become-a-creator">How to start a channel</a>
      </p>
    </div>
    ${ssrFooter(clubs)}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat([
      {
        '@type': 'WebPage',
        '@id': url,
        url,
        name: title,
        description,
        isPartOf: { '@id': SITE_URL + '/#website' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: url },
        ],
      },
    ]),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
    body: applyPage(html, { title, description, url, bodyHtml, jsonLd }),
  };
};
