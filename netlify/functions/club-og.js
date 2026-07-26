// Server-renders /clubs/:team with per-club OG / Twitter meta tags so social
// share previews show the club name + creator count instead of the generic
// site card. Same strategy as creator-og.js: intercept via netlify.toml
// redirect, read index.html, replace the meta tags, return modified HTML —
// the SPA still hydrates normally on the client.
//
// og:image is always the site logo, not the club crest: ~76% of crests are
// SVG (img/crests/*.svg), which most social platforms (Facebook, Twitter,
// Discord, LinkedIn) don't reliably render as link-preview images.

const fs = require('fs');
const path = require('path');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';

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

exports.handler = async (event) => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const rawPath = event.path || '';
  // /clubs/:team or /clubs/:team/videos — only rewrite meta for the club
  // page itself, not the videos sub-page (falls through to default HTML).
  const match = rawPath.match(/^\/clubs\/([^\/\?]+)\/?$/);
  const team = match ? decodeURIComponent(match[1]) : '';

  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  if (!team || !sbKey) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }

  let creators = [];
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?select=name,subscriber_count&team=eq.${encodeURIComponent(team)}&order=subscriber_count.desc`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (res.ok) creators = await res.json();
  } catch { /* fall through to default */ }

  if (!creators.length) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }

  const top = creators[0];
  const title = `${team} Football YouTubers | FanReactionsFC`;
  const description = `${creators.length} ${team} content creator${creators.length !== 1 ? 's' : ''} on YouTube — watchalongs, reactions, and fan commentary. The most-followed is ${top.name}${top.subscriber_count ? ` with ${formatNum(top.subscriber_count)} subscribers` : ''}.`;
  const image = `${SITE_URL}/img/logo-wide.png`;
  const url = `${SITE_URL}/clubs/${encodeURIComponent(team)}`;

  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  out = out.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${esc(image)}">`);
  out = out.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
    body: out,
  };
};

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
