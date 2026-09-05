// Public read-only feed of the latest published articles, shaped for
// building MailerLite newsletter campaigns (P0.7 of the MailerLite plan).
// GET /newsletter-articles?limit=10  (limit optional, default 10, max 50)
//
// Stable JSON shape — one object per article:
//   { title, dek, summary, slug, url, cover, published_at, tags }
// `cover` is the first-party /article-covers/... proxy URL (or null), same
// mapping as firstPartyCoverUrl() in netlify/functions/news-article.js and
// js/app.js — never the raw Supabase Storage URL, which X/Twitter's
// crawler refuses over the X-Robots-Tag: none header Supabase sends.
//
// Reads with the service-role key (server-side only, same pattern as every
// other read-only prerender function in this repo) but only ever returns
// published rows — drafts are excluded by the query itself, not by RLS.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function firstPartyCoverUrl(coverImageUrl) {
  const m = coverImageUrl && coverImageUrl.match(/\/article-covers\/([^/]+\/[^/?]+)/);
  return m ? `${SITE_URL}/article-covers/${m[1]}` : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const rawLimit = parseInt((event.queryStringParameters || {}).limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  let articles = [];
  try {
    const sbRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_articles?select=slug,title,dek,summary,cover_image_url,tags,published_at&status=eq.published&order=published_at.desc.nullslast&limit=${limit}`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (!sbRes.ok) return res(502, { error: 'Could not load articles' });
    articles = await sbRes.json();
  } catch (e) {
    console.error('newsletter-articles: fetch failed', e);
    return res(502, { error: 'Could not load articles' });
  }

  const body = articles.map(a => ({
    title: a.title,
    dek: a.dek || null,
    summary: a.summary || null,
    slug: a.slug,
    url: `${SITE_URL}/news/${a.slug}`,
    cover: firstPartyCoverUrl(a.cover_image_url),
    published_at: a.published_at,
    tags: a.tags || [],
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
    body: JSON.stringify(body),
  };
};

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
