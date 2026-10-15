// /account and /admin are signed-in SPA screens. Auth lives in the
// browser (Supabase), so the document has to load for a signed-in
// visitor — a 401 would block the same shell the SPA needs. Crawlers
// get noindex via X-Robots-Tag and meta robots, and the raw HTML is
// not the homepage shell. renderAccount() / renderAdmin() replace #app
// after the client session resolves.

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

function applyPage(html, { title, description, url, bodyHtml }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta name="twitter:title"[^>]*>/, () => `<meta name="twitter:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  if (!out.includes('name="robots"')) {
    out = out.replace('<head>', '<head>\n  <meta name="robots" content="noindex, nofollow">');
  }
  out = out.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${bodyHtml}</main>`);
  return out;
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/account/' || reqPath === '/admin/') {
    const bare = reqPath === '/account/' ? '/account' : '/admin';
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + bare, 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const isAdmin = reqPath === '/admin' || reqPath.startsWith('/admin/');
  const isAccount = reqPath === '/account';
  if (!isAdmin && !isAccount) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };
  }

  const title = isAdmin ? 'Admin | FanReactionsFC' : 'Account | FanReactionsFC';
  const description = isAdmin
    ? 'FanReactionsFC admin panel. Sign in required.'
    : 'Manage your FanReactionsFC account. Sign in required.';
  const url = SITE_URL + (isAdmin ? '/admin' : '/account');
  const heading = isAdmin ? 'Admin' : 'Account';
  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Account</div>
            <h1 class="page-hero-title">${heading}</h1>
            <p class="page-hero-subtitle">Sign in required.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section-message">
      <div class="empty-state">
        <div class="es-title">Sign in required</div>
        <p style="color:var(--text-dim)">This page is only for signed-in visitors. The app loads your ${isAdmin ? 'admin panel' : 'account'} once your session is available.</p>
      </div>
    </div>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    body: applyPage(html, { title, description, url, bodyHtml }),
  };
};
