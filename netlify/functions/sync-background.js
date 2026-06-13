// Netlify scheduled background function — refreshes full creator metadata
// twice a day (07:00 and 15:00 UTC).
//
// Background function: up to 15-minute timeout (vs 30s for regular scheduled).
// Named with the `-background` suffix so Netlify routes it through the
// background runtime.
//
// Required env vars:
//   YOUTUBE_API_KEY             — YouTube Data API key
//   SUPABASE_URL                — optional, falls back to hardcoded
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase secret key so writes bypass RLS
//
// Cost: ~9 YouTube quota units × ~157 creators = ~1,400/run × 2 runs/day
//       = ~2,800/day, well under the 10k/day free quota.
//
// NOTE: is_live / live_video_id are deliberately NOT touched here — the
// live-check function (every 5 min) owns those fields.

exports.config = { schedule: '0 7,15 * * *' };

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!ytKey) return ok({ error: 'YOUTUBE_API_KEY not set' }, 500);

  // 1. Fetch all creators.
  const selectRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,name,channel_url,avatar_url`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!selectRes.ok) return ok({ error: 'supabase select failed', status: selectRes.status }, 502);
  const creators = await selectRes.json();

  let okCount = 0, failCount = 0, quota = 0;

  for (const c of creators) {
    const m = (c.channel_url || '').match(/@([A-Za-z0-9_.-]+)/);
    if (!m) { failCount++; continue; }
    const handle = m[1];

    try {
      // 1. Channel metadata
      quota += 5;
      const chData = await ytFetch(ytKey, 'channels', {
        forHandle: handle,
        part: 'snippet,statistics,contentDetails',
      });
      const ch = chData.items && chData.items[0];
      if (!ch) { failCount++; continue; }

      const stats = ch.statistics || {};
      const snippet = ch.snippet || {};
      const uploadsPlaylist = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;

      const update = {
        youtube_channel_id: ch.id,
        subscriber_count: parseInt(stats.subscriberCount) || 0,
        total_view_count: parseInt(stats.viewCount) || 0,
        video_count: parseInt(stats.videoCount) || 0,
        channel_created_at: snippet.publishedAt || null,
        avatar_url:
          (snippet.thumbnails && (snippet.thumbnails.high && snippet.thumbnails.high.url || snippet.thumbnails.medium && snippet.thumbnails.medium.url)) ||
          c.avatar_url,
        channel_country: snippet.country || null,
        last_youtube_sync: new Date().toISOString(),
      };

      // Default: no upcoming stream found. We NULL these out every sync so
      // stale data doesn't linger once a scheduled stream has started or
      // been cancelled.
      update.upcoming_video_id = null;
      update.upcoming_video_title = null;
      update.upcoming_video_thumbnail = null;
      update.upcoming_video_scheduled_at = null;

      // 2. Latest uploads
      if (uploadsPlaylist) {
        try {
          quota += 3;
          const plData = await ytFetch(ytKey, 'playlistItems', {
            playlistId: uploadsPlaylist,
            part: 'snippet',
            maxResults: 5,
          });
          const vids = (plData.items || [])
            .map(item => ({
              videoId: item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId,
              publishedAt: item.snippet && item.snippet.publishedAt,
              title: (item.snippet && item.snippet.title) || '',
            }))
            .filter(v => v.videoId);

          if (vids.length) {
            const latest = vids[0];
            update.latest_video_id = latest.videoId;
            update.latest_video_title = latest.title;
            update.latest_video_date = latest.publishedAt;
            update.latest_video_thumbnail = `https://i.ytimg.com/vi/${latest.videoId}/mqdefault.jpg`;

            // 3. Batch-fetch details for all up-to-5 recent videos — same
            // cost as a single-ID request, and lets us detect upcoming
            // scheduled livestreams in the process.
            try {
              quota += 1;
              const ids = vids.map(v => v.videoId).join(',');
              const vidData = await ytFetch(ytKey, 'videos', { id: ids, part: 'snippet,statistics,liveStreamingDetails' });
              const items = vidData.items || [];

              // Latest video stats from the first returned item whose id matches latest
              const latestDetail = items.find(it => it.id === latest.videoId);
              if (latestDetail) {
                update.latest_video_views = parseInt(latestDetail.statistics && latestDetail.statistics.viewCount) || 0;
              }

              // Find the soonest upcoming scheduled livestream across the 5 items
              const now = Date.now();
              let soonest = null;
              for (const it of items) {
                const sched = it.liveStreamingDetails && it.liveStreamingDetails.scheduledStartTime;
                const state = it.snippet && it.snippet.liveBroadcastContent;
                if (state !== 'upcoming' || !sched) continue;
                const schedMs = new Date(sched).getTime();
                if (!schedMs || schedMs < now) continue; // already passed
                if (!soonest || schedMs < soonest.ms) {
                  soonest = { ms: schedMs, it: it, sched: sched };
                }
              }
              if (soonest) {
                const it = soonest.it;
                const sn = it.snippet || {};
                update.upcoming_video_id = it.id;
                update.upcoming_video_title = sn.title || '';
                update.upcoming_video_thumbnail = `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`;
                update.upcoming_video_scheduled_at = soonest.sched;
              }
            } catch (e) { /* video detail fetch failed, continue with playlist-only data */ }

            // 4. Upload frequency
            const dates = vids.map(v => v.publishedAt).filter(Boolean);
            if (dates.length >= 2) {
              const sorted = dates.map(d => new Date(d).getTime()).sort((a, b) => b - a);
              const gaps = [];
              for (let g = 0; g < sorted.length - 1; g++) gaps.push((sorted[g] - sorted[g + 1]) / 86400000);
              const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
              update.upload_frequency =
                avg < 2 ? 'Daily' :
                avg < 2.5 ? '5x/week' :
                avg < 3.5 ? '3x/week' :
                avg < 5 ? '2x/week' :
                avg < 10 ? 'Weekly' :
                avg < 20 ? 'Biweekly' :
                avg < 45 ? 'Monthly' : 'Inactive';
            }
          }
        } catch (e) { /* playlist fetch failed, proceed with channel-only data */ }
      }

      // 5. Persist creator update
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
          body: JSON.stringify(update),
        }
      );
      if (!patchRes.ok) { failCount++; continue; }

      // 6. Record subscriber history
      if (update.subscriber_count > 0) {
        await fetch(`${supabaseUrl}/rest/v1/frfc_subscriber_history`, {
          method: 'POST',
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ creator_id: c.id, subscriber_count: update.subscriber_count }),
        });
      }

      okCount++;
    } catch (e) {
      failCount++;
    }
  }

  return ok({ total: creators.length, ok: okCount, fail: failCount, quota });
};

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
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
