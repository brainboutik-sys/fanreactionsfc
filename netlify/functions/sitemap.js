// Dynamic sitemap.xml — built from frfc_streamers and frfc_articles so
// Google indexes every creator, club, and news page, not just the homepage.
//
// lastmod is only emitted when we have a real date from the database.
// Static URLs omit lastmod rather than stamping "today" on every row.
// Creator URLs use last_youtube_sync, then updated_at. Club URLs use the
// latest of those creator stamps for that club, or a related article
// date when that is newer. A missing date is omitted, never invented.
//
// This handler always returns 200 with a valid urlset. A Supabase blip
// must not 500 the endpoint (it did once). Served at /sitemap.xml.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';

const CLUB_SLUG_OVERRIDES = {
  'Man United': 'manchester-united',
  'Man City': 'manchester-city',
  'Nottm Forest': 'nottingham-forest',
  'Oxford Utd': 'oxford-united',
  'Sheffield Utd': 'sheffield-united',
  'Sheffield Wed': 'sheffield-wednesday',
  'West Brom': 'west-bromwich-albion',
  'Multi-Club / Other': 'multi-club',
};

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function clubSlug(team) { return CLUB_SLUG_OVERRIDES[team] || slugify(team); }

// Paid Verified tier. Keep in sync with js/lib/verified.js.
function isCurrentlyVerified(row, now) {
  if (!row) return false;
  const flag = row.isVerified !== undefined ? row.isVerified : row.is_verified;
  if (flag !== true) return false;
  const until = row.verifiedUntil !== undefined ? row.verifiedUntil : row.verified_until;
  if (until == null || until === '') return true;
  const ts = new Date(until).getTime();
  const clock = typeof now === 'number' ? now : (now instanceof Date ? now.getTime() : Date.now());
  return Number.isFinite(ts) && ts > clock;
}

function ymd(iso) {
  if (!iso) return '';
  const d = String(iso).split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

// Prefer the YouTube sync stamp. updated_at is only used when sync is empty.
function creatorLastmod(row) {
  if (!row) return '';
  return ymd(row.last_youtube_sync || row.updated_at);
}

function articleLastmod(row) {
  if (!row) return '';
  return ymd(row.updated_at || row.published_at);
}

function later(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a > b ? a : b;
}

// Most recent creator stamp or article date for each club slug we might emit.
// Clubs with neither are absent from the map so lastmod is omitted.
function clubLastmods(creators, articles) {
  const stamps = {};
  function bump(team, stamp) {
    if (!team || team === 'Multi-Club / Other' || !stamp) return;
    const slug = clubSlug(team);
    if (!slug) return;
    stamps[slug] = later(stamps[slug], stamp);
  }
  for (const c of creators || []) bump(c.team, creatorLastmod(c));
  for (const a of articles || []) bump(a.related_team, articleLastmod(a));
  return stamps;
}

function urlXml(u) {
  return `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `
    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`;
}

function wrap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(urlXml).join('\n')}
</urlset>`;
}

const STATIC_URLS = [
  { loc: SITE_URL + '/', priority: '1.0', changefreq: 'daily' },
  { loc: SITE_URL + '/discover', priority: '0.9', changefreq: 'daily' },
  { loc: SITE_URL + '/rankings', priority: '0.8', changefreq: 'daily' },
  { loc: SITE_URL + '/news', priority: '0.8', changefreq: 'daily' },
  { loc: SITE_URL + '/become-a-creator', priority: '0.6', changefreq: 'monthly' },
  { loc: SITE_URL + '/tools', priority: '0.5', changefreq: 'monthly' },
  { loc: SITE_URL + '/tools/generator', priority: '0.5', changefreq: 'monthly' },
  { loc: SITE_URL + '/submit', priority: '0.3', changefreq: 'monthly' },
];

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  };

  const fallback = () => ({ statusCode: 200, headers, body: wrap(STATIC_URLS) });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return fallback();

  let creators = [];
  let articles = [];
  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  try {
    let articlesRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_articles?select=slug,published_at,updated_at,related_team&status=eq.published`,
      { headers: sbHeaders }
    );
    if (!articlesRes.ok) {
      articlesRes = await fetch(
        `${supabaseUrl}/rest/v1/frfc_articles?select=slug,published_at,updated_at&status=eq.published`,
        { headers: sbHeaders }
      );
    }
    if (articlesRes.ok) {
      const rows = await articlesRes.json();
      articles = Array.isArray(rows) ? rows : [];
    }
    // Retry without the Verified columns so a deploy before the migration
    // still lists every creator and club.
    let creatorsRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?select=slug,name,team,last_youtube_sync,updated_at,is_verified,verified_until`,
      { headers: sbHeaders }
    );
    if (!creatorsRes.ok) {
      creatorsRes = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?select=slug,name,team,last_youtube_sync,updated_at`,
        { headers: sbHeaders }
      );
    }
    if (creatorsRes.ok) {
      const rows = await creatorsRes.json();
      creators = Array.isArray(rows) ? rows : [];
    }
  } catch {
    return fallback();
  }

  const clubs = [...new Set(creators.map(c => c.team).filter(t => t && t !== 'Multi-Club / Other'))];
  const clubStamps = clubLastmods(creators, articles);

  const urlEntries = [
    ...STATIC_URLS,
    ...creators.map(c => ({
      loc: `${SITE_URL}/creators/${c.slug || slugify(c.name)}`,
      priority: '0.7',
      changefreq: 'weekly',
      lastmod: creatorLastmod(c) || undefined,
    })),
    ...creators.filter(c => isCurrentlyVerified(c)).map(c => ({
      loc: `${SITE_URL}/creators/${c.slug || slugify(c.name)}/stats`,
      priority: '0.4',
      changefreq: 'monthly',
      lastmod: creatorLastmod(c) || undefined,
    })),
    ...clubs.map(team => ({
      loc: `${SITE_URL}/clubs/${clubSlug(team)}`,
      priority: '0.6',
      changefreq: 'weekly',
      lastmod: clubStamps[clubSlug(team)] || undefined,
    })),
    ...articles.map(a => ({
      loc: `${SITE_URL}/news/${a.slug}`,
      priority: '0.6',
      changefreq: 'weekly',
      lastmod: articleLastmod(a) || undefined,
    })),
  ];

  return { statusCode: 200, headers, body: wrap(urlEntries) };
};
