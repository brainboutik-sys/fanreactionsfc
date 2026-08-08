// Dynamic sitemap.xml — built from frfc_streamers and frfc_articles so
// Google indexes every creator, club, and news page, not just the homepage.
//
// Served at /sitemap.xml via netlify.toml redirect.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  };

  if (!sbKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'SUPABASE_SERVICE_ROLE_KEY not set' };
  }

  // Fetch all creators for their slugs and teams, and every published article.
  const [creatorsRes, articlesRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/frfc_streamers?select=slug,name,team,last_youtube_sync`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }),
    fetch(`${supabaseUrl}/rest/v1/frfc_articles?select=slug,published_at,updated_at&status=eq.published`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }),
  ]);
  if (!creatorsRes.ok) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'supabase select failed' };
  }
  const creators = await creatorsRes.json();
  const articles = articlesRes.ok ? await articlesRes.json() : [];

  const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const now = new Date().toISOString().split('T')[0];

  // Static routes that always exist.
  const staticUrls = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/discover', priority: '0.9', changefreq: 'daily' },
    { loc: '/rankings', priority: '0.8', changefreq: 'daily' },
    { loc: '/news', priority: '0.8', changefreq: 'daily' },
    { loc: '/tools/generator', priority: '0.5', changefreq: 'monthly' },
    { loc: '/submit', priority: '0.3', changefreq: 'monthly' },
  ];

  const clubs = [...new Set(creators.map(c => c.team).filter(t => t && t !== 'Multi-Club / Other'))];

  const urlEntries = [
    ...staticUrls.map(u => ({ loc: SITE_URL + u.loc, priority: u.priority, changefreq: u.changefreq, lastmod: now })),
    ...creators.map(c => ({
      loc: `${SITE_URL}/creators/${c.slug || slugify(c.name)}`,
      priority: '0.7',
      changefreq: 'weekly',
      lastmod: (c.last_youtube_sync || '').split('T')[0] || now,
    })),
    ...clubs.map(team => ({
      loc: `${SITE_URL}/clubs/${encodeURIComponent(team)}`,
      priority: '0.6',
      changefreq: 'weekly',
      lastmod: now,
    })),
    ...articles.map(a => ({
      loc: `${SITE_URL}/news/${a.slug}`,
      priority: '0.6',
      changefreq: 'weekly',
      lastmod: (a.updated_at || a.published_at || '').split('T')[0] || now,
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return { statusCode: 200, headers, body: xml };
};
