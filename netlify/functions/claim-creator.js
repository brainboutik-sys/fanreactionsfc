// Creator claim endpoint.
// POST /claim-creator  (Authorization: Bearer <supabase_access_token>)
// Body: { creatorId: string }
//
// Flow:
//  1. Verify the caller's Supabase JWT to get their user ID.
//  2. Fetch the creator's YouTube channel URL from frfc_streamers.
//  3. Fetch the channel description via YouTube Data API.
//  4. Check that the description contains the verification code
//     FRFC-<first 8 uppercase hex chars of the user UUID without dashes>.
//  5. PATCH claimed_by on the row using the service role key.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });
  if (!ytKey) return res(500, { error: 'Server misconfigured: YOUTUBE_API_KEY missing' });

  // 1. Authenticate caller via Bearer token.
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res(401, { error: 'Missing auth token' });

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res(401, { error: 'Invalid or expired token' });
  const { id: userId } = await userRes.json();
  if (!userId) return res(401, { error: 'Could not identify user' });

  // 2. Get creator record.
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON body' }); }
  const { creatorId } = body;
  if (!creatorId) return res(400, { error: 'creatorId is required' });

  const creatorRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creatorId)}&select=id,channel_url,claimed_by`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  const creators = await creatorRes.json();
  if (!creators.length) return res(404, { error: 'Creator not found' });
  const creator = creators[0];
  if (creator.claimed_by) {
    if (creator.claimed_by === userId) return res(200, { ok: true, message: 'Already claimed by you' });
    return res(409, { error: 'This profile is already claimed by another account' });
  }

  // 3. Resolve channel ID from channel_url.
  const channelUrl = creator.channel_url || '';
  let channelId = null;
  const handleMatch = channelUrl.match(/@([\w-]+)/);
  const idMatch = channelUrl.match(/\/channel\/(UC[\w-]+)/);
  if (idMatch) {
    channelId = idMatch[1];
  } else if (handleMatch) {
    const srchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handleMatch[1])}&key=${ytKey}`
    );
    const srchData = await srchRes.json();
    channelId = srchData.items?.[0]?.id || null;
  }
  if (!channelId) return res(422, { error: 'Could not resolve YouTube channel. Make sure the channel URL is correct.' });

  // 4. Fetch channel description.
  const chRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}&key=${ytKey}`
  );
  const chData = await chRes.json();
  const description = chData.items?.[0]?.snippet?.description || '';

  // 5. Check for verification code.
  const code = 'FRFC-' + userId.replace(/-/g, '').slice(0, 8).toUpperCase();
  if (!description.includes(code)) {
    return res(403, { error: `Verification code not found. Add "${code}" to your YouTube channel description and try again.` });
  }

  // 6. Claim the profile.
  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creatorId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: sbKey, Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ claimed_by: userId }),
    }
  );
  if (!patchRes.ok) return res(502, { error: 'Database update failed' });
  return res(200, { ok: true, message: 'Channel verified and profile claimed' });
};

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
