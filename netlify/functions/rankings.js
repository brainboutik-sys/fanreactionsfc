// Server-renders /rankings with a unique H1, a visible creator table, and
// ItemList + BreadcrumbList JSON-LD. Query filters (?league, ?team) keep
// the same canonical /rankings URL but change the visible list.

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

// Keep the "Best Football Fan YouTubers" table to club-directory fan
// channels (and multi-club rows that are actually watchalong/reaction).
// Journalists and celebrity streamers must not sit at #1 under that H1.
const FAN_RANK_TYPES = ['Reactions', 'Watchalong', 'Match Review', 'Banter', 'Fan Cam', 'Compilation'];
const NON_FAN_SLUGS = new Set(['live-djmariio', 'bydiegox10']);

function isFanRankingsChannel(c) {
  const slug = String(c.slug || '').toLowerCase();
  if (slug && NON_FAN_SLUGS.has(slug)) return false;
  const team = c.team || '';
  if (team && team !== 'Multi-Club / Other') return true;
  const types = c.content_types || c.contentTypes || [];
  return types.some(t => FAN_RANK_TYPES.includes(t));
}

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
  if (reqPath === '/rankings/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/rankings', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const qs = event.queryStringParameters || {};
  const leagueFilter = qs.league || '';
  const teamFilter = qs.team || '';

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let creators = [];
  if (sbKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team,league,subscriber_count,video_count,total_view_count,content_types,last_youtube_sync,updated_at&order=subscriber_count.desc.nullslast&limit=1000`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res.ok) creators = await res.json();
    } catch { /* empty table still gets unique head/body */ }
  }

  let ranked = creators.filter(c => (c.subscriber_count || 0) > 0 && isFanRankingsChannel(c));
  if (leagueFilter) ranked = ranked.filter(c => (c.league || '') === leagueFilter);
  if (teamFilter) ranked = ranked.filter(c => c.team === teamFilter);

  const scope = teamFilter || leagueFilter || '';
  const h1 = scope ? `Best ${scope} Fan YouTubers Ranked` : 'Best Football Fan YouTubers Ranked';
  const title = h1 + ' | FanReactionsFC';
  const top = ranked[0];
  const description = ranked.length
    ? `${ranked.length} ${scope ? scope + ' ' : ''}football fan YouTubers ranked by subscribers.${top ? ` ${top.name} leads with ${formatNum(top.subscriber_count)} subscribers.` : ''} Updated from YouTube channel data.`
    : 'Football fan YouTubers ranked by subscribers, videos, and views on FanReactionsFC.';
  const url = SITE_URL + '/rankings';
  const clubs = [...new Set(creators.map(c => c.team).filter(t => t && t !== 'Multi-Club / Other'))].sort();
  const dateModified = ranked
    .map(c => c.last_youtube_sync || c.updated_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || undefined;

  const leagues = [...new Set(creators.map(c => c.league).filter(Boolean))].sort();
  const leagueLinks = ['<a href="/rankings">All leagues</a>']
    .concat(leagues.map(l => `<a href="/rankings?league=${encodeURIComponent(l)}">${esc(l)}</a>`))
    .join(' · ');

  const tableRows = ranked.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a></td>
      <td>${c.team ? `<a href="${clubPath(c.team)}">${esc(c.team)}</a>` : '—'}</td>
      <td>${formatNum(c.subscriber_count)}</td>
      <td>${c.video_count ? formatNum(c.video_count) : '—'}</td>
    </tr>`).join('');

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Daily Rankings</div>
            <h1 class="page-hero-title">${esc(h1)}</h1>
            <p class="page-hero-subtitle">${esc(description)}</p>
            <p class="page-hero-meta seo-filter-links">${leagueLinks}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <p>${ranked.length} creator${ranked.length !== 1 ? 's' : ''} · <a href="/discover">Browse the full directory</a></p>
      ${ranked.length ? `
      <table class="seo-table">
        <thead><tr><th>#</th><th>Creator</th><th>Club</th><th>Subscribers</th><th>Videos</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>` : '<div class="empty-state"><div class="es-title">No rankings yet</div></div>'}
    </div>
    ${ssrFooter(clubs)}`;

  const itemList = {
    '@type': 'ItemList',
    name: h1,
    numberOfItems: ranked.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: ranked.slice(0, 100).map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/creators/${c.slug || slugify(c.name)}`,
      name: c.name,
    })),
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat([
      Object.assign({
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: title,
        description,
        isPartOf: { '@id': SITE_URL + '/#website' },
        mainEntity: itemList,
      }, dateModified ? { dateModified } : {}),
      itemList,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: 'Rankings', item: url },
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

exports.isFanRankingsChannel = isFanRankingsChannel;
