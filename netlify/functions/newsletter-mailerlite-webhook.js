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

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const secret = process.env.MAILERLITE_WEBHOOK_SECRET;
  if (!secret) return res(500, { error: 'Server misconfigured: MAILERLITE_WEBHOOK_SECRET missing' });

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const signature = event.headers.signature || event.headers.Signature || '';
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigOk = signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!sigOk) {
    await logWebhookError(supabaseUrl, sbKey, null, null, 'Invalid signature');
    return res(401, { error: 'Invalid signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch {
    await logWebhookError(supabaseUrl, sbKey, null, null, 'Invalid JSON body');
    return res(400, { error: 'Invalid JSON body' });
  }

  // MailerLite sends a single event object directly, or { events: [...] } when batched.
  const events = Array.isArray(payload.events) ? payload.events : [payload];

  for (const evt of events) {
    const email = String(evt.email || '').trim().toLowerCase();
    const newStatus = STATUS_BY_EVENT[evt.event];
    if (!email || !newStatus) continue; // event type we don't track — ignore

    const patch = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'active') patch.confirmed_at = new Date().toISOString();
    if (newStatus === 'unsubscribed') patch.unsubscribed_at = new Date().toISOString();

    try {
      const patchRes = await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_subscribers?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!patchRes.ok) {
        const detail = await patchRes.text().catch(() => '');
        await logWebhookError(supabaseUrl, sbKey, evt.event, email, `Subscriber update failed (${patchRes.status}): ${detail}`);
      }
    } catch (e) {
      await logWebhookError(supabaseUrl, sbKey, evt.event, email, `Subscriber update threw: ${e.message}`);
    }

    const consentAction = CONSENT_ACTION_BY_EVENT[evt.event];
    if (consentAction) {
      // Must be awaited — an unawaited fetch can get cut off when Netlify
      // freezes the function right after the handler returns (confirmed
      // live: the subscriber PATCH above landed but this fire-and-forget
      // version of this call never wrote a row).
      try {
        const logRes = await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_consent_log`, {
          method: 'POST',
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ email, action: consentAction, notice_version: 'mailerlite_webhook', source: 'mailerlite_webhook' }),
        });
        if (!logRes.ok) {
          const detail = await logRes.text().catch(() => '');
          await logWebhookError(supabaseUrl, sbKey, evt.event, email, `Consent log insert failed (${logRes.status}): ${detail}`);
        }
      } catch (e) {
        await logWebhookError(supabaseUrl, sbKey, evt.event, email, `Consent log insert threw: ${e.message}`);
      }
    }
  }

  return res(200, { ok: true });
};

// P1.1 admin panel surfaces these — see renderNewsletter() in js/admin.js.
async function logWebhookError(supabaseUrl, sbKey, eventType, email, detail) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/frfc_newsletter_webhook_errors`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ event_type: eventType, email, error_detail: String(detail).slice(0, 2000) }),
    });
  } catch (e) { /* best-effort — don't let logging failure mask the original error */ }
}

function res(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
