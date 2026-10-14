// Server-renders /tools — an index of the creator tools that already
// exist in the app (description generator at /tools/generator, Streamwall
// at /streamwall). /tools itself was an unknown path, so the catch-all
// not-found function returned HTTP 404. The SPA hydrates #app with the
// same hub (renderTools in js/app.js).

const fs = require('fs');
const path = require('path');

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

function eventPathname(event) {
  if (event && event.rawUrl) {
    try { return new URL(event.rawUrl).pathname; } catch {}
  }
  return (event && event.path) || '';
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
          <div class="footer-col">
            <h4>Tools</h4>
            <a href="/tools">All tools</a>
            <a href="/tools/generator">Description Generator</a>
            <a href="/streamwall">Streamwall</a>
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

function toolsBodyHtml(description) {
  return `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Free Tools</div>
            <h1 class="page-hero-title">Tools</h1>
            <p class="page-hero-subtitle">${esc(description)}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div class="home-promo-row">
        <a href="/tools/generator" class="home-promo-card">
          <span class="home-promo-icon">&#128221;</span>
          <div>
            <div class="home-promo-title">Description Generator</div>
            <p class="home-promo-sub">Write a YouTube title, description, and tags for a fan-reaction or watchalong video.</p>
          </div>
          <span class="home-promo-arrow">&rarr;</span>
        </a>
        <a href="/streamwall" class="home-promo-card">
          <span class="home-promo-icon"><img src="/img/icons/live-now.png" alt=""></span>
          <div>
            <div class="home-promo-title">Streamwall</div>
            <p class="home-promo-sub">Watch live football creators side by side — watchalongs, reactions, and match-day streams.</p>
          </div>
          <span class="home-promo-arrow">&rarr;</span>
        </a>
      </div>
    </div>
    ${ssrFooter()}`;
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/tools/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/tools', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const title = 'Tools | FanReactionsFC';
  const description = 'Free tools for football creators and fans: generate a YouTube description, or watch live creators on Streamwall.';
  const url = SITE_URL + '/tools';

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
        hasPart: [
          { '@type': 'WebPage', name: 'Description Generator', url: SITE_URL + '/tools/generator' },
          { '@type': 'WebPage', name: 'Streamwall', url: SITE_URL + '/streamwall' },
        ],
      },
    ]),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
    body: applyPage(html, { title, description, url, bodyHtml: toolsBodyHtml(description), jsonLd }),
  };
};
