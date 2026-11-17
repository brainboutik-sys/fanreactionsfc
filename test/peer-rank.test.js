const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const peer = require('../js/lib/peer-rank.js');
const clubs = require('../js/lib/club-slugs.js');
const stats = require('../netlify/functions/creator-stats.js');

const NOW = Date.parse('2026-11-17T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function creator(id, team, subs) {
  return { id: id, team: team, subscriber_count: subs };
}

function iso(ms) {
  return new Date(ms).toISOString();
}

test('club names, slugs, and casing are one club', () => {
  assert.equal(peer.canonicalClubSlug('Man United'), 'manchester-united');
  assert.equal(peer.canonicalClubSlug('man united'), 'manchester-united');
  assert.equal(peer.canonicalClubSlug('MAN UNITED'), 'manchester-united');
  assert.equal(peer.canonicalClubSlug('manchester-united'), 'manchester-united');
  assert.equal(peer.canonicalClubSlug('Manchester United'), 'manchester-united');
  assert.equal(peer.canonicalClubSlug('Arsenal'), peer.canonicalClubSlug('arsenal'));
  assert.equal(peer.canonicalClubSlug('Multi-Club / Other'), 'multi-club');
  assert.equal(peer.canonicalClubSlug('multi-club'), 'multi-club');
  assert.equal(peer.canonicalClubSlug(''), '');
  assert.equal(peer.canonicalClubSlug(null), '');
  assert.equal(peer.clubLabelForSlug('manchester-united'), 'Man United');
  assert.equal(peer.clubLabelForSlug('multi-club'), 'Multi-Club / Other');
});

test('subscriber rank is within the normalised club and ignores the re-baselined snapshot', () => {
  const directory = [
    creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 500),
    creator('22222222-2222-4222-8222-222222222222', 'arsenal', 500),
    creator('33333333-3333-4333-8333-333333333333', 'Man United', 900),
    creator('44444444-4444-4444-8444-444444444444', 'manchester-united', 100),
    creator('55555555-5555-4555-8555-555555555555', 'Chelsea', 5000),
  ];
  const tied = peer.buildPeerRank({
    creator: Object.assign({ subscriber_count_prev: 1, rank_snapshot_at: '2026-11-16T00:00:00Z' }, directory[1]),
    directory: directory,
    metrics: [],
    history: [],
    now: NOW,
  });
  assert.equal(tied.rank, 1);
  assert.equal(tied.clubSize, 2);
  assert.equal(tied.clubLabel, 'Arsenal');
  assert.equal(tied.subscriberCount, 500);

  const united = peer.buildPeerRank({
    creator: directory[3],
    directory: directory,
    metrics: [],
    history: [],
    now: NOW,
  });
  assert.equal(united.rank, 2);
  assert.equal(united.clubSize, 2);
  assert.equal(united.clubLabel, 'Man United');

  const alone = peer.buildPeerRank({
    creator: creator('66666666-6666-4666-8666-666666666666', 'Brentford', 10),
    directory: directory.concat([creator('66666666-6666-4666-8666-666666666666', 'Brentford', 10)]),
    metrics: [],
    history: [],
    now: NOW,
  });
  assert.equal(alone.rank, 1);
  assert.equal(alone.clubSize, 1);

  const noClub = peer.buildPeerRank({
    creator: creator('77777777-7777-4777-8777-777777777777', '', 10),
    directory: [],
    metrics: [],
    history: [],
    now: NOW,
  });
  assert.equal(noClub.rank, null);
  assert.equal(noClub.clubSize, 0);
});

test('views per video use the latest snapshot in 30 days and the club median', () => {
  const arsenalA = '11111111-1111-4111-8111-111111111111';
  const arsenalB = '22222222-2222-4222-8222-222222222222';
  const chelsea = '55555555-5555-4555-8555-555555555555';
  const directory = [
    creator(arsenalA, 'Arsenal', 10),
    creator(arsenalB, 'Arsenal', 20),
    creator(chelsea, 'Chelsea', 30),
  ];
  const metrics = [
    { creator_id: arsenalA, video_id: 'aaaaaaaaaaa', views: 100, recorded_at: iso(NOW - 10 * DAY) },
    { creator_id: arsenalA, video_id: 'aaaaaaaaaaa', views: 400, recorded_at: iso(NOW - 2 * DAY) },
    { creator_id: arsenalA, video_id: 'aaaaaaaaaaa', views: 50, recorded_at: iso(NOW - 2 * DAY) },
    { creator_id: arsenalA, video_id: 'bbbbbbbbbbb', views: 200, recorded_at: iso(NOW - 1 * DAY) },
    { creator_id: arsenalA, video_id: 'ccccccccccc', views: 9999, recorded_at: iso(NOW - 40 * DAY) },
    { creator_id: arsenalB, video_id: 'ddddddddddd', views: 100, recorded_at: iso(NOW - 3 * DAY) },
    { creator_id: arsenalB, video_id: 'eeeeeeeeeee', views: 300, recorded_at: iso(NOW - 3 * DAY) },
    { creator_id: chelsea, video_id: 'fffffffffff', views: 9000, recorded_at: iso(NOW - 1 * DAY) },
  ];
  const model = peer.buildPeerRank({
    creator: directory[0],
    directory: directory,
    metrics: metrics,
    history: [],
    now: NOW,
  });
  // Latest aaaaa is 400 (higher view count wins the same timestamp). bbbbb is 200.
  // The 40-day snapshot and the Chelsea video are ignored. Average is 300.
  assert.equal(model.videoCount, 2);
  assert.equal(model.viewsPerVideo, 300);
  assert.equal(model.clubCreatorsWithVideos, 2);
  // Other Arsenal creator averages (100+300)/2 = 200. Median of 300 and 200 is 250.
  assert.equal(model.clubMedianViewsPerVideo, 250);

  const only = peer.buildPeerRank({
    creator: directory[0],
    directory: [directory[0]],
    metrics: metrics,
    history: [],
    now: NOW,
  });
  assert.equal(only.viewsPerVideo, 300);
  assert.equal(only.clubMedianViewsPerVideo, null);
  assert.equal(only.clubCreatorsWithVideos, 1);

  const none = peer.buildPeerRank({
    creator: directory[0],
    directory: directory,
    metrics: [],
    history: [],
    now: NOW,
  });
  assert.equal(none.viewsPerVideo, null);
  assert.equal(none.videoCount, 0);
});

test('week on week uses the snapshot closest to seven days before the latest', () => {
  const history = [
    { subscriber_count: 1000, recorded_at: iso(NOW - 8 * DAY) },
    { subscriber_count: 1100, recorded_at: iso(NOW - 6 * DAY) },
    { subscriber_count: 1500, recorded_at: iso(NOW - 1 * DAY) },
    { subscriber_count: 1400, recorded_at: iso(NOW - DAY) },
    { subscriber_count: 50, subscriber_count_prev: 1, recorded_at: iso(NOW - 20 * DAY) },
  ];
  const model = peer.buildPeerRank({
    creator: creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 9999),
    directory: [],
    metrics: [],
    history: history,
    now: NOW,
  });
  // Latest is 1500 one day ago. Seven days before that is 8 days ago, which
  // is closer than the point 6 days ago. The 20-day point is outside 5–10.
  assert.equal(model.weekFromCount, 1000);
  assert.equal(model.weekToCount, 1500);
  assert.equal(model.weekDelta, 500);
  assert.equal(model.weekGapDays, 7);

  const tooClose = peer.buildPeerRank({
    creator: creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 10),
    directory: [],
    metrics: [],
    history: [
      { subscriber_count: 10, recorded_at: iso(NOW - 2 * DAY) },
      { subscriber_count: 12, recorded_at: iso(NOW - DAY) },
    ],
    now: NOW,
  });
  assert.equal(tooClose.weekDelta, null);

  const tooFar = peer.buildPeerRank({
    creator: creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 10),
    directory: [],
    metrics: [],
    history: [
      { subscriber_count: 10, recorded_at: iso(NOW - 14 * DAY) },
      { subscriber_count: 12, recorded_at: iso(NOW - DAY) },
    ],
    now: NOW,
  });
  assert.equal(tooFar.weekDelta, null);

  const single = peer.buildPeerRank({
    creator: creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 10),
    directory: [],
    metrics: [],
    history: [{ subscriber_count: 10, recorded_at: iso(NOW - DAY) }],
    now: NOW,
  });
  assert.equal(single.weekDelta, null);

  const edges = [5, 10];
  for (const days of edges) {
    const edge = peer.buildPeerRank({
      creator: creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 10),
      directory: [],
      metrics: [],
      history: [
        { subscriber_count: 4, recorded_at: iso(NOW - days * DAY) },
        { subscriber_count: 9, recorded_at: iso(NOW) },
      ],
      now: NOW,
    });
    assert.equal(edge.weekDelta, 5, days + ' days should count');
    assert.equal(edge.weekGapDays, days);
  }
});

test('the public block states the definition and does not print click totals', () => {
  const model = peer.buildPeerRank({
    creator: creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 1200),
    directory: [
      creator('11111111-1111-4111-8111-111111111111', 'Arsenal', 1200),
      creator('22222222-2222-4222-8222-222222222222', 'Arsenal', 400),
    ],
    metrics: [
      { creator_id: '11111111-1111-4111-8111-111111111111', video_id: 'aaaaaaaaaaa', views: 3000, recorded_at: iso(NOW - DAY) },
      { creator_id: '22222222-2222-4222-8222-222222222222', video_id: 'bbbbbbbbbbb', views: 1000, recorded_at: iso(NOW - DAY) },
    ],
    history: [
      { subscriber_count: 1000, recorded_at: iso(NOW - 7 * DAY) },
      { subscriber_count: 1200, recorded_at: iso(NOW) },
    ],
    now: NOW,
  });
  const html = peer.peerRankSectionHtml(model, (s) => String(s));
  assert.match(html, /id="creator-peer-rank"/);
  assert.match(html, /1 of 2/);
  assert.match(html, /3\.0K/);
  assert.match(html, /1\.5× the club median/);
  assert.match(html, /\+200/);
  assert.match(html, /last 30 days/);
  assert.match(html, /between 5 and 10 days/);
  assert.match(html, /16 November 2026/);
  assert.doesNotMatch(html, /subscriber_count_prev|rank_snapshot_at|frfc_link_clicks|Referral clicks|clicks_7d/);

  const thin = peer.peerRankSectionHtml(peer.buildPeerRank({
    creator: creator('11111111-1111-4111-8111-111111111111', 'Brentford', 8),
    directory: [creator('11111111-1111-4111-8111-111111111111', 'Brentford', 8)],
    metrics: [],
    history: [],
    now: NOW,
  }), (s) => String(s));
  assert.match(thin, /1 of 1/);
  assert.match(thin, /Only creator listed for Brentford/);
  assert.match(thin, /No video snapshots in the last 30 days/);
  assert.match(thin, /Not enough subscriber history/);
});

test('referral totals render only from owner rows and ignore poll clicks', () => {
  assert.equal(peer.shouldRequestReferralClicks(null, '11111111-1111-4111-8111-111111111111'), false);
  assert.equal(peer.shouldRequestReferralClicks('11111111-1111-4111-8111-111111111111', null), false);
  assert.equal(peer.shouldRequestReferralClicks('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'), false);
  assert.equal(peer.shouldRequestReferralClicks('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'), true);

  const html = peer.referralClicksHtml([
    { link_type: 'channel', clicks_7d: '4', clicks_30d: 11 },
    { link_type: 'live', clicks_7d: 0, clicks_30d: 2 },
    { link_type: 'poll', clicks_7d: 99, clicks_30d: 99 },
  ], (s) => String(s));
  assert.match(html, /id="creator-referral-clicks"/);
  assert.match(html, /Channel link/);
  assert.match(html, /Last 7 days <strong>4<\/strong>/);
  assert.match(html, /Last 30 days <strong>11<\/strong>/);
  assert.match(html, /Watch live/);
  assert.match(html, /Last 7 days <strong>0<\/strong>/);
  assert.match(html, /Last 30 days <strong>2<\/strong>/);
  assert.doesNotMatch(html, />99</);
  assert.match(html, /Only the channel owner/);
});

test('an RPC payload normalises into the same public block', () => {
  const model = peer.normalizeRpcPeerRank({
    club_slug: 'arsenal',
    club_label: 'Arsenal',
    rank: 3,
    club_size: 12,
    subscriber_count: 1200,
    views_per_video: 3000,
    video_count: 4,
    club_median_views_per_video: 1000,
    club_creators_with_videos: 8,
    week_delta: -40,
    week_from_count: 1240,
    week_to_count: 1200,
    week_from_at: '2026-11-10T00:00:00Z',
    week_to_at: '2026-11-17T00:00:00Z',
    week_gap_days: '7.0',
  });
  assert.equal(model.rank, 3);
  assert.equal(model.clubSize, 12);
  assert.equal(model.weekDelta, -40);
  assert.equal(model.weekGapDays, 7);
  const html = peer.peerRankSectionHtml(model, (s) => String(s));
  assert.match(html, /3 of 12/);
  assert.match(html, /3\.0× the club median/);
  assert.match(html, /-40/);
  assert.equal(peer.normalizeRpcPeerRank([]), null);
  assert.equal(peer.normalizeRpcPeerRank({ error: 'nope' }), null);
});

test('the stats function prefers the RPC and never reads click rows', async () => {
  const calls = [];
  const creator = {
    id: '11111111-1111-4111-8111-111111111111',
    team: 'Arsenal',
    subscriber_count: 1200,
  };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/rpc/frfc_creator_peer_rank')) {
      return jsonResponse(200, {
        club_slug: 'arsenal',
        club_label: 'Arsenal',
        rank: 2,
        club_size: 5,
        subscriber_count: 1200,
        views_per_video: null,
        video_count: 0,
        club_median_views_per_video: null,
        club_creators_with_videos: 0,
        week_delta: null,
        week_from_count: null,
        week_to_count: null,
        week_from_at: null,
        week_to_at: null,
        week_gap_days: null,
      });
    }
    return jsonResponse(500, { message: 'should not be called' });
  };
  const model = await stats.fetchPeerRankForCreator('https://example.test', 'service', creator, { fetch: fetchImpl, now: NOW });
  assert.equal(model.rank, 2);
  assert.equal(model.clubSize, 5);
  assert.deepEqual(calls, ['https://example.test/rest/v1/rpc/frfc_creator_peer_rank']);
  assert.equal(calls.some(url => url.includes('frfc_link_clicks') || url.includes('frfc_owner_referral')), false);

  const fallbackCalls = [];
  const fallbackFetch = async (url) => {
    const href = String(url);
    fallbackCalls.push(href);
    if (href.includes('/rpc/frfc_creator_peer_rank')) {
      return jsonResponse(404, { code: 'PGRST202', message: 'Could not find the function' });
    }
    if (href.includes('/frfc_streamers')) {
      return jsonResponse(200, [
        creator,
        { id: '22222222-2222-4222-8222-222222222222', team: 'arsenal', subscriber_count: 50 },
        { id: '33333333-3333-4333-8333-333333333333', team: 'Chelsea', subscriber_count: 9000 },
      ]);
    }
    if (href.includes('/frfc_video_metrics')) {
      return jsonResponse(200, [
        { creator_id: creator.id, video_id: 'aaaaaaaaaaa', views: 10, recorded_at: iso(NOW - DAY) },
      ]);
    }
    if (href.includes('/frfc_subscriber_history')) return jsonResponse(200, []);
    return jsonResponse(500, { message: 'unexpected ' + href });
  };
  const fallback = await stats.fetchPeerRankForCreator('https://example.test', 'service', creator, { fetch: fallbackFetch, now: NOW });
  assert.equal(fallback.rank, 1);
  assert.equal(fallback.clubSize, 2);
  assert.equal(fallback.viewsPerVideo, 10);
  assert.equal(fallbackCalls.some(url => url.includes('frfc_link_clicks') || url.includes('subscriber_count_prev')), false);
  assert.equal(fallbackCalls.some(url => url.includes('/frfc_streamers?select=id,team,subscriber_count')), true);
});

test('verified HTML includes peer rank and a locked channel does not', async () => {
  const prevFetch = global.fetch;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const urls = [];
  const verified = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Pinned Channel',
    slug: 'pinned-channel',
    team: 'Arsenal',
    subscriber_count: 1200,
    video_count: 40,
    latest_video_id: 'abcdefghijk',
    latest_video_title: 'Match reaction',
    latest_video_views: 80,
    last_youtube_sync: '2026-10-02T00:00:00Z',
    is_verified: true,
    verified_until: null,
  };
  global.fetch = async (url) => {
    const href = String(url);
    urls.push(href);
    if (href.includes('/rpc/frfc_creator_peer_rank')) {
      return jsonResponse(200, {
        club_slug: 'arsenal',
        club_label: 'Arsenal',
        rank: 4,
        club_size: 9,
        subscriber_count: 1200,
        views_per_video: 80,
        video_count: 1,
        club_median_views_per_video: 40,
        club_creators_with_videos: 3,
        week_delta: 15,
        week_from_count: 1185,
        week_to_count: 1200,
        week_from_at: '2026-09-25T00:00:00Z',
        week_to_at: '2026-10-02T00:00:00Z',
        week_gap_days: 7,
      });
    }
    if (href.includes('frfc_video_metrics')) return jsonResponse(200, []);
    if (href.includes('slug.eq.')) return jsonResponse(200, [verified]);
    return jsonResponse(200, []);
  };
  const root = path.join(__dirname, '..');
  const prevCwd = process.cwd();
  process.chdir(root);
  try {
    const card = await stats.handler({ path: '/creators/pinned-channel/stats' });
    assert.equal(card.statusCode, 200);
    assert.match(card.body, /id="creator-peer-rank"/);
    assert.match(card.body, /4 of 9/);
    assert.match(card.body, /2\.0× the club median/);
    assert.match(card.body, /\+15/);
    assert.match(card.body, /last 30 days/);
    assert.doesNotMatch(card.body, /id="creator-referral-clicks"/);
    assert.doesNotMatch(card.body, /frfc_link_clicks|clicks_7d|clicks_30d/);
    assert.equal(urls.some(url => url.includes('frfc_link_clicks') || url.includes('frfc_owner_referral')), false);

    urls.length = 0;
    global.fetch = async (url) => {
      const href = String(url);
      urls.push(href);
      if (href.includes('is_verified')) return { ok: false, status: 400, json: async () => ({}) };
      return jsonResponse(200, [{
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Plain Channel',
        slug: 'plain-channel',
        team: 'Arsenal',
        subscriber_count: 99999,
        video_count: 3,
      }]);
    };
    const locked = await stats.handler({ path: '/creators/plain-channel/stats' });
    assert.equal(locked.statusCode, 200);
    assert.match(locked.body, /Get Verified — CHF 4\/month/);
    assert.doesNotMatch(locked.body, /id="creator-peer-rank"|id="creator-referral-clicks"|99999/);
    assert.equal(urls.some(url => url.includes('frfc_creator_peer_rank') || url.includes('frfc_link_clicks')), false);
  } finally {
    process.chdir(prevCwd);
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('the migration matches the club maps and keeps clicks behind claimed_by', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261117120000_creator_peer_rank.sql'), 'utf8');
  const overrides = JSON.parse(between(sql, 'peer-rank-overrides'));
  const aliases = JSON.parse(between(sql, 'peer-rank-aliases'));
  const names = JSON.parse(between(sql, 'peer-rank-names'));
  assert.deepEqual(overrides, clubs.CLUB_SLUG_OVERRIDES);
  assert.deepEqual(aliases, clubs.CLUB_SLUG_ALIASES);
  assert.deepEqual(names, clubs.CLUB_DISPLAY_NAMES);

  assert.match(sql, /security invoker/);
  assert.match(sql, /interval '30 days'/);
  assert.match(sql, /interval '7 days'/);
  assert.match(sql, /interval '5 days'/);
  assert.match(sql, /interval '10 days'/);
  assert.match(sql, /percentile_cont\(0\.5\)/);
  assert.match(sql, /distinct on \(m\.creator_id, m\.video_id\)/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /subscriber_count_prev|rank_snapshot_at/);

  const ownerAt = sql.indexOf('function public.frfc_owner_referral_clicks');
  const owner = sql.slice(ownerAt);
  assert.match(owner, /security definer/);
  assert.match(owner, /claimed_by = auth\.uid\(\)/);
  assert.match(owner, /not the channel owner/);
  assert.match(owner, /'channel'::text/);
  assert.match(owner, /'live'::text/);
  assert.doesNotMatch(owner, /'poll'/);
  assert.match(sql, /revoke all on function public\.frfc_owner_referral_clicks\(uuid\) from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.frfc_owner_referral_clicks\(uuid\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.frfc_owner_referral_clicks\(uuid\) to anon/);
  assert.match(sql, /grant execute on function public\.frfc_creator_peer_rank\(uuid\) to anon, authenticated, service_role/);
  assert.match(sql, /Not applied by the app or by CI/);
  assert.match(sql, /frfc_link_clicks_creator_id_created_idx/);

  const fn = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/creator-stats.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(fn, /frfc_link_clicks|frfc_owner_referral|subscriber_count_prev|rank_snapshot_at/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  const renderAt = app.indexOf('async function renderCreatorStats');
  const renderEnd = app.indexOf('\nfunction formatNum', renderAt);
  const render = app.slice(renderAt, renderEnd);
  assert.match(render, /initialPeerRankHtml\(c\)/);
  assert.match(render, /id="creator-referral-mount"/);
  assert.doesNotMatch(render, /referralClicksHtml|clicks_7d|Last 7 days/);
  const fetchFn = app.slice(app.indexOf('async function fetchOwnerReferralClicks'), app.indexOf('async function hydrateCreatorStatsExtras'));
  assert.match(fetchFn, /rpc\/frfc_owner_referral_clicks/);
  assert.match(fetchFn, /session\.access_token/);
  assert.doesNotMatch(fetchFn, /SERVICE_ROLE|service_role/);
});

function between(sql, name) {
  const start = sql.indexOf('-- ' + name + ':start');
  const end = sql.indexOf('-- ' + name + ':end');
  assert.ok(start > -1 && end > start, name);
  const chunk = sql.slice(start, end);
  const match = chunk.match(/\$[a-z]+\$([\s\S]*)\$[a-z]+\$/);
  assert.ok(match, name);
  return match[1];
}

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => text,
  };
}
