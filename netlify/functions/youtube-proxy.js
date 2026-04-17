// Netlify serverless function — proxies YouTube Data API requests
// so the API key stays server-side (set YOUTUBE_API_KEY in Netlify env vars).

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
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
