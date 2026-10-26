const { test } = require('node:test');
const assert = require('node:assert/strict');

const portal = require('../netlify/functions/billing-portal.js');

const USER = '11111111-1111-4111-8111-111111111111';
const CREATOR = '22222222-2222-4222-8222-222222222222';
const SERVICE = 'service-role-test-key';

function json(status, data) {
  const text = data == null ? '' : JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (text ? JSON.parse(text) : null),
    text: async () => text,
  };
}

async function withEnv(env, fn) {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'URL'];
  const prev = {};
  for (const key of keys) prev[key] = process.env[key];
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  if (env.STRIPE_SECRET_KEY == null) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  process.env.URL = 'https://fanreactionsfc.com';
  global.fetch = env.fetch;
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

function handlerEvent(method) {
  return {
    httpMethod: method,
    headers: { authorization: 'Bearer user-token' },
  };
}

function routeFetch(routes) {
  return async (url, options = {}) => {
    const href = String(url);
    const hit = routes.find((route) => href.includes(route.match));
    if (!hit) return json(500, { message: 'unexpected ' + href });
    if (hit.onCall) hit.onCall(href, options);
    return json(hit.status || 200, hit.body);
  };
}

test('manage subscription stays hidden without a Stripe customer or secret key', async () => {
  const noCustomer = routeFetch([
    { match: '/auth/v1/user', body: { id: USER } },
    { match: 'frfc_streamers', body: [] },
    { match: 'frfc_creator_claims', body: [] },
  ]);
  const hidden = await withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', fetch: noCustomer }, () => (
    portal.handler(handlerEvent('GET'))
  ));
  assert.equal(hidden.statusCode, 200);
  assert.deepEqual(JSON.parse(hidden.body), { available: false });

  const hasCustomer = routeFetch([
    { match: '/auth/v1/user', body: { id: USER } },
    { match: 'frfc_streamers', body: [{ id: CREATOR }] },
    { match: 'frfc_creator_claims', body: [] },
    { match: 'frfc_verified_subscriptions', body: [{ stripe_customer_id: 'cus_123', updated_at: '2026-10-01T00:00:00Z' }] },
  ]);
  const noKey = await withEnv({ STRIPE_SECRET_KEY: null, fetch: hasCustomer }, () => (
    portal.handler(handlerEvent('GET'))
  ));
  assert.equal(noKey.statusCode, 200);
  assert.deepEqual(JSON.parse(noKey.body), { available: false });
  const post = await withEnv({ STRIPE_SECRET_KEY: null, fetch: hasCustomer }, () => (
    portal.handler(handlerEvent('POST'))
  ));
  assert.equal(post.statusCode, 503);
});

test('a portal session is created server-side and the customer id is not returned', async () => {
  let stripeBody = '';
  const fetchImpl = routeFetch([
    { match: '/auth/v1/user', body: { id: USER } },
    { match: 'frfc_streamers', body: [{ id: CREATOR }] },
    { match: 'frfc_creator_claims', body: [] },
    { match: 'frfc_verified_subscriptions', body: [{ stripe_customer_id: 'cus_123', updated_at: '2026-10-01T00:00:00Z' }] },
    {
      match: 'api.stripe.com/v1/billing_portal/sessions',
      body: { url: 'https://billing.stripe.com/p/session_test' },
      onCall: (_href, options) => { stripeBody = options.body; },
    },
  ]);
  const res = await withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', fetch: fetchImpl }, () => (
    portal.handler(handlerEvent('POST'))
  ));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.url, 'https://billing.stripe.com/p/session_test');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'customer'), false);
  assert.match(stripeBody, /customer=cus_123/);
  assert.match(stripeBody, /return_url=https%3A%2F%2Ffanreactionsfc\.com%2Faccount/);
});
