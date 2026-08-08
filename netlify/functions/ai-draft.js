// Admin-triggered — generates an AI-assisted article draft for a story
// candidate, as an alternative to the deterministic template in
// buildRankingDraft() (js/admin.js). Only ever runs on data already
// computed and stored on the candidate (frfc_story_candidates.payload) —
// the model is never asked to invent facts, only to write prose around
// numbers we already trust.
// POST /ai-draft  (Authorization: Bearer <supabase_access_token>)
// Body: { candidateId: string }

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_OUTPUT_TOKENS = 800;

// A single runaway admin session (or a retry loop) shouldn't be able to
// rack up an unbounded OpenAI bill. 60/month is comfortably more than one
// weekly-ranking article a day; raise it deliberately, not by accident.
const MONTHLY_CALL_CAP = 60;

const DISCLOSURE = 'This article was drafted with AI assistance from tracked subscriber and video data, and reviewed by an editor before publishing.';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });
  if (!openaiKey) return res(500, { error: 'Server misconfigured: OPENAI_API_KEY missing' });

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
  const candidateId = body.candidateId;
  if (!candidateId) return res(400, { error: 'candidateId is required' });

  // Spend cap check happens before we touch OpenAI or create a job run —
  // a rejected-for-budget request shouldn't itself count against anything.
  const jobRunsRes = await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs?select=started_at&job_type=eq.ai-draft`, { headers: sbHeaders });
  const jobRuns = jobRunsRes.ok ? await jobRunsRes.json() : [];
  const capCheck = checkMonthlyCap(jobRuns, MONTHLY_CALL_CAP, new Date());
  if (capCheck.exceeded) {
    return res(429, { error: `Monthly AI drafting cap reached (${capCheck.count}/${MONTHLY_CALL_CAP} calls this month). Use the templated draft instead, or raise MONTHLY_CALL_CAP.` });
  }

  const jobRunId = await startJobRun(supabaseUrl, sbHeaders, 'ai-draft');

  try {
    const candRes = await fetch(`${supabaseUrl}/rest/v1/frfc_story_candidates?select=*&id=eq.${candidateId}`, { headers: sbHeaders });
    if (!candRes.ok) throw new Error('Failed to load candidate');
    const candidate = (await candRes.json())[0];
    if (!candidate) throw new Error('Candidate not found');

    const prompt = buildDraftPrompt(candidate);

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });
    if (!aiRes.ok) throw new Error('OpenAI request failed: ' + await aiRes.text());
    const aiJson = await aiRes.json();
    const raw = aiJson.choices && aiJson.choices[0] && aiJson.choices[0].message && aiJson.choices[0].message.content;
    if (!raw) throw new Error('OpenAI returned no content');

    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('OpenAI response was not valid JSON'); }
    if (!parsed.title || !parsed.summary || !parsed.body) throw new Error('OpenAI response missing title/summary/body');

    const draft = finalizeDraft(parsed);

    const payload = Object.assign({}, candidate.payload, { draft });
    const updateRes = await fetch(`${supabaseUrl}/rest/v1/frfc_story_candidates?id=eq.${candidateId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ payload, status: 'review_ready' }),
    });
    if (!updateRes.ok) throw new Error('Failed to save draft: ' + await updateRes.text());

    await logStatus(supabaseUrl, sbHeaders, candidateId, candidate.status, 'review_ready', 'AI-assisted draft generated (gpt-4o-mini)');

    const usage = aiJson.usage || {};
    await finishJobRun(supabaseUrl, sbHeaders, jobRunId, {
      status: 'success', items_processed: 1, items_failed: 0,
      quota_used: usage.total_tokens || null,
    });
    return res(200, { ok: true, draft });
  } catch (e) {
    await finishJobRun(supabaseUrl, sbHeaders, jobRunId, { status: 'failed', items_processed: 0, items_failed: 1, error_summary: { message: e.message } });
    return res(500, { error: e.message });
  }
};

// Pure — no I/O — so it's unit testable without hitting OpenAI or Supabase.
function checkMonthlyCap(jobRuns, cap, now) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const count = jobRuns.filter(r => new Date(r.started_at) >= monthStart).length;
  return { count, exceeded: count >= cap };
}

// Pure — builds the prompt from already-trusted, already-computed data.
// The model is explicitly told not to introduce any fact not present in
// the payload, since this is prose generation over real numbers, not
// research or fact-finding.
function buildDraftPrompt(candidate) {
  const system = [
    'You are a sports content editor writing for FanReactionsFC, a site about football YouTube creators.',
    'You will be given structured ranking data as JSON. Write a short news article using ONLY the facts in that data.',
    'Do not invent statistics, quotes, sponsorships, transfers, or events not present in the data.',
    'Write in plain prose paragraphs separated by blank lines — no markdown headers, no bullet points, no bold text.',
    'Keep it to 3-5 short paragraphs.',
    'Do not include any disclosure or "AI-generated" notice — that is added separately.',
    'Respond with a JSON object with exactly these string fields: title, summary, body.',
  ].join(' ');

  const user = JSON.stringify({
    workingTitle: candidate.working_title,
    type: candidate.type,
    payload: candidate.payload,
  });

  return { system, user };
}

// Pure — appends the disclosure footer deterministically rather than
// trusting the model to reproduce exact required wording, and tags the
// draft so approveAndPublishCandidate() can carry ai_assisted through to
// the published article.
function finalizeDraft(parsed) {
  return {
    title: String(parsed.title).trim(),
    summary: String(parsed.summary).trim(),
    body: String(parsed.body).trim() + '\n\n' + DISCLOSURE,
    ai_generated: true,
  };
}

async function startJobRun(supabaseUrl, sbHeaders, jobType) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/frfc_job_runs`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ job_type: jobType, status: 'running' }),
    });
    const rows = await r.json().catch(() => []);
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

module.exports.checkMonthlyCap = checkMonthlyCap;
module.exports.buildDraftPrompt = buildDraftPrompt;
module.exports.finalizeDraft = finalizeDraft;
module.exports.DISCLOSURE = DISCLOSURE;
module.exports.MONTHLY_CALL_CAP = MONTHLY_CALL_CAP;
