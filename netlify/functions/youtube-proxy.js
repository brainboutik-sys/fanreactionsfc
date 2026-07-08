// Netlify serverless function — proxies YouTube Data API requests
// so the API key stays server-side (set YOUTUBE_API_KEY in Netlify env vars).
//
// Access is restricted to requests originating from the site itself
// (Origin/Referer allowlist) so third parties can't burn the daily
// YouTube quota that the scheduled sync functions depend on. Note this
// stops browser-based and casual abuse, not a determined curl attacker —
// header spoofing is always possible; the quota itself is the backstop.

const ALLOWED_HOSTS = [
  'fanreactionsfc.com',
  'www.fanreactionsfc.com',
  'frfcgenerator.netlify.app', // production + deploy-preview URLs
  'localhost',
  '127.0.0.1',
];

function requestHost(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}

function isAllowed(event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const referer = event.headers.referer || event.headers.Referer || '';
  const host = requestHost(origin) || requestHost(referer);
  if (!host) return false;
  return ALLOWED_HOSTS.some(h => host === h || host.endsWith('--frfcgenerator.netlify.app'));
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Access-Control-Allow-Origin': isAllowed(event) ? (origin || 'https://fanreactionsfc.com') : 'https://fanreactionsfc.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!isAllowed(event)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'YOUTUBE_API_KEY not configured' }) };
  }

  const params = event.queryStringParameters || {};
  const endpoint = params.endpoint;
  delete params.endpoint;

  const allowed = ['channels', 'playlistItems', 'videos'];
  if (!endpoint || !allowed.includes(endpoint)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid endpoint' }) };
  }

  params.key = apiKey;
  const qs = new URLSearchParams(params).toString();
  const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message }) };
  }
};
