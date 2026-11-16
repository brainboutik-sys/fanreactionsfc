// Weekly snapshot of each creator's subscriber count and average rating.
// /rankings diffs the live columns against subscriber_count_prev /
// avg_rating_prev to render the up, down, and NEW badges.
//
// Schedule: Monday 03:00 UTC. It has to be declared in netlify.toml.
// This file still exports `config.schedule` (same as the other jobs), but
// Netlify's bundler only honours that export on the modern default-export
// function shape. A legacy `exports.handler` drops it, so this job never
// registered and rank_snapshot_at stayed on the April 2026 backfill.
// The `-background` suffix is intentional: paging the directory and patching
// every row can outlive the 30s scheduled-function limit. A background
// function scheduled from netlify.toml still runs on the cron and gets the
// 15-minute limit (same pattern as live-check-fixtures-background).
//
// No YouTube Data API calls. Reads and writes Supabase only.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SCHEDULE = '0 3 * * 1';
const JOB_TYPE = 'rank-snapshot';
// PostgREST caps an unpaged response at 1000 rows and still returns 200.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

exports.SCHEDULE = SCHEDULE;
exports.JOB_TYPE = JOB_TYPE;
exports.PAGE_SIZE = PAGE_SIZE;
exports.config = { schedule: SCHEDULE };

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return json(500, { error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const jobRunId = await startJobRun(supabaseUrl, sbKey, JOB_TYPE);
  const now = new Date().toISOString();

  try {
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
    const reviews = await fetchAllRows(
      `${supabaseUrl}/rest/v1/frfc_reviews?select=id,creator_id,rating&order=id.asc`,
      headers,
      'frfc_reviews'
    );
    const creators = await fetchAllRows(
      `${supabaseUrl}/rest/v1/frfc_streamers?select=id,subscriber_count&order=id.asc`,
      headers,
      'frfc_streamers'
    );
    const averages = aggregateRatings(reviews);

    let ok = 0;
    let fail = 0;
    const failedStatuses = [];
    for (const creator of creators) {
      if (!creator || creator.id == null) {
        fail++;
        continue;
      }
      try {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creator.id)}`,
          {
            method: 'PATCH',
            headers: writeHeaders(sbKey, 'return=minimal'),
            body: JSON.stringify({
              subscriber_count_prev: creator.subscriber_count,
              avg_rating_prev: averages.has(creator.id) ? averages.get(creator.id) : null,
              rank_snapshot_at: now,
            }),
          }
        );
        if (res.ok) ok++;
        else {
          fail++;
          if (failedStatuses.length < 5) failedStatuses.push(res.status);
        }
      } catch (e) {
        fail++;
        if (failedStatuses.length < 5) failedStatuses.push(0);
      }
    }

    const status = fail === 0 ? 'success' : (ok > 0 ? 'partial' : 'failed');
    const jobPatch = {
      status,
      items_processed: ok,
      items_failed: fail,
      quota_used: 0,
    };
    if (fail !== 0) {
      jobPatch.error_summary = {
        message: `${fail} of ${creators.length} creator snapshots failed`,
        sample_statuses: failedStatuses,
      };
    }
    await finishJobRun(supabaseUrl, sbKey, jobRunId, jobPatch);

    return json(200, { snapshot_at: now, ok, fail, total: creators.length, status });
  } catch (e) {
    await finishJobRun(supabaseUrl, sbKey, jobRunId, {
      status: 'failed',
      items_processed: 0,
      items_failed: 1,
      quota_used: 0,
      error_summary: { message: e.message },
    });
    return json(502, { error: e.message });
  }
};

// Sum ratings per creator. Non-numeric ratings are ignored. The average is
// rounded to 2 decimal places, matching the column the rankings page reads.
function aggregateRatings(reviews) {
  const sums = new Map();
  for (const review of reviews || []) {
    if (!review || review.creator_id == null || review.rating == null || review.rating === '') continue;
    const rating = Number(review.rating);
    if (!Number.isFinite(rating)) continue;
    const current = sums.get(review.creator_id) || { sum: 0, count: 0 };
    current.sum += rating;
    current.count += 1;
    sums.set(review.creator_id, current);
  }
  const averages = new Map();
  for (const [creatorId, bucket] of sums) {
    averages.set(creatorId, bucket.count ? +(bucket.sum / bucket.count).toFixed(2) : null);
  }
  return averages;
}

async function fetchAllRows(baseUrl, headers, label) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(page * PAGE_SIZE));
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      throw new Error(`${label} read failed (${res.status})`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch)) {
      throw new Error(`${label} read did not return a row array`);
    }
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw new Error(`${label} exceeded ${MAX_PAGES * PAGE_SIZE} rows`);
}

function writeHeaders(sbKey, prefer) {
  return {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

// Best-effort. A health-log failure must not hide the snapshot result.
async function startJobRun(supabaseUrl, sbKey, jobType) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs`, {
      method: 'POST',
      headers: writeHeaders(sbKey, 'return=representation'),
      body: JSON.stringify({ job_type: jobType, status: 'running' }),
    });
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows[0] ? rows[0].id : null;
  } catch (e) {
    return null;
  }
}

async function finishJobRun(supabaseUrl, sbKey, jobRunId, patch) {
  if (!jobRunId) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs?id=eq.${encodeURIComponent(jobRunId)}`, {
      method: 'PATCH',
      headers: writeHeaders(sbKey, 'return=minimal'),
      body: JSON.stringify({ ...patch, finished_at: new Date().toISOString() }),
    });
  } catch (e) { /* non-critical */ }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.aggregateRatings = aggregateRatings;
