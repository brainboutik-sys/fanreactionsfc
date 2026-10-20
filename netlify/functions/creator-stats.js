// Server-renders /creators/:slug/stats — the monthly shareable YouTube
// stats card for a paid Verified creator. Subscribers, video count, and
// recent uploads come from columns the YouTube sync already writes
// (frfc_streamers.latest_video_* plus frfc_video_metrics). No analytics.
//
// Self-contained: do not require another function or js/lib module.
// isCurrentlyVerified / statsShareCopy / statsMonthLabel / verifiedPaymentUrl
// must stay in lockstep with js/lib/verified.js (see test/verified.test.js).
// The Stripe Payment Link is read from that file so the URL lives in one
// constant. This function passes the creator id only — never an email.

const fs = require('fs');
const path = require('path');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';
const DEFAULT_OG_IMAGE = SITE_URL + '/img/og-social-card.jpg';

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

function verifiedFormatCount(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function statsMonthLabel(iso, now) {
  const parsed = iso ? new Date(iso) : null;
  const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(typeof now === 'number' ? now : Date.now());
  return d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function statsShareCopy(input) {
  const name = (input && input.name) || 'This creator';
  const subs = verifiedFormatCount(input && input.subscriberCount);
  const videos = verifiedFormatCount(input && input.videoCount);
  const month = (input && input.monthLabel) || 'This month';
  const latest = input && input.latestTitle ? ` Latest upload: ${input.latestTitle}.` : '';
  return {
    title: `${name} — ${month} YouTube stats | FanReactionsFC`,
    description: `${name} has ${subs} subscribers and ${videos} videos on YouTube. ${month} snapshot from FanReactionsFC.${latest} YouTube totals only — no channel analytics.`,
  };
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
    } catch { /* try the next location */ }
  }
  return null;
}

function readVerifiedConfig() {
  const candidates = [
    path.join(process.cwd(), 'js/lib/verified.js'),
    path.join(__dirname, '..', '..', 'js/lib/verified.js'),
  ];
  for (const p of candidates) {
    try {
      const src = fs.readFileSync(p, 'utf8');
      const linkName = 'VERIFIED_STRIPE_PAYMENT_LINK';
      const priceName = 'VERIFIED_PRICE_LABEL';
      const link = src.match(new RegExp("const " + linkName + " = '([^']*)'"));
      const price = src.match(new RegExp("const " + priceName + " = '([^']*)'"));
      if (link && price) return { link: link[1], price: price[1] };
    } catch { /* try the next location */ }
  }
  return { link: '', price: 'CHF 4/month' };
}

// Mirror of js/lib/verified.js verifiedPaymentUrl. The base URL is read
// from that file. Do not pass an email from this server render.
function verifiedPaymentUrl(creatorId, email) {
  const base = readVerifiedConfig().link;
  if (!base) return '';
  const id = creatorId == null ? '' : String(creatorId).trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return base;
  const params = new URLSearchParams();
  params.set('client_reference_id', id);
  const mail = typeof email === 'string' ? email.trim() : '';
  if (mail) params.set('prefilled_email', mail);
  return base + '?' + params.toString();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeVideoId(id) {
  return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : '';
}

function eventPathname(event) {
  if (event.rawUrl) {
    try { return new URL(event.rawUrl).pathname; } catch { /* use event.path */ }
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

function applyPage(html, { title, description, url, image, bodyHtml, noindex }) {
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
  out = out.replace(/<link rel="canonical"[^>]*>/, () => `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, () => `<main id="app">${bodyHtml}</main>`);
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
          </div>
        </div>
      </div>
    </footer>`;
}

function notFoundHtml(html, reqPath) {
  const body = `
    <div class="container section-message">
      <div class="empty-state">
        <div class="es-title">Page not found</div>
        <p style="color:var(--text-dim);margin-bottom:16px">No stats card at <code>${esc(reqPath)}</code>.</p>
        <a href="/discover" class="btn btn-primary">Browse creators</a>
      </div>
    </div>
    ${ssrFooter()}`;
  return applyPage(html, {
    title: 'Page Not Found | FanReactionsFC',
    description: 'This page does not exist on FanReactionsFC.',
    url: SITE_URL + reqPath,
    bodyHtml: body,
    noindex: true,
  });
}

function getVerifiedCta(config, creatorId) {
  const url = verifiedPaymentUrl(creatorId);
  if (!url) return '';
  return `
    <a href="${esc(url)}" class="btn btn-accent" target="_blank" rel="nofollow noopener">Get Verified — ${esc(config.price)}</a>`;
}

const CREATOR_SELECT = 'id,name,slug,team,avatar_url,subscriber_count,video_count,latest_video_id,latest_video_title,latest_video_date,latest_video_views,latest_video_thumbnail,last_youtube_sync,is_verified,verified_until';
const CREATOR_SELECT_LEGACY = 'id,name,slug,team,avatar_url,subscriber_count,video_count,latest_video_id,latest_video_title,latest_video_date,latest_video_views,latest_video_thumbnail,last_youtube_sync';

async function fetchCreator(supabaseUrl, sbKey, slug) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const filter = `or=(slug.eq.${encodeURIComponent(slug)},slug.eq.${encodeURIComponent(slugify(slug))})&limit=1`;
  let res = await fetch(`${supabaseUrl}/rest/v1/frfc_streamers?select=${CREATOR_SELECT}&${filter}`, { headers });
  if (!res.ok) {
    res = await fetch(`${supabaseUrl}/rest/v1/frfc_streamers?select=${CREATOR_SELECT_LEGACY}&${filter}`, { headers });
  }
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function fetchRecentUploads(supabaseUrl, sbKey, creator) {
  const uploads = [];
  const latestId = safeVideoId(creator.latest_video_id);
  if (latestId) {
    uploads.push({
      videoId: latestId,
      title: creator.latest_video_title || 'Latest upload',
      views: creator.latest_video_views || 0,
      thumbnail: creator.latest_video_thumbnail || `https://i.ytimg.com/vi/${latestId}/hqdefault.jpg`,
    });
  }
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_video_metrics?select=video_id,views,recorded_at&creator_id=eq.${encodeURIComponent(creator.id)}&order=recorded_at.desc&limit=30`,
      { headers }
    );
    if (!res.ok) return uploads;
    const rows = await res.json();
    const seen = new Set(uploads.map(u => u.videoId));
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = safeVideoId(row.video_id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      uploads.push({
        videoId: id,
        title: 'Recent upload',
        views: row.views || 0,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      });
      if (uploads.length >= 5) break;
    }
  } catch { /* the latest synced upload above is enough */ }
  return uploads.slice(0, 5);
}

function uploadsHtml(uploads) {
  if (!uploads.length) {
    return '<p class="stats-empty">No recent upload is stored from the YouTube sync yet.</p>';
  }
  return `<div class="stats-uploads">${uploads.map(u => `
    <a class="stats-upload" href="https://www.youtube.com/watch?v=${esc(u.videoId)}" target="_blank" rel="noopener">
      <img src="${esc(u.thumbnail)}" alt="" width="160" height="90">
      <span class="stats-upload-body">
        <span class="stats-upload-title">${esc(u.title)}</span>
        <span class="stats-upload-meta">${u.views ? esc(verifiedFormatCount(u.views)) + ' views' : 'YouTube'}</span>
      </span>
    </a>`).join('')}</div>`;
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  const match = reqPath.match(/^\/creators\/([^\/]+)\/stats\/?$/);
  if (!match) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  let slug = match[1];
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  if (!slug) return htmlResponse(404, notFoundHtml(html, reqPath));
  if (reqPath.endsWith('/')) return redirect301('/creators/' + slug + '/stats');

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return htmlResponse(404, notFoundHtml(html, reqPath));

  let creator = null;
  try {
    creator = await fetchCreator(supabaseUrl, sbKey, slug);
  } catch { creator = null; }

  if (!creator) return htmlResponse(404, notFoundHtml(html, reqPath));

  const canonicalSlug = creator.slug || slugify(creator.name);
  if (slug !== canonicalSlug) return redirect301('/creators/' + canonicalSlug + '/stats');

  const url = `${SITE_URL}/creators/${canonicalSlug}/stats`;
  const config = readVerifiedConfig();
  const profileUrl = `/creators/${canonicalSlug}`;

  if (!isCurrentlyVerified(creator)) {
    const title = `Verified stats | FanReactionsFC`;
    const description = `Monthly YouTube stats cards are part of the Verified creator tier (${config.price}).`;
    const bodyHtml = `
      <div class="page-hero">
        <div class="container">
          <a href="${profileUrl}" class="page-hero-back">&larr; ${esc(creator.name)}</a>
          <div class="page-hero-inner">
            <div class="page-hero-text">
              <div class="page-hero-eyebrow">Verified</div>
              <h1 class="page-hero-title">Monthly stats card</h1>
              <p class="page-hero-subtitle">${esc(creator.name)} does not have a public stats card. Verified creators (${esc(config.price)}) get a shareable snapshot of their YouTube subscribers, video count, and recent uploads.</p>
            </div>
          </div>
        </div>
      </div>
      <div class="container section">
        <div class="stats-locked">
          ${getVerifiedCta(config, creator.id)}
          <p><a href="${profileUrl}">Back to ${esc(creator.name)}</a></p>
        </div>
      </div>
      ${ssrFooter()}`;
    return htmlResponse(200, applyPage(html, {
      title,
      description,
      url,
      image: DEFAULT_OG_IMAGE,
      bodyHtml,
      noindex: true,
    }));
  }

  const monthLabel = statsMonthLabel(creator.last_youtube_sync);
  const share = statsShareCopy({
    name: creator.name,
    subscriberCount: creator.subscriber_count,
    videoCount: creator.video_count,
    monthLabel,
    latestTitle: creator.latest_video_title || '',
  });
  const uploads = await fetchRecentUploads(supabaseUrl, sbKey, creator);
  const image = (uploads[0] && uploads[0].thumbnail) || creator.avatar_url || DEFAULT_OG_IMAGE;
  const club = creator.team && creator.team !== 'Multi-Club / Other' ? creator.team : '';

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <a href="${profileUrl}" class="page-hero-back">&larr; ${esc(creator.name)}</a>
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow"><span class="badge badge-verified">Verified</span> ${esc(monthLabel)}</div>
            <h1 class="page-hero-title">${esc(creator.name)} — YouTube stats</h1>
            <p class="page-hero-subtitle">${esc(share.description)}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <article class="stats-card" id="creator-stats-card">
        <div class="stats-card-top">
          ${creator.avatar_url ? `<img class="stats-avatar" src="${esc(creator.avatar_url)}" alt="">` : ''}
          <div>
            <div class="stats-kicker">FanReactionsFC · Verified · ${esc(monthLabel)}</div>
            <h2 class="stats-name">${esc(creator.name)}</h2>
            ${club ? `<a class="stats-club" href="${clubPath(club)}">${esc(club)}</a>` : ''}
          </div>
        </div>
        <div class="stats-metrics">
          <div class="stats-metric">
            <div class="stats-metric-label">Subscribers</div>
            <div class="stats-metric-num">${esc(verifiedFormatCount(creator.subscriber_count))}</div>
          </div>
          <div class="stats-metric">
            <div class="stats-metric-label">Videos</div>
            <div class="stats-metric-num">${esc(verifiedFormatCount(creator.video_count))}</div>
          </div>
        </div>
        <h3 class="stats-uploads-title">Recent uploads</h3>
        ${uploadsHtml(uploads)}
        <p class="stats-footnote">YouTube totals from the latest FanReactionsFC sync. Channel analytics are not included.</p>
      </article>
      <div class="stats-actions">
        <button type="button" class="btn btn-primary" id="statsShareBtn" data-share-url="${esc(url)}" data-share-title="${esc(share.title)}" data-share-text="${esc(share.description)}">Share stats card</button>
        <a href="${profileUrl}" class="btn btn-ghost">Creator profile</a>
      </div>
    </div>
    ${ssrFooter()}`;

  return htmlResponse(200, applyPage(html, {
    title: share.title,
    description: share.description,
    url,
    image,
    bodyHtml,
  }));
};

exports.isCurrentlyVerified = isCurrentlyVerified;
exports.statsShareCopy = statsShareCopy;
exports.statsMonthLabel = statsMonthLabel;
exports.readVerifiedConfig = readVerifiedConfig;
exports.verifiedPaymentUrl = verifiedPaymentUrl;
exports.esc = esc;
