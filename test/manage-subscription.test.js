const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { escHtml } = require('../js/lib/html.js');

const PORTAL_LOGIN_URL = 'https://billing.stripe.com/p/login/aFabJ03Rd2xw0KW4v0ffy00';

const TERMS_CANCEL_LINE = 'You can cancel at any time from Manage subscription on your account settings page, which opens the Stripe customer portal. If you need help, email <a href="mailto:admin@fanreactionsfc.com">admin@fanreactionsfc.com</a>.';

function manageSubscriptionMarkup(appSource, url) {
  const match = appSource.match(/\$\{STRIPE_PORTAL_LOGIN_URL \? (`[\s\S]*?`) : ''\}/);
  assert.ok(match, 'Manage subscription markup conditional');
  const STRIPE_PORTAL_LOGIN_URL = url;
  return eval(match[1]);
}

test('manage subscription link uses the Stripe customer portal login URL and stays hidden when empty', () => {
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(
    app,
    new RegExp(`const STRIPE_PORTAL_LOGIN_URL = '${PORTAL_LOGIN_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`)
  );

  const shown = manageSubscriptionMarkup(app, PORTAL_LOGIN_URL);
  assert.match(shown, new RegExp(`href="${PORTAL_LOGIN_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(shown, /id="manageSubscriptionLink"/);
  assert.match(shown, />Manage subscription<\/a>/);

  assert.equal(manageSubscriptionMarkup(app, ''), '');

  assert.doesNotMatch(app, /billing-portal/);
  assert.doesNotMatch(app, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(app, /openBillingPortal/);
  assert.equal(fs.existsSync(path.join(__dirname, '../netlify/functions/billing-portal.js')), false);
});

test('terms tell creators to cancel from Manage subscription, with email as a fallback', () => {
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.ok(app.includes(TERMS_CANCEL_LINE));
  assert.ok(app.includes('Cancelling stops future renewals, and Verified status stays on until the end of the period you have already paid for. Payments are not refunded, except where the law requires otherwise.'));
  assert.doesNotMatch(app, /You can cancel at any time by emailing/);
});
