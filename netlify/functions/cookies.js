// Server-renders /cookies. The route used to rewrite to index.html, so
// crawlers received the homepage title, canonical, and "Loading..." shell.
// The SPA still hydrates #app via renderCookiePolicy() in js/app.js.
// Keep the body in sync with that function. Legal wording is for Vincent
// to review before it is treated as final.

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://fanreactionsfc.com';
const LAST_UPDATED = 'October 22, 2026';

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

function jsonForScript(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, function (ch) {
    if (ch === '<') return '\\u003c';
    if (ch === '\u2028') return '\\u2028';
    return '\\u2029';
  });
}

function applyPage(html, { title, description, url, bodyHtml, jsonLd }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, () => `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta name="twitter:title"[^>]*>/, () => `<meta name="twitter:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, () => `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, () => `<meta property="og:url" content="${esc(url)}">`);
  out = out.replace(/<link rel="canonical"[^>]*>/, () => `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, () => `<main id="app">${bodyHtml}</main>`);
  if (jsonLd) {
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`);
  }
  return out;
}

function ssrFooter() {
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-col">
            <h4>Browse</h4>
            <a href="/discover">Discover Creators</a>
            <a href="/rankings">Rankings</a>
            <a href="/news">News</a>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <a href="/privacy">Privacy Policy</a>
            <a href="/cookies">Cookie Policy</a>
            <a href="/contact">Contact</a>
          </div>
        </div>
      </div>
    </footer>`;
}

const BODY = `
    <p>This page lists the cookies and similar technologies (like localStorage) that FanReactionsFC uses. FanReactionsFC is a directory of football YouTube creators, hosted on Netlify, with accounts and data stored in Supabase.</p>

    <h2>Strictly necessary (always on)</h2>
    <table class="legal-table">
      <tr><th>Name</th><th>Purpose</th><th>Duration</th></tr>
      <tr><td>Supabase auth session</td><td>Keeps you signed in</td><td>Until you sign out / session expiry</td></tr>
      <tr><td><code>frfc_consent_analytics</code></td><td>Remembers your cookie choice</td><td>Persistent (until cleared)</td></tr>
      <tr><td><code>frfc_fp</code></td><td>Random anonymous ID to prevent repeat-vote abuse in Creator Battle — not linked to your identity</td><td>Persistent (until cleared)</td></tr>
      <tr><td><code>frfc_streamwall_streams</code> / <code>frfc_streamwall_goal_ids</code></td><td>Remembers which streams you added to your Streamwall</td><td>Persistent (until cleared)</td></tr>
    </table>
    <p>These are required for the site to function and are not subject to consent.</p>

    <h2>Optional — only set if you accept</h2>
    <table class="legal-table">
      <tr><th>Provider</th><th>Purpose</th><th>Control</th></tr>
      <tr><td>Google Tag Manager / Google Analytics (GA4) — <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a></td><td>Aggregate traffic and usage analytics</td><td>Only loads after you click "Accept analytics"; reject or withdraw anytime via the "Cookie preferences" link in the footer</td></tr>
    </table>

    <h2>Third-party embeds</h2>
    <p>Creator videos and live streams are embedded from YouTube (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a>) using its privacy-enhanced <code>youtube-nocookie.com</code> domain. Promotional and preview videos show a static thumbnail and only load the YouTube player after you click play, so no request reaches Google just from viewing those pages. The one exception is Streamwall: clicking "Open Streamwall" is itself the action that loads the video players you selected, since that page's whole purpose is watching those streams. Once a YouTube player loads, YouTube/Google may set cookies under Google's own policy.</p>
    <p>Looking up public channel information with the YouTube Data API happens on our servers and does not set a cookie in your browser. Paying for the Verified tier happens on a Stripe-hosted checkout page that opens in a new tab. Stripe may set cookies there under <a href="https://stripe.com/privacy" target="_blank" rel="noopener">its own policy</a>; no Stripe code runs on fanreactionsfc.com itself, so the site sets no payment cookies.</p>

    <h2>Managing cookies</h2>
    <p>You can change your analytics choice anytime via the "Cookie preferences" link in the site footer, or clear cookies/localStorage in your browser settings. See the <a href="/privacy">Privacy Policy</a> for how this relates to accounts stored in Supabase and hosting on Netlify.</p>

    <p class="legal-disclaimer">This page is provided for transparency and is not a substitute for legal advice.</p>
`;

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/cookies/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/cookies', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const title = 'Cookie Policy | FanReactionsFC';
  const description = 'The cookies and trackers FanReactionsFC uses, including Supabase auth, optional Google Analytics, and YouTube embeds. No Stripe payment cookies.';
  const url = SITE_URL + '/cookies';
  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Legal</div>
            <h1 class="page-hero-title">Cookie Policy</h1>
            <p class="page-hero-subtitle">Last updated ${LAST_UPDATED}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div class="legal-content">${BODY}</div>
    </div>
    ${ssrFooter()}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': url,
        url,
        name: title,
        description,
        isPartOf: { '@id': SITE_URL + '/#website' },
      },
    ],
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=3600, must-revalidate',
    },
    body: applyPage(html, { title, description, url, bodyHtml, jsonLd }),
  };
};
