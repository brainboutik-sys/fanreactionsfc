// Self-serve, no-login newsletter unsubscribe (P0.5 of the MailerLite plan).
// POST /newsletter-unsubscribe   Body: { email, source }
//
// Always responds 200 { ok: true } for a well-formed email, whether or not
// that address is actually subscribed — this endpoint must not become a way
// to check who is on the list. The real one-click unsubscribe link inside
// each campaign email is MailerLite's own hosted link; this is the extra,
// branded self-serve path from /newsletter/preferences and
// /newsletter/unsubscribe reachable without an email in hand.

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const MAILERLITE_API = 'https://connect.mailerlite.com/api/subscribers';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Invalid JSON body' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const source = String(body.source || 'preferences_page');
  if (!EMAIL_RE.test(email)) return res(400, { error: 'A valid email address is required' });

  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_subscribers?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('newsletter-unsubscribe: subscriber update failed', e);
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_consent_log`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        email, action: 'opt_out', notice_version: 'n/a', source,
        user_agent: String(event.headers['user-agent'] || '').slice(0, 300),
      }),
    });
  } catch (e) {
    console.error('newsletter-unsubscribe: consent log insert failed', e);
  }

  const mlToken = process.env.MAILERLITE_API_TOKEN;
  if (mlToken) {
    try {
      await fetch(MAILERLITE_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mlToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, status: 'unsubscribed' }),
      });
    } catch (e) {
      console.error('newsletter-unsubscribe: MailerLite call failed', e);
    }
  }

  return res(200, { ok: true });
};

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
