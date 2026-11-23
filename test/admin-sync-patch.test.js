const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ADMIN_SYNC_OMITTED_COLUMNS,
  omitAdminSyncLiveColumns,
  adminSyncChannelPatch,
} = require('../js/lib/admin-sync-patch.js');

const ROOT = path.join(__dirname, '..');

const OMITTED = [
  'is_live',
  'live_video_id',
  'upcoming_video_id',
  'upcoming_video_title',
  'upcoming_video_thumbnail',
  'upcoming_video_scheduled_at',
];

function postgrestBody(row) {
  return JSON.parse(JSON.stringify(row));
}

function assertLiveColumnsAbsent(row) {
  const body = postgrestBody(row);
  for (const key of OMITTED) {
    assert.equal(Object.hasOwn(row, key), false, key + ' must not be a patch key');
    assert.equal(Object.hasOwn(body, key), false, key + ' must not be in the JSON body');
  }
  const serialized = JSON.stringify(body);
  for (const key of OMITTED) {
    assert.equal(serialized.includes('"' + key + '"'), false, key);
  }
}

function functionSource(src, name) {
  const sig = 'async function ' + name + '(';
  const start = src.indexOf(sig);
  assert.notEqual(start, -1, name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const channel = {
  id: 'UC123',
  statistics: { subscriberCount: '1200', viewCount: '9000', videoCount: '40' },
  snippet: {
    publishedAt: '2018-05-01T00:00:00Z',
    country: 'GB',
    thumbnails: { high: { url: 'https://yt.example/a.jpg' } },
  },
};

// Newest upload is already broadcasting: actualStartTime set, no actualEndTime.
// That is the condition the old admin sync used to set is_live true.
const liveVideos = [
  { videoId: 'liveVid', publishedAt: '2026-11-23T15:00:00Z', title: 'Arsenal watchalong' },
  { videoId: 'older', publishedAt: '2026-11-22T15:00:00Z', title: 'Older reaction' },
];

const liveDetail = {
  id: 'liveVid',
  statistics: { viewCount: '50' },
  snippet: { liveBroadcastContent: 'live', title: 'Arsenal watchalong' },
  liveStreamingDetails: { actualStartTime: '2026-11-23T15:00:05Z' },
};

test('omitted columns are the live-job and upcoming columns, and nothing else', () => {
  assert.deepEqual(ADMIN_SYNC_OMITTED_COLUMNS, OMITTED);
});

test('a currently-live latest upload does not write is_live or live_video_id', () => {
  const patch = adminSyncChannelPatch({
    channel: channel,
    videos: liveVideos,
    videoDetail: liveDetail,
    avatarUrl: 'https://example/old.jpg',
    now: '2026-11-23T15:01:00.000Z',
    // Current row, including a flag the fixtures job just set. The builder
    // has no path that copies these onto the write.
    is_live: true,
    live_video_id: 'job-set-id',
    upcoming_video_id: 'scheduled-id',
  });

  assertLiveColumnsAbsent(patch);
  assert.equal(patch.youtube_channel_id, 'UC123');
  assert.equal(patch.subscriber_count, 1200);
  assert.equal(patch.total_view_count, 9000);
  assert.equal(patch.video_count, 40);
  assert.equal(patch.channel_created_at, '2018-05-01T00:00:00Z');
  assert.equal(patch.avatar_url, 'https://yt.example/a.jpg');
  assert.equal(patch.channel_country, 'GB');
  assert.equal(patch.last_youtube_sync, '2026-11-23T15:01:00.000Z');
  assert.equal(patch.latest_video_id, 'liveVid');
  assert.equal(patch.latest_video_title, 'Arsenal watchalong');
  assert.equal(patch.latest_video_date, '2026-11-23T15:00:00Z');
  assert.equal(patch.latest_video_thumbnail, 'https://i.ytimg.com/vi/liveVid/mqdefault.jpg');
  assert.equal(patch.latest_video_views, 50);
  assert.equal(patch.upload_frequency, 'Daily');
  assert.equal(Object.hasOwn(patch, 'liveStreamingDetails'), false);
  assert.deepEqual(Object.keys(patch).sort(), [
    'avatar_url',
    'channel_country',
    'channel_created_at',
    'last_youtube_sync',
    'latest_video_date',
    'latest_video_id',
    'latest_video_thumbnail',
    'latest_video_title',
    'latest_video_views',
    'subscriber_count',
    'total_view_count',
    'upload_frequency',
    'video_count',
    'youtube_channel_id',
  ]);
});

test('an upcoming scheduled video does not write upcoming_video_*', () => {
  const patch = adminSyncChannelPatch({
    channel: channel,
    videos: [{ videoId: 'soon', publishedAt: '2026-11-24T19:00:00Z', title: 'Scheduled stream' }],
    videoDetail: {
      id: 'soon',
      statistics: { viewCount: '0' },
      snippet: { liveBroadcastContent: 'upcoming', title: 'Scheduled stream' },
      liveStreamingDetails: { scheduledStartTime: '2026-11-24T19:30:00Z' },
    },
    avatarUrl: 'https://example/old.jpg',
    now: '2026-11-23T15:01:00.000Z',
  });

  assertLiveColumnsAbsent(patch);
  assert.equal(patch.latest_video_id, 'soon');
  assert.equal(patch.latest_video_views, 0);
  assert.equal(Object.hasOwn(patch, 'upload_frequency'), false);
});

test('channel-only sync still omits live columns and keeps an intentional null country', () => {
  const patch = adminSyncChannelPatch({
    channel: {
      id: 'UC999',
      statistics: {},
      snippet: { thumbnails: {} },
    },
    videos: [],
    videoDetail: null,
    avatarUrl: 'https://example/kept.jpg',
    now: '2026-11-23T15:01:00.000Z',
  });

  assertLiveColumnsAbsent(patch);
  assert.equal(patch.subscriber_count, 0);
  assert.equal(patch.avatar_url, 'https://example/kept.jpg');
  assert.equal(patch.channel_country, null);
  assert.equal(Object.hasOwn(postgrestBody(patch), 'channel_country'), true);
  assert.equal(Object.hasOwn(patch, 'latest_video_id'), false);
});

test('explicit null, false, and true on live columns are dropped before the body is sent', () => {
  const poisoned = {
    subscriber_count: 0,
    latest_video_views: 0,
    channel_country: null,
    is_live: false,
    live_video_id: null,
    upcoming_video_id: null,
    upcoming_video_title: null,
    upcoming_video_thumbnail: null,
    upcoming_video_scheduled_at: null,
  };
  const cleared = omitAdminSyncLiveColumns(poisoned);
  assertLiveColumnsAbsent(cleared);
  assert.equal(cleared.subscriber_count, 0);
  assert.equal(cleared.latest_video_views, 0);
  assert.equal(cleared.channel_country, null);

  const setTrue = omitAdminSyncLiveColumns({
    subscriber_count: 10,
    is_live: true,
    live_video_id: 'liveVid',
    upcoming_video_id: 'soon',
    upcoming_video_title: 'Scheduled stream',
    upcoming_video_thumbnail: 'https://i.ytimg.com/vi/soon/mqdefault.jpg',
    upcoming_video_scheduled_at: '2026-11-24T19:30:00Z',
  });
  assertLiveColumnsAbsent(setTrue);
  assert.deepEqual(postgrestBody(setTrue), { subscriber_count: 10 });
});

test('runSync sends the omitted patch and does not decide live state', () => {
  const adminJs = fs.readFileSync(path.join(ROOT, 'js/admin.js'), 'utf8');
  const runSync = functionSource(adminJs, 'runSync');
  const code = stripComments(runSync);

  assert.match(code, /adminSyncChannelPatch\(/);
  assert.match(code, /sb\.from\('frfc_streamers'\)\.update\(omitAdminSyncLiveColumns\(update\)\)\.eq\('id', c\.id\)/);
  assert.doesNotMatch(code, /\.upsert\(/);
  assert.doesNotMatch(code, /\bis_live\b/);
  assert.doesNotMatch(code, /\blive_video_id\b/);
  assert.doesNotMatch(code, /\bupcoming_video_/);
  assert.match(code, /part: 'statistics'/);
  assert.doesNotMatch(code, /liveStreamingDetails/);

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const libAt = indexHtml.indexOf('/js/lib/admin-sync-patch.js');
  const appAt = indexHtml.indexOf('/js/app.js');
  assert.ok(libAt > 0 && appAt > libAt);

  const reset = functionSource(adminJs.replace('function resetAllLive', 'async function resetAllLive'), 'resetAllLive');
  assert.match(reset, /is_live: false/);
  assert.match(reset, /live_video_id: null/);
});
