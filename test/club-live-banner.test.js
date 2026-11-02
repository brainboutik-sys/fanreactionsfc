const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lib = require('../js/lib/club-live-banner.js');

const KICK = new Date('2026-11-02T20:00:00.000Z');
const PRE = 45 * 60 * 1000;
const MATCH = 130 * 60 * 1000;

function at(offsetMs) {
  return new Date(KICK.getTime() + offsetMs);
}

function fixture(over) {
  return Object.assign({
    home_team: 'Newcastle',
    away_team: 'Everton',
    kickoff_at: KICK.toISOString(),
    competition_code: 'PL',
    status: 'TIMED',
  }, over || {});
}

function creator(over) {
  return Object.assign({
    name: 'TheKickOff',
    slug: 'thekickoff',
    team: 'Newcastle',
    subscriberCount: 426000,
    isLive: false,
    live: 'https://www.youtube.com/@TheKickOff/streams',
  }, over || {});
}

function banner(over) {
  return lib.clubLiveBannerHtml(Object.assign({
    enabled: true,
    club: 'Newcastle',
    creators: [creator()],
    fixtures: [fixture()],
    now: at(-10 * 60 * 1000),
  }, over || {}));
}

test('the banner ships behind one boolean switch', () => {
  assert.equal(typeof lib.CLUB_LIVE_BANNER_ENABLED, 'boolean');
  assert.equal(lib.CLUB_LIVE_BANNER_ENABLED, true);
  assert.equal(lib.CLUB_LIVE_PRE_MS, PRE);
  assert.equal(lib.CLUB_LIVE_MATCH_MS, MATCH);
  const html = lib.clubLiveBannerHtml({
    enabled: false,
    club: 'Newcastle',
    creators: [creator({ isLive: true, liveVideoId: 'abcdefghijk' })],
    fixtures: [fixture()],
    now: KICK,
  });
  assert.equal(html, '');
});

test('no banner outside the match window when nobody is live', () => {
  assert.equal(banner({ now: at(-(PRE + 60 * 1000)), fixtures: [fixture()] }), '');
  assert.equal(banner({ now: at(MATCH), fixtures: [fixture()] }), '');
  assert.equal(banner({ fixtures: [], now: KICK }), '');
  assert.equal(banner({
    now: at(-10 * 60 * 1000),
    fixtures: [fixture({ status: 'FINISHED' })],
  }), '');
  assert.equal(banner({
    now: KICK,
    fixtures: [fixture({ status: 'POSTPONED' })],
  }), '');
});

test('match window links the top creator streams page and names the fixture', () => {
  const html = banner({
    now: at(-PRE),
    creators: [
      creator({ name: 'Smaller', slug: 'smaller', subscriberCount: 10 }),
      creator(),
      creator({ name: 'Arsenal Fan', slug: 'aftv', team: 'Arsenal', isLive: true, liveVideoId: 'abcdefghijk' }),
    ],
  });
  assert.match(html, /data-club-live-banner="soon"/);
  assert.match(html, /Watch live now/);
  assert.match(html, /Premier League · Newcastle vs Everton kicks off in 45 minutes\./);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/@TheKickOff\/streams"/);
  assert.match(html, /data-frfc-link="live"/);
  assert.match(html, /data-frfc-creator="thekickoff"/);
  assert.match(html, /data-frfc-club="Newcastle"/);
  assert.doesNotMatch(html, /data-frfc-link="channel"/);
  assert.doesNotMatch(html, /aftv|abcdefghijk/);
});

test('the same kickoff is shown on the away club page', () => {
  const html = banner({
    club: 'Everton',
    now: at(34 * 60 * 1000),
    creators: [creator({
      name: 'Toffee',
      slug: 'toffee',
      team: 'Everton',
      live: 'https://www.youtube.com/@Toffee/streams',
    })],
  });
  assert.match(html, /data-club-live-banner="on"/);
  assert.match(html, /Premier League · Newcastle vs Everton kicked off 34 minutes ago\./);
  assert.match(html, /data-frfc-club="Everton"/);
});

test('a scheduled stream in the window beats the generic streams page', () => {
  const html = banner({
    now: at(-10 * 60 * 1000),
    creators: [creator({
      upcomingVideoId: 'zzzzzzzzzzz',
      upcomingVideoScheduledAt: KICK.toISOString(),
    })],
  });
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=zzzzzzzzzzz"/);
  assert.doesNotMatch(html, /\/streams"/);
});

test('an old scheduled stream is not reused deep into the match', () => {
  const html = banner({
    now: at(80 * 60 * 1000),
    creators: [creator({
      upcomingVideoId: 'zzzzzzzzzzz',
      upcomingVideoScheduledAt: KICK.toISOString(),
    })],
  });
  assert.match(html, /href="https:\/\/www\.youtube\.com\/@TheKickOff\/streams"/);
  assert.doesNotMatch(html, /zzzzzzzzzzz/);
});

test('a live creator shows a watch link even with no fixture', () => {
  const html = banner({
    club: 'Arsenal',
    fixtures: [],
    now: at(-5 * 60 * 60 * 1000),
    creators: [creator({
      name: 'AFTV <script>',
      slug: 'aftv',
      team: 'Arsenal',
      isLive: true,
      liveVideoId: 'abcdefghijk',
      live: 'javascript:alert(1)',
    })],
  });
  assert.match(html, /data-club-live-banner="streaming"/);
  assert.match(html, /AFTV &lt;script&gt; is streaming now\./);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk"/);
  assert.match(html, /data-frfc-link="live" data-frfc-creator="aftv" data-frfc-club="Arsenal"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<script>/);
});

test('verified live creator leads, and other live creators stay tracked links', () => {
  const html = banner({
    fixtures: [fixture()],
    now: at(5 * 60 * 1000),
    creators: [
      creator({ name: 'Bigger', slug: 'bigger', subscriberCount: 900000, isLive: true, liveVideoId: 'bbbbbbbbbbb' }),
      creator({ name: 'Verified', slug: 'verified-one', subscriberCount: 20, isVerified: true, isLive: true, liveVideoId: 'aaaaaaaaaaa' }),
      creator({ name: 'Third', slug: 'third', subscriberCount: 5, isLive: true, liveVideoId: 'ccccccccccc' }),
    ],
  });
  const slugs = [...html.matchAll(/data-frfc-creator="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(slugs, ['verified-one', 'bigger', 'third']);
  assert.match(html, /Verified and 2 other Newcastle creators are live\./);
  assert.match(html, /Premier League · Newcastle vs Everton kicked off 5 minutes ago\./);
  assert.equal(html.includes('data-frfc-link="live"'), true);
  assert.equal(html.includes('data-frfc-link="channel"'), false);
});

test('a live creator with only a javascript url does not invent a link', () => {
  assert.equal(banner({
    fixtures: [],
    creators: [creator({ isLive: true, liveVideoId: 'nope', live: 'javascript:alert(1)' })],
  }), '');
});

test('one other live creator uses the singular', () => {
  const html = banner({
    fixtures: [],
    creators: [
      creator({ isLive: true, liveVideoId: 'aaaaaaaaaaa' }),
      creator({ name: 'Other', slug: 'other', subscriberCount: 1, isLive: true, liveVideoId: 'bbbbbbbbbbb' }),
    ],
  });
  assert.match(html, /TheKickOff and 1 other Newcastle creator are live\./);
});

test('club pages render the banner in the hero and load the one switch first', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8');
  const bannerAt = html.indexOf('/js/lib/club-live-banner.js');
  const appAt = html.indexOf('/js/app.js');
  assert.ok(bannerAt > -1 && appAt > bannerAt);
  assert.match(app, /function loadClubLiveFixtures/);
  assert.match(app, /frfc_fixtures/);
  assert.match(app, /home_team,away_team,kickoff_at,competition_code,status/);
  assert.doesNotMatch(app, /trigger_sent_at/);
  assert.equal((app.match(/clubLiveBannerFor\(/g) || []).length >= 3, true);
  assert.match(app, /\$\{liveBanner\}/);
  assert.match(css, /\.club-live-banner\{/);
  assert.match(css, /\.page-hero-actions\{display:none\}/);
  const heroActions = css.indexOf('.page-hero-actions{display:none}');
  const bannerRule = css.indexOf('.club-live-banner{');
  assert.ok(bannerRule > -1 && heroActions > -1);
  assert.equal(css.slice(bannerRule, bannerRule + 400).includes('display:none'), false);
});
