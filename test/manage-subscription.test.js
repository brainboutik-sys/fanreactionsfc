const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('manage subscription is a static portal login link and is hidden while the URL is empty', () => {
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(app, /const STRIPE_PORTAL_LOGIN_URL = '';/);
  assert.match(app, /\$\{STRIPE_PORTAL_LOGIN_URL \? `/);
  assert.doesNotMatch(app, /billing-portal/);
  assert.doesNotMatch(app, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(app, /openBillingPortal/);
  assert.equal(fs.existsSync(path.join(__dirname, '../netlify/functions/billing-portal.js')), false);
});
