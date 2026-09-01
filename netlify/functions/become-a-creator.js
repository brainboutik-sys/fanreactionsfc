// Server-renders /become-a-creator — the long unique guide — so crawlers
// see the H1 and body without running JS. Keep copy aligned with
// renderBecomeCreator() in js/app.js.

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

function applyPage(html, { title, description, url, bodyHtml, jsonLd }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(url)}">`);
  out = out.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${bodyHtml}</main>`);
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
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
            <a href="/submit">Submit a Creator</a>
          </div>
          <div class="footer-col">
            <h4>Clubs</h4>
            <a href="/clubs/arsenal">Arsenal</a>
            <a href="/clubs/manchester-united">Manchester United</a>
            <a href="/clubs/liverpool">Liverpool</a>
            <a href="/clubs/chelsea">Chelsea</a>
            <a href="/discover">All clubs</a>
          </div>
        </div>
      </div>
    </footer>`;
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/become-a-creator/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/become-a-creator', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const title = 'How to Start a Football Live Streaming Channel on YouTube | FanReactionsFC';
  const description = 'Free step-by-step guide to setting up a professional football watchalong channel on YouTube using Prism Live Studio, Uno Overlays, and Canva.';
  const url = SITE_URL + '/become-a-creator';

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Free Guide</div>
            <h1 class="page-hero-title">How to Start a Football Live Streaming Channel on YouTube</h1>
            <p class="page-hero-subtitle">A free, step-by-step guide to setting up a professional YouTube watchalong channel with live scoreboards, overlays, and chat — using free tools.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div class="tutorial-body">
        <div class="tutorial-toc">
          <div class="tutorial-toc-title">In this guide</div>
          <ol>
            <li><a href="#tut-intro">Why start a football reaction channel?</a></li>
            <li><a href="#tut-tools">The three free streaming tools you need</a></li>
            <li><a href="#tut-prism">Setting up Prism Live Studio</a></li>
            <li><a href="#tut-overlays">Creating overlays with Canva</a></li>
            <li><a href="#tut-yuno">Scoreboard &amp; live chat overlay for YouTube</a></li>
            <li><a href="#tut-golive">Going live on YouTube</a></li>
            <li><a href="#tut-tips">Tips for growing your channel</a></li>
            <li><a href="#tut-faq">FAQ</a></li>
          </ol>
        </div>

        <p><a href="https://www.youtube.com/watch?v=RA7-Wtsk8Pg">Watch the companion walkthrough on YouTube</a></p>

        <h2 id="tut-intro">Why Start a Football Reaction Channel?</h2>
        <p>Football live streaming and watchalongs have become one of the most popular formats on YouTube. Fan reaction channels have built massive communities around live match coverage. If you're passionate about football and want to start your own YouTube live streaming channel, the great news is you can do it today with zero budget.</p>
        <p>All you need is a computer, a webcam (even your built-in one works), a microphone, and the three free tools outlined in this guide. Whether you support a Premier League, La Liga, Serie A, Bundesliga, or Ligue 1 club — there's an audience waiting for your football fan reactions and watchalong streams.</p>

        <h2 id="tut-tools">The Three Free YouTube Live Stream Tools You Need</h2>
        <h3>Prism Live Studio</h3>
        <p>A free streaming app that sits between StreamYard's simplicity and OBS's power. Available for Mac and Windows. Comes with built-in widgets for live chat, viewer count, and GIF stickers. <a href="https://prismlive.com/en_us/">Visit Prism Live Studio</a>.</p>
        <h3>Uno Overlays</h3>
        <p>Free real-time overlays purpose-built for sports streaming: live scoreboards, game clocks, lineup displays. <a href="https://overlays.uno/home">Visit Uno Overlays</a>.</p>
        <h3>Canva</h3>
        <p>Create transparent PNG overlays, thumbnails, and visual assets. The free tier is enough to start. <a href="https://www.canva.com/">Visit Canva</a>.</p>

        <h2 id="tut-prism">Setting Up Prism Live Studio for Football Streaming</h2>
        <p>Download Prism Live Studio from their website — it's available for both Mac and Windows. Once installed, add your camera source, a transparent PNG overlay, and the built-in Live Chat, Viewer Count, and GIF sticker widgets.</p>
        <h3>1. Add your camera source</h3>
        <p>Click the + button to add sources. Select your webcam, or use Prism Lens for a virtual green screen.</p>
        <h3>2. Add your overlay</h3>
        <p>Create a transparent PNG overlay in Canva with placeholders for chat, scoreboard, lineups, and social handles. In Prism, add it as an Image source.</p>
        <h3>3. Add built-in widgets</h3>
        <ul>
          <li><strong>Live Chat</strong> — pulls directly from your YouTube live chat</li>
          <li><strong>Viewer Count</strong> — shows how many people are watching</li>
          <li><strong>GIF Stickers</strong> — add an animated subscribe button or club crest</li>
        </ul>

        <h2 id="tut-overlays">Creating Stream Overlays with Canva</h2>
        <p>Open Canva and create a 1920×1080 design. Design your overlay with transparent areas where your webcam, chat, and scoreboard will appear. Export as PNG with transparency. Use your club's colours and keep the layout clean.</p>

        <h2 id="tut-yuno">Scoreboard &amp; Live Chat Overlay for YouTube Streams</h2>
        <p>Uno Overlays provides the two most critical elements for any football watchalong: the live scoreboard and the game clock. Search for "soccer" on Uno. Customise colours and crests, start the second half from 45:00, and control the overlay from your phone via the QR code. Add it to Prism as a Browser source.</p>

        <h2 id="tut-golive">Going Live on YouTube</h2>
        <p>Once your environment is set up, click Go Live in Prism and connect your YouTube channel. Chat populates automatically. Never rebroadcast match footage — watchalongs are about your reaction while viewers watch the match on their own screens.</p>

        <h2 id="tut-tips">Tips for Growing Your Channel</h2>
        <ul>
          <li>Be consistent — stream every match day</li>
          <li>Start 10–15 minutes before kick-off</li>
          <li>Engage the chat</li>
          <li>Prioritise audio quality</li>
          <li>Post reaction highlights as Shorts</li>
          <li>Cross-promote on X and football communities</li>
          <li><a href="/submit">Submit your channel to FanReactionsFC</a> so fans can discover you</li>
        </ul>

        <h2 id="tut-faq">Frequently Asked Questions</h2>
        <h3>Is it free to start a football live streaming channel on YouTube?</h3>
        <p>Yes. Prism Live Studio, Uno Overlays, and Canva all have free tiers that are more than sufficient.</p>
        <h3>What equipment do I need?</h3>
        <p>A mid-range laptop or desktop, a webcam, and a microphone. You do not need an expensive setup to start.</p>
        <h3>Can I use OBS instead of Prism?</h3>
        <p>Yes. Everything in this guide works with OBS. Prism is simpler for beginners because widgets are built in.</p>
        <h3>Can I show the football match on my live stream?</h3>
        <p>You should never rebroadcast match footage. Watchalongs are about your reaction and the chat.</p>
        <h3>How many viewers do I need to start?</h3>
        <p>Zero. Every channel starts from scratch.</p>

        <p><a href="/submit" class="btn btn-accent">Submit Your Channel</a> · <a href="/discover">Discover creators</a> · <a href="/rankings">See the rankings</a></p>
      </div>
    </div>
    ${ssrFooter()}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
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
      {
        '@type': 'Article',
        headline: 'How to Start a Football Live Streaming Channel on YouTube',
        description,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        publisher: { '@id': SITE_URL + '/#organization' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: 'Become a Creator', item: url },
        ],
      },
    ],
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=600',
    },
    body: applyPage(html, { title, description, url, bodyHtml, jsonLd }),
  };
};
