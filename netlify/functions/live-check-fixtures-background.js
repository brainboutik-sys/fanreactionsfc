// Netlify scheduled function — runs every 5 minutes.
//
// FRFC_LIVE_MATCH_WINDOW (env) or FRFC_LIVE_MATCH_WINDOW_ENABLED (constant
// in js/lib/live-match-window.js) defaults on. Set the env var to 0 to
// restore the one-shot behaviour below without a code change.
//
// On (window mode):
//   Fixtures are retried from 10 minutes before kickoff until 120 minutes
//   after. Only the two clubs on the fixture are checked — a World Cup
//   row with no club names is skipped, not fanned out to every creator.
//   The first run in the window reads each creator's uploads playlist
//   (playlistItems.list, 1 unit, up to 5 videos) and saves latest /
//   upcoming ids even when nobody is live yet. A second playlist read,
//   at or after kickoff, covers creators who are still not live and have
//   no upcoming video for this kickoff. Every run, including those two,
//   re-checks saved ids with videos.list (1 unit, 50 ids per call).
//   search.list is used only on that first run, only for a club whose
//   creators have no video id at all, and only for that club's largest
//   channel — once per club per fixture. A stream with actualEndTime
//   clears is_live.
//
// Off (legacy one-shot):
//   Fixtures kicking off in the next ~7 minutes with trigger_sent_at null
//   are checked once. The playlist head is not saved unless the video is
//   already live, then trigger_sent_at is set and the fixture is not
//   retried. World Cup fixtures still check every creator.
//
// Required env vars:
//   YOUTUBE_API_KEY             — server-side YouTube Data API key
//   SUPABASE_URL                — optional, falls back to hardcoded
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase secret key so writes bypass RLS

exports.config = { schedule: '*/5 * * * *' };

const { liveMatchWindowEnabled, liveDetectionPhase, creatorNeedsPlaylist, parseLiveItem, creatorLivePatch } = require('../../js/lib/live-match-window.js');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const PLAYLIST_FETCH_CONCURRENCY = 20;
const VIDEO_BATCH = 50;

function nowMs() {
  return typeof exports.now === 'function' ? exports.now() : Date.now();
}

async function mapWithConcurrency(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function sbHeaders(sbKey, json) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  if (json) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=minimal';
  }
  return headers;
}

async function ytFetch(key, endpoint, params) {
  const query = new URLSearchParams(params);
  query.set('key', key);
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${query}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e.error && e.error.message) || res.statusText);
  }
  return res.json();
}

function ok(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;

  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);
  if (!ytKey) return ok({ error: 'YOUTUBE_API_KEY not set' }, 500);

  if (!liveMatchWindowEnabled(process.env)) return runLegacy(supabaseUrl, sbKey, ytKey);
  return runWindow(supabaseUrl, sbKey, ytKey);
};

async function runWindow(supabaseUrl, sbKey, ytKey) {
  const now = nowMs();
  const from = new Date(now - 120 * 60 * 1000).toISOString();
  const to = new Date(now + 10 * 60 * 1000).toISOString();
  const fixRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?select=id,competition_code,home_team,away_team,kickoff_at,status,trigger_sent_at&kickoff_at=gte.${encodeURIComponent(from)}&kickoff_at=lte.${encodeURIComponent(to)}`,
    { headers: sbHeaders(sbKey) }
  );
  if (!fixRes.ok) return ok({ error: 'fixtures select failed', status: fixRes.status }, 502);
  const loaded = await fixRes.json();
  const fixtures = (Array.isArray(loaded) ? loaded : []).filter(f => liveDetectionPhase(f, now) !== 'skip');
  if (!fixtures.length) return ok({ mode: 'window', fixtures_due: 0, quota_units: 0, search_calls: 0 });

  const teams = new Set();
  const kickoffByTeam = {};
  for (const f of fixtures) {
    const kick = new Date(f.kickoff_at).getTime();
    for (const team of [f.home_team, f.away_team]) {
      if (!team) continue;
      teams.add(team);
      if (kickoffByTeam[team] == null || Math.abs(kick - now) < Math.abs(kickoffByTeam[team] - now)) {
        kickoffByTeam[team] = kick;
      }
    }
  }

  const teamList = [...teams].map(t => `"${String(t).replace(/"/g, '\\"')}"`).join(',');
  const creatorsRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,team,youtube_channel_id,latest_video_id,live_video_id,upcoming_video_id,upcoming_video_scheduled_at,is_live,subscriber_count&team=in.(${teamList})&youtube_channel_id=not.is.null`,
    { headers: sbHeaders(sbKey) }
  );
  if (!creatorsRes.ok) return ok({ error: 'creators select failed', status: creatorsRes.status }, 502);
  const creators = await creatorsRes.json();

  const phaseByFixture = {};
  for (const f of fixtures) phaseByFixture[f.id] = liveDetectionPhase(f, now);

  const fresh = {};
  let playlistCalls = 0;
  const toScan = (Array.isArray(creators) ? creators : []).filter(c => {
    const kick = kickoffByTeam[c.team];
    const phase = fixtures.some(f => (f.home_team === c.team || f.away_team === c.team) && phaseByFixture[f.id] === 'scan')
      ? 'scan'
      : (fixtures.some(f => (f.home_team === c.team || f.away_team === c.team) && phaseByFixture[f.id] === 'rescan') ? 'rescan' : 'check');
    return creatorNeedsPlaylist(c, phase, kick);
  });

  await mapWithConcurrency(toScan, PLAYLIST_FETCH_CONCURRENCY, async (c) => {
    const uploadsPlaylistId = 'UU' + String(c.youtube_channel_id).slice(2);
    playlistCalls += 1;
    try {
      const plData = await ytFetch(ytKey, 'playlistItems', {
        playlistId: uploadsPlaylistId,
        part: 'snippet',
        maxResults: '5',
      });
      const items = (plData.items || []).map(item => {
        const sn = item.snippet || {};
        const videoId = sn.resourceId && sn.resourceId.videoId;
        if (!videoId) return null;
        return { videoId, title: sn.title || '', publishedAt: sn.publishedAt || null };
      }).filter(Boolean);
      if (items.length) {
        fresh[c.id] = {
          videoId: items[0].videoId,
          title: items[0].title,
          publishedAt: items[0].publishedAt,
          candidates: items.map(item => item.videoId),
        };
      }
    } catch (e) { /* keep the ids already stored */ }
  });

  const videoIds = new Set();
  function addId(id) { if (id) videoIds.add(id); }
  for (const c of creators) {
    addId(c.latest_video_id);
    addId(c.live_video_id);
    addId(c.upcoming_video_id);
    const found = fresh[c.id];
    if (!found) continue;
    addId(found.videoId);
    (found.candidates || []).forEach(addId);
  }

  // One search.list per club, and only on the first pass, when that club
  // has no video id at all. search.list is a separate 100-call daily
  // bucket (1 unit each); it is not spent on the 10,000-unit pool.
  let searchCalls = 0;
  const searched = new Set();
  for (const f of fixtures) {
    if (phaseByFixture[f.id] !== 'scan') continue;
    for (const team of [f.home_team, f.away_team]) {
      if (!team || searched.has(team)) continue;
      const clubCreators = creators.filter(c => c.team === team);
      if (!clubCreators.length) continue;
      const anyId = clubCreators.some(c => c.latest_video_id || c.live_video_id || c.upcoming_video_id || (fresh[c.id] && fresh[c.id].videoId));
      if (anyId) continue;
      searched.add(team);
      const top = clubCreators
        .filter(c => c.youtube_channel_id)
        .sort((a, b) => (Number(b.subscriber_count) || 0) - (Number(a.subscriber_count) || 0))[0];
      if (!top) continue;
      const eventType = now < kickoffByTeam[team] ? 'upcoming' : 'live';
      searchCalls += 1;
      try {
        const data = await ytFetch(ytKey, 'search', {
          part: 'snippet',
          channelId: top.youtube_channel_id,
          eventType,
          type: 'video',
          maxResults: '1',
        });
        const item = data.items && data.items[0];
        const videoId = item && item.id && item.id.videoId;
        if (videoId) {
          fresh[top.id] = {
            videoId,
            title: (item.snippet && item.snippet.title) || '',
            publishedAt: null,
            candidates: [videoId],
          };
          addId(videoId);
        }
      } catch (e) { /* the videos we already have are still checked */ }
    }
  }

  const ids = [...videoIds];
  const info = {};
  const checked = new Set();
  let videoCalls = 0;
  for (let i = 0; i < ids.length; i += VIDEO_BATCH) {
    const batch = ids.slice(i, i + VIDEO_BATCH);
    videoCalls += 1;
    try {
      const vidData = await ytFetch(ytKey, 'videos', {
        id: batch.join(','),
        part: 'snippet,liveStreamingDetails',
      });
      batch.forEach(id => checked.add(id));
      for (const item of vidData.items || []) info[item.id] = parseLiveItem(item);
    } catch (e) { /* this batch stays unchecked so a live row is not cleared */ }
  }

  let updated = 0;
  let nowLive = 0;
  let endedLive = 0;
  for (const c of creators) {
    const patch = creatorLivePatch(c, fresh[c.id] || null, info, checked, kickoffByTeam[c.team]);
    if (!Object.keys(patch).length) continue;
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(c.id)}`,
      { method: 'PATCH', headers: sbHeaders(sbKey, true), body: JSON.stringify(patch) }
    );
    if (!patchRes.ok) continue;
    updated += 1;
    if (patch.is_live === true && !c.is_live) nowLive += 1;
    if (patch.is_live === false && c.is_live) endedLive += 1;
  }

  const advance = fixtures.filter(f => phaseByFixture[f.id] === 'scan' || phaseByFixture[f.id] === 'rescan').map(f => f.id);
  if (advance.length) {
    await fetch(
      `${supabaseUrl}/rest/v1/frfc_fixtures?id=in.(${advance.join(',')})`,
      {
        method: 'PATCH',
        headers: sbHeaders(sbKey, true),
        body: JSON.stringify({ trigger_sent_at: new Date(now).toISOString() }),
      }
    );
  }

  return ok({
    mode: 'window',
    fixtures_due: fixtures.length,
    matched_teams: teams.size,
    creators_checked: creators.length,
    playlist_calls: playlistCalls,
    video_calls: videoCalls,
    search_calls: searchCalls,
    quota_units: playlistCalls + videoCalls,
    updated,
    now_live: nowLive,
    ended_live: endedLive,
  });
}

async function runLegacy(supabaseUrl, sbKey, ytKey) {
  const now = nowMs();
  const windowEnd = new Date(now + 7 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const fixRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?select=id,competition_code,home_team,away_team,kickoff_at&kickoff_at=gte.${encodeURIComponent(nowIso)}&kickoff_at=lte.${encodeURIComponent(windowEnd)}&trigger_sent_at=is.null`,
    { headers: sbHeaders(sbKey) }
  );
  if (!fixRes.ok) return ok({ error: 'fixtures select failed', status: fixRes.status }, 502);
  const fixtures = await fixRes.json();

  if (!fixtures.length) return ok({ mode: 'legacy', fixtures_due: 0 });

  const teams = new Set();
  let broadCheck = false;
  for (const f of fixtures) {
    if (f.home_team) teams.add(f.home_team);
    if (f.away_team) teams.add(f.away_team);
    if (f.competition_code === 'WC') broadCheck = true;
  }
  if (!teams.size && !broadCheck) {
    await markFired(supabaseUrl, sbKey, fixtures.map(f => f.id), now);
    return ok({ mode: 'legacy', fixtures_due: fixtures.length, matched_teams: 0, broad_check: false });
  }

  const creatorsUrl = broadCheck
    ? `${supabaseUrl}/rest/v1/frfc_streamers?select=id,team,youtube_channel_id,latest_video_id,live_video_id,is_live&is_live=is.false&youtube_channel_id=not.is.null`
    : `${supabaseUrl}/rest/v1/frfc_streamers?select=id,team,youtube_channel_id,latest_video_id,live_video_id,is_live&team=in.(${[...teams].map(t => `"${t.replace(/"/g, '\\"')}"`).join(',')})&is_live=is.false&youtube_channel_id=not.is.null`;
  const creatorsRes = await fetch(creatorsUrl, { headers: sbHeaders(sbKey) });
  if (!creatorsRes.ok) return ok({ error: 'creators select failed', status: creatorsRes.status }, 502);
  const creators = await creatorsRes.json();

  if (!creators.length) {
    await markFired(supabaseUrl, sbKey, fixtures.map(f => f.id), now);
    return ok({ mode: 'legacy', fixtures_due: fixtures.length, matched_teams: teams.size, broad_check: broadCheck, creators_checked: 0 });
  }

  const freshIds = {};
  for (const c of creators) freshIds[c.id] = c.latest_video_id || null;
  await mapWithConcurrency(creators, PLAYLIST_FETCH_CONCURRENCY, async (c) => {
    const uploadsPlaylistId = 'UU' + c.youtube_channel_id.slice(2);
    try {
      const plData = await ytFetch(ytKey, 'playlistItems', {
        playlistId: uploadsPlaylistId,
        part: 'snippet',
        maxResults: '1',
      });
      const vid = plData.items && plData.items[0] && plData.items[0].snippet &&
        plData.items[0].snippet.resourceId && plData.items[0].snippet.resourceId.videoId;
      if (vid) freshIds[c.id] = vid;
    } catch (e) { /* keep existing latest_video_id on failure */ }
  });

  const videoIds = new Set();
  for (const c of creators) {
    if (freshIds[c.id]) videoIds.add(freshIds[c.id]);
    if (c.live_video_id) videoIds.add(c.live_video_id);
  }
  const ids = [...videoIds];
  const liveStatus = {};
  for (let i = 0; i < ids.length; i += VIDEO_BATCH) {
    const batch = ids.slice(i, i + VIDEO_BATCH);
    try {
      const vidData = await ytFetch(ytKey, 'videos', { id: batch.join(','), part: 'liveStreamingDetails' });
      for (const item of vidData.items || []) {
        const d = item.liveStreamingDetails || {};
        liveStatus[item.id] = !!d.actualStartTime && !d.actualEndTime;
      }
    } catch (e) { /* skip this batch */ }
  }

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
      { method: 'PATCH', headers: sbHeaders(sbKey, true), body: JSON.stringify(patchBody) }
    );
    if (patchRes.ok) nowLive++;
  }

  await markFired(supabaseUrl, sbKey, fixtures.map(f => f.id), now);

  return ok({
    mode: 'legacy',
    fixtures_due: fixtures.length,
    matched_teams: teams.size,
    broad_check: broadCheck,
    creators_checked: creators.length,
    now_live: nowLive,
  });
}

async function markFired(supabaseUrl, sbKey, ids, now) {
  if (!ids.length) return;
  await fetch(
    `${supabaseUrl}/rest/v1/frfc_fixtures?id=in.(${ids.join(',')})`,
    {
      method: 'PATCH',
      headers: sbHeaders(sbKey, true),
      body: JSON.stringify({ trigger_sent_at: new Date(now).toISOString() }),
    }
  );
}
