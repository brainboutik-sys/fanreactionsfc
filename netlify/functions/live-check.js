// Netlify scheduled function — refreshes `is_live` / `live_video_id`
// for all creators every 5 minutes by batch-checking their known latest
// and live video IDs against YouTube's liveStreamingDetails.
//
// Required env vars:
//   YOUTUBE_API_KEY             — server-side YouTube Data API key
//   SUPABASE_URL                — Supabase project URL (optional, falls back to hardcoded)
//   SUPABASE_SERVICE_ROLE_KEY   — service-role key so PATCH bypasses RLS
//
// Cost: ~3 YouTube quota units per run (for ~150 creators), ~864/day.

exports.config = { schedule: '*/5 * * * *' };

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!ytKey) return ok({ error: 'YOUTUBE_API_KEY not set' }, 500);

  // 1. Fetch creators that have any candidate video ID we can check.
  const selectRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,latest_video_id,live_video_id,is_live`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!selectRes.ok) return ok({ error: 'supabase select failed', status: selectRes.status }, 502);
  const creators = await selectRes.json();

  // 2. Collect unique video IDs to check.
  const videoIds = new Set();
  for (const c of creators) {
    if (c.latest_video_id) videoIds.add(c.latest_video_id);
    if (c.live_video_id) videoIds.add(c.live_video_id);
  }
  const ids = [...videoIds];

  if (!ids.length) return ok({ checked: 0, message: 'no video ids to check' });

  // 3. Batch YouTube videos.list (max 50 IDs per call).
  const liveStatus = {}; // videoId → { isLive: boolean }
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      id: batch.join(','),
      part: 'liveStreamingDetails',
      key: ytKey,
    });
    const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    if (!ytRes.ok) {
      const errBody = await ytRes.text();
      return ok({ error: 'youtube fetch failed', status: ytRes.status, body: errBody.slice(0, 500) }, 502);
    }
    const ytData = await ytRes.json();
    for (const item of ytData.items || []) {
      const d = item.liveStreamingDetails || {};
      liveStatus[item.id] = { isLive: !!d.actualStartTime && !d.actualEndTime };
    }
    // Videos that were returned but have no liveStreamingDetails are not live.
    // Videos not returned at all (e.g. deleted) also default to not live.
  }

  // 4. Compute desired is_live / live_video_id per creator and PATCH changed rows.
  let updated = 0, nowLive = 0, endedLive = 0;
  for (const c of creators) {
    let newIsLive = false;
    let newLiveVideoId = null;

    // Prefer the known live_video_id; fall back to latest_video_id.
    if (c.live_video_id && liveStatus[c.live_video_id]?.isLive) {
      newIsLive = true;
      newLiveVideoId = c.live_video_id;
    } else if (c.latest_video_id && liveStatus[c.latest_video_id]?.isLive) {
      newIsLive = true;
      newLiveVideoId = c.latest_video_id;
    }

    const liveChanged = newIsLive !== !!c.is_live;
    const idChanged = (newLiveVideoId || null) !== (c.live_video_id || null);
    if (!liveChanged && !(newIsLive && idChanged)) continue;

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(c.id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          is_live: newIsLive,
          live_video_id: newIsLive ? newLiveVideoId : null,
        }),
      }
    );
    if (patchRes.ok) {
      updated++;
      if (newIsLive && !c.is_live) nowLive++;
      if (!newIsLive && c.is_live) endedLive++;
    }
  }

  return ok({
    checked_video_ids: ids.length,
    creators: creators.length,
    updated,
    now_live: nowLive,
    ended_live: endedLive,
  });
};

function ok(body, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
