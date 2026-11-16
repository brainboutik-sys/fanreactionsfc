const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  computeWeeklyRankings,
  MIN_BASELINE_FOR_PCT_GROWTH,
  MIN_ACTIVE_COVERAGE,
  assessRankingCoverage,
  countActiveCreators,
  startOfIsoWeekUtc,
  runWeeklyRanking,
  handler,
} = require('../netlify/functions/weekly-ranking.js');
const scheduled = require('../netlify/functions/weekly-ranking-scheduled.js');

const DAY_MS = 86400000;
const periodEnd = new Date('2026-08-08T00:00:00.000Z');
const periodStart = new Date(periodEnd.getTime() - 7 * DAY_MS);

function creator(id, name, team) {
  return { id, name, team, slug: name.toLowerCase().replace(/\s+/g, '-') };
}

function snapshot(creatorId, subscriberCount, daysBeforeEnd) {
  return {
    creator_id: creatorId,
    subscriber_count: subscriberCount,
    recorded_at: new Date(periodEnd.getTime() - daysBeforeEnd * DAY_MS).toISOString(),
  };
}

test('ranks fastest percentage growth, filtering out low-baseline noise', () => {
  const creators = [creator('a', 'Small Channel', 'X'), creator('b', 'Big Channel', 'Y')];
  const history = [
    // Small Channel: 20 -> 25 is 25% growth but baseline is below the noise floor.
    snapshot('a', 20, 6), snapshot('a', 25, 0),
    // Big Channel: 1000 -> 1100 is 10% growth on a real baseline.
    snapshot('b', 1000, 6), snapshot('b', 1100, 0),
  ];
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });

  assert.equal(out.fastestGrowthPct.length, 1);
  assert.equal(out.fastestGrowthPct[0].creatorId, 'b');
  assert.equal(out.fastestGrowthPct[0].pct, 10);
  assert.ok(20 < MIN_BASELINE_FOR_PCT_GROWTH, 'test assumption: 20 is below the noise floor');
});

test('ranks largest absolute gain regardless of baseline size', () => {
  const creators = [creator('a', 'Mega Channel', 'X'), creator('b', 'Small Channel', 'Y')];
  const history = [
    snapshot('a', 3200000, 6), snapshot('a', 3210000, 0), // +10,000
    snapshot('b', 50, 6), snapshot('b', 60, 0), // +10, but 20% growth
  ];
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });

  assert.equal(out.largestAbsoluteGain[0].creatorId, 'a');
  assert.equal(out.largestAbsoluteGain[0].delta, 10000);
});

test('a creator with only one snapshot in the whole lookback has no baseline to compare against', () => {
  const creators = [creator('a', 'New Channel', 'X')];
  const history = [snapshot('a', 500, 0)];
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });

  assert.equal(out.growthRowsCount, 0);
  assert.equal(out.fastestGrowthPct.length, 0);
  assert.equal(out.largestAbsoluteGain.length, 0);
});

test('a creator with zero net change over the window still ranks (at the bottom), not excluded', () => {
  const creators = [creator('a', 'Flat Channel', 'X')];
  const history = [snapshot('a', 500, 6), snapshot('a', 500, 0)];
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });

  assert.equal(out.growthRowsCount, 1);
  assert.equal(out.largestAbsoluteGain[0].delta, 0);
});

test('uses the latest before-window snapshot as baseline even when the window itself has data', () => {
  const creators = [creator('a', 'Slow Channel', 'X')];
  const history = [
    snapshot('a', 900, 10), // before the window
    snapshot('a', 950, 1),  // inside the window
  ];
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });

  assert.equal(out.largestAbsoluteGain[0].baseline, 900);
  assert.equal(out.largestAbsoluteGain[0].current, 950);
});

// Regression test for a real bug found while writing this suite: a creator
// synced only once during the window used to get that same snapshot picked
// for both baseline and current (same object reference), and was silently
// skipped as "no change" even though earlier history existed to compare
// against.
test('a creator with exactly one in-window snapshot still ranks against prior history', () => {
  const creators = [creator('a', 'Weekly Sync Channel', 'X')];
  const history = [
    snapshot('a', 900, 10), // before the window
    snapshot('a', 950, 1),  // the only snapshot inside the window
  ];
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });

  assert.equal(out.growthRowsCount, 1);
  assert.equal(out.largestAbsoluteGain[0].delta, 50);
});

test('falls back to the earliest in-window snapshot when there is no earlier history at all', () => {
  const creators = [creator('a', 'Brand New Channel', 'X')];
  const history = [
    snapshot('a', 100, 5), // inside the window — earliest known data point
    snapshot('a', 150, 0),
  ];
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });

  assert.equal(out.largestAbsoluteGain[0].baseline, 100);
  assert.equal(out.largestAbsoluteGain[0].current, 150);
});

test('most-active dedups repeated video-metric snapshots by video_id (sync-run idempotency)', () => {
  const creators = [creator('a', 'Prolific Channel', 'X')];
  // Two sync runs both snapshotting the same two videos — a real pattern,
  // since sync-background.js records stats for recent videos on every run.
  const videoMetrics = [
    { creator_id: 'a', video_id: 'vid1', recorded_at: '2026-08-03T00:00:00.000Z' },
    { creator_id: 'a', video_id: 'vid2', recorded_at: '2026-08-03T00:00:00.000Z' },
    { creator_id: 'a', video_id: 'vid1', recorded_at: '2026-08-05T00:00:00.000Z' },
    { creator_id: 'a', video_id: 'vid2', recorded_at: '2026-08-05T00:00:00.000Z' },
  ];
  const out = computeWeeklyRankings({ creators, history: [], videoMetrics, periodStart, periodEnd });

  assert.equal(out.mostActive.length, 1);
  assert.equal(out.mostActive[0].newVideos, 2, 'must count distinct videos, not snapshot rows');
});

test('reports a data-quality note when a section has nothing to show', () => {
  const out = computeWeeklyRankings({ creators: [], history: [], videoMetrics: [], periodStart, periodEnd });
  assert.equal(out.fastestGrowthPct.length, 0);
  assert.equal(out.mostActive.length, 0);
  assert.ok(out.dataQualityNotes.length >= 2);
});

test('caps each ranking section at 10 entries', () => {
  const creators = [];
  const history = [];
  for (let i = 0; i < 15; i++) {
    const id = 'c' + i;
    creators.push(creator(id, 'Channel ' + i, 'X'));
    history.push(snapshot(id, 1000, 6), snapshot(id, 1000 + (i + 1) * 10, 0));
  }
  const out = computeWeeklyRankings({ creators, history, videoMetrics: [], periodStart, periodEnd });
  assert.equal(out.fastestGrowthPct.length, 10);
  assert.equal(out.largestAbsoluteGain.length, 10);
});

test('empty coverage is a failed job and a thin coverage is partial', () => {
  const empty = assessRankingCoverage({ growthRowsCount: 0, activeCreatorCount: 474 });
  assert.equal(empty.ok, false);
  assert.equal(empty.status, 'failed');
  assert.match(empty.error_summary.message, /0 creators/);
  assert.match(empty.error_summary.message, /474 active creators/);

  const noneAtAll = assessRankingCoverage({ growthRowsCount: 0, activeCreatorCount: 0 });
  assert.equal(noneAtAll.status, 'failed');

  // 474 * 0.5 = 237. One creator under the line is "far fewer".
  const thin = assessRankingCoverage({ growthRowsCount: 236, activeCreatorCount: 474 });
  assert.equal(thin.ok, false);
  assert.equal(thin.status, 'partial');
  assert.equal(thin.error_summary.growthRowsCount, 236);

  const enough = assessRankingCoverage({ growthRowsCount: 237, activeCreatorCount: 474 });
  assert.equal(enough.ok, true);
  assert.equal(enough.status, 'success');

  const healthy = assessRankingCoverage({ growthRowsCount: 459, activeCreatorCount: 474 });
  assert.equal(healthy.ok, true);
  assert.equal(MIN_ACTIVE_COVERAGE, 0.5);
});

test('active creators are the synced directory, falling back when nobody has synced', () => {
  assert.equal(countActiveCreators([]), 0);
  assert.equal(countActiveCreators([
    { id: 'a', last_youtube_sync: '2026-11-16T07:00:00.000Z' },
    { id: 'b', last_youtube_sync: null },
  ]), 1);
  assert.equal(countActiveCreators([{ id: 'a' }, { id: 'b' }]), 2);
});

test('ISO week starts Monday 00:00 UTC', () => {
  assert.equal(startOfIsoWeekUtc(new Date('2026-11-16T08:00:00.000Z')).toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(startOfIsoWeekUtc(new Date('2026-11-15T23:00:00.000Z')).toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(startOfIsoWeekUtc(new Date('2026-08-24T08:07:07.000Z')).toISOString(), '2026-08-24T00:00:00.000Z');
  assert.equal(startOfIsoWeekUtc(new Date('2026-08-08T08:12:49.000Z')).toISOString(), '2026-08-03T00:00:00.000Z');
});

const RUN_NOW = new Date('2026-11-16T08:00:00.000Z');
const SUPABASE_URL = 'https://example.test';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function pageResponse(rows, options) {
  const range = (options.headers && (options.headers.Range || options.headers.range)) || '0-999';
  const start = Number(range.split('-')[0]);
  if (start >= rows.length) {
    return {
      ok: false,
      status: 416,
      headers: { get: () => `*/${rows.length}` },
      json: async () => ({ message: 'Requested range not satisfiable' }),
      text: async () => '',
    };
  }
  const end = Number(range.split('-')[1]);
  const slice = rows.slice(start, Math.min(end + 1, rows.length));
  const last = start + slice.length - 1;
  return {
    ok: true,
    status: 206,
    headers: { get: (name) => String(name).toLowerCase() === 'content-range' ? `${start}-${last}/${rows.length}` : null },
    json: async () => slice,
    text: async () => JSON.stringify(slice),
  };
}

function streamer(id) {
  return { id, name: 'Channel ' + id, team: 'X', slug: id, last_youtube_sync: '2026-11-16T07:00:00.000Z' };
}

function historyRow(creatorId, subscriberCount, recordedAt) {
  return { creator_id: creatorId, subscriber_count: subscriberCount, recorded_at: recordedAt };
}

function createRankingFetch({ streamers, history, videos = [], existingCandidates = [], videoStatus = 200 }) {
  const calls = [];
  const candidates = existingCandidates.map(row => ({ ...row }));
  async function fetchImpl(url, options = {}) {
    const u = String(url);
    const method = options.method || 'GET';
    calls.push({ url: u, method, headers: options.headers || {}, body: options.body || null });
    if (u.includes('googleapis.com') || u.includes('youtube.googleapis') || u.includes('YOUTUBE')) {
      throw new Error('YouTube Data API must not be called');
    }
    if (u.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' });
    if (u.includes('/rpc/frfc_has_permission')) return jsonResponse(true);
    if (u.includes('/frfc_job_runs')) {
      if (method === 'POST') return jsonResponse([{ id: 'job-1' }]);
      return jsonResponse([]);
    }
    if (u.includes('/frfc_story_candidates')) {
      if (method === 'GET') {
        const match = u.match(/created_at=gte\.([^&]+)/);
        const since = match ? decodeURIComponent(match[1]) : null;
        const visible = since ? candidates.filter(row => row.created_at >= since) : candidates.slice();
        return pageResponse(visible, options);
      }
      const created = { id: 'cand-new', created_at: RUN_NOW.toISOString(), ...JSON.parse(options.body) };
      candidates.push(created);
      return jsonResponse([created]);
    }
    if (u.includes('/frfc_streamers')) return pageResponse(streamers, options);
    if (u.includes('/frfc_subscriber_history')) return pageResponse(history, options);
    if (u.includes('/frfc_video_metrics')) {
      if (videoStatus !== 200) return jsonResponse({ message: 'video read failed' }, videoStatus);
      return pageResponse(videos, options);
    }
    if (u.includes('/frfc_evidence_items') || u.includes('/frfc_candidate_status_log') || u.includes('/frfc_admin_log')) {
      return jsonResponse([]);
    }
    throw new Error('unexpected ' + method + ' ' + u);
  }
  return { fetchImpl, calls, candidates };
}

function jobPatch(calls) {
  const patches = calls.filter(call => call.method === 'PATCH' && call.url.includes('/frfc_job_runs'));
  assert.equal(patches.length, 1);
  return JSON.parse(patches[0].body);
}

function storyPosts(calls) {
  return calls.filter(call => call.method === 'POST' && call.url.includes('/frfc_story_candidates'));
}

test('pagination feeds every history page into the ranking and still writes no YouTube quota', async () => {
  const { fetchImpl, calls, candidates } = createRankingFetch({
    streamers: [streamer('a'), streamer('b')],
    history: [
      historyRow('a', 1000, '2026-11-08T12:00:00.000Z'),
      historyRow('b', 2000, '2026-11-08T12:00:00.000Z'),
      historyRow('a', 1100, '2026-11-16T07:00:00.000Z'),
      historyRow('b', 2500, '2026-11-16T07:00:00.000Z'),
    ],
  });

  const result = await runWeeklyRanking({
    supabaseUrl: SUPABASE_URL,
    sbKey: 'service-role-test-key',
    periodDays: 7,
    userId: null,
    now: RUN_NOW,
    fetchImpl,
    pageSize: 2,
  });

  const historyRanges = calls
    .filter(call => call.url.includes('/frfc_subscriber_history'))
    .map(call => call.headers.Range);
  assert.deepEqual(historyRanges, ['0-1', '2-3']);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.duplicate, undefined);
  assert.equal(storyPosts(calls).length, 1);
  assert.equal(candidates.length, 1);
  const stored = JSON.parse(storyPosts(calls)[0].body);
  assert.equal(stored.explanation, 'Computed from 2 creators with subscriber history in the 7-day window.');
  assert.equal(stored.payload.sections.largest_absolute_gain[0].creatorId, 'b');
  assert.equal(stored.payload.sections.largest_absolute_gain[0].delta, 500);

  const patch = jobPatch(calls);
  assert.equal(patch.status, 'success');
  assert.equal(patch.items_processed, 2);
  assert.equal(patch.quota_used, 0);
  assert.equal(calls.some(call => call.url.includes('/auth/v1/user')), false);
  assert.ok(calls.every(call => call.url.startsWith(SUPABASE_URL)));
});

test('zero ranked creators fails the job and does not insert a candidate', async () => {
  const { fetchImpl, calls, candidates } = createRankingFetch({
    streamers: [streamer('a'), streamer('b'), streamer('c'), streamer('d')],
    history: [
      historyRow('a', 1000, '2026-11-16T07:00:00.000Z'),
      historyRow('b', 1000, '2026-11-16T07:00:00.000Z'),
      historyRow('c', 1000, '2026-11-16T07:00:00.000Z'),
      historyRow('d', 1000, '2026-11-16T07:00:00.000Z'),
    ],
  });

  const result = await runWeeklyRanking({
    supabaseUrl: SUPABASE_URL,
    sbKey: 'service-role-test-key',
    now: RUN_NOW,
    fetchImpl,
  });

  assert.equal(result.statusCode, 500);
  assert.match(result.body.error, /0 creators from 4 active creators/);
  assert.equal(result.body.status, 'failed');
  assert.equal(storyPosts(calls).length, 0);
  assert.equal(candidates.length, 0);
  const patch = jobPatch(calls);
  assert.equal(patch.status, 'failed');
  assert.equal(patch.items_processed, 0);
  assert.equal(patch.items_failed, 1);
  assert.equal(patch.quota_used, 0);
  assert.match(patch.error_summary.message, /Refusing to create an empty candidate/);
});

test('a ranking far below the active directory is partial and does not insert a candidate', async () => {
  const { fetchImpl, calls, candidates } = createRankingFetch({
    streamers: [streamer('a'), streamer('b'), streamer('c'), streamer('d')],
    history: [
      historyRow('a', 1000, '2026-11-08T12:00:00.000Z'),
      historyRow('a', 1100, '2026-11-16T07:00:00.000Z'),
      historyRow('b', 500, '2026-11-16T07:00:00.000Z'),
      historyRow('c', 500, '2026-11-16T07:00:00.000Z'),
      historyRow('d', 500, '2026-11-16T07:00:00.000Z'),
    ],
  });

  const result = await runWeeklyRanking({
    supabaseUrl: SUPABASE_URL,
    sbKey: 'service-role-test-key',
    now: RUN_NOW,
    fetchImpl,
  });

  assert.equal(result.statusCode, 500);
  assert.equal(result.body.status, 'partial');
  assert.equal(result.body.growthRowsCount, 1);
  assert.equal(result.body.activeCreatorCount, 4);
  assert.equal(storyPosts(calls).length, 0);
  assert.equal(candidates.length, 0);
  const patch = jobPatch(calls);
  assert.equal(patch.status, 'partial');
  assert.equal(patch.items_processed, 1);
  assert.equal(patch.quota_used, 0);
  assert.match(patch.error_summary.message, /far fewer than 4 active creators/);
});

test('a second run in the same ISO week does not create another candidate', async () => {
  const { fetchImpl, calls, candidates } = createRankingFetch({
    streamers: [streamer('a')],
    history: [],
    existingCandidates: [{
      id: 'cand-existing',
      working_title: 'Weekly Creator Rankings — 9 Nov to 16 Nov',
      created_at: '2026-11-16T01:00:00.000Z',
      status: 'evidence_ready',
    }],
  });

  const result = await runWeeklyRanking({
    supabaseUrl: SUPABASE_URL,
    sbKey: 'service-role-test-key',
    now: RUN_NOW,
    fetchImpl,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(result.body.candidateId, 'cand-existing');
  assert.equal(storyPosts(calls).length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(calls.some(call => call.url.includes('/frfc_subscriber_history')), false);
  const patch = jobPatch(calls);
  assert.equal(patch.status, 'success');
  assert.equal(patch.quota_used, 0);
  assert.equal(patch.error_summary.skipped, true);
  assert.equal(patch.error_summary.candidateId, 'cand-existing');
});

test('a candidate from the previous ISO week does not block Monday', async () => {
  const { fetchImpl, calls } = createRankingFetch({
    streamers: [streamer('a'), streamer('b')],
    history: [
      historyRow('a', 1000, '2026-11-08T12:00:00.000Z'),
      historyRow('a', 1100, '2026-11-16T07:00:00.000Z'),
      historyRow('b', 2000, '2026-11-08T12:00:00.000Z'),
      historyRow('b', 2100, '2026-11-16T07:00:00.000Z'),
    ],
    existingCandidates: [{
      id: 'cand-last-week',
      working_title: 'last week',
      created_at: '2026-11-15T23:00:00.000Z',
      status: 'published',
    }],
  });

  const result = await runWeeklyRanking({
    supabaseUrl: SUPABASE_URL,
    sbKey: 'service-role-test-key',
    now: RUN_NOW,
    fetchImpl,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.duplicate, undefined);
  assert.equal(storyPosts(calls).length, 1);
});

test('a video-metrics read failure still publishes the subscriber ranking', async () => {
  const { fetchImpl, calls } = createRankingFetch({
    streamers: [streamer('a'), streamer('b')],
    history: [
      historyRow('a', 1000, '2026-11-08T12:00:00.000Z'),
      historyRow('a', 1100, '2026-11-16T07:00:00.000Z'),
      historyRow('b', 2000, '2026-11-08T12:00:00.000Z'),
      historyRow('b', 2100, '2026-11-16T07:00:00.000Z'),
    ],
    videoStatus: 500,
  });

  const result = await runWeeklyRanking({
    supabaseUrl: SUPABASE_URL,
    sbKey: 'service-role-test-key',
    now: RUN_NOW,
    fetchImpl,
  });

  assert.equal(result.statusCode, 200);
  assert.ok(result.body.dataQualityNotes.some(note => note.includes('frfc_video_metrics could not be read')));
  assert.equal(storyPosts(calls).length, 1);
  assert.equal(jobPatch(calls).quota_used, 0);
});

test('the admin button still requires the bearer token and does not run without it', async () => {
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not fetch'); };
  try {
    const missing = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    assert.equal(missing.statusCode, 401);
    assert.equal(called, false);
    const wrongMethod = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer token' }, body: '' });
    assert.equal(wrongMethod.statusCode, 405);
  } finally {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('the admin button still generates a ranking for an authorised editor', async () => {
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const now = Date.now();
  const backend = createRankingFetch({
    streamers: [streamer('a'), streamer('b')],
    history: [
      historyRow('a', 1000, new Date(now - 6 * 86400000).toISOString()),
      historyRow('a', 1100, new Date(now - 60000).toISOString()),
      historyRow('b', 2000, new Date(now - 6 * 86400000).toISOString()),
      historyRow('b', 2100, new Date(now - 60000).toISOString()),
    ],
  });
  global.fetch = backend.fetchImpl;
  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer editor-token' },
      body: JSON.stringify({ periodDays: 7 }),
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.candidateId, 'cand-new');
    const userCall = backend.calls.find(call => call.url.includes('/auth/v1/user'));
    assert.equal(userCall.headers.Authorization, 'Bearer editor-token');
    const historyCall = backend.calls.find(call => call.url.includes('/frfc_subscriber_history'));
    assert.equal(historyCall.headers.Authorization, 'Bearer service-role-test-key');
    assert.equal(jobPatch(backend.calls).quota_used, 0);
  } finally {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('the Monday schedule is a separate function and the admin URL stays invocable', () => {
  const admin = require('../netlify/functions/weekly-ranking.js');
  assert.equal(admin.config, undefined);
  assert.equal(scheduled.config.schedule, '0 8 * * 1');

  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.match(toml, /\[functions\."weekly-ranking-scheduled"\]\s+schedule = "0 8 \* \* 1"/);

  const root = path.join(__dirname, '..', 'netlify', 'functions');
  const sources = ['weekly-ranking.js', 'weekly-ranking-scheduled.js', '_shared/supabase-page.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
  const code = sources
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.equal(code.includes('googleapis.com'), false);
  assert.equal(code.includes('YOUTUBE_API_KEY'), false);
  const requires = [...fs.readFileSync(path.join(root, 'weekly-ranking.js'), 'utf8').matchAll(/require\((['"])(.+?)\1\)/g)].map(match => match[2]);
  assert.deepEqual(requires, ['./_shared/supabase-page.js']);
  assert.equal(fs.readFileSync(path.join(root, '_shared/supabase-page.js'), 'utf8').includes('require('), false);
});

test('the scheduled wrapper runs the ranking with the service role and no editor token', async () => {
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevUrl = process.env.SUPABASE_URL;
  const prevFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.SUPABASE_URL = SUPABASE_URL;
  const now = Date.now();
  const backend = createRankingFetch({
    streamers: [streamer('a'), streamer('b')],
    history: [
      historyRow('a', 1000, new Date(now - 6 * 86400000).toISOString()),
      historyRow('a', 1100, new Date(now - 60000).toISOString()),
      historyRow('b', 2000, new Date(now - 6 * 86400000).toISOString()),
      historyRow('b', 2100, new Date(now - 60000).toISOString()),
    ],
  });
  global.fetch = backend.fetchImpl;
  try {
    const response = await scheduled.handler({ body: JSON.stringify({ next_run: '2026-11-23T08:00:00.000Z' }) });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.candidateId, 'cand-new');
    assert.equal(backend.calls.some(call => call.url.includes('/auth/v1/user')), false);
    const historyCall = backend.calls.find(call => call.url.includes('/frfc_subscriber_history'));
    assert.equal(historyCall.headers.Authorization, 'Bearer service-role-test-key');
    assert.equal(jobPatch(backend.calls).quota_used, 0);
    assert.equal(storyPosts(backend.calls).length, 1);
  } finally {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
  }
});
