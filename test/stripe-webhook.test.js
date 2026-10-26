const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const webhook = require('../netlify/functions/stripe-webhook.js');

const SECRET = 'whsec_test_secret_value';
const SERVICE = 'service-role-test-key';
const SUPABASE_URL = 'https://example.supabase.co';
const CREATOR = '11111111-1111-4111-8111-111111111111';
const UNKNOWN = '22222222-2222-4222-8222-222222222222';
const PERIOD_END_MS = Date.parse('2026-11-20T00:00:00.000Z');
const PERIOD_END_UNIX = PERIOD_END_MS / 1000;
const LATER_UNTIL = '2027-06-01T00:00:00.000Z';

function stripeHeader(secret, rawBody, timestamp, extraV1) {
  const hex = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  const header = `t=${timestamp},v1=${hex}`;
  return extraV1 ? `${header},v1=${extraV1}` : header;
}

function signedEvent(payload, timestamp, secret) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    header: stripeHeader(secret || SECRET, rawBody, timestamp),
  };
}

function memoryBackend(creators) {
  const state = {
    events: new Map(),
    creators: new Map(creators || []),
    subs: new Map(),
    unlinked: new Map(),
    calls: [],
  };

  async function fetchImpl(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const u = new URL(String(url));
    const body = options.body ? JSON.parse(options.body) : null;
    const call = { method, pathname: u.pathname, search: u.search, body, headers: options.headers || {} };
    state.calls.push(call);
    const table = u.pathname.split('/').filter(Boolean).pop();
    const auth = call.headers.Authorization || '';
    if (auth !== `Bearer ${SERVICE}` || call.headers.apikey !== SERVICE) {
      return json(401, { message: 'bad key' });
    }

    if (table === 'frfc_stripe_events' && method === 'GET') {
      const id = eqParam(u, 'event_id');
      const row = state.events.get(id);
      return json(200, row ? [{ event_id: row.event_id }] : []);
    }
    if (table === 'frfc_stripe_events' && method === 'POST') {
      if (state.events.has(body.event_id)) return json(409, { code: '23505' });
      state.events.set(body.event_id, { event_id: body.event_id, event_type: body.event_type });
      return json(201, null);
    }
    if (table === 'frfc_streamers' && method === 'GET') {
      const id = eqParam(u, 'id');
      const row = state.creators.get(id);
      return json(200, row ? [{ ...row }] : []);
    }
    if (table === 'frfc_streamers' && method === 'PATCH') {
      const id = eqParam(u, 'id');
      const row = state.creators.get(id);
      if (!row) return json(404, { message: 'missing creator' });
      if (Object.prototype.hasOwnProperty.call(body, 'is_verified')) row.is_verified = body.is_verified;
      if (Object.prototype.hasOwnProperty.call(body, 'verified_until')) row.verified_until = body.verified_until;
      return json(204, null);
    }
    if (table === 'frfc_verified_subscriptions' && method === 'GET') {
      const id = eqParam(u, 'stripe_subscription_id');
      const row = state.subs.get(id);
      return json(200, row ? [{ ...row }] : []);
    }
    if (table === 'frfc_verified_subscriptions' && method === 'POST') {
      const existing = state.subs.get(body.stripe_subscription_id);
      state.subs.set(body.stripe_subscription_id, {
        stripe_subscription_id: body.stripe_subscription_id,
        stripe_customer_id: body.stripe_customer_id,
        creator_id: body.creator_id,
        status: body.status,
        updated_at: body.updated_at,
        created_at: existing ? existing.created_at : body.updated_at,
      });
      return json(201, null);
    }
    if (table === 'frfc_stripe_unlinked_invoices' && method === 'POST') {
      state.unlinked.set(body.event_id, body);
      return json(201, null);
    }
    if (table === 'frfc_verified_subscriptions' && method === 'PATCH') {
      const id = eqParam(u, 'stripe_subscription_id');
      const row = state.subs.get(id);
      if (!row) return json(404, { message: 'missing subscription' });
      if (body.status) row.status = body.status;
      if (body.updated_at) row.updated_at = body.updated_at;
      return json(204, null);
    }
    return json(500, { message: `unexpected ${method} ${u.pathname}` });
  }

  return { state, fetchImpl };
}

function eqParam(url, key) {
  const raw = url.searchParams.get(key) || '';
  return raw.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : '';
}

function json(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data == null ? '' : JSON.stringify(data)),
  };
}

function creator(overrides) {
  return Object.assign({
    id: CREATOR,
    is_verified: false,
    verified_until: null,
  }, overrides);
}

function checkoutPayload(eventId, creatorId) {
  return {
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        object: 'checkout.session',
        client_reference_id: creatorId,
        customer: 'cus_123',
        subscription: 'sub_123',
        mode: 'subscription',
      },
    },
  };
}

function invoicePayload(eventId, shape) {
  const lineEnd = PERIOD_END_UNIX;
  const baseLine = { period: { start: lineEnd - 2592000, end: lineEnd } };
  const invoice = {
    id: 'in_123',
    object: 'invoice',
    customer: 'cus_123',
    period_end: lineEnd - 86400,
    lines: { data: [Object.assign({ subscription: 'sub_123' }, baseLine)] },
  };
  if (shape === 'parent') {
    delete invoice.lines.data[0].subscription;
    invoice.subscription = null;
    invoice.parent = { type: 'subscription_details', subscription_details: { subscription: 'sub_123' } };
    invoice.lines.data[0].parent = { subscription_item_details: { subscription: 'sub_123' } };
  } else {
    invoice.subscription = 'sub_123';
  }
  return {
    id: eventId,
    object: 'event',
    type: 'invoice.paid',
    data: { object: invoice },
  };
}

function paymentFailedPayload(eventId) {
  return {
    id: eventId,
    object: 'event',
    type: 'invoice.payment_failed',
    data: {
      object: {
        object: 'invoice',
        customer: 'cus_123',
        subscription: 'sub_123',
      },
    },
  };
}

function deletedPayload(eventId) {
  return {
    id: eventId,
    object: 'event',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_123',
        object: 'subscription',
        customer: 'cus_123',
        status: 'canceled',
      },
    },
  };
}

async function withWebhookEnv(env, fn) {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const prev = {};
  for (const key of keys) prev[key] = process.env[key];
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = env.SUPABASE_URL === undefined ? SUPABASE_URL : env.SUPABASE_URL;
  if (env.SUPABASE_SERVICE_ROLE_KEY === undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  else if (env.SUPABASE_SERVICE_ROLE_KEY == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (env.STRIPE_WEBHOOK_SECRET === undefined) process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  else if (env.STRIPE_WEBHOOK_SECRET == null) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
  global.fetch = env.fetch || (async () => { throw new Error('fetch should not be called'); });
  try {
    return await fn();
  } finally {
    global.fetch = prevFetch;
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function post(rawBody, header, extra) {
  return webhook.handler(Object.assign({
    httpMethod: 'POST',
    headers: { 'Stripe-Signature': header },
    body: rawBody,
    isBase64Encoded: false,
  }, extra));
}

async function deliver(payload, backend, timestamp) {
  const signed = signedEvent(payload, timestamp || Math.floor(Date.now() / 1000));
  const response = await withWebhookEnv({ fetch: backend.fetchImpl }, () => post(signed.rawBody, signed.header));
  return { response, body: JSON.parse(response.body) };
}

function streamerPatches(state) {
  return state.calls.filter(call => call.method === 'PATCH' && call.pathname.endsWith('frfc_streamers'));
}

function subscriptionPosts(state) {
  return state.calls.filter(call => call.method === 'POST' && call.pathname.endsWith('frfc_verified_subscriptions'));
}

test('signature verification accepts a fresh v1 and rejects a bad or stale one', () => {
  const nowSec = 1700000000;
  const nowMs = nowSec * 1000;
  const raw = '{"id":"evt_1"}';
  const fresh = nowSec - 10;
  const edge = nowSec - webhook.SIGNATURE_TOLERANCE_SECONDS;
  const stale = nowSec - webhook.SIGNATURE_TOLERANCE_SECONDS - 1;
  const ahead = nowSec + 60;

  assert.equal(webhook.verifyStripeSignature(raw, stripeHeader(SECRET, raw, fresh), SECRET, nowMs).ok, true);
  assert.equal(webhook.verifyStripeSignature(raw, stripeHeader(SECRET, raw, edge), SECRET, nowMs).ok, true);
  assert.equal(webhook.verifyStripeSignature(raw, stripeHeader(SECRET, raw, ahead), SECRET, nowMs).ok, true);

  const rotated = stripeHeader(SECRET, raw, fresh, 'a'.repeat(64));
  assert.equal(webhook.verifyStripeSignature(raw, rotated, SECRET, nowMs).ok, true);
  const onlyWrong = `t=${fresh},v1=${'ab'.repeat(32)}`;
  const wrong = webhook.verifyStripeSignature(raw, onlyWrong, SECRET, nowMs);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'Invalid signature');

  const old = webhook.verifyStripeSignature(raw, stripeHeader(SECRET, raw, stale), SECRET, nowMs);
  assert.equal(old.ok, false);
  assert.equal(old.error, 'Stale signature');

  const tampered = webhook.verifyStripeSignature(raw + ' ', stripeHeader(SECRET, raw, fresh), SECRET, nowMs);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.error, 'Invalid signature');

  const v0Only = `t=${fresh},v0=${crypto.createHmac('sha256', SECRET).update(`${fresh}.${raw}`).digest('hex')}`;
  assert.equal(webhook.verifyStripeSignature(raw, v0Only, SECRET, nowMs).ok, false);
  assert.equal(webhook.verifyStripeSignature(raw, '', SECRET, nowMs).ok, false);
});

test('the handler rejects invalid and stale signatures with 400 and does not touch Supabase', async () => {
  const raw = JSON.stringify(checkoutPayload('evt_checkout_sig', CREATOR));
  const now = Math.floor(Date.now() / 1000);
  const bad = await withWebhookEnv({}, () => post(raw, stripeHeader(SECRET, raw, now).replace(/v1=[0-9a-f]+/, 'v1=' + '0'.repeat(64))));
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).error, 'Invalid signature');

  const staleHeader = stripeHeader(SECRET, raw, now - webhook.SIGNATURE_TOLERANCE_SECONDS - 5);
  const stale = await withWebhookEnv({}, () => post(raw, staleHeader));
  assert.equal(stale.statusCode, 400);
  assert.equal(JSON.parse(stale.body).error, 'Stale signature');

  const missingSecret = await withWebhookEnv({ STRIPE_WEBHOOK_SECRET: null }, () => post(raw, stripeHeader(SECRET, raw, now)));
  assert.equal(missingSecret.statusCode, 500);
  assert.match(JSON.parse(missingSecret.body).error, /STRIPE_WEBHOOK_SECRET/);

  const missingKey = await withWebhookEnv({ SUPABASE_SERVICE_ROLE_KEY: null }, () => post(raw, stripeHeader(SECRET, raw, now)));
  assert.equal(missingKey.statusCode, 500);
  assert.match(JSON.parse(missingKey.body).error, /SUPABASE_SERVICE_ROLE_KEY/);

  const get = await withWebhookEnv({}, () => webhook.handler({ httpMethod: 'GET', headers: {}, body: '' }));
  assert.equal(get.statusCode, 405);
});

test('checkout.session.completed stores the subscription against a real creator and skips anything else', async () => {
  const backend = memoryBackend([[CREATOR, creator()]]);
  const ok = await deliver(checkoutPayload('evt_checkout_ok', CREATOR), backend);
  assert.equal(ok.response.statusCode, 200);
  assert.equal(ok.body.linked, CREATOR);
  const row = backend.state.subs.get('sub_123');
  assert.equal(row.stripe_customer_id, 'cus_123');
  assert.equal(row.creator_id, CREATOR);
  assert.equal(row.status, 'active');
  assert.equal(backend.state.creators.get(CREATOR).is_verified, false);
  assert.equal(streamerPatches(backend.state).length, 0);

  const unknown = await deliver(checkoutPayload('evt_checkout_unknown', UNKNOWN), backend);
  assert.equal(unknown.response.statusCode, 200);
  assert.equal(unknown.body.skipped, 'unknown_creator');
  assert.equal(backend.state.subs.size, 1);

  const badId = await deliver(checkoutPayload('evt_checkout_bad', 'not a creator'), backend);
  assert.equal(badId.response.statusCode, 200);
  assert.equal(badId.body.skipped, 'invalid_client_reference_id');
  assert.equal(subscriptionPosts(backend.state).length, 1);

  const missingSub = checkoutPayload('evt_checkout_nosub', CREATOR);
  missingSub.data.object.subscription = null;
  const retry = await deliver(missingSub, backend);
  assert.equal(retry.response.statusCode, 500);
  assert.equal(backend.state.events.has('evt_checkout_nosub'), false);
});

test('a repeated event id is acknowledged and not applied twice', async () => {
  const backend = memoryBackend([[CREATOR, creator()]]);
  const first = await deliver(checkoutPayload('evt_checkout_once', CREATOR), backend);
  assert.equal(first.response.statusCode, 200);
  const posts = subscriptionPosts(backend.state).length;
  const second = await deliver(checkoutPayload('evt_checkout_once', CREATOR), backend);
  assert.equal(second.response.statusCode, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(subscriptionPosts(backend.state).length, posts);
  assert.equal(backend.state.subs.size, 1);
});

test('invoice.paid turns Verified on through the billing period end and a retry waits for the link', async () => {
  const backend = memoryBackend([[CREATOR, creator()]]);
  const early = await deliver(invoicePayload('evt_invoice_1'), backend);
  assert.equal(early.response.statusCode, 500);
  assert.equal(JSON.parse(early.response.body).error, 'Subscription not linked yet');
  assert.equal(backend.state.events.has('evt_invoice_1'), false);
  assert.equal(backend.state.creators.get(CREATOR).is_verified, false);

  await deliver(checkoutPayload('evt_checkout_before_invoice', CREATOR), backend);
  const paid = await deliver(invoicePayload('evt_invoice_1'), backend);
  assert.equal(paid.response.statusCode, 200);
  const row = backend.state.creators.get(CREATOR);
  assert.equal(row.is_verified, true);
  assert.equal(row.verified_until, new Date(PERIOD_END_MS).toISOString());
  assert.equal(backend.state.subs.get('sub_123').status, 'active');
  const patch = streamerPatches(backend.state).at(-1);
  assert.equal(patch.body.verified_until, new Date(PERIOD_END_MS).toISOString());
  assert.notEqual(patch.body.verified_until, new Date((PERIOD_END_UNIX - 86400) * 1000).toISOString());

  const patches = streamerPatches(backend.state).length;
  const again = await deliver(invoicePayload('evt_invoice_1'), backend);
  assert.equal(again.body.duplicate, true);
  assert.equal(streamerPatches(backend.state).length, patches);
});

test('a stale unlinked invoice.paid is acknowledged and logged, a fresh one still retries', async () => {
  const backend = memoryBackend([[CREATOR, creator()]]);
  const now = Math.floor(Date.now() / 1000);
  const freshPayload = invoicePayload('evt_invoice_fresh');
  freshPayload.created = now - 60;
  const fresh = await deliver(freshPayload, backend);
  assert.equal(fresh.response.statusCode, 500);
  assert.equal(fresh.body.error, 'Subscription not linked yet');
  assert.equal(backend.state.events.has('evt_invoice_fresh'), false);
  assert.equal(backend.state.unlinked.size, 0);

  const stalePayload = invoicePayload('evt_invoice_stale');
  stalePayload.created = now - Math.ceil(webhook.UNLINKED_INVOICE_AGE_MS / 1000) - 5;
  const stale = await deliver(stalePayload, backend);
  assert.equal(stale.response.statusCode, 200);
  assert.equal(stale.body.skipped, 'unlinked_subscription');
  assert.equal(stale.body.review, true);
  assert.equal(backend.state.events.has('evt_invoice_stale'), true);
  assert.equal(backend.state.creators.get(CREATOR).is_verified, false);
  const logged = backend.state.unlinked.get('evt_invoice_stale');
  assert.equal(logged.stripe_subscription_id, 'sub_123');
  assert.equal(logged.stripe_customer_id, 'cus_123');
  assert.equal(logged.invoice_id, 'in_123');
  assert.equal(Object.prototype.hasOwnProperty.call(logged, 'email'), false);

  const again = await deliver(stalePayload, backend);
  assert.equal(again.body.duplicate, true);
  assert.equal(backend.state.unlinked.size, 1);
});

test('invoice.paid reads the newer invoice parent subscription id and does not shorten a later or open-ended period', async () => {
  assert.equal(webhook.subscriptionIdFromInvoice({
    parent: { subscription_details: { subscription: 'sub_parent' } },
  }), 'sub_parent');
  assert.equal(webhook.billingPeriodEndUnix({
    period_end: 100,
    lines: { data: [{ period: { end: 200 } }, { period: { end: 150 } }] },
  }), 200);
  assert.equal(webhook.extendVerifiedUntil(null, false, PERIOD_END_MS), new Date(PERIOD_END_MS).toISOString());
  assert.equal(webhook.extendVerifiedUntil(LATER_UNTIL, true, PERIOD_END_MS), LATER_UNTIL);
  assert.equal(webhook.extendVerifiedUntil(null, true, PERIOD_END_MS), null);

  const later = memoryBackend([[CREATOR, creator({ is_verified: true, verified_until: LATER_UNTIL })]]);
  await deliver(checkoutPayload('evt_checkout_later', CREATOR), later);
  const paidLater = await deliver(invoicePayload('evt_invoice_later', 'parent'), later);
  assert.equal(paidLater.response.statusCode, 200);
  assert.equal(later.state.creators.get(CREATOR).is_verified, true);
  assert.equal(later.state.creators.get(CREATOR).verified_until, LATER_UNTIL);

  const comp = memoryBackend([[CREATOR, creator({ is_verified: true, verified_until: null })]]);
  await deliver(checkoutPayload('evt_checkout_comp', CREATOR), comp);
  const paidComp = await deliver(invoicePayload('evt_invoice_comp'), comp);
  assert.equal(paidComp.response.statusCode, 200);
  assert.equal(comp.state.creators.get(CREATOR).is_verified, true);
  assert.equal(comp.state.creators.get(CREATOR).verified_until, null);
  assert.equal(streamerPatches(comp.state).at(-1).body.verified_until, null);
});

test('a failed payment and a deleted subscription leave the current Verified period in place', async () => {
  const backend = memoryBackend([[CREATOR, creator()]]);
  await deliver(checkoutPayload('evt_checkout_lapse', CREATOR), backend);
  await deliver(invoicePayload('evt_invoice_lapse'), backend);
  const before = { ...backend.state.creators.get(CREATOR) };
  const patchesBefore = streamerPatches(backend.state).length;

  const failed = await deliver(paymentFailedPayload('evt_fail_1'), backend);
  assert.equal(failed.response.statusCode, 200);
  assert.equal(failed.body.lapsed, false);
  assert.equal(backend.state.subs.get('sub_123').status, 'past_due');
  assert.deepEqual(
    { is_verified: backend.state.creators.get(CREATOR).is_verified, verified_until: backend.state.creators.get(CREATOR).verified_until },
    { is_verified: before.is_verified, verified_until: before.verified_until }
  );
  assert.equal(streamerPatches(backend.state).length, patchesBefore);

  const deleted = await deliver(deletedPayload('evt_del_1'), backend);
  assert.equal(deleted.response.statusCode, 200);
  assert.equal(deleted.body.canceled, 'sub_123');
  assert.equal(backend.state.subs.get('sub_123').status, 'canceled');
  assert.equal(backend.state.creators.get(CREATOR).is_verified, true);
  assert.equal(backend.state.creators.get(CREATOR).verified_until, before.verified_until);
  assert.equal(streamerPatches(backend.state).length, patchesBefore);

  const unknownPayload = paymentFailedPayload('evt_fail_unknown');
  unknownPayload.data.object.subscription = 'sub_missing';
  const unknownFail = await deliver(unknownPayload, backend);
  assert.equal(unknownFail.response.statusCode, 200);
  assert.equal(unknownFail.body.skipped, 'unknown_subscription');
  assert.equal(backend.state.creators.get(CREATOR).verified_until, before.verified_until);
});

test('Netlify base64 bodies still verify, and the migration keeps the tables service-role only', async () => {
  const backend = memoryBackend([[CREATOR, creator()]]);
  const signed = signedEvent(checkoutPayload('evt_checkout_b64', CREATOR), Math.floor(Date.now() / 1000));
  const response = await withWebhookEnv({ fetch: backend.fetchImpl }, () => post(
    Buffer.from(signed.rawBody, 'utf8').toString('base64'),
    signed.header,
    { isBase64Encoded: true, headers: { 'stripe-signature': signed.header } }
  ));
  assert.equal(response.statusCode, 200);
  assert.equal(backend.state.subs.get('sub_123').creator_id, CREATOR);

  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261020160000_verified_stripe_webhook.sql'), 'utf8');
  assert.match(sql, /alter table public\.frfc_stripe_events enable row level security/);
  assert.match(sql, /alter table public\.frfc_verified_subscriptions enable row level security/);
  assert.match(sql, /revoke all on table public\.frfc_stripe_events from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.frfc_verified_subscriptions from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.frfc_stripe_events to service_role/);
  assert.match(sql, /grant select, insert, update, delete on table public\.frfc_verified_subscriptions to service_role/);
  assert.doesNotMatch(sql, /create policy/i);

  const src = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/stripe-webhook.js'), 'utf8');
  assert.equal(src.includes("require('stripe')"), false);
  assert.equal(src.includes('sk_live'), false);
  assert.equal(src.includes('sk_test'), false);
  assert.match(src, /STRIPE_WEBHOOK_SECRET/);
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(src, /require\('\.\./);
});
