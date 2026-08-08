// Admin-triggered (not scheduled) — generates a deterministic weekly
// creator-rankings story candidate from real subscriber/video history.
// POST /weekly-ranking  (Authorization: Bearer <supabase_access_token>)
// Body: { periodDays?: number }  (default 7)
//
// This is the PRD's Phase 1 exit criterion: "the owner can produce a
// correct weekly ranking article from stored data." No AI, no scoring
// heuristics — every number here is a real query result, and every ranking
// entry gets a matching frfc_evidence_items row so the editorial queue can
// show exactly which snapshot values produced it.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

// Below this baseline subscriber count, a percentage-growth ranking is
// mostly noise (a 20-subscriber channel gaining 5 subs is "25% growth").
const MIN_BASELINE_FOR_PCT_GROWTH = 100;
const TOP_N = 10;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res(401, { error: 'Missing auth token' });

  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: sbKey, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return res(401, { error: 'Invalid or expired token' });
  const { id: userId } = await userRes.json();
  if (!userId) return res(401, { error: 'Could not identify user' });

  const roleRes = await fetch(`${supabaseUrl}/rest/v1/frfc_admin_roles?select=role&user_id=eq.${userId}`, { headers: sbHeaders });
  const roles = roleRes.ok ? await roleRes.json() : [];
  if (!roles.length) return res(403, { error: 'Admin access required' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON body' }); }
  const periodDays = Number(body.periodDays) || 7;

  const jobRunId = await startJobRun(supabaseUrl, sbHeaders, 'weekly-ranking');

  try {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - periodDays * 86400000);

    const [creatorsRes, historyRes, videoRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/frfc_streamers?select=id,name,team,slug`, { headers: sbHeaders }),
      // Every snapshot in the window, plus the one just before it (to
      // establish a baseline for creators whose only in-window snapshot
      // is itself, e.g. a slow-moving channel synced twice a day).
      fetch(`${supabaseUrl}/rest/v1/frfc_subscriber_history?select=creator_id,subscriber_count,recorded_at&recorded_at=gte.${encodeURIComponent(new Date(periodStart.getTime() - 86400000).toISOString())}&order=recorded_at.asc`, { headers: sbHeaders }),
      fetch(`${supabaseUrl}/rest/v1/frfc_video_metrics?select=creator_id,video_id,recorded_at&recorded_at=gte.${encodeURIComponent(periodStart.toISOString())}&order=recorded_at.asc`, { headers: sbHeaders }),
    ]);
    if (!creatorsRes.ok || !historyRes.ok) throw new Error('Supabase read failed');

    const creators = await creatorsRes.json();
    const history = await historyRes.json();
    const videoMetrics = videoRes.ok ? await videoRes.json() : [];

    const { fastestGrowthPct, largestAbsoluteGain, mostActive, dataQualityNotes, growthRowsCount } =
      computeWeeklyRankings({ creators, history, videoMetrics, periodStart, periodEnd });

    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const workingTitle = `Weekly Creator Rankings — ${fmt(periodStart)} to ${fmt(periodEnd)}`;

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

    const candidateRes = await fetch(`${supabaseUrl}/rest/v1/frfc_story_candidates`, {
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

    await logStatus(supabaseUrl, sbHeaders, candidate.id, null, 'detected', 'Weekly ranking computed');
    await logStatus(supabaseUrl, sbHeaders, candidate.id, 'detected', 'evidence_ready', 'Deterministic data — no drafting model needed for evidence');

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
      await fetch(`${supabaseUrl}/rest/v1/frfc_evidence_items`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify(evidenceRows),
      });
    }

    await finishJobRun(supabaseUrl, sbHeaders, jobRunId, { status: 'success', items_processed: growthRowsCount, items_failed: 0 });
    return res(200, { ok: true, candidateId: candidate.id, workingTitle, dataQualityNotes });
  } catch (e) {
    await finishJobRun(supabaseUrl, sbHeaders, jobRunId, { status: 'failed', items_processed: 0, items_failed: 1, error_summary: { message: e.message } });
    return res(500, { error: e.message });
  }
};

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

async function startJobRun(supabaseUrl, sbHeaders, jobType) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ job_type: jobType, status: 'running' }),
    });
    const rows = await res.json().catch(() => []);
    return rows[0] && rows[0].id;
  } catch (e) { return null; }
}

async function finishJobRun(supabaseUrl, sbHeaders, jobRunId, patch) {
  if (!jobRunId) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs?id=eq.${jobRunId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, finished_at: new Date().toISOString() }),
    });
  } catch (e) { /* non-critical */ }
}

async function logStatus(supabaseUrl, sbHeaders, candidateId, oldStatus, newStatus, note) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_candidate_status_log`, {
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
