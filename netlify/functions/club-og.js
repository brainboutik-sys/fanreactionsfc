// Server-renders /clubs/:slug with unique title/canonical/H1, a visible
// creator table, ItemList + SportsTeam + BreadcrumbList JSON-LD, and 301s
// from legacy spaced/cased URLs onto lowercase hyphenated slugs.
//
// Unlike the old meta-only rewrite, a non-JS crawler sees the club name
// and the creator list in the raw HTML — same idea as news-article.js.
// The SPA still hydrates and replaces #app with its own render.

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
const CLUB_SLUG_ALIASES = {
  'man-united': 'Man United', 'man-utd': 'Man United', 'manutd': 'Man United', 'manchester-united': 'Man United',
  'man-city': 'Man City', 'manchester-city': 'Man City',
  'nottm-forest': 'Nottm Forest', 'nottingham-forest': 'Nottm Forest', 'notts-forest': 'Nottm Forest',
  'oxford-utd': 'Oxford Utd', 'oxford-united': 'Oxford Utd',
  'sheffield-utd': 'Sheffield Utd', 'sheffield-united': 'Sheffield Utd',
  'sheffield-wed': 'Sheffield Wed', 'sheffield-wednesday': 'Sheffield Wed',
  'west-brom': 'West Brom', 'west-bromwich-albion': 'West Brom',
  'psg': 'PSG', 'paris-saint-germain': 'PSG',
  'multi-club': 'Multi-Club / Other', 'multi-club-other': 'Multi-Club / Other',
};
const CLUB_DISPLAY_NAMES = [
  'Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Chelsea','Coventry','Crystal Palace','Everton','Fulham','Hull City','Ipswich','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham',
  'Birmingham','Blackburn','Bristol City','Burnley','Charlton','Derby','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','West Ham','Wolves','Wrexham','Luton',
  'Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes',
  'Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como',
  'Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli',
  'PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne',
  'Multi-Club / Other',
];

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function clubSlug(team) { return CLUB_SLUG_OVERRIDES[team] || slugify(team); }
function clubPath(team, suffix) { return '/clubs/' + clubSlug(team) + (suffix || ''); }

function resolveClub(raw, extraTeams) {
  let input = String(raw || '').replace(/\+/g, ' ').trim();
  try { input = decodeURIComponent(input); } catch { /* already decoded */ }
  input = input.replace(/\/+$/, '').trim();
  if (!input) return null;
  const known = new Set(CLUB_DISPLAY_NAMES.concat(extraTeams || []));
  if (known.has(input)) return input;
  const lower = input.toLowerCase();
  for (const name of known) if (name.toLowerCase() === lower) return name;
  const slugged = slugify(input);
  if (!slugged) return null;
  if (CLUB_SLUG_ALIASES[slugged] && known.has(CLUB_SLUG_ALIASES[slugged])) return CLUB_SLUG_ALIASES[slugged];
  for (const [name, slug] of Object.entries(CLUB_SLUG_OVERRIDES)) {
    if (slug === slugged && known.has(name)) return name;
  }
  for (const name of known) if (slugify(name) === slugged) return name;
  return null;
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

function htmlResponse(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': statusCode === 200 ? 'public, max-age=300, s-maxage=300' : 'public, max-age=60',
    }, extraHeaders || {}),
    body,
  };
}

function redirect301(toPath) {
  return {
    statusCode: 301,
    headers: { Location: SITE_URL + toPath, 'Cache-Control': 'public, max-age=86400' },
    body: '',
  };
}

function applyPage(html, { title, description, url, bodyHtml, jsonLd, noindex }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  if (noindex) {
    out = out.replace('<head>', '<head>\n  <meta name="robots" content="noindex, follow">');
  }
  out = out.replace(/<link rel="canonical"[^>]*>/, noindex
    ? '<link rel="canonical" id="canonicalLink" href="">'
    : `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${bodyHtml}</main>`);
  if (jsonLd) {
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  }
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
            <a href="/contact">Contact</a>
          </div>
        </div>
        ${clubLinks ? `<div class="footer-clubs"><h4>Clubs</h4><div class="footer-club-links">${clubLinks}</div></div>` : ''}
      </div>
    </footer>`;
}

function notFoundHtml(html, reqPath) {
  const body = `
    <div class="container section-message">
      <div class="empty-state">
        <div class="es-title">Page not found</div>
        <p style="color:var(--text-dim);margin-bottom:16px">No page at <code>${esc(reqPath)}</code>.</p>
        <a href="/discover" class="btn btn-primary">Browse creators</a>
      </div>
    </div>
    ${ssrFooter(['Arsenal','Man United','Liverpool','Chelsea','Tottenham'])}`;
  return applyPage(html, {
    title: 'Page Not Found | FanReactionsFC',
    description: 'This page does not exist on FanReactionsFC.',
    url: SITE_URL + reqPath,
    bodyHtml: body,
    noindex: true,
  });
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
  if (reqPath === '/clubs' || reqPath === '/clubs/') {
    return redirect301('/discover');
  }

  const videosMatch = reqPath.match(/^\/clubs\/([^\/\?]+)\/videos\/?$/);
  const clubMatch = reqPath.match(/^\/clubs\/([^\/\?]+)\/?$/);
  const rawSeg = videosMatch ? videosMatch[1] : (clubMatch ? clubMatch[1] : '');
  const isVideos = !!videosMatch;
  const hadTrailingSlash = /\/$/.test(reqPath);

  if (!rawSeg) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let extraTeams = [];
  let creators = [];
  if (sbKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team,subscriber_count,last_youtube_sync,updated_at,channel_url,description&order=subscriber_count.desc.nullslast&limit=1000`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        extraTeams = [...new Set(rows.map(r => r.team).filter(Boolean))];
        // resolve first, then filter — team name must be the display name
        const maybe = resolveClub(rawSeg, extraTeams);
        if (maybe) creators = rows.filter(r => r.team === maybe);
      }
    } catch { /* resolve against the static list below */ }
  }

  const club = resolveClub(rawSeg, extraTeams);
  if (!club) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  const canonicalPath = clubPath(club, isVideos ? '/videos' : '');
  if (hadTrailingSlash || decodeURIComponent(rawSeg) !== clubSlug(club)) {
    const qs = event.rawQuery ? '?' + event.rawQuery : (event.queryStringParameters && Object.keys(event.queryStringParameters).length
      ? '?' + new URLSearchParams(event.queryStringParameters).toString()
      : '');
    return redirect301(canonicalPath + qs);
  }

  creators.sort((a, b) => (b.subscriber_count || 0) - (a.subscriber_count || 0));
  const url = SITE_URL + canonicalPath;
  const otherClubs = extraTeams.filter(t => t && t !== club && t !== 'Multi-Club / Other').sort();
  const dateModified = creators
    .map(c => c.last_youtube_sync || c.updated_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || undefined;

  if (isVideos) {
    const title = `Latest ${club} Videos | FanReactionsFC`;
    const description = `Recent ${club} reaction and watchalong videos from creators tracked on FanReactionsFC.`;
    const rows = creators.filter(c => c.name);
    const bodyHtml = `
      <div class="page-hero">
        <div class="container">
          <a href="${clubPath(club)}" class="page-hero-back">&larr; ${esc(club)}</a>
          <div class="page-hero-inner">
            <div class="page-hero-text">
              <div class="page-hero-eyebrow">Latest Videos</div>
              <h1 class="page-hero-title">${esc(club)} Videos</h1>
              <p class="page-hero-subtitle">${rows.length} creator${rows.length !== 1 ? 's' : ''} covering ${esc(club)}.</p>
            </div>
          </div>
        </div>
      </div>
      <div class="container section">
        <ul class="seo-list">
          ${rows.map(c => `<li><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a> — <a href="${clubPath(club)}">${esc(club)}</a></li>`).join('')}
        </ul>
      </div>
      ${ssrFooter(otherClubs)}`;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': siteGraph().concat([
        {
          '@type': 'CollectionPage',
          name: title,
          url,
          dateModified,
          isPartOf: { '@id': SITE_URL + '/#website' },
        },
      ]),
    };
    return htmlResponse(200, applyPage(html, { title, description, url, bodyHtml, jsonLd }));
  }

  const top = creators[0];
  const title = `${club} Football YouTubers | FanReactionsFC`;
  const description = creators.length
    ? `${creators.length} ${club} content creator${creators.length !== 1 ? 's' : ''} on YouTube — watchalongs, reactions, and fan commentary.${top ? ` The most-followed is ${top.name}${top.subscriber_count ? ` with ${formatNum(top.subscriber_count)} subscribers` : ''}.` : ''}`
    : `FanReactionsFC club page for ${club} YouTube creators — watchalongs, reactions, and fan commentary.`;

  const tableRows = creators.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a></td>
      <td>${c.subscriber_count ? formatNum(c.subscriber_count) : '—'}</td>
    </tr>`).join('');

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <a href="/discover" class="page-hero-back">&larr; All clubs</a>
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Football Club</div>
            <h1 class="page-hero-title">${esc(club)} Football YouTubers</h1>
            <p class="page-hero-subtitle">${esc(description)}</p>
            <div class="page-hero-meta">
              <span class="page-hero-tag">${creators.length} creator${creators.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      ${creators.length ? `
      <table class="seo-table">
        <thead><tr><th>#</th><th>Creator</th><th>Subscribers</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>` : `
      <div class="empty-state">
        <div class="es-title">No creators yet</div>
        <p>Know a great ${esc(club)} YouTuber? <a href="/submit">Suggest a creator</a>.</p>
      </div>`}
      <p class="seo-more-links"><a href="/rankings">See all ranked creators</a> · <a href="/discover">Discover more clubs</a></p>
    </div>
    ${ssrFooter(otherClubs)}`;

  const itemList = {
    '@type': 'ItemList',
    name: `${club} football YouTubers`,
    numberOfItems: creators.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: creators.slice(0, 50).map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/creators/${c.slug || slugify(c.name)}`,
      name: c.name,
    })),
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat([
      {
        '@type': 'SportsTeam',
        '@id': url + '#team',
        name: club,
        sport: 'Soccer',
        url,
      },
      Object.assign({
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: title,
        description,
        dateModified,
        about: { '@id': url + '#team' },
        isPartOf: { '@id': SITE_URL + '/#website' },
        mainEntity: itemList,
      }, dateModified ? { dateModified } : {}),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: 'Discover', item: SITE_URL + '/discover' },
          { '@type': 'ListItem', position: 3, name: club, item: url },
        ],
      },
    ]),
  };

  return htmlResponse(200, applyPage(html, { title, description, url, bodyHtml, jsonLd }));
};
