// Stripe Customer Portal session for the signed-in user.
// GET  /.netlify/functions/billing-portal
//   → { available: true } when this user has a Stripe customer and
//     STRIPE_SECRET_KEY is set. Otherwise { available: false }.
// POST /.netlify/functions/billing-portal
//   Authorization: Bearer <supabase access token>
//   → { url } for a Billing Portal session, or 404 when there is no customer.
//
// The customer id is the one stored on frfc_verified_subscriptions for a
// creator this user has claimed. The browser never sees that id.
//
// Env:
//   STRIPE_SECRET_KEY          — required to open a session. Stripe secret
//                                key (or a restricted key that can create
//                                Billing Portal sessions). The Customer
//                                Portal must also be enabled in the Stripe
//                                dashboard (Settings → Billing → Customer portal).
//   SUPABASE_SERVICE_ROLE_KEY  — required.
//   SUPABASE_URL               — optional. Defaults to the production project.
//   URL                        — optional. Return URL origin. Defaults to
//                                https://fanreactionsfc.com

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const DEFAULT_SITE = 'https://fanreactionsfc.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_ID_RE = /^cus_[A-Za-z0-9]+$/;

function res(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function identifyUser(supabaseUrl, sbKey, token) {
  const callerRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${token}` },
  });
  if (!callerRes.ok) return '';
  const caller = await readJson(callerRes);
  const id = caller && caller.id;
  return typeof id === 'string' && UUID_RE.test(id) ? id : '';
}

async function stripeCustomerId(supabaseUrl, sbKey, userId) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Accept: 'application/json' };
  const [claimedRes, claimsRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/frfc_streamers?select=id&claimed_by=eq.${encodeURIComponent(userId)}`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/frfc_creator_claims?select=creator_id&user_id=eq.${encodeURIComponent(userId)}`, { headers }),
  ]);
  const ids = [];
  function add(id) {
    if (typeof id === 'string' && UUID_RE.test(id) && ids.indexOf(id) < 0) ids.push(id);
  }
  if (claimedRes.ok) {
    const rows = await readJson(claimedRes);
    (Array.isArray(rows) ? rows : []).forEach(row => add(row && row.id));
  }
  if (claimsRes.ok) {
    const rows = await readJson(claimsRes);
    (Array.isArray(rows) ? rows : []).forEach(row => add(row && row.creator_id));
  }
  if (!ids.length) return '';
  const filter = ids.map(id => encodeURIComponent(id)).join(',');
  const subsRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_verified_subscriptions?select=stripe_customer_id,updated_at&creator_id=in.(${filter})&order=updated_at.desc&limit=5`,
    { headers }
  );
  if (!subsRes.ok) return '';
  const subs = await readJson(subsRes);
  const rows = Array.isArray(subs) ? subs : [];
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i] && rows[i].stripe_customer_id;
    if (typeof id === 'string' && CUSTOMER_ID_RE.test(id)) return id;
  }
  return '';
}

async function createPortalSession(secret, customerId, returnUrl) {
  const body = new URLSearchParams();
  body.set('customer', customerId);
  body.set('return_url', returnUrl);
  const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await readJson(response);
  if (!response.ok || !data || typeof data.url !== 'string' || !data.url) return '';
  return data.url;
}

exports.handler = async (event) => {
  const method = event && event.httpMethod;
  if (method !== 'GET' && method !== 'POST') return res(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res(500, { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res(401, { error: 'Missing auth token' });

  const userId = await identifyUser(supabaseUrl, sbKey, token);
  if (!userId) return res(401, { error: 'Invalid or expired token' });

  const customerId = await stripeCustomerId(supabaseUrl, sbKey, userId);
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (method === 'GET') {
    return res(200, { available: !!(customerId && secret) });
  }
  if (!customerId) return res(404, { error: 'No Stripe customer' });
  if (!secret) return res(503, { error: 'STRIPE_SECRET_KEY is not configured' });

  const origin = (process.env.URL || DEFAULT_SITE).replace(/\/$/, '');
  const url = await createPortalSession(secret, customerId, origin + '/account');
  if (!url) return res(502, { error: 'Could not open the subscription portal' });
  return res(200, { url });
};
