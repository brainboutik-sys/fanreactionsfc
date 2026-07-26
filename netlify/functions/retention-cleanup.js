// Netlify scheduled function — deletes personal-data rows past their
// documented retention window (see /privacy Section 5). Runs daily.
//
// Retention:
//   frfc_contact_messages  — 12 months from submission
//   frfc_creator_reports   — 12 months from submission (whether resolved or not)
//
// These are the only tables holding data collected from non-account free-text
// forms (name/email/message); account-linked data (profile, favourites, etc.)
// is retained only while the account exists and is deleted via the
// delete-account Edge Function when a user closes their account.
//
// Required env vars:
//   SUPABASE_URL                — optional, falls back to hardcoded
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase secret key so deletes bypass RLS

exports.config = { schedule: '0 5 * * *' };

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const RETENTION_DAYS = 365;

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return ok({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

  const results = {};
  for (const [table, dateCol] of [['frfc_contact_messages', 'created_at'], ['frfc_creator_reports', 'submitted_at']]) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${dateCol}=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE', headers });
      const deleted = res.ok ? await res.json().catch(() => []) : [];
      results[table] = { ok: res.ok, deletedCount: Array.isArray(deleted) ? deleted.length : 0, status: res.status };
    } catch (e) {
      results[table] = { ok: false, error: String(e) };
    }
  }

  return ok({ cutoff, results });
};

function ok(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
