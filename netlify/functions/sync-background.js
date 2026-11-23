// Netlify scheduled background function — refreshes full creator metadata
// twice a day (07:00 and 15:00 UTC).
//
// Schedule: `0 7,15 * * *` UTC. It has to be declared in netlify.toml.
// This file still exports `config.schedule` (the same constant), but
// Netlify's bundler only honours that export on the modern default-export
// function shape. A legacy `exports.handler` drops it, so this job never
// registered and the sync only ran when something requested the URL
// (no runs 6–16 Nov 2026). Same registration fix as rank-snapshot-background.
// The `-background` suffix stays: walking every creator can outlive the 30s
// scheduled-function limit. A background function scheduled from netlify.toml
// still runs on the cron and gets the 15-minute limit.
//
// Monday 07:00 UTC writes frfc_subscriber_history an hour before
// weekly-ranking-scheduled (Monday 08:00 UTC) reads it.
//
// A public GET must not start a sync. Once the cron is registered, Netlify
// does not accept web requests to a scheduled function (403). This handler
// also refuses anything that is not the scheduler's POST body
// `{"next_run":"<iso-8601>"}`, which is the payload Clockwork sends. A URL
// probe therefore cannot call YouTube or insert frfc_job_runs. The scheduled
// run still opens that row.
//
// Required env vars:
//   YOUTUBE_API_KEY             — YouTube Data API key
//   SUPABASE_URL                — optional, falls back to hardcoded
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase secret key so writes bypass RLS
//
// quota_used adds 9 per creator (channels 5, playlistItems 3, videos 1).
// channels.list, playlistItems.list and videos.list cost 1 unit each, so
// that counter overstates the YouTube dashboard by about 3×. Official usage
// is ~1,400 units per run. Two runs plus live-check (~480/day) is ~3,300,
// under 70% of the 10,000 unit daily quota. The 9 stays what frfc_job_runs
// already stores.
//
// NOTE: is_live / live_video_id are deliberately NOT touched here — the
// live-check function (every 5 min) owns those fields.

const SCHEDULE = '0 7,15 * * *';
const JOB_TYPE = 'sync-background';
const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

exports.SCHEDULE = SCHEDULE;
exports.JOB_TYPE = JOB_TYPE;
exports.config = { schedule: SCHEDULE };

// Netlify's scheduler POSTs {"next_run":"<iso>"}. A browser GET, or any
// other request that reaches this background URL, is not that invocation.
function scheduledNextRun(event) {
  if (!event || typeof event !== 'object') return null;
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') return null;
  let raw = event.body;
  if (raw == null || raw === '') return null;
  if (event.isBase64Encoded && typeof raw === 'string') {
    try {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    } catch (e) {
      return null;
    }
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const nextRun = parsed && parsed.next_run;
    if (typeof nextRun !== 'string' || !Number.isFinite(Date.parse(nextRun))) return null;
    return nextRun;
  } catch (e) {
    return null;
  }
}

exports.scheduledNextRun = scheduledNextRun;

exports.handler = async (event) => {
  const nextRun = scheduledNextRun(event);
  if (!nextRun) return ok({ error: 'Forbidden' }, 403);
  console.log('sync-background next run:', nextRun);

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!ytKey) return ok({ error: 'YOUTUBE_API_KEY not set' }, 500);

  const jobRunId = await startJobRun(supabaseUrl, sbKey, JOB_TYPE);

  // 1. Fetch all creators.
  const selectRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,name,channel_url,avatar_url,avatar_custom`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!selectRes.ok) return ok({ error: 'supabase select failed', status: selectRes.status }, 502);
  const creators = await selectRes.json();

  let okCount = 0, failCount = 0, quota = 0;
  const videoMetricRows = [];
  const videoPublishRows = [];

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

      // Channel fields only. Do not add is_verified or verified_until here —
      // this PATCH would clear the paid Verified tier on every sync.
      const update = {
        youtube_channel_id: ch.id,
        subscriber_count: parseInt(stats.subscriberCount) || 0,
        total_view_count: parseInt(stats.viewCount) || 0,
        video_count: parseInt(stats.videoCount) || 0,
        channel_created_at: snippet.publishedAt || null,
        // A claimed creator's uploaded avatar (avatar_custom=true, set via
        // manage-channel.js) is never overwritten by the YouTube sync.
        avatar_url: c.avatar_custom ? c.avatar_url :
          (snippet.thumbnails && (snippet.thumbnails.high && snippet.thumbnails.high.url || snippet.thumbnails.medium && snippet.thumbnails.medium.url)) ||
          c.avatar_url,
        channel_country: snippet.country || c.channel_country || null,
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

            // Upload time is already on these playlist items (snippet.publishedAt).
            // Kept off frfc_video_metrics, which is one stats row per sync.
            videoPublishRows.push(...publishRowsFromVids(c.id, vids));

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

              // Snapshot every fetched video's stats — this is data already
              // paid for by the request above (no extra quota), just not
              // persisted per-video until now. Weekly ranking calculations
              // (Epic 2) read this history instead of only ever seeing
              // "latest video" for whichever video happened to be newest
              // at sync time.
              videoMetricRows.push(...items.map(it => ({
                creator_id: c.id,
                video_id: it.id,
                views: parseInt(it.statistics && it.statistics.viewCount) || 0,
                likes: it.statistics && it.statistics.likeCount != null ? parseInt(it.statistics.likeCount) : null,
                comments: it.statistics && it.statistics.commentCount != null ? parseInt(it.statistics.commentCount) : null,
              })));
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

  // One batch insert for every video snapshot collected across the whole
  // run, rather than a request per creator.
  if (videoMetricRows.length) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/frfc_video_metrics`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(videoMetricRows),
      });
    } catch (e) { /* metrics are a nice-to-have for rankings, never fail the sync over them */ }
  }

  // One upsert for every upload time collected above. A missing frfc_videos
  // table (migration not applied yet) is ignored so this deploy can land
  // first. The in-browser admin sync does not write this table: it runs as
  // the admin user, and the table has no insert policy.
  let videosRecorded = 0;
  let videosMigrationRequired = false;
  let videosError = null;
  const videoRows = dedupeVideoRows(videoPublishRows);
  if (videoRows.length) {
    try {
      const videoResult = await upsertVideoPublishTimes(supabaseUrl, sbKey, videoRows);
      videosRecorded = videoResult.recorded;
      videosMigrationRequired = !!videoResult.migration_required;
      videosError = videoResult.error || null;
    } catch (e) { /* publish times never fail the creator sync */ }
  }

  await finishJobRun(supabaseUrl, sbKey, jobRunId, {
    status: failCount === 0 ? 'success' : (okCount > 0 ? 'partial' : 'failed'),
    items_processed: okCount,
    items_failed: failCount,
    quota_used: quota,
  });

  return ok({
    total: creators.length,
    ok: okCount,
    fail: failCount,
    quota,
    videoMetricsRecorded: videoMetricRows.length,
    videosRecorded,
    videosMigrationRequired,
    ...(videosError ? { videosError } : {}),
  });
};

function publishRowsFromVids(creatorId, vids) {
  const rows = [];
  const seen = new Set();
  for (const v of vids || []) {
    if (!v || !v.videoId || !v.publishedAt || seen.has(v.videoId)) continue;
    const ms = Date.parse(v.publishedAt);
    if (!Number.isFinite(ms)) continue;
    seen.add(v.videoId);
    rows.push({
      video_id: v.videoId,
      creator_id: creatorId,
      published_at: new Date(ms).toISOString(),
    });
  }
  return rows;
}

function dedupeVideoRows(rows) {
  const byId = new Map();
  for (const row of rows) byId.set(row.video_id, row);
  return [...byId.values()];
}

function isSchemaMissing(status, body) {
  if (status !== 400 && status !== 404 && status !== 406) return false;
  return /PGRST204|PGRST205|schema cache|Could not find the|column .* does not exist|relation .* does not exist/i.test(body || '');
}

async function upsertVideoPublishTimes(supabaseUrl, sbKey, rows) {
  const stamped = rows.map(row => ({ ...row, updated_at: new Date().toISOString() }));
  const res = await fetch(`${supabaseUrl}/rest/v1/frfc_videos?on_conflict=video_id`, {
    method: 'POST',
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(stamped),
  });
  if (res.ok) return { recorded: stamped.length };
  const body = await res.text();
  if (isSchemaMissing(res.status, body)) return { recorded: 0, migration_required: true };
  return { recorded: 0, error: body.slice(0, 300) };
}

exports.publishRowsFromVids = publishRowsFromVids;
exports.dedupeVideoRows = dedupeVideoRows;
exports.isSchemaMissing = isSchemaMissing;

// ── Job health tracking (frfc_job_runs) ─────────────────────────────────────
// Best-effort on both ends — a health-tracking failure should never take
// down the actual sync it's reporting on.
async function startJobRun(supabaseUrl, sbKey, jobType) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ job_type: jobType, status: 'running' }),
    });
    const rows = await res.json().catch(() => []);
    return rows[0] && rows[0].id;
  } catch (e) { return null; }
}

async function finishJobRun(supabaseUrl, sbKey, jobRunId, patch) {
  if (!jobRunId) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs?id=eq.${jobRunId}`, {
      method: 'PATCH',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, finished_at: new Date().toISOString() }),
    });
  } catch (e) { /* non-critical */ }
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
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
