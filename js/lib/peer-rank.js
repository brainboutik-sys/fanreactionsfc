/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Verified stats peer rank
   Loaded before app.js (see index.html). creator-stats.js requires this
   file; Netlify bundles that require, so netlify.toml does not list it.

   Public comparison for one creator against the same club:
     * subscriber rank (current totals, ties share a rank)
     * views per video vs the club median
     * week-on-week subscribers from frfc_subscriber_history

   Club identity follows js/lib/club-slugs.js: display name, slug, and
   casing are one club. This file does not read subscriber_count_prev
   or rank_snapshot_at (those were re-baselined on 16 Nov 2026).

   Referral click totals are not computed here. The owner RPC is the
   only place those counts are returned.
   ═══════════════════════════════════════════════════════════════════════════ */

const VIEWS_WINDOW_DAYS = 30;
const WEEK_TARGET_DAYS = 7;
const WEEK_MIN_DAYS = 5;
const WEEK_MAX_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const PEER_RANK_DEFINITION = 'Views per video is the average of each video\'s latest stored view count in the last 30 days (one snapshot per video: the newest recorded_at in that window; a tie keeps the higher view count). The club median is the median of those averages across creators listed under the same club who have at least one snapshot. Week on week compares the latest subscriber snapshot with the earlier snapshot closest to seven days before it, and only when that gap is between 5 and 10 days. Club rank counts creators with the same club (display name, slug, and casing treated as one club) by current subscriber total. Tied totals share a rank. This does not use the 16 November 2026 subscriber snapshot.';

function loadClubMaps() {
  try {
    // Present in Node and in the Netlify bundle. A classic browser script
    // has no require; the catch uses the globals from club-slugs.js.
    return require('./club-slugs.js');
  } catch (e) {
    return {
      CLUB_SLUG_OVERRIDES: typeof CLUB_SLUG_OVERRIDES !== 'undefined' ? CLUB_SLUG_OVERRIDES : {},
      CLUB_SLUG_ALIASES: typeof CLUB_SLUG_ALIASES !== 'undefined' ? CLUB_SLUG_ALIASES : {},
      CLUB_DISPLAY_NAMES: typeof CLUB_DISPLAY_NAMES !== 'undefined' ? CLUB_DISPLAY_NAMES : [],
    };
  }
}

const clubMaps = loadClubMaps();

function slugifyClub(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function canonicalClubSlug(team) {
  if (team == null) return '';
  const raw = String(team).trim();
  if (!raw) return '';
  const names = clubMaps.CLUB_DISPLAY_NAMES || [];
  const overrides = clubMaps.CLUB_SLUG_OVERRIDES || {};
  const aliases = clubMaps.CLUB_SLUG_ALIASES || {};
  const lower = raw.toLowerCase();
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === lower) return overrides[names[i]] || slugifyClub(names[i]);
  }
  const slugged = slugifyClub(raw);
  if (!slugged) return '';
  if (aliases[slugged]) return overrides[aliases[slugged]] || slugifyClub(aliases[slugged]);
  const overrideNames = Object.keys(overrides);
  for (let i = 0; i < overrideNames.length; i++) {
    if (overrides[overrideNames[i]] === slugged) return slugged;
  }
  for (let i = 0; i < names.length; i++) {
    if (slugifyClub(names[i]) === slugged) return overrides[names[i]] || slugged;
  }
  return slugged;
}

function clubLabelForSlug(slug) {
  if (!slug) return '';
  const aliases = clubMaps.CLUB_SLUG_ALIASES || {};
  const overrides = clubMaps.CLUB_SLUG_OVERRIDES || {};
  const names = clubMaps.CLUB_DISPLAY_NAMES || [];
  if (aliases[slug]) return aliases[slug];
  const overrideNames = Object.keys(overrides);
  for (let i = 0; i < overrideNames.length; i++) {
    if (overrides[overrideNames[i]] === slug) return overrideNames[i];
  }
  for (let i = 0; i < names.length; i++) {
    if ((overrides[names[i]] || slugifyClub(names[i])) === slug) return names[i];
  }
  return slug;
}

function rowId(row) {
  if (!row) return '';
  return String(row.id || row.creator_id || '');
}

function rowTeam(row) {
  if (!row || row.team == null) return '';
  return row.team;
}

function subscriberTotal(row) {
  if (!row) return 0;
  const raw = row.subscriber_count != null ? row.subscriber_count : row.subscriberCount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function clockMs(now) {
  if (typeof now === 'number') return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatCount(n) {
  n = Math.round(Number(n) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
  return sign + String(abs);
}

function formatSignedCount(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded > 0) return '+' + formatCount(rounded);
  if (rounded < 0) return formatCount(rounded);
  return '0';
}

function formatUtcDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatGapDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return String(Math.round(rounded));
  return rounded.toFixed(1);
}

function emptyFields() {
  return {
    unavailable: false,
    viewsPending: false,
    weekPending: false,
    clubSlug: '',
    clubLabel: '',
    rank: null,
    clubSize: 0,
    subscriberCount: 0,
    viewsPerVideo: null,
    videoCount: 0,
    clubMedianViewsPerVideo: null,
    clubCreatorsWithVideos: 0,
    weekDelta: null,
    weekFromCount: null,
    weekToCount: null,
    weekFromAt: null,
    weekToAt: null,
    weekGapDays: null,
  };
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildPeerRank(input) {
  const source = input || {};
  const creator = source.creator || {};
  const result = emptyFields();
  result.unavailable = source.unavailable === true;
  result.viewsPending = source.viewsPending === true;
  result.weekPending = source.weekPending === true;
  result.subscriberCount = subscriberTotal(creator);
  if (result.unavailable) return result;

  const slug = canonicalClubSlug(rowTeam(creator));
  result.clubSlug = slug;
  result.clubLabel = slug ? (clubLabelForSlug(slug) || String(rowTeam(creator))) : '';
  const clock = clockMs(source.now);
  const creatorKey = rowId(creator);

  if (slug) {
    const peers = [];
    const seen = new Set();
    const directory = Array.isArray(source.directory) ? source.directory : [];
    for (let i = 0; i < directory.length; i++) {
      const row = directory[i];
      if (canonicalClubSlug(rowTeam(row)) !== slug) continue;
      const id = rowId(row);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      peers.push(row);
    }
    if (creatorKey && !seen.has(creatorKey)) peers.push(creator);
    if (!creatorKey && !peers.length) peers.push(creator);
    const mine = subscriberTotal(creator);
    let ahead = 0;
    for (let i = 0; i < peers.length; i++) {
      if (subscriberTotal(peers[i]) > mine) ahead += 1;
    }
    result.rank = ahead + 1;
    result.clubSize = peers.length;
  }

  const peerIds = new Set();
  if (slug) {
    const directory = Array.isArray(source.directory) ? source.directory : [];
    for (let i = 0; i < directory.length; i++) {
      if (canonicalClubSlug(rowTeam(directory[i])) === slug) {
        const id = rowId(directory[i]);
        if (id) peerIds.add(id);
      }
    }
  }
  if (creatorKey) peerIds.add(creatorKey);

  const cutoff = clock - VIEWS_WINDOW_DAYS * DAY_MS;
  const latest = new Map();
  const metrics = Array.isArray(source.metrics) ? source.metrics : [];
  for (let i = 0; i < metrics.length; i++) {
    const row = metrics[i];
    const id = row && row.creator_id ? String(row.creator_id) : '';
    const videoId = row && row.video_id ? String(row.video_id) : '';
    if (!id || !videoId || (peerIds.size && !peerIds.has(id))) continue;
    const t = Date.parse(row.recorded_at);
    if (!Number.isFinite(t) || t < cutoff || t > clock + 60 * 1000) continue;
    const views = Number(row.views);
    const viewCount = Number.isFinite(views) ? views : 0;
    const key = id + '\0' + videoId;
    const prev = latest.get(key);
    if (!prev || t > prev.t || (t === prev.t && viewCount > prev.views)) {
      latest.set(key, { t: t, views: viewCount, creatorId: id });
    }
  }

  const sums = new Map();
  const counts = new Map();
  for (const snap of latest.values()) {
    sums.set(snap.creatorId, (sums.get(snap.creatorId) || 0) + snap.views);
    counts.set(snap.creatorId, (counts.get(snap.creatorId) || 0) + 1);
  }
  const averages = [];
  for (const [id, count] of counts) averages.push(sums.get(id) / count);
  const myVideos = creatorKey ? (counts.get(creatorKey) || 0) : 0;
  if (myVideos > 0) {
    result.videoCount = myVideos;
    result.viewsPerVideo = sums.get(creatorKey) / myVideos;
  }
  result.clubCreatorsWithVideos = averages.length;
  if (slug && averages.length >= 2) result.clubMedianViewsPerVideo = median(averages);

  const points = [];
  const history = Array.isArray(source.history) ? source.history : [];
  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    const t = Date.parse(row && row.recorded_at);
    const count = Number(row && row.subscriber_count);
    if (!Number.isFinite(t) || t > clock + 60 * 1000 || !Number.isFinite(count)) continue;
    points.push({ t: t, count: count, at: row.recorded_at });
  }
  points.sort((a, b) => a.t - b.t || a.count - b.count);
  if (points.length >= 2) {
    const anchor = points[points.length - 1];
    const target = anchor.t - WEEK_TARGET_DAYS * DAY_MS;
    let best = null;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (point.t >= anchor.t) continue;
      const dist = Math.abs(point.t - target);
      if (!best || dist < best.dist || (dist === best.dist && point.t < best.point.t)) {
        best = { dist: dist, point: point };
      }
    }
    if (best) {
      const gap = anchor.t - best.point.t;
      if (gap >= WEEK_MIN_DAYS * DAY_MS && gap <= WEEK_MAX_DAYS * DAY_MS) {
        result.weekFromCount = best.point.count;
        result.weekToCount = anchor.count;
        result.weekDelta = anchor.count - best.point.count;
        result.weekFromAt = best.point.at;
        result.weekToAt = anchor.at;
        result.weekGapDays = Math.round((gap / DAY_MS) * 10) / 10;
      }
    }
  }
  return result;
}

function normalizeRpcPeerRank(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.club_size == null && data.clubSize == null) return null;
  if (data.clubSlug != null || data.clubSize != null) {
    const copy = emptyFields();
    Object.keys(copy).forEach((key) => {
      if (data[key] !== undefined) copy[key] = data[key];
    });
    copy.unavailable = false;
    return copy;
  }
  const result = emptyFields();
  result.clubSlug = data.club_slug || '';
  result.clubLabel = data.club_label || '';
  result.rank = data.rank == null ? null : finiteOrNull(data.rank);
  result.clubSize = finiteOrNull(data.club_size) || 0;
  result.subscriberCount = finiteOrNull(data.subscriber_count) || 0;
  result.viewsPerVideo = finiteOrNull(data.views_per_video);
  result.videoCount = finiteOrNull(data.video_count) || 0;
  result.clubMedianViewsPerVideo = finiteOrNull(data.club_median_views_per_video);
  result.clubCreatorsWithVideos = finiteOrNull(data.club_creators_with_videos) || 0;
  result.weekDelta = finiteOrNull(data.week_delta);
  result.weekFromCount = finiteOrNull(data.week_from_count);
  result.weekToCount = finiteOrNull(data.week_to_count);
  result.weekFromAt = data.week_from_at || null;
  result.weekToAt = data.week_to_at || null;
  result.weekGapDays = finiteOrNull(data.week_gap_days);
  return result;
}

function peerRankParts(model) {
  const row = model || emptyFields();
  if (row.unavailable) {
    return {
      rankNum: '—',
      rankNote: 'Peer rank could not be loaded.',
      viewsNum: '—',
      viewsNote: 'Peer rank could not be loaded.',
      weekNum: '—',
      weekNote: 'Peer rank could not be loaded.',
    };
  }
  let rankNum = '—';
  let rankNote = 'No club is listed for this channel, so there is no peer rank.';
  if (row.clubSlug && row.clubSize <= 1) {
    rankNum = '1 of 1';
    rankNote = 'Only creator listed for ' + row.clubLabel + '.';
  } else if (row.clubSlug && row.rank != null) {
    rankNum = row.rank + ' of ' + row.clubSize;
    rankNote = 'By current subscribers among ' + row.clubLabel + ' creators. Tied totals share a rank.';
  }

  let viewsNum = '—';
  let viewsNote = 'No video snapshots in the last 30 days.';
  if (row.viewsPending && row.viewsPerVideo == null) {
    viewsNote = 'Loading the last 30 days of video snapshots…';
  } else if (row.viewsPerVideo != null) {
    viewsNum = formatCount(row.viewsPerVideo);
    const videos = row.videoCount === 1 ? '1 video' : String(row.videoCount) + ' videos';
    if (!row.clubSlug) {
      viewsNote = 'Average of ' + videos + ' with a snapshot in the last 30 days. No club is listed, so there is no club median.';
    } else if (row.clubCreatorsWithVideos < 2 || row.clubMedianViewsPerVideo == null) {
      viewsNote = 'Average of ' + videos + ' with a snapshot in the last 30 days. No other ' + row.clubLabel + ' creator has one, so there is no club median yet.';
    } else {
      const medianViews = row.clubMedianViewsPerVideo;
      const medianLabel = formatCount(medianViews);
      let relation;
      if (!(medianViews > 0)) relation = 'The club median is 0.';
      else {
        const ratio = row.viewsPerVideo / medianViews;
        if (ratio >= 0.95 && ratio <= 1.05) relation = 'In line with the club median of ' + medianLabel + '.';
        else relation = ratio.toFixed(1) + '× the club median of ' + medianLabel + '.';
      }
      viewsNote = 'Average of ' + videos + '. ' + relation;
    }
  }

  let weekNum = '—';
  let weekNote = 'Not enough subscriber history for a week-on-week comparison. That needs the latest snapshot and an earlier one about 7 days before it (a gap of 5 to 10 days).';
  if (row.weekPending && row.weekDelta == null) {
    weekNote = 'Loading subscriber history…';
  } else if (row.weekDelta != null) {
    weekNum = formatSignedCount(row.weekDelta);
    const fromDate = formatUtcDate(row.weekFromAt);
    const toDate = formatUtcDate(row.weekToAt);
    weekNote = 'From ' + formatCount(row.weekFromCount) + (fromDate ? ' on ' + fromDate : '')
      + ' to ' + formatCount(row.weekToCount) + (toDate ? ' on ' + toDate : '')
      + ' (' + formatGapDays(row.weekGapDays) + ' days).';
  }
  return { rankNum: rankNum, rankNote: rankNote, viewsNum: viewsNum, viewsNote: viewsNote, weekNum: weekNum, weekNote: weekNote };
}

function peerRankSectionHtml(model, esc) {
  const e = typeof esc === 'function' ? esc : (s) => String(s == null ? '' : s);
  const parts = peerRankParts(model);
  return '<section class="stats-peers" id="creator-peer-rank" aria-label="Peer rank">'
    + '<h3 class="stats-uploads-title">Peer rank</h3>'
    + '<div class="stats-metrics stats-peers-metrics">'
    + '<div class="stats-metric"><div class="stats-metric-label">Club rank</div><div class="stats-metric-num">' + e(parts.rankNum) + '</div><p class="stats-metric-note">' + e(parts.rankNote) + '</p></div>'
    + '<div class="stats-metric"><div class="stats-metric-label">Views per video</div><div class="stats-metric-num">' + e(parts.viewsNum) + '</div><p class="stats-metric-note">' + e(parts.viewsNote) + '</p></div>'
    + '<div class="stats-metric"><div class="stats-metric-label">Subscribers, week on week</div><div class="stats-metric-num">' + e(parts.weekNum) + '</div><p class="stats-metric-note">' + e(parts.weekNote) + '</p></div>'
    + '</div>'
    + '<p class="stats-footnote">' + e(PEER_RANK_DEFINITION) + '</p>'
    + '</section>';
}

function shouldRequestReferralClicks(userId, claimedBy) {
  if (!userId || !claimedBy) return false;
  return String(userId) === String(claimedBy);
}

function referralClickCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function referralClicksModel(rows) {
  const model = {
    channel: { days7: 0, days30: 0 },
    live: { days7: 0, days30: 0 },
  };
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!row || (row.link_type !== 'channel' && row.link_type !== 'live')) continue;
    model[row.link_type] = {
      days7: referralClickCount(row.clicks_7d),
      days30: referralClickCount(row.clicks_30d),
    };
  }
  return model;
}

function referralClicksHtml(rows, esc) {
  const e = typeof esc === 'function' ? esc : (s) => String(s == null ? '' : s);
  const model = referralClicksModel(rows);
  function cell(label, bucket) {
    return '<div class="stats-referral-stat"><div class="stats-referral-label">' + e(label) + '</div>'
      + '<div class="stats-referral-line">Last 7 days <strong>' + e(String(bucket.days7)) + '</strong></div>'
      + '<div class="stats-referral-line">Last 30 days <strong>' + e(String(bucket.days30)) + '</strong></div></div>';
  }
  return '<section class="stats-referrals" id="creator-referral-clicks" aria-label="Referral clicks">'
    + '<h3>Referral clicks</h3>'
    + '<p class="stats-referrals-note">Clicks on the channel and watch-live links this site sent to your profile, over the last 7 and 30 days. Only the channel owner can see this. Poll clicks are not included.</p>'
    + '<div class="stats-referrals-grid">'
    + cell('Channel link', model.channel)
    + cell('Watch live', model.live)
    + '</div></section>';
}

function videoMetricsQuery(ids, sinceIso) {
  const clean = [];
  const seen = new Set();
  const list = Array.isArray(ids) ? ids : [];
  for (let i = 0; i < list.length; i++) {
    const id = String(list[i] || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(id);
  }
  if (!clean.length) return '';
  return 'select=creator_id,video_id,views,recorded_at&creator_id=in.(' + clean.join(',')
    + ')&recorded_at=gte.' + encodeURIComponent(sinceIso)
    + '&order=creator_id.asc,video_id.asc,recorded_at.desc';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VIEWS_WINDOW_DAYS,
    WEEK_TARGET_DAYS,
    WEEK_MIN_DAYS,
    WEEK_MAX_DAYS,
    PEER_RANK_DEFINITION,
    canonicalClubSlug,
    clubLabelForSlug,
    buildPeerRank,
    normalizeRpcPeerRank,
    peerRankParts,
    peerRankSectionHtml,
    shouldRequestReferralClicks,
    referralClicksModel,
    referralClicksHtml,
    videoMetricsQuery,
    formatCount,
    formatSignedCount,
  };
}
