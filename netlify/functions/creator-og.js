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

function aOrAn(word) {
  return /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
}

function clipMeta(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 155) return t;
  const cut = t.slice(0, 152);
  const sp = cut.lastIndexOf(' ');
  return ((sp > 80 ? cut.slice(0, sp) : cut).trim()) + '…';
}

// Stored YouTube description when the sync has one. Otherwise only facts
// already on the streamer row: club, content types, subscribers, videos, cadence.
function creatorBio(creator) {
  const stored = String(creator.description || '').replace(/\s+/g, ' ').trim();
  if (stored) return stored;
  const name = creator.name || 'This creator';
  const team = creator.team && creator.team !== 'Multi-Club / Other' ? creator.team : '';
  const types = Array.isArray(creator.content_types) ? creator.content_types.filter(Boolean).slice(0, 3) : [];
  const freq = creator.upload_frequency && creator.upload_frequency !== 'Unknown' && creator.upload_frequency !== 'Inactive'
    ? String(creator.upload_frequency).toLowerCase() : '';
  let sentence = team
    ? `${name} is ${aOrAn(team)} ${team} fan YouTuber`
    : `${name} is a football fan YouTuber`;
  if (types.length) sentence += ` covering ${types.map(t => String(t).toLowerCase()).join(', ')}`;
  sentence += '.';
  const stats = [];
  if (creator.subscriber_count) stats.push(`${formatNum(creator.subscriber_count)} subscribers`);
  if (creator.video_count) stats.push(`${Number(creator.video_count).toLocaleString('en-GB')} videos`);
  if (stats.length) {
    sentence += ` The channel has ${stats.join(' and ')}`;
    sentence += freq ? `, and uploads ${freq}.` : '.';
  } else if (freq) {
    sentence += ` The channel uploads ${freq}.`;
  }
  return sentence;
}

function safeVideoId(id) {
  const s = String(id || '');
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : '';
}

async function fetchTopVideos(supabaseUrl, sbKey, creator) {
  const byId = new Map();
  function add(video) {
    const id = safeVideoId(video && video.id);
    if (!id) return;
    const prev = byId.get(id);
    const views = Number(video.views) || 0;
    const title = String((video && video.title) || '').trim();
    const thumb = String((video && video.thumb) || '').trim();
    if (!prev) {
      byId.set(id, { id, views, title, thumb });
      return;
    }
    if (views > prev.views) prev.views = views;
    if (title && !prev.title) prev.title = title;
    if (thumb && !prev.thumb) prev.thumb = thumb;
  }
  add({
    id: creator.latest_video_id,
    title: creator.latest_video_title || '',
    views: creator.latest_video_views || 0,
    thumb: creator.latest_video_thumbnail || '',
  });
  if (creator.id && sbKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/frfc_video_metrics?select=video_id,views&creator_id=eq.${encodeURIComponent(creator.id)}&order=views.desc.nullslast&limit=40`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        (Array.isArray(rows) ? rows : []).forEach(row => add({ id: row.video_id, views: row.views || 0 }));
      }
    } catch { /* the latest synced upload above is enough */ }
  }
  return [...byId.values()]
    .sort((a, b) => b.views - a.views || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map(v => Object.assign({}, v, { thumb: v.thumb || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` }));
}

function topVideosHtml(videos) {
  if (!videos.length) return '';
  return `
        <div class="cp-section-card">
          <div class="cp-section-head"><span class="cp-section-label">Top videos</span></div>
          <ul class="seo-list">
            ${videos.map(v => {
              const label = v.title || (v.views ? `${formatNum(v.views)} views` : 'YouTube');
              const meta = v.title && v.views ? ` · ${formatNum(v.views)} views` : '';
              return `<li><a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(label)}</a>${esc(meta)}</li>`;
            }).join('')}
          </ul>
        </div>`;
}

// Paid Verified tier. Keep in sync with js/lib/verified.js.
function isCurrentlyVerified(row, now) {
  if (!row) return false;
  const flag = row.isVerified !== undefined ? row.isVerified : row.is_verified;
  if (flag !== true) return false;
  const until = row.verifiedUntil !== undefined ? row.verifiedUntil : row.verified_until;
  if (until == null || until === '') return true;
  const ts = new Date(until).getTime();
  const clock = typeof now === 'number' ? now : (now instanceof Date ? now.getTime() : Date.now());
  return Number.isFinite(ts) && ts > clock;
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
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': statusCode === 200
        ? 'public, s-maxage=300, must-revalidate'
        : 'public, s-maxage=60, must-revalidate',
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

function jsonForScript(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, function (ch) {
    if (ch === '<') return '\\u003c';
    if (ch === '\u2028') return '\\u2028';
    return '\\u2029';
  });
}

function applyPage(html, { title, description, url, image, bodyHtml, jsonLd, noindex }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, () => `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta name="twitter:title"[^>]*>/, () => `<meta name="twitter:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, () => `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, () => `<meta property="og:url" content="${esc(url)}">`);
  if (image) {
    out = out.replace(/<meta property="og:image"[^>]*>/, () => `<meta property="og:image" content="${esc(image)}">`);
    out = out.replace(/<meta name="twitter:image"[^>]*>/, () => `<meta name="twitter:image" content="${esc(image)}">`);
  }
  if (noindex) {
    out = out.replace('<head>', '<head>\n  <meta name="robots" content="noindex, follow">');
  }
  out = out.replace(/<link rel="canonical"[^>]*>/, () => (noindex
    ? '<link rel="canonical" id="canonicalLink" href="">'
    : `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`));
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, () => `<main id="app">${bodyHtml}</main>`);
  if (jsonLd) {
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`);
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
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
    const cols = 'id,name,slug,team,description,avatar_url,subscriber_count,video_count,upload_frequency,content_types,channel_url,last_youtube_sync,updated_at,is_verified,verified_until,latest_video_id,latest_video_title,latest_video_views,latest_video_thumbnail';
    const legacyCols = 'name,slug,team,description,avatar_url,subscriber_count,channel_url,last_youtube_sync,updated_at';
    const base = `${supabaseUrl}/rest/v1/frfc_streamers?select=`;
    let res = await fetch(
      `${base}${cols}&or=(slug.eq.${encodeURIComponent(slug)},slug.eq.${encodeURIComponent(slugify(slug))})&limit=1`,
      { headers }
    );
    if (!res.ok) {
      res = await fetch(
        `${base}${legacyCols}&or=(slug.eq.${encodeURIComponent(slug)},slug.eq.${encodeURIComponent(slugify(slug))})&limit=1`,
        { headers }
      );
    }
    if (res.ok) {
      const rows = await res.json();
      creator = rows[0] || null;
    }
    if (!creator) {
      let res2 = await fetch(
        `${base}${cols}&slug=eq.${encodeURIComponent(slug)}&limit=1`,
        { headers }
      );
      if (!res2.ok) {
        res2 = await fetch(
          `${base}${legacyCols}&slug=eq.${encodeURIComponent(slug)}&limit=1`,
          { headers }
        );
      }
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
  const bio = creatorBio(creator);
  const description = clipMeta(bio);
  const topVideos = await fetchTopVideos(supabaseUrl, sbKey, creator);
  const clubHub = creator.team
    ? `<p class="seo-more-links"><a href="${clubPath(creator.team)}">${creator.team !== 'Multi-Club / Other' ? `Best ${esc(creator.team)} fan YouTubers` : `${esc(creator.team)} creators`}</a></p>`
    : '';
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
            <h1 class="cp-hero-name">${esc(creator.name)}${isCurrentlyVerified(creator) ? ' <span class="badge badge-verified">Verified</span>' : ''}</h1>
            <p class="cp-hero-desc">${esc(bio)}</p>
            <div class="cp-hero-actions">
              ${creator.channel_url ? `<a href="${esc(creator.channel_url)}" rel="noopener" class="btn btn-accent" data-frfc-link="channel" data-frfc-creator="${esc(canonicalSlug)}" data-frfc-club="${esc(creator.team || '')}">Watch on YouTube</a>` : ''}
              ${creator.team && creator.team !== 'Multi-Club / Other' ? `<a href="${clubPath(creator.team)}" class="btn btn-on-dark">best ${esc(creator.team)} fan YouTubers</a>` : (creator.team ? `<a href="${clubPath(creator.team)}" class="btn btn-on-dark">More ${esc(creator.team)} creators</a>` : '')}
            </div>
          </div>
        </div>
      </div>
    </div>
    ${stats.length ? `<div class="cp-stats-bar"><div class="container"><div class="cp-stat-cards">${stats.join('')}</div></div></div>` : ''}
    <div class="container cp-body">
      <div class="cp-main">
        ${clubHub}
        ${topVideosHtml(topVideos)}
        ${similar.length ? `
        <div class="cp-section-card">
          <div class="cp-section-head">
            <span class="cp-section-label">More ${esc(creator.team)} Creators</span>
            <a href="${clubPath(creator.team)}" class="cp-section-link">${creator.team && creator.team !== 'Multi-Club / Other' ? `best ${esc(creator.team)} fan YouTubers` : 'View all &rarr;'}</a>
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
