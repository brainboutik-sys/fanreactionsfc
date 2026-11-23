/* FanReactionsFC — match-window live detection and club-hub YouTube CTA.
   One switch. Default on.

   Scheduled functions read FRFC_LIVE_MATCH_WINDOW from the environment
   when it is set (0 / false / off turns them off). When it is unset they
   follow FRFC_LIVE_MATCH_WINDOW_ENABLED. The club-hub buttons follow the
   constant. Set the constant to false and redeploy to turn the buttons
   off. Revert the pull request to remove both.

   Detection window is kickoff − 10 minutes through kickoff + 120 minutes.
   The club-hub banner window (45 minutes before, 130 minutes after) is
   separate and stays in club-live-banner.js. */

const FRFC_LIVE_MATCH_WINDOW_ENABLED = true;

const LIVE_DETECT_PRE_MS = 10 * 60 * 1000;
const LIVE_DETECT_POST_MS = 120 * 60 * 1000;
const LIVE_UPCOMING_BEFORE_MS = 3 * 60 * 60 * 1000;
const LIVE_UPCOMING_AFTER_MS = 30 * 60 * 1000;
const LIVE_RESCAN_COVER_BEFORE_MS = 45 * 60 * 1000;
const LIVE_RESCAN_COVER_AFTER_MS = 30 * 60 * 1000;

const FRFC_LINK_TYPES = ['live', 'channel', 'poll', 'live_hub', 'streamwall_play'];

const LIVE_TERMINAL = {
  FINISHED: true,
  AWARDED: true,
  CANCELLED: true,
  CANCELED: true,
  POSTPONED: true,
  SUSPENDED: true,
};

function liveMatchWindowEnabled(env) {
  const source = env || {};
  const raw = source.FRFC_LIVE_MATCH_WINDOW;
  if (raw == null || String(raw).trim() === '') return FRFC_LIVE_MATCH_WINDOW_ENABLED;
  const value = String(raw).trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'off' || value === 'no') return false;
  if (value === '1' || value === 'true' || value === 'on' || value === 'yes') return true;
  return FRFC_LIVE_MATCH_WINDOW_ENABLED;
}

function frfcLinkTypeOk(type) {
  return FRFC_LINK_TYPES.indexOf(type) !== -1;
}

function liveHttpUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch (e) {
    return '';
  }
}

function liveWatchUrl(id) {
  const raw = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(raw)) return '';
  return 'https://www.youtube.com/watch?v=' + raw;
}

function upcomingWatchHref(creator, nowMs) {
  const href = liveWatchUrl(creatorField(creator, 'upcomingVideoId', 'upcoming_video_id'));
  if (!href || !Number.isFinite(nowMs)) return '';
  const when = new Date(creatorField(creator, 'upcomingVideoScheduledAt', 'upcoming_video_scheduled_at') || '').getTime();
  if (!Number.isFinite(when)) return '';
  if (when < nowMs - 10 * 60 * 1000 || when > nowMs + LIVE_UPCOMING_BEFORE_MS) return '';
  return href;
}

function creatorFlag(row, camel, snake) {
  if (!row) return false;
  if (row[camel] != null) return !!row[camel];
  return !!row[snake];
}

function creatorField(row, camel, snake) {
  if (!row) return '';
  if (row[camel] != null && row[camel] !== '') return row[camel];
  if (row[snake] != null && row[snake] !== '') return row[snake];
  return '';
}

// Where the club-hub YouTube button goes, and which click type it records.
// Channel clicks stay "channel". Match-window and live destinations are
// "live_hub", never "live", so the existing watch-live metric is unchanged.
function hubYoutubeCta(creator, options) {
  const opts = options || {};
  const enabled = Object.prototype.hasOwnProperty.call(opts, 'enabled')
    ? !!opts.enabled
    : FRFC_LIVE_MATCH_WINDOW_ENABLED;
  const channel = liveHttpUrl(creatorField(creator, 'channel', 'channel_url'));
  const streams = liveHttpUrl(creatorField(creator, 'live', 'live_url'));
  const channelCta = channel ? { href: channel, linkType: 'channel', label: 'YouTube' } : null;
  if (!enabled) return channelCta;
  const isLive = creatorFlag(creator, 'isLive', 'is_live');
  const inWindow = !!opts.inMatchWindow;
  if (!isLive && !inWindow) return channelCta;
  const nowMs = opts.now instanceof Date ? opts.now.getTime() : new Date(opts.now || Date.now()).getTime();
  const liveHref = isLive ? liveWatchUrl(creatorField(creator, 'liveVideoId', 'live_video_id')) : '';
  const upcomingHref = inWindow ? upcomingWatchHref(creator, nowMs) : '';
  const href = liveHref || upcomingHref || streams;
  if (!href) return channelCta;
  return { href: href, linkType: 'live_hub', label: 'Watch live' };
}

// scan: first look in the window (playlist head, at most one search).
// rescan: first run at or after kickoff, playlist only for creators
//         who are still not live and have no upcoming video for this kickoff.
// check: videos.list on the ids already saved. No playlist, no search.
// skip: outside the window, finished, or no clubs on the fixture.
function liveDetectionPhase(fixture, nowMs) {
  if (!fixture) return 'skip';
  const status = String(fixture.status || '').toUpperCase();
  if (status && LIVE_TERMINAL[status]) return 'skip';
  if (!fixture.home_team && !fixture.away_team) return 'skip';
  const kick = new Date(fixture.kickoff_at).getTime();
  if (!Number.isFinite(kick) || !Number.isFinite(nowMs)) return 'skip';
  if (nowMs < kick - LIVE_DETECT_PRE_MS || nowMs >= kick + LIVE_DETECT_POST_MS) return 'skip';
  const sent = fixture.trigger_sent_at ? new Date(fixture.trigger_sent_at).getTime() : NaN;
  if (!Number.isFinite(sent)) return 'scan';
  if (nowMs >= kick && sent < kick) return 'rescan';
  return 'check';
}

function upcomingCoversKickoff(creator, kickoffMs) {
  if (!creator || !creator.upcoming_video_id) return false;
  const when = new Date(creator.upcoming_video_scheduled_at || '').getTime();
  if (!Number.isFinite(when) || !Number.isFinite(kickoffMs)) return false;
  return when >= kickoffMs - LIVE_RESCAN_COVER_BEFORE_MS && when <= kickoffMs + LIVE_RESCAN_COVER_AFTER_MS;
}

function creatorNeedsPlaylist(creator, phase, kickoffMs) {
  if (!creator || !creator.youtube_channel_id) return false;
  if (phase === 'scan') return !creator.is_live;
  if (phase === 'rescan') {
    return !creator.is_live && !upcomingCoversKickoff(creator, kickoffMs);
  }
  return false;
}

function parseLiveItem(item) {
  const details = (item && item.liveStreamingDetails) || {};
  const snippet = (item && item.snippet) || {};
  const started = !!details.actualStartTime;
  const ended = !!details.actualEndTime;
  const isLive = started && !ended;
  const upcoming = !isLive && !ended && !started && (snippet.liveBroadcastContent === 'upcoming' || !!details.scheduledStartTime);
  return {
    isLive: isLive,
    ended: ended,
    upcoming: upcoming,
    scheduledStart: details.scheduledStartTime || null,
    title: snippet.title || '',
  };
}

function creatorLivePatch(creator, fresh, infoById, checkedIds, kickoffMs) {
  const patch = {};
  const checked = checkedIds instanceof Set ? checkedIds : new Set(checkedIds || []);
  const info = infoById || {};
  const freshId = fresh && fresh.videoId;
  if (freshId && freshId !== creator.latest_video_id) {
    patch.latest_video_id = freshId;
    if (fresh.title) patch.latest_video_title = fresh.title;
    if (fresh.publishedAt) patch.latest_video_date = fresh.publishedAt;
    patch.latest_video_thumbnail = 'https://i.ytimg.com/vi/' + freshId + '/mqdefault.jpg';
  }

  const order = [];
  function add(id) {
    if (id && order.indexOf(id) === -1) order.push(id);
  }
  add(freshId);
  if (fresh && fresh.candidates) fresh.candidates.forEach(add);
  add(creator.live_video_id);
  add(creator.upcoming_video_id);
  add(creator.latest_video_id);

  let liveId = null;
  for (let i = 0; i < order.length; i++) {
    const row = info[order[i]];
    if (row && row.isLive) {
      liveId = order[i];
      break;
    }
  }
  if (liveId) {
    if (!creator.is_live || creator.live_video_id !== liveId) {
      patch.is_live = true;
      patch.live_video_id = liveId;
    }
  } else if (creator.is_live || creator.live_video_id) {
    if (order.length && order.every(id => checked.has(id))) {
      patch.is_live = false;
      patch.live_video_id = null;
    }
  }

  let best = null;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const row = info[id];
    if (!row || !row.upcoming || !row.scheduledStart) continue;
    const when = new Date(row.scheduledStart).getTime();
    if (!Number.isFinite(when) || !Number.isFinite(kickoffMs)) continue;
    if (when < kickoffMs - LIVE_UPCOMING_BEFORE_MS || when > kickoffMs + LIVE_UPCOMING_AFTER_MS) continue;
    if (!best || Math.abs(when - kickoffMs) < Math.abs(best.when - kickoffMs)) {
      best = { id: id, when: when, row: row };
    }
  }
  if (best && best.id !== creator.upcoming_video_id) {
    patch.upcoming_video_id = best.id;
    patch.upcoming_video_title = best.row.title || '';
    patch.upcoming_video_thumbnail = 'https://i.ytimg.com/vi/' + best.id + '/mqdefault.jpg';
    patch.upcoming_video_scheduled_at = best.row.scheduledStart;
  } else if (creator.upcoming_video_id && checked.has(creator.upcoming_video_id)) {
    const current = info[creator.upcoming_video_id];
    const still = current && current.upcoming && !current.isLive && !current.ended;
    if (!still) {
      patch.upcoming_video_id = null;
      patch.upcoming_video_title = null;
      patch.upcoming_video_thumbnail = null;
      patch.upcoming_video_scheduled_at = null;
    }
  }
  return patch;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FRFC_LIVE_MATCH_WINDOW_ENABLED,
    FRFC_LINK_TYPES,
    LIVE_DETECT_PRE_MS,
    LIVE_DETECT_POST_MS,
    LIVE_TERMINAL,
    liveMatchWindowEnabled,
    frfcLinkTypeOk,
    hubYoutubeCta,
    liveDetectionPhase,
    upcomingCoversKickoff,
    creatorNeedsPlaylist,
    parseLiveItem,
    creatorLivePatch,
    liveWatchUrl,
  };
}
