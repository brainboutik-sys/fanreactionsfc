// Inbound MailerLite webhook (P0.6 of the MailerLite plan). Also the piece
// that closes the double-opt-in loop for newsletter-subscribe.js: MailerLite
// sends its own confirmation email, and subscriber.active is how it tells us
// the visitor actually clicked confirm.
//
// Configure in MailerLite: Integrations > Webhooks > add
// https://fanreactionsfc.com/.netlify/functions/newsletter-mailerlite-webhook
// for events subscriber.active, subscriber.unsubscribed, subscriber.bounced,
// subscriber.spam_reported — copy the webhook's secret into the
// MAILERLITE_WEBHOOK_SECRET Netlify env var.

const crypto = require('crypto');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

const STATUS_BY_EVENT = {
  'subscriber.active': 'active',
  'subscriber.unsubscribed': 'unsubscribed',
  'subscriber.bounced': 'bounced',
  'subscriber.spam_reported': 'complained',
};
const CONSENT_ACTION_BY_EVENT = {
  'subscriber.active': 'confirm',
  'subscriber.unsubscribed': 'opt_out',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });

  const secret = process.env.MAILERLITE_WEBHOOK_SECRET;
  if (!secret) return res(500, { error: 'Server misconfigured: MAILERLITE_WEBHOOK_SECRET missing' });

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const signature = event.headers.signature || event.headers.Signature || '';
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigOk = signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!sigOk) return res(401, { error: 'Invalid signature' });

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return res(400, { error: 'Invalid JSON body' }); }

  // MailerLite sends a single event object directly, or { events: [...] } when batched.
  const events = Array.isArray(payload.events) ? payload.events : [payload];

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  for (const evt of events) {
    const email = String(evt.email || '').trim().toLowerCase();
    const newStatus = STATUS_BY_EVENT[evt.event];
    if (!email || !newStatus) continue; // event type we don't track — ignore

    const patch = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'active') patch.confirmed_at = new Date().toISOString();
    if (newStatus === 'unsubscribed') patch.unsubscribed_at = new Date().toISOString();

    try {
      await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_subscribers?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      console.error('newsletter webhook: subscriber update failed', evt.event, e);
    }

    const consentAction = CONSENT_ACTION_BY_EVENT[evt.event];
    if (consentAction) {
      fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_consent_log`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ email, action: consentAction, notice_version: 'mailerlite_webhook', source: 'mailerlite_webhook' }),
      }).catch(() => {});
    }
  }

  return res(200, { ok: true });
};

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
