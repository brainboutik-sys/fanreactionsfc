// Server-renders /discover — the filtered creator index, not a second
// rankings page. Unique H1 + a crawlable creator/club list in raw HTML.

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

function formatNum(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function eventPathname(event) {
  if (event.rawUrl) {
    try { return new URL(event.rawUrl).pathname; } catch {}
  }
  return event.path || '';
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
  const clubLinks = (clubs || []).slice(0, 40).map(t => `<a href="${clubPath(t)}">${esc(t)}</a>`).join('');
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

  const reqPath = eventPathname(event);
  if (reqPath === '/discover/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/discover', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const qs = event.queryStringParameters || {};
  const q = (qs.q || '').trim();
  const leagueFilter = qs.league || '';
  const teamFilter = qs.team || '';

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let creators = [];
  if (sbKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team,league,subscriber_count,content_types&order=subscriber_count.desc.nullslast&limit=1000`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res.ok) creators = await res.json();
    } catch { /* empty index still gets unique head/body */ }
  }

  let filtered = creators.slice();
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter(c =>
      (c.name || '').toLowerCase().includes(needle) ||
      (c.team || '').toLowerCase().includes(needle) ||
      (c.league || '').toLowerCase().includes(needle)
    );
  }
  if (leagueFilter) filtered = filtered.filter(c => (c.league || '') === leagueFilter);
  if (teamFilter) filtered = filtered.filter(c => c.team === teamFilter);

  const h1 = teamFilter ? `Discover ${teamFilter} Creators` : leagueFilter ? `Discover ${leagueFilter} Creators` : 'Discover Football Creators';
  const title = h1 + ' | FanReactionsFC';
  const description = q
    ? `${filtered.length} creators match “${q}” in the FanReactionsFC directory.`
    : `Browse ${filtered.length || creators.length} football YouTubers by league, club, or name. Filter the directory — this is the index, not the rankings table.`;
  const url = SITE_URL + '/discover';
  const clubs = [...new Set(creators.map(c => c.team).filter(t => t && t !== 'Multi-Club / Other'))].sort();
  const leagues = [...new Set(creators.map(c => c.league).filter(Boolean))].sort();

  const clubLinks = clubs.map(t => `<a href="${clubPath(t)}">${esc(t)}</a>`).join(' · ');
  const leagueLinks = ['<a href="/discover">All leagues</a>']
    .concat(leagues.map(l => `<a href="/discover?league=${encodeURIComponent(l)}">${esc(l)}</a>`))
    .join(' · ');

  const tableRows = filtered.map(c => `
    <tr>
      <td><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a></td>
      <td>${c.team ? `<a href="${clubPath(c.team)}">${esc(c.team)}</a>` : '—'}</td>
      <td>${c.league ? esc(c.league) : '—'}</td>
      <td>${c.subscriber_count ? formatNum(c.subscriber_count) : '—'}</td>
    </tr>`).join('');

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Directory</div>
            <h1 class="page-hero-title">${esc(h1)}</h1>
            <p class="page-hero-subtitle">${esc(description)}</p>
            <p class="seo-filter-links">${leagueLinks}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <h2>Clubs</h2>
      <p class="seo-filter-links">${clubLinks}</p>
      <h2>${filtered.length} creator${filtered.length !== 1 ? 's' : ''}</h2>
      ${filtered.length ? `
      <table class="seo-table">
        <thead><tr><th>Creator</th><th>Club</th><th>League</th><th>Subscribers</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>` : '<div class="empty-state"><div class="es-title">No creators found</div><p><a href="/submit">Suggest a creator</a></p></div>'}
      <p class="seo-more-links"><a href="/rankings">Best football fan YouTubers ranked</a></p>
    </div>
    ${ssrFooter(clubs)}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat([
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: title,
        description,
        isPartOf: { '@id': SITE_URL + '/#website' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: 'Discover', item: url },
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
