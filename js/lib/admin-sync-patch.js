/* FanReactionsFC — payload for the in-browser admin YouTube sync.
   Loaded before app.js (see index.html). admin.js calls these when an
   admin clicks "Run YouTube Sync Now". Node tests require this file.

   sync-background.js never writes is_live or live_video_id. Those columns
   belong to live-check.js and live-check-fixtures-background.js. This
   manual sync follows that rule and also leaves upcoming_video_* alone.

   Why there is no live=true exception: the old client sync defaulted
   is_live to false and live_video_id to null, then set them only when
   the newest uploads-playlist item already had
   liveStreamingDetails.actualStartTime and no actualEndTime. At kickoff
   the fixtures job has often just marked the creator live from a fresher
   check. The newest upload is frequently not that stream, and it often
   has no actualStartTime yet, so the default false wiped the flag and
   the set-true branch did not put it back. Keeping only the set-true
   branch would still replace live_video_id with the newest upload.
   This sync does not know the live state better than the jobs that own
   the columns, so it does not write them in either direction.

   upcoming_video_* is a different owner (sync-background.js, which nulls
   the columns when it finds no scheduled stream). This client sync does
   not detect scheduled streams. Sending null would clear a value the
   server sync just stored, so those keys stay off the body too.

   latest_video_* is still written. That is the metadata this sync and
   sync-background.js both refresh. live-check-fixtures-background.js may
   also set latest_video_id when it discovers a newer playlist head; a
   manual sync updating it from the same playlist is the refresh, not a
   live-flag wipe.

   PostgREST PATCH and upsert (merge-duplicates) both write every key in
   the JSON body. An explicit null is a write. Leaving the key out is
   what preserves the stored value. omitAdminSyncLiveColumns() is the
   last step before that body is sent. */

const ADMIN_SYNC_OMITTED_COLUMNS = [
  'is_live',
  'live_video_id',
  'upcoming_video_id',
  'upcoming_video_title',
  'upcoming_video_thumbnail',
  'upcoming_video_scheduled_at',
];

function omitAdminSyncLiveColumns(row) {
  const skip = Object.create(null);
  for (let i = 0; i < ADMIN_SYNC_OMITTED_COLUMNS.length; i++) skip[ADMIN_SYNC_OMITTED_COLUMNS[i]] = true;
  const out = {};
  const src = row && typeof row === 'object' ? row : {};
  const keys = Object.keys(src);
  for (let k = 0; k < keys.length; k++) {
    if (skip[keys[k]]) continue;
    out[keys[k]] = src[keys[k]];
  }
  return out;
}

function adminSyncUploadFrequency(videos) {
  const dates = (videos || []).map(function(v) { return v.publishedAt; }).filter(Boolean);
  if (dates.length < 2) return null;
  const sorted = dates.map(function(d) { return new Date(d).getTime(); }).sort(function(a, b) { return b - a; });
  const gaps = [];
  for (let g = 0; g < sorted.length - 1; g++) gaps.push((sorted[g] - sorted[g + 1]) / 86400000);
  const avg = gaps.reduce(function(a, b) { return a + b; }, 0) / gaps.length;
  if (avg < 2) return 'Daily';
  if (avg < 2.5) return '5x/week';
  if (avg < 3.5) return '3x/week';
  if (avg < 5) return '2x/week';
  if (avg < 10) return 'Weekly';
  if (avg < 20) return 'Biweekly';
  if (avg < 45) return 'Monthly';
  return 'Inactive';
}

// channel: YouTube channels.list item (id, statistics, snippet).
// videos: playlist items already reduced to { videoId, publishedAt, title }, newest first.
// videoDetail: videos.list item for the newest id, used only for statistics.viewCount.
//   liveStreamingDetails on that item is ignored.
// avatarUrl: existing frfc_streamers.avatar_url, kept when YouTube has no thumbnail.
// now: ISO timestamp for last_youtube_sync. Defaults to the current time.
function adminSyncChannelPatch(opts) {
  const options = opts || {};
  const ch = options.channel || {};
  const stats = ch.statistics || {};
  const snippet = ch.snippet || {};
  const videos = options.videos || [];
  const videoDetail = options.videoDetail || null;

  const update = {
    youtube_channel_id: ch.id,
    subscriber_count: parseInt(stats.subscriberCount, 10) || 0,
    total_view_count: parseInt(stats.viewCount, 10) || 0,
    video_count: parseInt(stats.videoCount, 10) || 0,
    channel_created_at: snippet.publishedAt || null,
    avatar_url: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || options.avatarUrl,
    channel_country: snippet.country || null,
    last_youtube_sync: options.now || new Date().toISOString(),
  };

  if (videos.length) {
    const latest = videos[0];
    update.latest_video_id = latest.videoId;
    update.latest_video_title = latest.title;
    update.latest_video_date = latest.publishedAt;
    update.latest_video_thumbnail = 'https://i.ytimg.com/vi/' + latest.videoId + '/mqdefault.jpg';
    if (videoDetail) {
      update.latest_video_views = parseInt(videoDetail.statistics?.viewCount, 10) || 0;
    }
    const frequency = adminSyncUploadFrequency(videos);
    if (frequency) update.upload_frequency = frequency;
  }

  return omitAdminSyncLiveColumns(update);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ADMIN_SYNC_OMITTED_COLUMNS,
    omitAdminSyncLiveColumns,
    adminSyncUploadFrequency,
    adminSyncChannelPatch,
  };
}
