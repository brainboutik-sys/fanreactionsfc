// Server-renders /submit so the response is the creator submission form,
// not the homepage shell. /submit used to rewrite to index.html, whose
// visible H1, title, and canonical are the homepage — crawlers and the
// first paint never saw the form that renderSubmit() in js/app.js draws
// after hydration. This snapshot uses the same fields; the SPA replaces
// #app with the interactive form (YouTube lookup + insert) on load.
//
// Team lists mirror js/data/teams.js (TEAM_TO_LEAGUE). Functions cannot
// share modules, so the lists are copied here for the static snapshot.

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://fanreactionsfc.com';

const TEAMS_BY_LEAGUE = {
  'Premier League': ['Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Chelsea','Coventry','Crystal Palace','Everton','Fulham','Hull City','Ipswich','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham'],
  'Championship': ['Birmingham','Blackburn','Bristol City','Burnley','Charlton','Derby','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','West Ham','Wolves','Wrexham'],
  'La Liga': ['Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes'],
  'Serie A': ['Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como'],
  'Bundesliga': ['Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli'],
  'Ligue 1': ['PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne'],
};

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

function teamSelectHtml() {
  const leagueOrder = ['Premier League', 'Championship', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
  let html = '<option value="">Select team...</option>';
  leagueOrder.forEach(league => {
    const teams = (TEAMS_BY_LEAGUE[league] || []).slice().sort();
    html += `<optgroup label="${esc(league)}">` + teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('') + '</optgroup>';
  });
  html += '<optgroup label="Other"><option value="Multi-Club / Other">Multi-Club / Other</option></optgroup>';
  return html;
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

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/submit/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/submit', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const title = 'Submit a Creator | FanReactionsFC';
  const description = 'Know a great football YouTuber? Suggest them for the FanReactionsFC database — submissions are reviewed before being published.';
  const url = SITE_URL + '/submit';

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Community</div>
            <h1 class="page-hero-title">Submit a Creator</h1>
            <p class="page-hero-subtitle">Know a great football YouTuber? Suggest them for the database. Submissions are reviewed before being published.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container container-narrow section">
      <form id="submitForm" action="/submit" method="get" onsubmit="event.preventDefault(); return false;">
        <div class="sc-card" style="margin-bottom:0">
          <div class="sc-head"><div class="sc-head-title">Creator details</div></div>
          <div class="sc-body">
            <div style="margin-bottom:14px">
              <label class="field-label" for="sub_channel">YouTube Channel URL</label>
              <input type="text" id="sub_channel" name="channel" class="admin-form-input" placeholder="e.g. https://www.youtube.com/@AFTVmedia" oninput="checkDuplicateChannel(this.value)">
              <div id="channelDupeWarn" class="dupe-warn"></div>
              <div style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:4px">We'll fetch the channel name automatically.</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div>
                <label class="field-label" for="sub_league">League</label>
                <select id="sub_league" name="league" class="admin-form-select" onchange="document.getElementById('sub_team').innerHTML = submitTeamOpts(this.value)">
                  <option>Premier League</option><option>Championship</option><option>La Liga</option><option>Serie A</option><option>Bundesliga</option><option>Ligue 1</option>
                </select>
              </div>
              <div>
                <label class="field-label" for="sub_team">Team</label>
                <select id="sub_team" name="team" class="admin-form-select">${teamSelectHtml()}</select>
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-block btn-lg" onclick="submitCreator()" style="margin-top:8px">Submit for Review</button>
            <div id="submitMsg" style="text-align:center;margin-top:12px;font-size:var(--fs-base)"></div>
          </div>
        </div>
      </form>
    </div>
    ${ssrFooter()}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat([
      {
        '@type': 'WebPage',
        '@id': url,
        url,
        name: title,
        description,
        isPartOf: { '@id': SITE_URL + '/#website' },
      },
    ]),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
    body: applyPage(html, { title, description, url, bodyHtml, jsonLd }),
  };
};
