// Newsletter signup endpoint (P0.3/P0.4 of the MailerLite plan).
// POST /newsletter-subscribe  (Authorization: Bearer <supabase_access_token>, optional)
// Body: { email, consent: true, source, notice_version }
//
// Flow:
//  1. Validate email + require explicit consent (blocked server-side even if
//     the client checkbox were bypassed).
//  2. If a Bearer token is present, resolve the signed-in user so the row can
//     be tagged is_site_member + user_id.
//  3. Upsert frfc_newsletter_subscribers by lower(email) — new signup goes to
//     'pending', a resubscribe from 'unsubscribed' resets to 'pending' and
//     requires a fresh double opt-in, an existing pending/active row is left
//     alone (idempotent, no error spam). bounced/complained rows are never
//     re-armed from this endpoint.
//  4. Always append an opt_in row to frfc_newsletter_consent_log.
//  5. Call MailerLite to (re)send its own double opt-in confirmation email —
//     account-wide "Double opt-in for API and integrations" must be enabled
//     in MailerLite (Account settings > Subscribe settings) for this to fire.
//     MailerLite's subscriber.active webhook (see newsletter-mailerlite-webhook.js)
//     is what tells us the visitor actually confirmed.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const MAILERLITE_API = 'https://connect.mailerlite.com/api/subscribers';
const ALLOWED_SOURCES = ['site_footer', 'news_page', 'article', 'account', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON body' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const source = body.source;
  const noticeVersion = String(body.notice_version || '').trim();
  if (!EMAIL_RE.test(email)) return res(400, { error: 'A valid email address is required' });
  if (body.consent !== true) return res(400, { error: 'Consent is required to subscribe' });
  if (!ALLOWED_SOURCES.includes(source)) return res(400, { error: 'Invalid source' });
  if (!noticeVersion) return res(400, { error: 'notice_version is required' });

  // Optional: resolve the signed-in user from the Bearer token, if any.
  let userId = null;
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    try {
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${token}` },
      });
      if (userRes.ok) {
        const u = await userRes.json();
        userId = u.id || null;
      }
    } catch { /* treat as anonymous signup */ }
  }
  const isSiteMember = !!userId;

  // Look up any existing subscriber row for this email.
  let existing = null;
  try {
    const findRes = await fetch(
      `${supabaseUrl}/rest/v1/frfc_newsletter_subscribers?select=id,status&email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (findRes.ok) {
      const rows = await findRes.json();
      existing = rows[0] || null;
    }
  } catch { /* fall through and attempt an insert */ }

  const isSuppressed = existing && (existing.status === 'bounced' || existing.status === 'complained');
  const needsFreshDoi = !existing || existing.status === 'unsubscribed';

  if (!existing) {
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_subscribers`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ email, status: 'pending', source, is_site_member: isSiteMember, user_id: userId }),
    });
    if (!insertRes.ok) return res(502, { error: 'Could not save your subscription. Please try again.' });
  } else if (existing.status === 'unsubscribed') {
    const patchRes = await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_subscribers?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'pending', source, is_site_member: isSiteMember, user_id: userId, unsubscribed_at: null, confirmed_at: null, updated_at: new Date().toISOString() }),
    });
    if (!patchRes.ok) return res(502, { error: 'Could not save your subscription. Please try again.' });
  }
  // pending/active/suppressed rows: nothing to change locally — just log consent below.

  // Always record the consent event, even for an idempotent re-tick or a
  // suppressed address, so there's a full history of what was agreed to.
  fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_consent_log`, {
    method: 'POST',
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      email, action: 'opt_in', notice_version: noticeVersion, source,
      user_agent: String(event.headers['user-agent'] || '').slice(0, 300),
    }),
  }).catch(() => {});

  // Never push a bounced/complained address back to MailerLite from this
  // endpoint — respond as success either way so we don't leak suppression
  // status to whoever is submitting the form.
  if (isSuppressed) return res(200, { ok: true, status: 'pending' });

  const mlToken = process.env.MAILERLITE_API_TOKEN;
  if (mlToken) {
    const groups = [
      process.env.MAILERLITE_GROUP_NEWSLETTER_ONLY,
      isSiteMember ? process.env.MAILERLITE_GROUP_SITE_MEMBERS : null,
    ].filter(Boolean);
    try {
      const mlRes = await fetch(MAILERLITE_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mlToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        // Passing status:'unconfirmed' explicitly is what makes MailerLite (re-)send its
        // double opt-in email even to a subscriber it already knows about (e.g. a resubscribe).
        body: JSON.stringify({ email, groups, ...(needsFreshDoi ? { status: 'unconfirmed' } : {}) }),
      });
      if (!mlRes.ok) {
        const detail = await mlRes.text().catch(() => '');
        console.error('MailerLite subscribe failed', mlRes.status, detail);
        return res(502, { error: 'Could not reach our email provider. Please try again shortly.' });
      }
    } catch (e) {
      console.error('MailerLite subscribe error', e);
      return res(502, { error: 'Could not reach our email provider. Please try again shortly.' });
    }
  } else {
    console.error('MAILERLITE_API_TOKEN missing — subscriber saved locally but not sent to MailerLite');
  }

  return res(200, { ok: true, status: 'pending' });
};

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
