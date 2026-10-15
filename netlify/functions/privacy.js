// Server-renders /privacy. The route used to rewrite to index.html, so
// crawlers received the homepage title, canonical, and "Loading..." shell.
// The SPA still hydrates #app via renderPrivacyPolicy() in js/app.js.
// Keep the body in sync with that function. Legal wording is for Vincent
// to review before it is treated as final.

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://fanreactionsfc.com';
const LAST_UPDATED = 'October 15, 2026';

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
  out = out.replace(/<meta name="twitter:title"[^>]*>/, () => `<meta name="twitter:title" content="${esc(title)}">`);
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
    <p>FanReactionsFC ("we", "us") operates fanreactionsfc.com, a directory and community site for football YouTube creators. This policy explains what personal data we collect, why, and the choices you have.</p>

    <h2>Who we are</h2>
    <p>FanReactionsFC.com is operated by Vincent Tervooren, who acts as the data controller for the personal data described in this policy. You can reach us at <a href="mailto:admin@fanreactionsfc.com">admin@fanreactionsfc.com</a> for any privacy question or request.</p>

    <h2>1. Data we collect</h2>
    <table class="legal-table">
      <tr><th>What</th><th>When</th><th>Why</th></tr>
      <tr><td>Email address, name, Google profile info</td><td>Signing in with Google</td><td>To create and secure your account</td></tr>
      <tr><td>Display name, avatar, favourite team</td><td>You edit your account profile</td><td>To personalise your experience</td></tr>
      <tr><td>Favourited creators</td><td>You tap the heart icon on a creator</td><td>To show your favourites across sessions</td></tr>
      <tr><td>Name, email, message subject/body</td><td>You submit the Contact form or report/claim a creator profile</td><td>To respond to your request</td></tr>
      <tr><td>Anonymous device identifier (random UUID, no personal info)</td><td>Automatically, stored in your browser</td><td>To prevent repeat voting abuse in Creator Battle</td></tr>
      <tr><td>Usage analytics (pages viewed, approximate location, device type)</td><td>Only if you accept analytics cookies</td><td>To understand traffic and improve the site</td></tr>
      <tr><td>Email address, and a record of when/how you opted in</td><td>Only if you tick the newsletter opt-in box on the News page, an article, the site footer, or your Account settings, and confirm via email</td><td>To send you the optional FanReactionsFC email newsletter</td></tr>
    </table>
    <p>We do not collect payment information, and we do not use Stripe or any other payment processor. We do not collect government IDs or sensitive categories of data (health, religion, etc.). Public YouTube data — channel names, subscriber counts, and video links — is read with the YouTube Data API to build the directory. That is public creator information, not information about you as a visitor.</p>

    <h2>2. Legal basis for processing</h2>
    <p>We process account and profile data under <strong>contract</strong> (to provide the service you signed up for), contact/report data under <strong>legitimate interest</strong> (responding to inquiries), and both analytics cookies and the email newsletter under your <strong>consent</strong>. Newsletter consent is separate from cookie consent: it requires its own explicit, unticked opt-in and a confirmation email (double opt-in) before we send anything, and you can withdraw either consent at any time — analytics via the cookie banner or the "Cookie preferences" link in the footer, the newsletter via the unsubscribe link in every email or the <a href="/newsletter/preferences">newsletter preferences</a> page.</p>

    <h2>3. Who we share data with (subprocessors)</h2>
    <table class="legal-table">
      <tr><th>Provider</th><th>Purpose</th></tr>
      <tr><td>Supabase</td><td>Database, authentication, file storage</td></tr>
      <tr><td>Netlify</td><td>Website hosting, serverless functions</td></tr>
      <tr><td>Resend</td><td>Transactional email (notifications you trigger, e.g. contact replies)</td></tr>
      <tr><td>MailerLite</td><td>Newsletter delivery and subscriber management (only if you opt in) — see <a href="https://www.mailerlite.com/legal/privacy-policy" target="_blank" rel="noopener">MailerLite's Privacy Policy</a></td></tr>
      <tr><td>Google (Sign-In, YouTube embeds, YouTube Data API, Tag Manager/Analytics)</td><td>Authentication, video embeds, public channel data, analytics (analytics only with consent)</td></tr>
      <tr><td>football-data.org</td><td>Match fixture data used to detect live streams</td></tr>
    </table>
    <p>We do not sell your personal data. MailerLite acts as our data processor for the newsletter under a signed data processing agreement.</p>

    <h2>4. International transfers</h2>
    <p>Some of the providers above (Google, Resend, MailerLite, Supabase's underlying infrastructure) may process data outside your country, including the United States. Where required, transfers rely on those providers' standard contractual clauses or equivalent safeguards.</p>

    <h2>5. Retention</h2>
    <p>Account data (profile, favourites, votes, community posts) is retained while your account is active and deleted when you delete your account (Section 7). Contact form messages and creator reports are automatically deleted 12 months after submission. Newsletter subscriber records are kept while your subscription is active; if you unsubscribe, we delete your email from our subscriber list within 30 days, keeping only a minimal suppression record so we don't accidentally email you again. Records of newsletter consent (what you agreed to and when) are kept for 3 years to demonstrate compliance, then deleted or anonymised. You can request earlier deletion at any time — see Section 10.</p>

    <h2>6. Cookies</h2>
    <p>See our <a href="/cookies">Cookie Policy</a> for the full list of cookies and trackers.</p>

    <h2>7. Your rights</h2>
    <p>Depending on your location (including under the EU/UK GDPR), you have the right to access, correct, export, or delete your personal data, and to object to or restrict certain processing. You can:</p>
    <ul>
      <li>Update your profile directly from your <a href="/account">Account</a> page</li>
      <li>Request a copy or deletion of your data by contacting us (Section 10)</li>
      <li>Withdraw analytics consent at any time via the cookie banner</li>
      <li>Unsubscribe from the newsletter at any time via the link in any newsletter email, or the <a href="/newsletter/preferences">newsletter preferences</a> page — no login required</li>
    </ul>

    <h2>8. California residents (CCPA/CPRA)</h2>
    <p>The only "sharing" of personal information we do, as CCPA/CPRA defines it, is through analytics cookies (Google Analytics) — and only if you've consented to them. You can opt out at any time, with no account required, via the <strong>"Do Not Sell or Share My Info"</strong> link in the site footer; this immediately withdraws analytics consent. California residents also have the rights described in Section 7 (access, deletion, correction) regardless of this section.</p>

    <h2>9. Children</h2>
    <p>FanReactionsFC is not directed at children under 16, and we do not knowingly collect their data.</p>

    <h2>10. Contact</h2>
    <p>Questions or data requests: <a href="mailto:admin@fanreactionsfc.com">admin@fanreactionsfc.com</a> or via our <a href="/contact">Contact form</a>.</p>

    <p class="legal-disclaimer">This page is provided for transparency and is not a substitute for legal advice.</p>
`;

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/privacy/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/privacy', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const title = 'Privacy Policy | FanReactionsFC';
  const description = 'How FanReactionsFC collects, uses, and protects personal data. Supabase, Netlify, YouTube embeds and the YouTube Data API. No Stripe.';
  const url = SITE_URL + '/privacy';
  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Legal</div>
            <h1 class="page-hero-title">Privacy Policy</h1>
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
