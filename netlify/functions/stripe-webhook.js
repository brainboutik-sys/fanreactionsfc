// Stripe webhook for the paid Verified tier.
// POST https://fanreactionsfc.com/.netlify/functions/stripe-webhook
//
// Dashboard: Developers → Webhooks → Add endpoint, that URL, events
//   checkout.session.completed
//   invoice.paid
//   invoice.payment_failed
//   customer.subscription.deleted
// Copy the endpoint signing secret into the Netlify env var
// STRIPE_WEBHOOK_SECRET. No Stripe SDK and no Stripe API key: the
// signature is HMAC-SHA256 of `${timestamp}.${rawBody}` with that
// secret as the key (the whsec_ string as given, not base64-decoded).
//
// Env:
//   STRIPE_WEBHOOK_SECRET      — required. Endpoint signing secret.
//   SUPABASE_SERVICE_ROLE_KEY  — required. Same service-role key the
//                                other functions use. Bypasses RLS.
//   SUPABASE_URL               — optional. Defaults to the production project.
//
// The migration supabase/migrations/20261020160000_verified_stripe_webhook.sql
// must be applied first. It is not run by deploy.
//
// Effects:
//   checkout.session.completed — store subscription id and customer id
//     against client_reference_id when that id is a real creator.
//   invoice.paid — set is_verified true and extend verified_until to the
//     invoice line's billing-period end (invoice.period_end if the line
//     has none). A later existing verified_until is kept. An open-ended
//     comp (is_verified already true and verified_until null) stays
//     open-ended.
//   invoice.payment_failed — mark the linked subscription past_due.
//     The current verified_until is left in place.
//   customer.subscription.deleted — mark the subscription canceled.
//     is_verified and verified_until stay as they are, so the period
//     already paid for runs out on its own. The badge hides once
//     verified_until is in the past.
//
// Events are applied once. A second delivery of the same event.id is
// acknowledged and skipped. The id is recorded only after a successful
// apply, so a retry after a 500 can still land.

const crypto = require('crypto');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SIGNATURE_TOLERANCE_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID_RE = /^evt_[A-Za-z0-9_]+$/;
// invoice.paid with no creator link is retried while it is fresh, so a
// checkout.session.completed that arrives second can still attach it.
// After this age Stripe is told 200 and the invoice is logged for review.
const UNLINKED_INVOICE_AGE_MS = 60 * 60 * 1000;
const SUBSCRIPTION_ID_RE = /^sub_[A-Za-z0-9]+$/;
const CUSTOMER_ID_RE = /^cus_[A-Za-z0-9]+$/;

function headerValue(headers, name) {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() !== wanted) continue;
    const value = headers[keys[i]];
    if (Array.isArray(value)) return value[0] || '';
    return value == null ? '' : String(value);
  }
  return '';
}

function parseStripeSignatureHeader(header) {
  const parsed = { timestamp: null, signatures: [] };
  if (typeof header !== 'string' || !header) return parsed;
  const parts = header.split(',');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) parsed.timestamp = Number(value);
    else if (key === 'v1' && value) parsed.signatures.push(value);
  }
  return parsed;
}

function signaturesMatch(expectedHex, candidate) {
  if (typeof candidate !== 'string' || candidate.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, 'utf8'), Buffer.from(candidate, 'utf8'));
}

// Stripe's documented check: HMAC-SHA256 of `${t}.${rawBody}`, then
// reject when the timestamp is older than the tolerance. A clock slightly
// ahead still verifies. v0 signatures are ignored. Any matching v1 is enough
// (secret rotation sends two).
function verifyStripeSignature(rawBody, header, secret, nowMs, toleranceSeconds) {
  const tolerance = Number.isFinite(toleranceSeconds) ? toleranceSeconds : SIGNATURE_TOLERANCE_SECONDS;
  if (typeof secret !== 'string' || !secret) return { ok: false, error: 'Invalid signature' };
  if (typeof rawBody !== 'string') return { ok: false, error: 'Invalid signature' };
  const parsed = parseStripeSignatureHeader(header);
  if (parsed.timestamp == null || parsed.signatures.length === 0) {
    return { ok: false, error: 'Invalid signature' };
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  let matched = false;
  for (let i = 0; i < parsed.signatures.length; i++) {
    if (signaturesMatch(expected, parsed.signatures[i])) matched = true;
  }
  if (!matched) return { ok: false, error: 'Invalid signature' };
  const nowSec = Math.floor((typeof nowMs === 'number' ? nowMs : Date.now()) / 1000);
  if (tolerance > 0 && nowSec - parsed.timestamp > tolerance) {
    return { ok: false, error: 'Stale signature' };
  }
  return { ok: true, timestamp: parsed.timestamp };
}

function stripeId(value, pattern) {
  const id = typeof value === 'string' ? value : (value && typeof value.id === 'string' ? value.id : '');
  if (!id || (pattern && !pattern.test(id))) return '';
  return id;
}

function subscriptionIdFromInvoice(invoice) {
  if (!invoice || typeof invoice !== 'object') return '';
  const direct = stripeId(invoice.subscription, SUBSCRIPTION_ID_RE);
  if (direct) return direct;
  const parent = invoice.parent && invoice.parent.subscription_details;
  const fromParent = parent && stripeId(parent.subscription, SUBSCRIPTION_ID_RE);
  if (fromParent) return fromParent;
  const lines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || {};
    const fromLine = stripeId(line.subscription, SUBSCRIPTION_ID_RE);
    if (fromLine) return fromLine;
    const details = line.parent && line.parent.subscription_item_details;
    const fromDetails = details && stripeId(details.subscription, SUBSCRIPTION_ID_RE);
    if (fromDetails) return fromDetails;
  }
  return '';
}

function billingPeriodEndUnix(invoice) {
  if (!invoice || typeof invoice !== 'object') return null;
  const lines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  let max = null;
  for (let i = 0; i < lines.length; i++) {
    const end = lines[i] && lines[i].period && lines[i].period.end;
    if (typeof end === 'number' && Number.isFinite(end) && end > 0) {
      max = max == null ? end : Math.max(max, end);
    }
  }
  if (max != null) return max;
  if (typeof invoice.period_end === 'number' && Number.isFinite(invoice.period_end) && invoice.period_end > 0) {
    return invoice.period_end;
  }
  return null;
}

// null means "leave verified_until null" (open-ended comp). Otherwise the
// later of the current instant and this invoice's period end.
function extendVerifiedUntil(currentUntil, isVerified, periodEndMs) {
  if (isVerified === true && (currentUntil == null || currentUntil === '')) return null;
  const nextIso = new Date(periodEndMs).toISOString();
  if (currentUntil == null || currentUntil === '') return nextIso;
  const currentMs = Date.parse(currentUntil);
  if (!Number.isFinite(currentMs) || periodEndMs > currentMs) return nextIso;
  return currentUntil;
}

function rawBody(event) {
  const body = event && event.body ? event.body : '';
  if (event && event.isBase64Encoded) return Buffer.from(body, 'base64').toString('utf8');
  return body;
}

function res(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function supabaseFetch(url, sbKey, options) {
  const method = (options && options.method) || 'GET';
  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    Accept: 'application/json',
  };
  if (options && options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options && options.prefer) headers.Prefer = options.prefer;
  const response = await fetch(url, {
    method,
    headers,
    body: options && options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function eventAlreadyProcessed(supabaseUrl, sbKey, eventId) {
  const found = await supabaseFetch(
    `${supabaseUrl}/rest/v1/frfc_stripe_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id`,
    sbKey
  );
  if (!found.ok) throw new Error(`Event lookup failed (${found.status})`);
  return Array.isArray(found.data) && found.data.length > 0;
}

async function recordEvent(supabaseUrl, sbKey, eventId, eventType) {
  const inserted = await supabaseFetch(`${supabaseUrl}/rest/v1/frfc_stripe_events`, sbKey, {
    method: 'POST',
    prefer: 'return=minimal',
    body: { event_id: eventId, event_type: eventType },
  });
  if (inserted.status === 409) return;
  if (!inserted.ok) throw new Error(`Event insert failed (${inserted.status})`);
}

async function findCreator(supabaseUrl, sbKey, creatorId) {
  const found = await supabaseFetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creatorId)}&select=id,is_verified,verified_until`,
    sbKey
  );
  if (!found.ok) throw new Error(`Creator lookup failed (${found.status})`);
  return Array.isArray(found.data) && found.data.length ? found.data[0] : null;
}

async function findSubscription(supabaseUrl, sbKey, subscriptionId) {
  const found = await supabaseFetch(
    `${supabaseUrl}/rest/v1/frfc_verified_subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=stripe_subscription_id,stripe_customer_id,creator_id,status`,
    sbKey
  );
  if (!found.ok) throw new Error(`Subscription lookup failed (${found.status})`);
  return Array.isArray(found.data) && found.data.length ? found.data[0] : null;
}

async function upsertSubscription(supabaseUrl, sbKey, row) {
  const saved = await supabaseFetch(
    `${supabaseUrl}/rest/v1/frfc_verified_subscriptions?on_conflict=stripe_subscription_id`,
    sbKey,
    {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: row,
    }
  );
  if (!saved.ok) throw new Error(`Subscription upsert failed (${saved.status})`);
}

async function patchSubscriptionStatus(supabaseUrl, sbKey, subscriptionId, status) {
  const saved = await supabaseFetch(
    `${supabaseUrl}/rest/v1/frfc_verified_subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
    sbKey,
    {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { status, updated_at: new Date().toISOString() },
    }
  );
  if (!saved.ok) throw new Error(`Subscription status update failed (${saved.status})`);
}

async function patchCreatorTier(supabaseUrl, sbKey, creatorId, verifiedUntil) {
  const saved = await supabaseFetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(creatorId)}`,
    sbKey,
    {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { is_verified: true, verified_until: verifiedUntil },
    }
  );
  if (!saved.ok) throw new Error(`Creator tier update failed (${saved.status})`);
}

async function handleCheckout(supabaseUrl, sbKey, session) {
  const creatorId = session && session.client_reference_id != null ? String(session.client_reference_id).trim() : '';
  if (!UUID_RE.test(creatorId)) {
    console.error('stripe-webhook checkout skipped: client_reference_id is not a creator id');
    return { ok: true, meta: { skipped: 'invalid_client_reference_id' } };
  }
  const customerId = stripeId(session.customer, CUSTOMER_ID_RE);
  const subscriptionId = stripeId(session.subscription, SUBSCRIPTION_ID_RE);
  if (!customerId || !subscriptionId) {
    return { ok: false, status: 500, error: 'Checkout session missing customer or subscription' };
  }
  const creator = await findCreator(supabaseUrl, sbKey, creatorId);
  if (!creator) {
    console.error('stripe-webhook checkout skipped: unknown creator', creatorId);
    return { ok: true, meta: { skipped: 'unknown_creator' } };
  }
  await upsertSubscription(supabaseUrl, sbKey, {
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    creator_id: creatorId,
    status: 'active',
    updated_at: new Date().toISOString(),
  });
  return { ok: true, meta: { linked: creatorId } };
}

function eventAgeMs(payload, nowMs) {
  const created = payload && payload.created;
  if (typeof created !== 'number' || !Number.isFinite(created)) return 0;
  return (typeof nowMs === 'number' ? nowMs : Date.now()) - (created * 1000);
}

// Service-role insert into frfc_stripe_unlinked_invoices. The migration is
// applied by hand; if the table is not there yet the function log still
// has the ids and the webhook returns 200 so Stripe stops retrying.
async function logUnlinkedInvoice(supabaseUrl, sbKey, payload, invoice, subscriptionId) {
  const customerId = stripeId(invoice && invoice.customer, CUSTOMER_ID_RE);
  const invoiceId = invoice && typeof invoice.id === 'string' ? invoice.id.slice(0, 80) : '';
  const created = payload && typeof payload.created === 'number'
    ? new Date(payload.created * 1000).toISOString()
    : null;
  console.error(
    'stripe-webhook invoice.paid unlinked after retry window',
    payload && payload.id,
    subscriptionId,
    customerId || '',
    invoiceId || ''
  );
  try {
    const inserted = await supabaseFetch(`${supabaseUrl}/rest/v1/frfc_stripe_unlinked_invoices`, sbKey, {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        event_id: payload.id,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId || null,
        invoice_id: invoiceId || null,
        event_created_at: created,
      },
    });
    if (inserted.status === 409) return;
    if (!inserted.ok) console.error('stripe-webhook unlinked invoice log failed', inserted.status);
  } catch (e) {
    console.error('stripe-webhook unlinked invoice log failed', e && e.message);
  }
}

async function handleInvoicePaid(supabaseUrl, sbKey, invoice, payload) {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return { ok: true, meta: { skipped: 'no_subscription' } };
  const periodEnd = billingPeriodEndUnix(invoice);
  if (periodEnd == null) return { ok: false, status: 500, error: 'Invoice missing billing period end' };
  const link = await findSubscription(supabaseUrl, sbKey, subscriptionId);
  if (!link) {
    if (eventAgeMs(payload, Date.now()) >= UNLINKED_INVOICE_AGE_MS) {
      await logUnlinkedInvoice(supabaseUrl, sbKey, payload, invoice, subscriptionId);
      return { ok: true, meta: { skipped: 'unlinked_subscription', review: true } };
    }
    return { ok: false, status: 500, error: 'Subscription not linked yet' };
  }
  const creator = await findCreator(supabaseUrl, sbKey, link.creator_id);
  if (!creator) {
    console.error('stripe-webhook invoice.paid skipped: creator missing', link.creator_id);
    return { ok: true, meta: { skipped: 'unknown_creator' } };
  }
  const verifiedUntil = extendVerifiedUntil(creator.verified_until, creator.is_verified === true, periodEnd * 1000);
  await patchCreatorTier(supabaseUrl, sbKey, creator.id, verifiedUntil);
  if (link.status !== 'canceled') await patchSubscriptionStatus(supabaseUrl, sbKey, subscriptionId, 'active');
  return { ok: true, meta: { creatorId: creator.id, verifiedUntil } };
}

async function handleInvoicePaymentFailed(supabaseUrl, sbKey, invoice) {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return { ok: true, meta: { skipped: 'no_subscription' } };
  const link = await findSubscription(supabaseUrl, sbKey, subscriptionId);
  if (!link) return { ok: true, meta: { skipped: 'unknown_subscription' } };
  if (link.status !== 'canceled') await patchSubscriptionStatus(supabaseUrl, sbKey, subscriptionId, 'past_due');
  return { ok: true, meta: { lapsed: false, status: link.status === 'canceled' ? 'canceled' : 'past_due' } };
}

async function handleSubscriptionDeleted(supabaseUrl, sbKey, subscription) {
  const subscriptionId = stripeId(subscription && (subscription.id || subscription.subscription), SUBSCRIPTION_ID_RE);
  if (!subscriptionId) return { ok: true, meta: { skipped: 'no_subscription' } };
  const link = await findSubscription(supabaseUrl, sbKey, subscriptionId);
  if (!link) return { ok: true, meta: { skipped: 'unknown_subscription' } };
  await patchSubscriptionStatus(supabaseUrl, sbKey, subscriptionId, 'canceled');
  return { ok: true, meta: { canceled: subscriptionId } };
}

async function dispatch(supabaseUrl, sbKey, payload) {
  const obj = (payload.data && payload.data.object) || {};
  switch (payload.type) {
    case 'checkout.session.completed':
      return handleCheckout(supabaseUrl, sbKey, obj);
    case 'invoice.paid':
      return handleInvoicePaid(supabaseUrl, sbKey, obj, payload);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(supabaseUrl, sbKey, obj);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(supabaseUrl, sbKey, obj);
    default:
      return { ok: true, meta: { ignored: payload.type } };
  }
}

exports.handler = async (event) => {
  if (event && event.httpMethod && event.httpMethod !== 'POST') {
    return res(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res(500, { error: 'Server misconfigured: STRIPE_WEBHOOK_SECRET missing' });

  const body = rawBody(event);
  const verdict = verifyStripeSignature(body, headerValue(event && event.headers, 'stripe-signature'), secret, Date.now());
  if (!verdict.ok) return res(400, { error: verdict.error });

  let payload;
  try { payload = JSON.parse(body); } catch {
    return res(400, { error: 'Invalid JSON body' });
  }
  if (!payload || typeof payload.id !== 'string' || typeof payload.type !== 'string' || !EVENT_ID_RE.test(payload.id)) {
    return res(400, { error: 'Invalid event' });
  }

  try {
    if (await eventAlreadyProcessed(supabaseUrl, sbKey, payload.id)) {
      return res(200, { ok: true, duplicate: true });
    }
    const result = await dispatch(supabaseUrl, sbKey, payload);
    if (!result.ok) return res(result.status || 500, { error: result.error || 'Webhook handler failed' });
    await recordEvent(supabaseUrl, sbKey, payload.id, payload.type);
    return res(200, Object.assign({ ok: true }, result.meta));
  } catch (e) {
    console.error('stripe-webhook', payload.id, payload.type, e.message);
    return res(500, { error: 'Webhook handler failed' });
  }
};

exports.verifyStripeSignature = verifyStripeSignature;
exports.SIGNATURE_TOLERANCE_SECONDS = SIGNATURE_TOLERANCE_SECONDS;
exports.extendVerifiedUntil = extendVerifiedUntil;
exports.subscriptionIdFromInvoice = subscriptionIdFromInvoice;
exports.billingPeriodEndUnix = billingPeriodEndUnix;
exports.UNLINKED_INVOICE_AGE_MS = UNLINKED_INVOICE_AGE_MS;
exports.eventAgeMs = eventAgeMs;
