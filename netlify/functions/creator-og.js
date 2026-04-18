// Server-renders /creators/:slug with per-creator OG / Twitter meta tags
// so social share previews show the creator's avatar + name + team
// instead of the generic site card.
//
// Strategy: intercept /creators/* via netlify.toml redirect, read index.html,
// replace the meta tags, and return the modified HTML. The SPA then hydrates
// as usual on the client.

const fs = require('fs');
const path = require('path');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';

let indexHtmlCache = null;
function readIndexHtml() {
  if (indexHtmlCache) return indexHtmlCache;
  // In Netlify Functions, the publish directory is bundled as a sibling asset.
  // Try a few probable locations and fall back to a minimal template.
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
  const match = rawPath.match(/\/creators\/([^\/\?]+)/);
  const slug = match ? decodeURIComponent(match[1]) : '';

  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  // If we can't resolve a creator, just return the default index.html — the
  // SPA will handle the 404 UX gracefully.
  if (!slug || !sbKey) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }

  let creator = null;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?select=name,team,description,avatar_url,subscriber_count,slug&slug=eq.${encodeURIComponent(slug)}&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      creator = rows[0] || null;
    }
  } catch { /* fall through to default */ }

  if (!creator) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }

  const title = `${creator.name} — Football creator on FanReactionsFC`;
  const subCount = creator.subscriber_count ? ` · ${formatNum(creator.subscriber_count)} subscribers` : '';
  const description = creator.description
    ? creator.description.slice(0, 200)
    : `Discover ${creator.name}, a ${creator.team} YouTube creator on FanReactionsFC${subCount}.`;
  const image = creator.avatar_url || `${SITE_URL}/img/logo.png`;
  const url = `${SITE_URL}/creators/${creator.slug || slug}`;

  // Replace head meta tags. We rewrite <title> and replace the OG/Twitter
  // blocks; the original tags remain fine fallbacks if substitution fails.
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  out = out.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${esc(image)}">`);

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
