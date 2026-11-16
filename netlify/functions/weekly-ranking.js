// Weekly creator-rankings story candidate from stored subscriber and
// video history. Two entry points share runWeeklyRanking:
//
//   POST /.netlify/functions/weekly-ranking
//     Authorization: Bearer <supabase access token>
//     Body: { periodDays?: number }  (default 7)
//     Permission: editorial_queue.manage
//     This is the "Generate Weekly Ranking" button in /admin.
//
//   netlify/functions/weekly-ranking-scheduled.js
//     Monday 08:00 UTC. No admin Bearer; service role, same as the
//     other scheduled jobs. Not URL-invocable in production.
//
// Every list read goes through _shared/supabase-page.js. That is the
// only local import, and it has no reads of its own. PostgREST was
// returning the first 1000 rows of frfc_subscriber_history, so the
// 24 Aug 2026 run stored a success with 0 creators and an empty
// candidate. A 0-creator result, or one covering under half the active
// directory, is now a failed or partial job and does not insert a
// candidate.
//
// No YouTube Data API calls. quota_used is recorded as 0.

const { fetchAllRows } = require('./_shared/supabase-page.js');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const JOB_TYPE = 'weekly-ranking';

// Below this baseline subscriber count, a percentage-growth ranking is
// mostly noise (a 20-subscriber channel gaining 5 subs is "25% growth").
const MIN_BASELINE_FOR_PCT_GROWTH = 100;
const TOP_N = 10;

// A healthy week ranks almost the whole synced directory (16 Nov 2026:
// 459 of 474 synced creators had two or more snapshots in the 8-day
// lookback). Under half is the truncated-read failure mode, not a
// normal week. Zero creators is a hard failure either way.
const MIN_ACTIVE_COVERAGE = 0.5;

function readEnv(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    const value = Netlify.env.get(name);
    if (value != null && value !== '') return value;
  }
  return process.env[name];
}

exports.handler = async (event) => {
  if (!event || event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = readEnv('SUPABASE_URL') || DEFAULT_SUPABASE_URL;
  const sbKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res(401, { error: 'Missing auth token' });

  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: sbKey, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return res(401, { error: 'Invalid or expired token' });
  const { id: userId } = await userRes.json();
  if (!userId) return res(401, { error: 'Could not identify user' });

  if (!(await hasPermission(supabaseUrl, sbHeaders, userId, 'editorial_queue.manage'))) {
    return res(403, { error: 'Permission required: editorial_queue.manage' });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON body' }); }
  const periodDays = Number(body.periodDays) || 7;

  const result = await runWeeklyRanking({ supabaseUrl, sbKey, periodDays, userId });
  return res(result.statusCode, result.body);
};

async function runWeeklyRanking({ supabaseUrl, sbKey, periodDays = 7, userId = null, now = new Date(), fetchImpl = globalThis.fetch, pageSize } = {}) {
  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };
  const pageOpts = { headers: sbHeaders, fetchImpl, pageSize };
  const jobRunId = await startJobRun(supabaseUrl, sbHeaders, JOB_TYPE, fetchImpl);
  const periodEnd = new Date(now.getTime());
  const periodStart = new Date(periodEnd.getTime() - periodDays * 86400000);
  const weekStart = startOfIsoWeekUtc(periodEnd);

  try {
    const existing = await findWeeklyCandidate(supabaseUrl, sbHeaders, weekStart, fetchImpl, pageSize);
    if (existing) {
      await finishJobRun(supabaseUrl, sbHeaders, jobRunId, {
        status: 'success',
        items_processed: 0,
        items_failed: 0,
        quota_used: 0,
        error_summary: {
          skipped: true,
          message: 'Skipped: a weekly ranking candidate already exists for this ISO week',
          candidateId: existing.id,
        },
      }, fetchImpl);
      return {
        statusCode: 200,
        body: {
          ok: true,
          duplicate: true,
          candidateId: existing.id,
          workingTitle: existing.working_title,
        },
      };
    }

    const historySince = new Date(periodStart.getTime() - 86400000).toISOString();
    const creatorsUrl = `${supabaseUrl}/rest/v1/frfc_streamers?select=id,name,team,slug,last_youtube_sync&order=id.asc`;
    const historyUrl = `${supabaseUrl}/rest/v1/frfc_subscriber_history?select=creator_id,subscriber_count,recorded_at&recorded_at=gte.${encodeURIComponent(historySince)}&order=recorded_at.asc,id.asc`;
    const videoUrl = `${supabaseUrl}/rest/v1/frfc_video_metrics?select=creator_id,video_id,recorded_at&recorded_at=gte.${encodeURIComponent(periodStart.toISOString())}&order=recorded_at.asc,id.asc`;

    const [creators, history, videoOutcome] = await Promise.all([
      fetchAllRows(creatorsUrl, pageOpts),
      fetchAllRows(historyUrl, pageOpts),
      fetchAllRows(videoUrl, pageOpts).then(
        (rows) => ({ rows, failed: false }),
        () => ({ rows: [], failed: true })
      ),
    ]);
    const videoMetrics = videoOutcome.rows;

    const computed = computeWeeklyRankings({ creators, history, videoMetrics, periodStart, periodEnd });
    if (videoOutcome.failed) {
      computed.dataQualityNotes.push('frfc_video_metrics could not be read, so the most-active section was left empty.');
    }
    const activeCreatorCount = countActiveCreators(creators);
    const assessment = assessRankingCoverage({
      growthRowsCount: computed.growthRowsCount,
      activeCreatorCount,
    });

    if (!assessment.ok) {
      await finishJobRun(supabaseUrl, sbHeaders, jobRunId, {
        status: assessment.status,
        items_processed: computed.growthRowsCount,
        items_failed: 1,
        quota_used: 0,
        error_summary: assessment.error_summary,
      }, fetchImpl);
      return {
        statusCode: 500,
        body: {
          error: assessment.error_summary.message,
          status: assessment.status,
          growthRowsCount: computed.growthRowsCount,
          activeCreatorCount,
        },
      };
    }

    // The check above closes the usual double-click / cron overlap. A
    // second run that started first can still commit during this read,
    // so look once more immediately before the insert.
    const raced = await findWeeklyCandidate(supabaseUrl, sbHeaders, weekStart, fetchImpl, pageSize);
    if (raced) {
      await finishJobRun(supabaseUrl, sbHeaders, jobRunId, {
        status: 'success',
        items_processed: 0,
        items_failed: 0,
        quota_used: 0,
        error_summary: {
          skipped: true,
          message: 'Skipped: a weekly ranking candidate already exists for this ISO week',
          candidateId: raced.id,
        },
      }, fetchImpl);
      return {
        statusCode: 200,
        body: {
          ok: true,
          duplicate: true,
          candidateId: raced.id,
          workingTitle: raced.working_title,
        },
      };
    }

    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const workingTitle = `Weekly Creator Rankings — ${fmt(periodStart)} to ${fmt(periodEnd)}`;
    const { fastestGrowthPct, largestAbsoluteGain, mostActive, dataQualityNotes, growthRowsCount } = computed;

    const payload = {
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      sections: {
        fastest_growth_pct: fastestGrowthPct,
        largest_absolute_gain: largestAbsoluteGain,
        most_active: mostActive,
      },
      data_quality_notes: dataQualityNotes,
    };

    const candidateRes = await fetchImpl(`${supabaseUrl}/rest/v1/frfc_story_candidates`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        type: 'weekly_ranking',
        status: 'evidence_ready',
        working_title: workingTitle,
        score: 100,
        score_components: { type: 'deterministic', note: 'Weekly rankings are computed from stored data, not heuristically scored.' },
        explanation: `Computed from ${growthRowsCount} creators with subscriber history in the ${periodDays}-day window.`,
        creator_ids: [...new Set([...fastestGrowthPct, ...largestAbsoluteGain].map(r => r.creatorId))],
        payload,
      }),
    });
    if (!candidateRes.ok) throw new Error('Failed to create story candidate: ' + await candidateRes.text());
    const candidate = (await candidateRes.json())[0];

    await logStatus(supabaseUrl, sbHeaders, candidate.id, null, 'detected', 'Weekly ranking computed', fetchImpl);
    await logStatus(supabaseUrl, sbHeaders, candidate.id, 'detected', 'evidence_ready', 'Deterministic data — no drafting model needed for evidence', fetchImpl);

    // One evidence row per ranking entry so the editorial queue can show
    // exactly which subscriber snapshots produced each number.
    const evidenceRows = [...fastestGrowthPct, ...largestAbsoluteGain].map(r => ({
      candidate_id: candidate.id,
      evidence_type: 'subscriber_snapshot',
      source_entity_type: 'creator',
      source_entity_id: r.creatorId,
      excerpt: `${r.baseline} → ${r.current} subscribers (${r.delta >= 0 ? '+' : ''}${r.delta}${r.pct !== null ? `, ${r.pct.toFixed(1)}%` : ''})`,
      retrieved_at: r.currentAt,
    }));
    if (evidenceRows.length) {
      await fetchImpl(`${supabaseUrl}/rest/v1/frfc_evidence_items`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify(evidenceRows),
      });
    }

    await finishJobRun(supabaseUrl, sbHeaders, jobRunId, {
      status: 'success',
      items_processed: growthRowsCount,
      items_failed: 0,
      quota_used: 0,
    }, fetchImpl);
    if (userId) {
      await logAdminAction(supabaseUrl, sbHeaders, userId, 'generate', 'story_candidate', candidate.id, { workingTitle }, fetchImpl);
    }
    return {
      statusCode: 200,
      body: { ok: true, candidateId: candidate.id, workingTitle, dataQualityNotes },
    };
  } catch (e) {
    await finishJobRun(supabaseUrl, sbHeaders, jobRunId, {
      status: 'failed',
      items_processed: 0,
      items_failed: 1,
      quota_used: 0,
      error_summary: { message: e.message },
    }, fetchImpl);
    return { statusCode: 500, body: { error: e.message } };
  }
}

// Monday 00:00 UTC of the ISO week containing `date`. A second run after
// that instant, including the Monday cron plus the admin button, finds
// the candidate the first run already wrote.
function startOfIsoWeekUtc(date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function countActiveCreators(creators) {
  if (!Array.isArray(creators) || creators.length === 0) return 0;
  const synced = creators.reduce((n, c) => n + (c && c.last_youtube_sync ? 1 : 0), 0);
  return synced > 0 ? synced : creators.length;
}

function assessRankingCoverage({ growthRowsCount, activeCreatorCount }) {
  const ranked = Number.isFinite(growthRowsCount) ? growthRowsCount : 0;
  const active = Number.isFinite(activeCreatorCount) ? activeCreatorCount : 0;
  if (ranked <= 0) {
    return {
      ok: false,
      status: 'failed',
      error_summary: {
        message: active
          ? `Weekly ranking computed 0 creators from ${active} active creators. Refusing to create an empty candidate.`
          : 'Weekly ranking computed 0 creators. Refusing to create an empty candidate.',
        growthRowsCount: 0,
        activeCreatorCount: active,
      },
    };
  }
  if (active > 0 && ranked < active * MIN_ACTIVE_COVERAGE) {
    return {
      ok: false,
      status: 'partial',
      error_summary: {
        message: `Weekly ranking computed ${ranked} creators, far fewer than ${active} active creators. Refusing to create a partial candidate.`,
        growthRowsCount: ranked,
        activeCreatorCount: active,
      },
    };
  }
  return { ok: true, status: 'success' };
}

async function findWeeklyCandidate(supabaseUrl, sbHeaders, weekStart, fetchImpl, pageSize) {
  const url = `${supabaseUrl}/rest/v1/frfc_story_candidates?select=id,working_title,created_at,status&type=eq.weekly_ranking&created_at=gte.${encodeURIComponent(weekStart.toISOString())}&order=created_at.asc,id.asc`;
  const rows = await fetchAllRows(url, { headers: sbHeaders, fetchImpl, pageSize });
  return rows[0] || null;
}

// Calls the same frfc_has_permission() SQL function RLS policies use,
// via RPC with an explicit user id — this function is SECURITY DEFINER
// and doesn't depend on auth.uid(), so it works correctly when invoked
// with the service-role key on the caller's behalf.
async function hasPermission(supabaseUrl, sbHeaders, userId, permission) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/frfc_has_permission`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({ p_user_id: userId, p_permission: permission }),
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch (e) { return false; }
}

async function logAdminAction(supabaseUrl, sbHeaders, userId, action, entityType, entityId, details, fetchImpl) {
  try {
    await fetchImpl(`${supabaseUrl}/rest/v1/frfc_admin_log`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, action, entity_type: entityType, entity_id: entityId, details: details || null }),
    });
  } catch (e) { /* non-critical */ }
}

function rankEntry(creatorById, r) {
  const c = creatorById.get(r.creatorId);
  return {
    creatorId: r.creatorId, name: c ? c.name : 'Unknown', team: c ? c.team : null, slug: c ? c.slug : null,
    baseline: r.baseline, current: r.current, delta: r.delta, pct: r.pct !== null ? Number(r.pct.toFixed(1)) : null,
    baselineAt: r.baselineAt, currentAt: r.currentAt,
  };
}

// Pure — no I/O — so it can be unit tested directly against synthetic
// data instead of only ever being exercised end-to-end against Supabase.
function computeWeeklyRankings({ creators, history, videoMetrics, periodStart, periodEnd }) {
  const creatorById = new Map(creators.map(c => [c.id, c]));

  // Per creator: latest snapshot strictly before periodStart as the
  // "start of period" baseline — falling back to the earliest in-window
  // snapshot only when there's no earlier data at all (a brand-new
  // creator whose whole history sits inside the lookback). Current is
  // always the single latest snapshot overall. Preferring a before-window
  // baseline (rather than the earliest in-window point) matters: a
  // creator synced only once during the window would otherwise get the
  // same row picked for both baseline and current, and be silently
  // skipped as "no change" even though real history exists to compare
  // against.
  const byCreator = new Map();
  for (const row of history) {
    if (!byCreator.has(row.creator_id)) byCreator.set(row.creator_id, []);
    byCreator.get(row.creator_id).push(row);
  }

  const growthRows = [];
  for (const [creatorId, rows] of byCreator) {
    const inWindow = rows.filter(r => new Date(r.recorded_at) >= periodStart);
    const before = rows.filter(r => new Date(r.recorded_at) < periodStart);
    const baseline = before.length ? before[before.length - 1] : (inWindow.length ? inWindow[0] : null);
    const current = rows[rows.length - 1];
    if (!baseline || !current || baseline === current) continue;
    const delta = current.subscriber_count - baseline.subscriber_count;
    growthRows.push({
      creatorId, baseline: baseline.subscriber_count, current: current.subscriber_count,
      baselineAt: baseline.recorded_at, currentAt: current.recorded_at, delta,
      pct: baseline.subscriber_count > 0 ? (delta / baseline.subscriber_count) * 100 : null,
    });
  }

  const fastestGrowthPct = growthRows
    .filter(r => r.baseline >= MIN_BASELINE_FOR_PCT_GROWTH && r.pct !== null)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, TOP_N)
    .map(r => rankEntry(creatorById, r));

  const largestAbsoluteGain = growthRows
    .slice()
    .sort((a, b) => b.delta - a.delta)
    .slice(0, TOP_N)
    .map(r => rankEntry(creatorById, r));

  // Most active: distinct videos first observed within the window, per
  // creator. Sparse-to-empty until frfc_video_metrics has accumulated a
  // few weeks of runs — that's a real "insufficient data" state, not a
  // bug, and is disclosed as such rather than silently omitted. Dedup by
  // video_id first — repeated sync runs snapshot the same video's stats
  // on every pass, and this must not inflate the "new videos" count.
  const firstSeenByVideo = new Map();
  for (const row of videoMetrics) {
    if (!firstSeenByVideo.has(row.video_id)) firstSeenByVideo.set(row.video_id, row);
  }
  const activeCounts = new Map();
  for (const row of firstSeenByVideo.values()) {
    activeCounts.set(row.creator_id, (activeCounts.get(row.creator_id) || 0) + 1);
  }
  const mostActive = [...activeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([creatorId, count]) => {
      const c = creatorById.get(creatorId);
      return { creatorId, name: c ? c.name : 'Unknown', team: c ? c.team : null, slug: c ? c.slug : null, newVideos: count };
    });

  const dataQualityNotes = [];
  if (!fastestGrowthPct.length) dataQualityNotes.push('No creators met the minimum subscriber baseline for a percentage-growth ranking this period.');
  if (!mostActive.length) dataQualityNotes.push('Video-level activity history is still accumulating (frfc_video_metrics) — this section will populate after a few more sync runs.');

  return { fastestGrowthPct, largestAbsoluteGain, mostActive, dataQualityNotes, growthRowsCount: growthRows.length };
}

async function startJobRun(supabaseUrl, sbHeaders, jobType, fetchImpl) {
  try {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/frfc_job_runs`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ job_type: jobType, status: 'running' }),
    });
    const rows = await response.json().catch(() => []);
    return rows[0] && rows[0].id;
  } catch (e) { return null; }
}

async function finishJobRun(supabaseUrl, sbHeaders, jobRunId, patch, fetchImpl) {
  if (!jobRunId) return;
  try {
    await fetchImpl(`${supabaseUrl}/rest/v1/frfc_job_runs?id=eq.${jobRunId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, finished_at: new Date().toISOString() }),
    });
  } catch (e) { /* non-critical */ }
}

async function logStatus(supabaseUrl, sbHeaders, candidateId, oldStatus, newStatus, note, fetchImpl) {
  try {
    await fetchImpl(`${supabaseUrl}/rest/v1/frfc_candidate_status_log`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ candidate_id: candidateId, old_status: oldStatus, new_status: newStatus, changed_by: 'system', note }),
    });
  } catch (e) { /* non-critical */ }
}

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

module.exports.computeWeeklyRankings = computeWeeklyRankings;
module.exports.MIN_BASELINE_FOR_PCT_GROWTH = MIN_BASELINE_FOR_PCT_GROWTH;
module.exports.MIN_ACTIVE_COVERAGE = MIN_ACTIVE_COVERAGE;
module.exports.assessRankingCoverage = assessRankingCoverage;
module.exports.countActiveCreators = countActiveCreators;
module.exports.startOfIsoWeekUtc = startOfIsoWeekUtc;
module.exports.runWeeklyRanking = runWeeklyRanking;
module.exports.readEnv = readEnv;
module.exports.DEFAULT_SUPABASE_URL = DEFAULT_SUPABASE_URL;
