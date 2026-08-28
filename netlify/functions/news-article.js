// Server-renders /news/:slug for real — unlike creator-og.js/club-og.js,
// which only swap meta tags and leave the actual body to the client SPA,
// this injects the full article title + body directly into #app, plus
// NewsArticle JSON-LD structured data. That distinction is the entire
// point for a page whose job is to be indexed: a non-JS crawler (or one
// that only renders a first pass before queuing JS execution) sees the
// real content immediately instead of a loading skeleton.
//
// The client SPA still hydrates normally afterward and replaces #app with
// its own render of the same article — no content differs between what's
// served here and what the client fetches, so this isn't cloaking, just a
// duplicate (server, then client) render of identical content.

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

const COVER_CONTENT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// Supabase Storage's public object URLs carry `X-Robots-Tag: none`, which
// makes X/Twitter refuse the image entirely — see article-cover.js for the
// proxy this maps onto. Strips the ?t= cache-buster admin.js appends too;
// crawlers should never see a cache-busted OG image URL. Returns null (not
// the raw Supabase URL) when the stored URL doesn't match the expected
// storage path, so the caller falls back to the site logo.
function firstPartyCoverUrl(coverImageUrl) {
  const m = coverImageUrl && coverImageUrl.match(/\/article-covers\/([^/]+\/[^/?]+)/);
  return m ? `${SITE_URL}/article-covers/${m[1]}` : null;
}

// Same paragraph-splitting convention as newsBodyHTML() in js/app.js — body
// is stored as plain text, not markdown/HTML. Same YouTube-embed regex too
// — keep both in sync.
const YOUTUBE_URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&]\S*)?$/;

function bodyHtml(body) {
  return body.split(/\n\s*\n/).map(p => {
    const trimmed = p.trim();
    const m = trimmed.match(YOUTUBE_URL_RE);
    if (m) return `<div class="news-video-embed"><iframe src="https://www.youtube.com/embed/${m[1]}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    return `<p>${esc(trimmed)}</p>`;
  }).join('');
}

exports.handler = async (event) => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const rawPath = event.path || '';
  const match = rawPath.match(/^\/news\/([^\/\?]+)\/?$/);
  const slug = match ? decodeURIComponent(match[1]) : '';

  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  // No slug means /news itself (the listing page) — fall through to the
  // default SPA shell; the listing has no single canonical entity to
  // server-render and isn't this function's job.
  if (!slug || !sbKey) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }

  let article = null;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_articles?select=title,dek,summary,body,cover_image_url,tags,related_team,published_at,updated_at,slug&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      article = rows[0] || null;
    }
  } catch { /* fall through — 404s render via the client SPA's own not-found state */ }

  if (!article) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }

  const title = `${article.title} | FanReactionsFC News`;
  const description = article.summary;
  const firstPartyCover = firstPartyCoverUrl(article.cover_image_url);
  const image = firstPartyCover || `${SITE_URL}/img/logo-wide.png`;
  const imageExt = (image.split('.').pop() || '').toLowerCase();
  const imageType = COVER_CONTENT_TYPES[imageExt] || 'image/png';
  const url = `${SITE_URL}/news/${article.slug}`;
  const publishedDate = article.published_at ? new Date(article.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.summary,
    image: [image],
    datePublished: article.published_at || undefined,
    dateModified: article.updated_at || article.published_at || undefined,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    publisher: {
      '@type': 'Organization',
      name: 'FanReactionsFC',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/img/logo-wide.png` },
    },
  };

  const articleHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">News${article.tags && article.tags.length ? ' &middot; ' + esc(article.tags[0]) : ''}</div>
            <h1 class="page-hero-title">${esc(article.title)}</h1>
            ${article.dek ? `<p class="page-hero-subtitle">${esc(article.dek)}</p>` : ''}
            <div class="news-article-meta">${esc(publishedDate)}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="container container-narrow section">
      ${article.cover_image_url ? `<img src="${esc(article.cover_image_url)}" alt="" class="news-article-cover">` : ''}
      <div class="news-article-body">${bodyHtml(article.body)}</div>
      ${article.related_team ? `
      <div class="news-article-related">
        <span>More on</span>
        <a href="/clubs/${encodeURIComponent(article.related_team)}">${esc(article.related_team)}</a>
      </div>` : ''}
      <div style="margin-top:32px"><a href="/news" class="btn btn-secondary">&larr; Back to News</a></div>
    </div>`;

  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:type"[^>]*>/, `<meta property="og:type" content="article">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  // Two separate, single-match replacements — one per pre-existing tag in
  // index.html — rather than one combined block, so there's no risk of an
  // inserted tag colliding with (and being mistaken for) the original one
  // it sits next to. Replacer is a function, not a string, so a literal $
  // in the title/image can't be misread as a String.replace backreference.
  const ogImageTags = [
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:secure_url" content="${esc(image)}">`,
    `<meta property="og:image:type" content="${imageType}">`,
    firstPartyCover ? '<meta property="og:image:width" content="1200">' : '',
    firstPartyCover ? '<meta property="og:image:height" content="630">' : '',
  ].filter(Boolean).join('\n  ');
  out = out.replace(/<meta property="og:image"[^>]*>/, () => ogImageTags);

  const twitterImageTags = [
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<meta name="twitter:image:alt" content="${esc(article.title)}">`,
  ].join('\n  ');
  out = out.replace(/<meta name="twitter:image"[^>]*>/, () => twitterImageTags);
  out = out.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${articleHtml}</main>`);
  out = out.replace('</head>', `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head>`);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
    body: out,
  };
};
