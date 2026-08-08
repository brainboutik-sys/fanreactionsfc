const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeWeeklyRankings, MIN_BASELINE_FOR_PCT_GROWTH } = require('../netlify/functions/weekly-ranking.js');

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
