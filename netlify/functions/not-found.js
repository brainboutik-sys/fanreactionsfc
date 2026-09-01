// Real HTTP 404 for unknown routes. The old SPA fallback served index.html
// as 200 with the homepage canonical — a soft 404. This function returns
// status 404, a unique H1, noindex, and no canonical pointing at /.

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
  if (event.rawUrl) {
    try { return new URL(event.rawUrl).pathname; } catch {}
  }
  return event.path || '';
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  const reqPath = eventPathname(event) || '/';
  const title = 'Page Not Found | FanReactionsFC';
  const description = 'This page does not exist on FanReactionsFC.';
  const bodyHtml = `
    <div class="container section-message">
      <div class="empty-state">
        <h1 class="es-title">Page not found</h1>
        <p style="color:var(--text-dim);margin-bottom:16px">No page at <code>${esc(reqPath)}</code>.</p>
        <p><a href="/" class="btn btn-primary">Back to Home</a> · <a href="/discover">Discover creators</a> · <a href="/rankings">Rankings</a></p>
      </div>
    </div>
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-col">
            <h4>Browse</h4>
            <a href="/discover">Discover Creators</a>
            <a href="/rankings">Rankings</a>
            <a href="/news">News</a>
            <a href="/become-a-creator">Become a Creator</a>
          </div>
          <div class="footer-col">
            <h4>Clubs</h4>
            <a href="/clubs/arsenal">Arsenal</a>
            <a href="/clubs/manchester-united">Manchester United</a>
            <a href="/clubs/liverpool">Liverpool</a>
            <a href="/clubs/chelsea">Chelsea</a>
          </div>
        </div>
      </div>
    </footer>`;

  if (!html) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
      body: `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="robots" content="noindex, follow"></head><body>${bodyHtml}</body></html>`,
    };
  }

  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(SITE_URL + reqPath)}">`);
  out = out.replace('<head>', '<head>\n  <meta name="robots" content="noindex, follow">');
  out = out.replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" id="canonicalLink" href="">');
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${bodyHtml}</main>`);

  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
    body: out,
  };
};
