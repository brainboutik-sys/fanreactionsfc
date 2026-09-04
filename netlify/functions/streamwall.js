// Server-renders /streamwall so crawlers see a unique title/H1/canonical
// and a real list of currently-live creators instead of the homepage
// shell. Read-only SSR snapshot — does not touch the interactive wall
// itself (renderStreamwall/renderStreamwallWall in js/app.js).

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

function applyPage(html, { title, description, url, bodyHtml, jsonLd }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  out = out.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${bodyHtml}</main>`);
  if (jsonLd) {
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  }
  return out;
}

function ssrFooter() {
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
        </div>
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
    },
  ];
}

exports.handler = async () => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let liveCreators = [];
  if (sbKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team&is_live=eq.true&order=subscriber_count.desc.nullslast&limit=60`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res.ok) liveCreators = await res.json();
    } catch { /* empty-state HTML below still gives crawlers a real page */ }
  }

  const title = 'Streamwall — Watch Live Football Creators | FanReactionsFC';
  const description = 'Watch multiple football creators streaming live on YouTube, all at once. Live watchalongs, reactions, and match day content.';
  const url = SITE_URL + '/streamwall';

  const rows = liveCreators.filter(c => c.name);
  const listHtml = rows.length
    ? `<ul class="seo-list">${rows.map(c => `<li><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a>${c.team ? ` — <a href="${esc(clubPath(c.team))}">${esc(c.team)}</a>` : ''}</li>`).join('')}</ul>`
    : `<div class="empty-state"><div class="es-title">No one is live right now</div><p>Check back on matchday, or <a href="/discover">browse the full creator directory</a>.</p></div>`;

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Live Now</div>
            <h1 class="page-hero-title">Watch Live Football Creators</h1>
            <p class="page-hero-subtitle">${esc(description)}</p>
            <div class="page-hero-meta"><span class="page-hero-tag">${rows.length} live now</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      ${listHtml}
      <p class="seo-more-links"><a href="/discover">Browse the full directory</a> · <a href="/rankings">See rankings</a></p>
    </div>
    ${ssrFooter()}`;

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
    ]),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
    body: applyPage(html, { title, description, url, bodyHtml, jsonLd }),
  };
};
