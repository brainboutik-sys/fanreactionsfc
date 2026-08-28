// Serves article cover images from this origin instead of directly from
// Supabase Storage. X/Twitter's crawler refuses to use link-card images
// whose response carries `X-Robots-Tag: none` — which every object served
// from Supabase's public storage CDN does, along with a `no-cache`
// Cache-Control and Cloudflare cookies. Fetching the bytes here and
// re-serving them under fanreactionsfc.com with clean headers fixes that
// without asking editors to re-upload anything: cover_image_url (stored on
// the article row) already embeds the storage path this function proxies.
//
// The on-page <img> (news-article-cover, news-card thumbnails) keeps using
// cover_image_url directly — browsers don't care about X-Robots-Tag. Only
// the OG/Twitter/JSON-LD tags injected by news-article.js point here.
//
// Route: /article-covers/:articleId/:filename -> this function (netlify.toml)

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

exports.handler = async (event) => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;

  const match = (event.path || '').match(/^\/article-covers\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)$/);
  if (!match) return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };
  const [, articleId, filename] = match;

  const upstreamUrl = `${supabaseUrl}/storage/v1/object/public/article-covers/${articleId}/${filename}`;
  let upstream;
  try {
    upstream = await fetch(upstreamUrl);
  } catch {
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'Failed to fetch cover image' };
  }
  if (!upstream.ok) return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };

  const ext = (filename.split('.').pop() || '').toLowerCase();
  const contentType = CONTENT_TYPES[ext] || upstream.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await upstream.arrayBuffer());

  // Deliberately only these two headers — never forward anything from the
  // upstream response (that's exactly how X-Robots-Tag/Set-Cookie would
  // leak through and reproduce the original bug).
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
};
