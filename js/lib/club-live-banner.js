/* FanReactionsFC — club-page watch-live banner.
   Loaded before app.js (see index.html). One switch hides the whole
   thing: set CLUB_LIVE_BANNER_ENABLED to false.

   Club hubs previously showed a non-clickable "N live" tag and channel
   links only. This banner is the live-stream link (data-frfc-link="live",
   the same click row the rest of the site already sends). It appears
   when a creator for that club is live, or when frfc_fixtures says the
   club is inside the match window. Fixture rows stay TIMED after
   kickoff, so the window is kickoff minus CLUB_LIVE_PRE_MS through
   kickoff plus CLUB_LIVE_MATCH_MS. A terminal status (finished,
   postponed, cancelled) hides it even inside that window. */

const CLUB_LIVE_BANNER_ENABLED = true;
const CLUB_LIVE_PRE_MS = 45 * 60 * 1000;
const CLUB_LIVE_MATCH_MS = 130 * 60 * 1000;

const CLUB_LIVE_COMPETITIONS = {
  PL: 'Premier League',
  ELC: 'Championship',
  PD: 'La Liga',
  SA: 'Serie A',
  BL1: 'Bundesliga',
  FL1: 'Ligue 1',
  CL: 'Champions League',
  WC: 'World Cup',
};

const CLUB_LIVE_TERMINAL = {
  FINISHED: true,
  AWARDED: true,
  CANCELLED: true,
  CANCELED: true,
  POSTPONED: true,
  SUSPENDED: true,
};

function clubLiveEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clubLiveHttpUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch (e) {
    return '';
  }
}

function clubLiveWatchUrl(id) {
  const raw = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(raw)) return '';
  return 'https://www.youtube.com/watch?v=' + raw;
}

function clubLiveSlug(c) {
  return String(c && c.slug || '').trim();
}

function clubLiveVerified(row, now) {
  if (typeof isCurrentlyVerified === 'function') return isCurrentlyVerified(row, now);
  if (!row || row.isVerified !== true) return false;
  const until = row.verifiedUntil;
  if (until == null || until === '') return true;
  const ts = new Date(until).getTime();
  const clock = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(ts) && ts > clock;
}

function clubLiveRank(a, b, now) {
  const av = clubLiveVerified(a, now) ? 1 : 0;
  const bv = clubLiveVerified(b, now) ? 1 : 0;
  if (av !== bv) return bv - av;
  const asubs = Number(a && a.subscriberCount) || 0;
  const bsubs = Number(b && b.subscriberCount) || 0;
  if (asubs !== bsubs) return bsubs - asubs;
  return String(a && a.name || '').localeCompare(String(b && b.name || ''));
}

function clubLiveSame(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  return left !== '' && left === right;
}

function clubLiveKickoffPhrase(kickoffMs, nowMs) {
  const diff = kickoffMs - nowMs;
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 1) return diff > 0 ? 'kicks off now' : 'just kicked off';
  const unit = mins === 1 ? 'minute' : 'minutes';
  if (diff > 0) return 'kicks off in ' + mins + ' ' + unit;
  return 'kicked off ' + mins + ' ' + unit + ' ago';
}

function clubLiveFixture(fixtures, club, nowMs) {
  let best = null;
  (fixtures || []).forEach(row => {
    if (!row) return;
    const status = String(row.status || '').toUpperCase();
    if (CLUB_LIVE_TERMINAL[status]) return;
    if (!clubLiveSame(row.home_team, club) && !clubLiveSame(row.away_team, club)) return;
    const kickoffMs = new Date(row.kickoff_at).getTime();
    if (!Number.isFinite(kickoffMs)) return;
    if (nowMs < kickoffMs - CLUB_LIVE_PRE_MS || nowMs >= kickoffMs + CLUB_LIVE_MATCH_MS) return;
    const on = nowMs >= kickoffMs;
    const candidate = { row, kickoffMs, on };
    if (!best) {
      best = candidate;
      return;
    }
    if (candidate.on !== best.on) {
      if (candidate.on) best = candidate;
      return;
    }
    const candidateDist = Math.abs(candidate.kickoffMs - nowMs);
    const bestDist = Math.abs(best.kickoffMs - nowMs);
    if (candidateDist < bestDist) best = candidate;
  });
  return best;
}

function clubLiveFixtureText(match, club) {
  const home = String(match.row.home_team || '').trim();
  const away = String(match.row.away_team || '').trim();
  const comp = CLUB_LIVE_COMPETITIONS[String(match.row.competition_code || '').toUpperCase()] || '';
  const phrase = clubLiveKickoffPhrase(match.kickoffMs, match.nowMs);
  let who = '';
  if (home && away) who = home + ' vs ' + away;
  else if (club) who = club;
  const body = who ? who + ' ' + phrase : 'Kickoff ' + phrase.replace(/^kicks off/, 'is').replace(/^kicked off/, 'was');
  return comp ? comp + ' · ' + body : body;
}

function clubLiveHref(c, kind) {
  if (!clubLiveSlug(c)) return '';
  if (kind === 'stream') return clubLiveWatchUrl(c.liveVideoId || c.live_video_id);
  if (kind === 'upcoming') return clubLiveWatchUrl(c.upcomingVideoId || c.upcoming_video_id);
  if (kind === 'page') return clubLiveHttpUrl(c.live || c.live_url);
  return '';
}

function clubLiveUpcoming(c, match, nowMs) {
  if (!match) return false;
  const when = new Date(c.upcomingVideoScheduledAt || c.upcoming_video_scheduled_at || '').getTime();
  if (!Number.isFinite(when)) return false;
  if (when < match.kickoffMs - CLUB_LIVE_PRE_MS || when > match.kickoffMs + 20 * 60 * 1000) return false;
  if (when < nowMs - 10 * 60 * 1000) return false;
  return !!clubLiveHref(c, 'upcoming');
}

function clubLiveBannerModel(input) {
  const club = String(input && input.club || '').trim();
  if (!club) return null;
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  const mine = (input.creators || []).filter(c => c && clubLiveSame(c.team, club));
  const match = clubLiveFixture(input.fixtures, club, nowMs);
  if (match) match.nowMs = nowMs;
  const streaming = mine
    .filter(c => c.isLive && (clubLiveHref(c, 'stream') || clubLiveHref(c, 'page')))
    .slice()
    .sort((a, b) => clubLiveRank(a, b, now));

  const links = [];
  streaming.forEach(c => {
    const href = clubLiveHref(c, 'stream') || clubLiveHref(c, 'page');
    if (!href) return;
    links.push({
      name: String(c.name || 'Creator'),
      slug: clubLiveSlug(c),
      href: href,
      live: true,
    });
  });

  let phase = links.length ? 'streaming' : '';
  if (!links.length && match) {
    const upcoming = mine
      .filter(c => clubLiveUpcoming(c, match, nowMs))
      .slice()
      .sort((a, b) => {
        const ad = Math.abs(new Date(a.upcomingVideoScheduledAt || a.upcoming_video_scheduled_at).getTime() - match.kickoffMs);
        const bd = Math.abs(new Date(b.upcomingVideoScheduledAt || b.upcoming_video_scheduled_at).getTime() - match.kickoffMs);
        if (ad !== bd) return ad - bd;
        return clubLiveRank(a, b, now);
      });
    if (upcoming.length) {
      const c = upcoming[0];
      links.push({
        name: String(c.name || 'Creator'),
        slug: clubLiveSlug(c),
        href: clubLiveHref(c, 'upcoming'),
        live: false,
      });
    } else {
      const pages = mine
        .filter(c => clubLiveHref(c, 'page'))
        .slice()
        .sort((a, b) => clubLiveRank(a, b, now));
      if (pages.length) {
        const c = pages[0];
        links.push({
          name: String(c.name || 'Creator'),
          slug: clubLiveSlug(c),
          href: clubLiveHref(c, 'page'),
          live: false,
        });
      }
    }
    if (links.length) phase = match.on ? 'on' : 'soon';
  } else if (links.length && match) {
    phase = 'streaming';
  }

  if (!phase || !links.length) return null;

  const fixtureText = match ? clubLiveFixtureText(match, club) : '';
  let detail = '';
  if (phase === 'streaming') {
    const lead = links[0].name;
    const extra = streaming.length - 1;
    if (extra <= 0) detail = lead + ' is streaming now.';
    else if (extra === 1) detail = lead + ' and 1 other ' + club + ' creator are live.';
    else detail = lead + ' and ' + extra + ' other ' + club + ' creators are live.';
    if (fixtureText) detail += ' ' + fixtureText + '.';
  } else {
    detail = fixtureText + '.';
  }

  return {
    phase: phase,
    title: 'Watch live now',
    detail: detail,
    links: links.slice(0, 4),
  };
}

function clubLiveTrack(slug, club) {
  if (!slug) return '';
  return ' data-frfc-link="live" data-frfc-creator="' + clubLiveEscape(slug) + '" data-frfc-club="' + clubLiveEscape(club) + '"';
}

function clubLiveBannerHtml(input) {
  const enabled = input && Object.prototype.hasOwnProperty.call(input, 'enabled')
    ? input.enabled
    : CLUB_LIVE_BANNER_ENABLED;
  if (!enabled) return '';
  const model = clubLiveBannerModel(input || {});
  if (!model) return '';
  const club = String(input.club || '').trim();
  const primary = model.links[0];
  const rest = model.links.slice(1).filter(link => link.live);
  const also = rest.length
    ? '<span class="club-live-banner-also-label">Also live</span>' + rest.map(link =>
      '<a class="club-live-banner-also" href="' + clubLiveEscape(link.href) + '" target="_blank" rel="noopener"' + clubLiveTrack(link.slug, club) + '>' + clubLiveEscape(link.name) + '</a>'
    ).join('')
    : '';
  return '<section class="club-live-banner" data-club-live-banner="' + clubLiveEscape(model.phase) + '" aria-label="Watch live now">' +
    '<div class="club-live-banner-copy">' +
      '<span class="live-dot-sm" aria-hidden="true"></span>' +
      '<div>' +
        '<div class="club-live-banner-title">' + clubLiveEscape(model.title) + '</div>' +
        '<p class="club-live-banner-detail">' + clubLiveEscape(model.detail) + '</p>' +
      '</div>' +
    '</div>' +
    '<div class="club-live-banner-actions">' +
      '<a class="btn btn-accent btn-pill" href="' + clubLiveEscape(primary.href) + '" target="_blank" rel="noopener"' + clubLiveTrack(primary.slug, club) + '>Watch live now</a>' +
      also +
    '</div>' +
  '</section>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CLUB_LIVE_BANNER_ENABLED,
    CLUB_LIVE_PRE_MS,
    CLUB_LIVE_MATCH_MS,
    clubLiveBannerModel,
    clubLiveBannerHtml,
  };
}
