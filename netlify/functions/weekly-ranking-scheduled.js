// Monday creator-ranking candidate. Same computation as the admin button
// (POST /.netlify/functions/weekly-ranking) but invoked by Netlify's
// scheduler, so there is no admin Bearer token. Uses the service-role
// key already configured for the other scheduled functions.
//
// 08:00 UTC Monday, not 07:00. sync-background.js already runs at
// `0 7 * * *` and is what writes frfc_subscriber_history. An hour later
// this job reads that write. The hand-run rankings on 8 Aug and 24 Aug
// 2026 were both around 08:10 UTC.
//
// Scheduled functions are not URL-invocable in production (a direct HTTP
// request is rejected by Netlify). `schedule` cannot share a function
// with the admin path, so this file is only the cron wrapper.
//
// This run reads and writes Supabase only. It does not call the YouTube
// Data API, does not read YOUTUBE_API_KEY, and records quota_used 0.

exports.config = { schedule: '0 8 * * 1' };

const { runWeeklyRanking, readEnv, DEFAULT_SUPABASE_URL } = require('./weekly-ranking.js');

exports.handler = async (event) => {
  let nextRun = null;
  try {
    nextRun = JSON.parse((event && event.body) || '{}').next_run || null;
  } catch (e) {
    nextRun = null;
  }
  if (nextRun) console.log('weekly ranking next run:', nextRun);

  const supabaseUrl = readEnv('SUPABASE_URL') || DEFAULT_SUPABASE_URL;
  const sbKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!sbKey) {
    return json(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });
  }

  const result = await runWeeklyRanking({
    supabaseUrl,
    sbKey,
    periodDays: 7,
    userId: null,
  });
  return json(result.statusCode, result.body);
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
