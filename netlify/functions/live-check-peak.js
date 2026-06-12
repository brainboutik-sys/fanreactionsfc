// Peak-hours live check — runs every 5 minutes but self-gates to match times.
// Active windows (UTC):
//   Weekdays (Mon–Fri): 18:00–22:00  (evening kick-offs)
//   Weekends (Sat–Sun): 11:00–21:00  (afternoon + evening matches)
//
// Outside these windows it exits immediately, spending ~0 quota.
// The baseline live-check.js covers off-peak at 30-minute intervals.

exports.config = { schedule: '*/5 * * * *' };

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

function isPeakHours() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  const hour = now.getUTCHours();
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? (hour >= 11 && hour < 21) : (hour >= 18 && hour < 22);
}

exports.handler = async () => {
  if (!isPeakHours()) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'outside peak hours' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!ytKey) return ok({ error: 'YOUTUBE_API_KEY not set' }, 500);

  const selectRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,latest_video_id,live_video_id,is_live`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!selectRes.ok) return ok({ error: 'supabase select failed', status: selectRes.status }, 502);
  const creators = await selectRes.json();

  const videoIds = new Set();
  for (const c of creators) {
    if (c.latest_video_id) videoIds.add(c.latest_video_id);
    if (c.live_video_id) videoIds.add(c.live_video_id);
  }
  const ids = [...videoIds];
  if (!ids.length) return ok({ checked: 0, message: 'no video ids to check' });

  const liveStatus = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams({ id: batch.join(','), part: 'liveStreamingDetails', key: ytKey });
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
  }

  let updated = 0, nowLive = 0, endedLive = 0;
  for (const c of creators) {
    let newIsLive = false;
    let newLiveVideoId = null;
    if (c.live_video_id && liveStatus[c.live_video_id]?.isLive) {
      newIsLive = true; newLiveVideoId = c.live_video_id;
    } else if (c.latest_video_id && liveStatus[c.latest_video_id]?.isLive) {
      newIsLive = true; newLiveVideoId = c.latest_video_id;
    }
    const liveChanged = newIsLive !== !!c.is_live;
    const idChanged = (newLiveVideoId || null) !== (c.live_video_id || null);
    if (!liveChanged && !(newIsLive && idChanged)) continue;
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(c.id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: sbKey, Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ is_live: newIsLive, live_video_id: newIsLive ? newLiveVideoId : null }),
      }
    );
    if (patchRes.ok) {
      updated++;
      if (newIsLive && !c.is_live) nowLive++;
      if (!newIsLive && c.is_live) endedLive++;
    }
  }

  return ok({ peak: true, checked_video_ids: ids.length, creators: creators.length, updated, now_live: nowLive, ended_live: endedLive });
};

function ok(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
