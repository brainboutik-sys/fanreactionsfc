// Netlify scheduled function — runs every 5 minutes and triggers a
// live-check for creators tied to any fixture kicking off soon, instead of
// blanket-polling all creators on a fixed time-of-day window.
//
// "5 minutes before kickoff": with a 5-minute cron granularity, we fire the
// first run whose window catches kickoff - 5min. We look forward 7 minutes
// (not exactly 5) as a safety margin against cron jitter and kickoffs that
// don't land on a 5-minute boundary (e.g. 15:07 TV slots) — this fires
// somewhere between ~2 and ~7 minutes before kickoff, which is as tight as
// a 5-minute scheduler can reasonably guarantee. frfc_fixtures.trigger_sent_at
// ensures each fixture only fires once.
//
// Unlike the old live-check-peak.js (removed), this does a REAL live-status
// discovery per matched creator: refresh their uploads-playlist head (1
// YouTube quota unit each) so a brand-new livestream that isn't already
// `latest_video_id` gets picked up, THEN batch-check liveStreamingDetails.
// This actually fixes the detection gap; live-check-peak only re-checked
// IDs already in the DB, so a fresh stream was invisible until the next
// twice-daily sync-background run.
//
// Required env vars:
//   YOUTUBE_API_KEY             — server-side YouTube Data API key
//   SUPABASE_URL                — optional, falls back to hardcoded
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase secret key so writes bypass RLS

exports.config = { schedule: '*/5 * * * *' };

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!ytKey) return ok({ error: 'YOUTUBE_API_KEY not set' }, 500);

  const now = Date.now();
  const windowEnd = new Date(now + 7 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  // 1. Fixtures kicking off in the next ~7 minutes that haven't fired yet.
  const fixRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?select=id,home_team,away_team,kickoff_at&kickoff_at=gte.${encodeURIComponent(nowIso)}&kickoff_at=lte.${encodeURIComponent(windowEnd)}&trigger_sent_at=is.null`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!fixRes.ok) return ok({ error: 'fixtures select failed', status: fixRes.status }, 502);
  const fixtures = await fixRes.json();

  if (!fixtures.length) return ok({ fixtures_due: 0 });

  const teams = new Set();
  for (const f of fixtures) {
    if (f.home_team) teams.add(f.home_team);
    if (f.away_team) teams.add(f.away_team);
  }
  if (!teams.size) {
    // Fixtures matched no tracked club (e.g. World Cup nations) — still
    // mark them as fired so we don't keep re-checking every 5 minutes.
    await markFired(supabaseUrl, sbKey, fixtures.map(f => f.id));
    return ok({ fixtures_due: fixtures.length, matched_teams: 0 });
  }

  // 2. Creators tied to those clubs, not already flagged live (skip —
  // nothing to gain re-discovering someone we already know is live).
  const teamFilter = [...teams].map(t => `"${t.replace(/"/g, '\\"')}"`).join(',');
  const creatorsRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,team,youtube_channel_id,latest_video_id,live_video_id,is_live&team=in.(${teamFilter})&is_live=is.false&youtube_channel_id=not.is.null`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!creatorsRes.ok) return ok({ error: 'creators select failed', status: creatorsRes.status }, 502);
  const creators = await creatorsRes.json();

  if (!creators.length) {
    await markFired(supabaseUrl, sbKey, fixtures.map(f => f.id));
    return ok({ fixtures_due: fixtures.length, matched_teams: teams.size, creators_checked: 0 });
  }

  // 3. Refresh each creator's uploads-playlist head (1 quota unit each) so
  // a brand-new livestream shows up as latest_video_id even if it hasn't
  // been through the twice-daily full sync yet.
  const freshIds = {}; // creator.id -> latest video id (fresh or existing)
  for (const c of creators) {
    freshIds[c.id] = c.latest_video_id || null;
    const uploadsPlaylistId = 'UU' + c.youtube_channel_id.slice(2);
    try {
      const plData = await ytFetch(ytKey, 'playlistItems', {
        playlistId: uploadsPlaylistId,
        part: 'snippet',
        maxResults: 1,
      });
      const vid = plData.items && plData.items[0] && plData.items[0].snippet &&
        plData.items[0].snippet.resourceId && plData.items[0].snippet.resourceId.videoId;
      if (vid) freshIds[c.id] = vid;
    } catch (e) { /* keep existing latest_video_id on failure */ }
  }

  // 4. Batch-check liveStreamingDetails for every candidate ID (fresh
  // latest_video_id + any existing live_video_id), same as live-check.js.
  const videoIds = new Set();
  for (const c of creators) {
    if (freshIds[c.id]) videoIds.add(freshIds[c.id]);
    if (c.live_video_id) videoIds.add(c.live_video_id);
  }
  const ids = [...videoIds];
  const liveStatus = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const vidData = await ytFetch(ytKey, 'videos', { id: batch.join(','), part: 'liveStreamingDetails' });
      for (const item of vidData.items || []) {
        const d = item.liveStreamingDetails || {};
        liveStatus[item.id] = !!d.actualStartTime && !d.actualEndTime;
      }
    } catch (e) { /* skip this batch */ }
  }

  // 5. Persist. Only creators that are now live need a write.
  let nowLive = 0;
  for (const c of creators) {
    const freshLive = freshIds[c.id] && liveStatus[freshIds[c.id]];
    const existingLive = c.live_video_id && liveStatus[c.live_video_id];
    if (!freshLive && !existingLive) continue;

    const liveVideoId = freshLive ? freshIds[c.id] : c.live_video_id;
    const patchBody = { is_live: true, live_video_id: liveVideoId };
    if (freshIds[c.id] && freshIds[c.id] !== c.latest_video_id) patchBody.latest_video_id = freshIds[c.id];

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(c.id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: sbKey, Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify(patchBody),
      }
    );
    if (patchRes.ok) nowLive++;
  }

  await markFired(supabaseUrl, sbKey, fixtures.map(f => f.id));

  return ok({
    fixtures_due: fixtures.length,
    matched_teams: teams.size,
    creators_checked: creators.length,
    now_live: nowLive,
  });
};

async function markFired(supabaseUrl, sbKey, ids) {
  if (!ids.length) return;
  await fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?id=in.(${ids.join(',')})`,
    {
      method: 'PATCH',
      headers: {
        apikey: sbKey, Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ trigger_sent_at: new Date().toISOString() }),
    }
  );
}

async function ytFetch(key, endpoint, params) {
  params.key = key;
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams(params)}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e.error && e.error.message) || res.statusText);
  }
  return res.json();
}

function ok(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
