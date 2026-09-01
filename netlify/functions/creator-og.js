// Server-renders /creators/:slug with unique title/canonical/H1, a visible
// profile body (club link, subscriber figure, related creators), and
// ProfilePage + Person/Organization JSON-LD. Trailing slashes 301.
// Unknown slugs are HTTP 404, not the homepage shell.

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
function clubSlug(team) { return CLUB_SLUG_OVERRIDES[team] || slugify(team); }
function clubPath(team) { return '/clubs/' + clubSlug(team); }

const MULTI_HOST = /aftv|unitedstand|that\'s football|thatsfootball|the united stand/i;

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

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': statusCode === 200 ? 'public, max-age=300, s-maxage=300' : 'public, max-age=60',
    },
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

function applyPage(html, { title, description, url, image, bodyHtml, jsonLd, noindex }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  if (image) {
    out = out.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${esc(image)}">`);
    out = out.replace(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${esc(image)}">`);
  }
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
  if (reqPath === '/creators' || reqPath === '/creators/') {
    return redirect301('/discover');
  }

  const match = reqPath.match(/^\/creators\/([^\/\?]+)\/?$/);
  if (!match) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  let slug = match[1];
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  if (!slug) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  if (reqPath.endsWith('/')) {
    return redirect301('/creators/' + slug);
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  let creator = null;
  let similar = [];
  let extraClubs = [];
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team,description,avatar_url,subscriber_count,channel_url,last_youtube_sync,updated_at&or=(slug.eq.${encodeURIComponent(slug)},slug.eq.${encodeURIComponent(slugify(slug))})&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      creator = rows[0] || null;
    }
    if (!creator) {
      const res2 = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team,description,avatar_url,subscriber_count,channel_url,last_youtube_sync,updated_at&slug=eq.${encodeURIComponent(slug)}&limit=1`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res2.ok) creator = (await res2.json())[0] || null;
    }
    if (creator && creator.team) {
      const sim = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=name,slug,team,subscriber_count&team=eq.${encodeURIComponent(creator.team)}&order=subscriber_count.desc.nullslast&limit=8`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (sim.ok) {
        similar = (await sim.json()).filter(c => (c.slug || slugify(c.name)) !== (creator.slug || slug));
      }
      extraClubs = [creator.team];
    }
  } catch { /* 404 below */ }

  if (!creator) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  const canonicalSlug = creator.slug || slugify(creator.name);
  if (slug !== canonicalSlug) {
    return redirect301('/creators/' + canonicalSlug);
  }

  const url = `${SITE_URL}/creators/${canonicalSlug}`;
  const subCount = creator.subscriber_count ? formatNum(creator.subscriber_count) : '';
  const title = `${creator.name} — Football creator on FanReactionsFC`;
  const description = creator.description
    ? creator.description.replace(/\s+/g, ' ').trim().slice(0, 155)
    : `Discover ${creator.name}, a ${creator.team} YouTube creator on FanReactionsFC${subCount ? ` · ${subCount} subscribers` : ''}.`;
  const image = creator.avatar_url || `${SITE_URL}/img/logo-wide.png`;
  const isOrg = MULTI_HOST.test(creator.name || '') || MULTI_HOST.test(canonicalSlug);

  const stats = [];
  if (creator.subscriber_count) stats.push(`<div class="cp-stat-card cp-stat-card--primary"><div class="cp-stat-label">Subscribers</div><div class="cp-stat-num">${esc(subCount)}</div></div>`);

  const bodyHtml = `
    <div class="cp-hero">
      <div class="container">
        <div class="cp-hero-inner">
          <div class="cp-hero-info">
            <div class="cp-hero-eyebrow">${creator.team ? `<a href="${clubPath(creator.team)}">${esc(creator.team)}</a>` : 'Football creator'}</div>
            <h1 class="cp-hero-name">${esc(creator.name)}</h1>
            <p class="cp-hero-desc">${esc(creator.description || `${creator.name} is a ${creator.team} football YouTuber on FanReactionsFC.`)}</p>
            <div class="cp-hero-actions">
              ${creator.channel_url ? `<a href="${esc(creator.channel_url)}" rel="noopener" class="btn btn-accent">Watch on YouTube</a>` : ''}
              ${creator.team ? `<a href="${clubPath(creator.team)}" class="btn btn-on-dark">More ${esc(creator.team)} creators</a>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
    ${stats.length ? `<div class="cp-stats-bar"><div class="container"><div class="cp-stat-cards">${stats.join('')}</div></div></div>` : ''}
    <div class="container cp-body">
      <div class="cp-main">
        ${similar.length ? `
        <div class="cp-section-card">
          <div class="cp-section-head">
            <span class="cp-section-label">More ${esc(creator.team)} Creators</span>
            <a href="${clubPath(creator.team)}" class="cp-section-link">View all &rarr;</a>
          </div>
          <ul class="seo-list">
            ${similar.map(s => `<li><a href="/creators/${esc(s.slug || slugify(s.name))}">${esc(s.name)}</a>${s.subscriber_count ? ` · ${formatNum(s.subscriber_count)} subscribers` : ''} — <a href="${clubPath(s.team)}">${esc(s.team)}</a></li>`).join('')}
          </ul>
        </div>` : ''}
        <p class="seo-more-links"><a href="/rankings">Best football fan YouTubers ranked</a> · <a href="/discover">Discover creators</a></p>
      </div>
    </div>
    ${ssrFooter(extraClubs.concat(['Arsenal','Man United','Liverpool','Chelsea','Tottenham']))}`;

  const entityType = isOrg ? 'Organization' : 'Person';
  const entity = {
    '@type': entityType,
    '@id': url + '#entity',
    name: creator.name,
    url,
  };
  if (creator.channel_url) entity.sameAs = [creator.channel_url];
  if (creator.team && creator.team !== 'Multi-Club / Other') {
    entity.affiliation = {
      '@type': 'SportsTeam',
      name: creator.team,
      sport: 'Soccer',
      url: SITE_URL + clubPath(creator.team),
    };
  }
  if (creator.subscriber_count) {
    entity.interactionStatistic = {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/SubscribeAction',
      userInteractionCount: Number(creator.subscriber_count),
    };
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat([
      {
        '@type': 'ProfilePage',
        '@id': url,
        url,
        name: title,
        description,
        dateModified: creator.last_youtube_sync || creator.updated_at || undefined,
        isPartOf: { '@id': SITE_URL + '/#website' },
        mainEntity: { '@id': url + '#entity' },
      },
      entity,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: 'Discover', item: SITE_URL + '/discover' },
          creator.team ? { '@type': 'ListItem', position: 3, name: creator.team, item: SITE_URL + clubPath(creator.team) } : null,
          { '@type': 'ListItem', position: creator.team ? 4 : 3, name: creator.name, item: url },
        ].filter(Boolean),
      },
    ]),
  };

  return htmlResponse(200, applyPage(html, { title, description, url, image, bodyHtml, jsonLd }));
};
