const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lib = require('../js/lib/live-match-window.js');
const banner = require('../js/lib/club-live-banner.js');
const fixturesFn = require('../netlify/functions/live-check-fixtures-background.js');
const liveCheck = require('../netlify/functions/live-check.js');

const KICK = Date.parse('2026-11-22T15:00:00.000Z');
const NEW_ID = 'newvideoid1';
const OLD_ID = 'oldvideoid1';
const LIVE_ID = 'livevideo01';

function json(status, data) {
  const text = data == null ? '' : JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (text ? JSON.parse(text) : null),
    text: async () => text,
  };
}

function ytUrl(url) {
  return String(url).includes('googleapis.com/youtube');
}

function endpoint(url) {
  const match = String(url).match(/\/youtube\/v3\/([^?]+)/);
  return match ? match[1] : '';
}

let envTail = Promise.resolve();

async function withEnv(env, fn) {
  const run = envTail.then(() => withEnvNow(env, fn));
  envTail = run.then(() => {}, () => {});
  return run;
}

async function withEnvNow(env, fn) {
  const prev = {};
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY', 'FRFC_LIVE_MATCH_WINDOW'];
  for (const key of keys) prev[key] = process.env[key];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.YOUTUBE_API_KEY = 'yt-test-key';
  if (env.FRFC_LIVE_MATCH_WINDOW == null) delete process.env.FRFC_LIVE_MATCH_WINDOW;
  else process.env.FRFC_LIVE_MATCH_WINDOW = env.FRFC_LIVE_MATCH_WINDOW;
  const prevFetch = global.fetch;
  const prevNow = fixturesFn.now;
  global.fetch = env.fetch;
  if (env.now != null) fixturesFn.now = () => env.now;
  else delete fixturesFn.now;
  try {
    return await fn();
  } finally {
    global.fetch = prevFetch;
    if (prevNow == null) delete fixturesFn.now;
    else fixturesFn.now = prevNow;
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function fixtureRow(over) {
  return Object.assign({
    id: 'fix1',
    competition_code: 'PL',
    home_team: 'Arsenal',
    away_team: 'Everton',
    kickoff_at: new Date(KICK).toISOString(),
    status: 'TIMED',
    trigger_sent_at: null,
  }, over || {});
}

function creatorRow(over) {
  return Object.assign({
    id: 'c1',
    team: 'Arsenal',
    youtube_channel_id: 'UCarsenalchannel',
    latest_video_id: OLD_ID,
    live_video_id: null,
    upcoming_video_id: null,
    upcoming_video_scheduled_at: null,
    is_live: false,
    subscriber_count: 1000,
  }, over || {});
}

function videoItem(id, details, snippet) {
  return {
    id,
    snippet: snippet || {},
    liveStreamingDetails: details || {},
  };
}

test('the flag defaults on and the env var turns it off', () => {
  assert.equal(lib.FRFC_LIVE_MATCH_WINDOW_ENABLED, true);
  assert.equal(lib.liveMatchWindowEnabled({}), true);
  assert.equal(lib.liveMatchWindowEnabled({ FRFC_LIVE_MATCH_WINDOW: '0' }), false);
  assert.equal(lib.liveMatchWindowEnabled({ FRFC_LIVE_MATCH_WINDOW: 'false' }), false);
  assert.equal(lib.liveMatchWindowEnabled({ FRFC_LIVE_MATCH_WINDOW: 'off' }), false);
  assert.equal(lib.liveMatchWindowEnabled({ FRFC_LIVE_MATCH_WINDOW: '1' }), true);
  assert.equal(lib.LIVE_DETECT_PRE_MS, 10 * 60 * 1000);
  assert.equal(lib.LIVE_DETECT_POST_MS, 120 * 60 * 1000);
});

test('detection retries across the match and skips a one-shot stop', () => {
  const row = fixtureRow();
  assert.equal(lib.liveDetectionPhase(row, KICK - 11 * 60 * 1000), 'skip');
  assert.equal(lib.liveDetectionPhase(row, KICK - 10 * 60 * 1000), 'scan');
  assert.equal(lib.liveDetectionPhase(row, KICK + 30 * 60 * 1000), 'scan');
  assert.equal(lib.liveDetectionPhase(fixtureRow({ trigger_sent_at: new Date(KICK - 8 * 60 * 1000).toISOString() }), KICK - 60 * 1000), 'check');
  assert.equal(lib.liveDetectionPhase(fixtureRow({ trigger_sent_at: new Date(KICK - 8 * 60 * 1000).toISOString() }), KICK + 60 * 1000), 'rescan');
  assert.equal(lib.liveDetectionPhase(fixtureRow({ trigger_sent_at: new Date(KICK + 60 * 1000).toISOString() }), KICK + 20 * 60 * 1000), 'check');
  assert.equal(lib.liveDetectionPhase(row, KICK + 120 * 60 * 1000), 'skip');
  assert.equal(lib.liveDetectionPhase(fixtureRow({ status: 'FINISHED' }), KICK), 'skip');
  assert.equal(lib.liveDetectionPhase(fixtureRow({ home_team: null, away_team: null, competition_code: 'WC' }), KICK), 'skip');
});

test('a not-yet-live playlist head is saved, and an ended stream clears is_live', () => {
  const saved = lib.creatorLivePatch(creatorRow(), {
    videoId: NEW_ID,
    title: 'Arsenal watchalong',
    publishedAt: '2026-11-22T14:40:00.000Z',
    candidates: [NEW_ID],
  }, {
    [NEW_ID]: {
      isLive: false,
      ended: false,
      upcoming: true,
      scheduledStart: new Date(KICK).toISOString(),
      title: 'Arsenal watchalong',
    },
  }, new Set([NEW_ID, OLD_ID]), KICK);
  assert.equal(saved.latest_video_id, NEW_ID);
  assert.equal(saved.upcoming_video_id, NEW_ID);
  assert.equal(saved.is_live, undefined);

  const wentLive = lib.creatorLivePatch(creatorRow({ upcoming_video_id: NEW_ID }), null, {
    [NEW_ID]: { isLive: true, ended: false, upcoming: false, scheduledStart: new Date(KICK).toISOString(), title: 'Arsenal watchalong' },
  }, new Set([NEW_ID]), KICK);
  assert.equal(wentLive.is_live, true);
  assert.equal(wentLive.live_video_id, NEW_ID);
  assert.equal(wentLive.upcoming_video_id, null);

  const ended = lib.creatorLivePatch(creatorRow({ is_live: true, live_video_id: LIVE_ID, latest_video_id: LIVE_ID }), null, {
    [LIVE_ID]: { isLive: false, ended: true, upcoming: false, scheduledStart: null, title: 'done' },
  }, new Set([LIVE_ID]), KICK);
  assert.equal(ended.is_live, false);
  assert.equal(ended.live_video_id, null);
});

test('the hub button uses live_hub only for a live or match-window destination', () => {
  const creator = {
    slug: 'aftv',
    channel: 'https://www.youtube.com/@AFTV',
    live: 'https://www.youtube.com/@AFTV/streams',
    isLive: false,
    liveVideoId: '',
    upcomingVideoId: NEW_ID,
  };
  assert.equal(lib.hubYoutubeCta(creator, { inMatchWindow: false }).linkType, 'channel');
  assert.match(lib.hubYoutubeCta(creator, { inMatchWindow: false }).href, /@AFTV$/);
  const during = lib.hubYoutubeCta(Object.assign({}, creator, {
    upcomingVideoScheduledAt: new Date().toISOString(),
  }), { inMatchWindow: true });
  assert.equal(during.linkType, 'live_hub');
  assert.equal(during.href, 'https://www.youtube.com/watch?v=' + NEW_ID);
  const live = lib.hubYoutubeCta(Object.assign({}, creator, { isLive: true, liveVideoId: LIVE_ID }), { inMatchWindow: false });
  assert.equal(live.linkType, 'live_hub');
  assert.equal(live.href, 'https://www.youtube.com/watch?v=' + LIVE_ID);
  const streams = lib.hubYoutubeCta(Object.assign({}, creator, { upcomingVideoId: '' }), { inMatchWindow: true });
  assert.equal(streams.linkType, 'live_hub');
  assert.match(streams.href, /\/streams$/);
  assert.equal(lib.hubYoutubeCta(creator, { inMatchWindow: true, enabled: false }).linkType, 'channel');
  assert.equal(banner.clubInMatchWindow([fixtureRow()], 'Arsenal', new Date(KICK)), true);
  assert.equal(banner.clubInMatchWindow([fixtureRow()], 'Arsenal', new Date(KICK - 46 * 60 * 1000)), false);
});

function install(state) {
  return async (url, options = {}) => {
    const href = String(url);
    state.calls.push({ url: href, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (href.includes('frfc_fixtures') && (!options.method || options.method === 'GET')) {
      return json(200, state.fixtures);
    }
    if (href.includes('frfc_fixtures') && options.method === 'PATCH') {
      state.fired.push(JSON.parse(options.body));
      const ids = href.split('id=in.(')[1] || '';
      state.firedIds.push(decodeURIComponent(ids.replace(/\)$/, '')));
      return json(204, null);
    }
    if (href.includes('frfc_streamers') && (!options.method || options.method === 'GET')) {
      state.creatorQueries.push(href);
      if (href.includes('is_live=is.false') && !href.includes('team=in.')) return json(200, state.broad || []);
      return json(200, state.creators);
    }
    if (href.includes('frfc_streamers') && options.method === 'PATCH') {
      state.patches.push(JSON.parse(options.body));
      return json(204, null);
    }
    if (!ytUrl(href)) return json(500, { message: 'unexpected ' + href });
    const name = endpoint(href);
    state.youtube.push(name);
    if (name === 'playlistItems') {
      return json(200, state.playlist || { items: [] });
    }
    if (name === 'videos') {
      const id = new URL(href).searchParams.get('id') || '';
      const wanted = new Set(id.split(',').filter(Boolean));
      return json(200, { items: (state.videos || []).filter(item => wanted.has(item.id)) });
    }
    if (name === 'search') {
      return json(200, state.search || { items: [] });
    }
    return json(500, { message: 'unexpected youtube ' + name });
  };
}

test('window mode saves a not-live id and checks it again without another playlist or search', async () => {
  const state = {
    calls: [],
    fixtures: [fixtureRow()],
    creators: [creatorRow()],
    patches: [],
    fired: [],
    firedIds: [],
    creatorQueries: [],
    youtube: [],
    playlist: {
      items: [{
        snippet: {
          title: 'Arsenal watchalong',
          publishedAt: '2026-11-22T14:40:00.000Z',
          resourceId: { videoId: NEW_ID },
        },
      }],
    },
    videos: [videoItem(NEW_ID, { scheduledStartTime: new Date(KICK).toISOString() }, { title: 'Arsenal watchalong', liveBroadcastContent: 'upcoming' })],
  };
  const first = await withEnv({
    now: KICK - 8 * 60 * 1000,
    fetch: install(state),
  }, () => fixturesFn.handler());
  const body = JSON.parse(first.body);
  assert.equal(body.mode, 'window');
  assert.equal(body.playlist_calls, 1);
  assert.equal(body.search_calls, 0);
  assert.equal(body.quota_units, body.playlist_calls + body.video_calls);
  assert.equal(state.youtube.filter(name => name === 'playlistItems').length, 1);
  assert.equal(state.youtube.includes('search'), false);
  assert.equal(state.patches.length, 1);
  assert.equal(state.patches[0].latest_video_id, NEW_ID);
  assert.equal(state.patches[0].upcoming_video_id, NEW_ID);
  assert.equal(state.patches[0].is_live, undefined);
  assert.equal(state.fired.length, 1);
  assert.match(state.creatorQueries[0], /team=in\./);
  assert.match(state.creatorQueries[0], /Arsenal/);
  assert.match(state.creatorQueries[0], /Everton/);
  assert.doesNotMatch(state.creatorQueries[0], /is_live=is\.false&youtube_channel_id=not\.is\.null$/);

  state.fixtures = [fixtureRow({ trigger_sent_at: state.fired[0].trigger_sent_at })];
  state.creators = [creatorRow({ latest_video_id: NEW_ID, upcoming_video_id: NEW_ID, upcoming_video_scheduled_at: new Date(KICK).toISOString() })];
  state.patches = [];
  state.youtube = [];
  state.videos = [videoItem(NEW_ID, { scheduledStartTime: new Date(KICK).toISOString(), actualStartTime: new Date(KICK).toISOString() }, { liveBroadcastContent: 'live', title: 'Arsenal watchalong' })];
  const second = await withEnv({
    now: KICK + 5 * 60 * 1000,
    fetch: install(state),
  }, () => fixturesFn.handler());
  const again = JSON.parse(second.body);
  assert.equal(again.mode, 'window');
  assert.equal(again.playlist_calls, 0);
  assert.equal(again.search_calls, 0);
  assert.equal(state.youtube.includes('playlistItems'), false);
  assert.equal(state.youtube.includes('search'), false);
  assert.ok(state.youtube.includes('videos'));
  const videoCall = state.calls.filter(call => call.url.includes('/videos?')).pop();
  assert.match(videoCall.url, new RegExp(NEW_ID));
  assert.equal(state.patches.some(patch => patch.is_live === true && patch.live_video_id === NEW_ID), true);
});

test('a live stream is cleared when actualEndTime is set', async () => {
  const state = {
    calls: [],
    fixtures: [fixtureRow({ trigger_sent_at: new Date(KICK + 60 * 1000).toISOString() })],
    creators: [creatorRow({ is_live: true, live_video_id: LIVE_ID, latest_video_id: LIVE_ID })],
    patches: [],
    fired: [],
    firedIds: [],
    creatorQueries: [],
    youtube: [],
    videos: [videoItem(LIVE_ID, { actualStartTime: new Date(KICK).toISOString(), actualEndTime: new Date(KICK + 100 * 60 * 1000).toISOString() }, { liveBroadcastContent: 'none' })],
  };
  const res = await withEnv({
    now: KICK + 110 * 60 * 1000,
    fetch: install(state),
  }, () => fixturesFn.handler());
  assert.equal(JSON.parse(res.body).ended_live, 1);
  assert.equal(state.patches[0].is_live, false);
  assert.equal(state.patches[0].live_video_id, null);
  assert.equal(state.youtube.includes('playlistItems'), false);
});

test('search.list runs once per club and only when the playlist has no video id', async () => {
  const state = {
    calls: [],
    fixtures: [fixtureRow()],
    creators: [creatorRow({ latest_video_id: null, subscriber_count: 50 }), creatorRow({ id: 'c2', team: 'Everton', youtube_channel_id: 'UCevertonchannel', latest_video_id: OLD_ID, subscriber_count: 10 })],
    patches: [],
    fired: [],
    firedIds: [],
    creatorQueries: [],
    youtube: [],
    playlist: { items: [] },
    videos: [],
    search: { items: [{ id: { videoId: NEW_ID }, snippet: { title: 'Found live' } }] },
  };
  const res = await withEnv({
    now: KICK - 5 * 60 * 1000,
    fetch: install(state),
  }, () => fixturesFn.handler());
  assert.equal(JSON.parse(res.body).search_calls, 1);
  const searches = state.calls.filter(call => endpoint(call.url) === 'search');
  assert.equal(searches.length, 1);
  assert.match(searches[0].url, /channelId=UCarsenalchannel/);
  assert.doesNotMatch(searches.map(call => call.url).join('\n'), /UCevertonchannel/);
  state.fixtures = [fixtureRow({ trigger_sent_at: new Date(KICK - 5 * 60 * 1000).toISOString() })];
  state.youtube = [];
  state.calls = [];
  await withEnv({
    now: KICK - 60 * 1000,
    fetch: install(state),
  }, () => fixturesFn.handler());
  assert.equal(state.calls.filter(call => endpoint(call.url) === 'search').length, 0);
  assert.equal(state.calls.filter(call => endpoint(call.url) === 'playlistItems').length, 0);
});

test('flag off keeps the one-shot check and does not save a video that is not live', async () => {
  const state = {
    calls: [],
    fixtures: [fixtureRow()],
    creators: [creatorRow()],
    patches: [],
    fired: [],
    firedIds: [],
    creatorQueries: [],
    youtube: [],
    playlist: {
      items: [{ snippet: { title: 'Later', publishedAt: '2026-11-22T14:50:00.000Z', resourceId: { videoId: NEW_ID } } }],
    },
    videos: [videoItem(NEW_ID, { scheduledStartTime: new Date(KICK).toISOString() }, { liveBroadcastContent: 'upcoming' })],
  };
  const res = await withEnv({
    FRFC_LIVE_MATCH_WINDOW: '0',
    now: KICK - 3 * 60 * 1000,
    fetch: install(state),
  }, () => fixturesFn.handler());
  const body = JSON.parse(res.body);
  assert.equal(body.mode, 'legacy');
  assert.equal(state.patches.length, 0);
  assert.equal(state.fired.length, 1);
  assert.match(state.calls[0].url, /trigger_sent_at=is\.null/);
  assert.equal(state.youtube.includes('search'), false);
});

test('flag off still broad-checks a World Cup fixture, window mode does not', async () => {
  const legacy = {
    calls: [],
    fixtures: [fixtureRow({ competition_code: 'WC', home_team: 'England', away_team: 'Brazil' })],
    creators: [],
    broad: [creatorRow({ team: 'Arsenal' })],
    patches: [],
    fired: [],
    firedIds: [],
    creatorQueries: [],
    youtube: [],
    playlist: { items: [] },
    videos: [],
  };
  await withEnv({
    FRFC_LIVE_MATCH_WINDOW: '0',
    now: KICK - 2 * 60 * 1000,
    fetch: install(legacy),
  }, () => fixturesFn.handler());
  assert.equal(legacy.creatorQueries.some(url => !url.includes('team=in.')), true);

  const windowed = {
    calls: [],
    fixtures: [fixtureRow({ competition_code: 'WC', home_team: null, away_team: null })],
    creators: [creatorRow()],
    patches: [],
    fired: [],
    firedIds: [],
    creatorQueries: [],
    youtube: [],
  };
  const res = await withEnv({
    now: KICK,
    fetch: install(windowed),
  }, () => fixturesFn.handler());
  assert.equal(JSON.parse(res.body).fixtures_due, 0);
  assert.equal(windowed.youtube.length, 0);
});

test('live-check includes upcoming_video_id only while the flag is on', async () => {
  const seen = [];
  const patches = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('frfc_streamers') && (!options.method || options.method === 'GET')) {
      return json(200, [{
        id: 'c1',
        latest_video_id: OLD_ID,
        live_video_id: null,
        upcoming_video_id: NEW_ID,
        is_live: false,
      }]);
    }
    if (href.includes('/videos?')) {
      return json(200, { items: [videoItem(NEW_ID, { actualStartTime: new Date(KICK).toISOString() }, {})] });
    }
    if (href.includes('frfc_streamers') && options.method === 'PATCH') {
      patches.push(JSON.parse(options.body));
      return json(204, null);
    }
    return json(500, { message: 'unexpected' });
  };
  const on = await withEnv({ fetch: fetchImpl }, () => liveCheck.handler());
  assert.match(seen[0], /upcoming_video_id/);
  assert.match(seen.find(url => url.includes('/videos?')), new RegExp(NEW_ID));
  assert.equal(patches[0].is_live, true);
  assert.equal(patches[0].live_video_id, NEW_ID);
  assert.equal(JSON.parse(on.body).now_live, 1);

  seen.length = 0;
  patches.length = 0;
  await withEnv({ FRFC_LIVE_MATCH_WINDOW: '0', fetch: fetchImpl }, () => liveCheck.handler());
  assert.doesNotMatch(seen[0], /upcoming_video_id/);
  assert.equal(patches.length, 0);
});

test('the click migration adds live_hub and streamwall_play and has a rollback', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261123085258_frfc_link_clicks_live_hub.sql'), 'utf8');
  assert.match(sql, /link_type in \('live', 'channel', 'poll', 'live_hub', 'streamwall_play'\)/);
  assert.match(sql, /link_type in \('live', 'channel', 'poll'\)/);
  assert.match(sql, /delete from public\.frfc_link_clicks/);
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.match(toml, /\[functions\."live-check-fixtures-background"\]\nschedule = "\*\/5 \* \* \* \*"/);
  assert.match(toml, /\[functions\."live-check"\]\nschedule = "\*\/30 \* \* \* \*"/);
  const sync = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/sync-background.js'), 'utf8');
  assert.equal(sync.includes('FRFC_LIVE_MATCH_WINDOW'), false);
  assert.match(sync, /const SCHEDULE = '0 7,15 \* \* \*'/);
  assert.match(toml, /\[functions\."sync-background"\]\nschedule = "0 7,15 \* \* \*"/);
});

test('a busy Saturday stays under 70 percent of the 10,000 unit pool', () => {
  // Official units: channels.list, playlistItems.list and videos.list are
  // 1 each. sync-background's quota_used adds 5+3+1=9, so 6,948 on that
  // counter is 772 creators × 9, which is 2,316 official units.
  // search.list is a separate 100-call bucket and is not in this total.
  const syncRun = 6948 / 9 * 3;
  const syncDay = syncRun * 2;
  const liveCheck = Math.ceil((474 * 2) / 50) * 48;
  const playlist = 326 * 2;
  const discoveryVideos = Math.ceil((326 * 5) / 50) * 2;
  const recheckVideos = Math.ceil((326 * 2) / 50) * 24;
  const total = syncDay + liveCheck + playlist + discoveryVideos + recheckVideos;
  assert.equal(syncRun, 2316);
  assert.equal(liveCheck, 912);
  assert.equal(playlist, 652);
  assert.equal(discoveryVideos, 66);
  assert.equal(recheckVideos, 336);
  assert.equal(total, 6598);
  assert.ok(total < 7000);
  assert.ok(total / 10000 < 0.7);
});
