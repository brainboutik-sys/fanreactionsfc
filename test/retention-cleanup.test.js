const { test } = require('node:test');
const assert = require('node:assert/strict');

const cleanup = require('../netlify/functions/retention-cleanup.js');

test('the daily job deletes link clicks older than 90 days', async () => {
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const deletes = [];
  global.fetch = async (url, options = {}) => {
    deletes.push({ url: String(url), method: options.method });
    return { ok: true, status: 200, json: async () => [] };
  };
  try {
    const res = await cleanup.handler();
    assert.equal(res.statusCode, 200);
    const clicks = deletes.find((row) => row.method === 'DELETE' && row.url.includes('/frfc_link_clicks?'));
    assert.ok(clicks, 'expected a delete of frfc_link_clicks');
    const cutoff = decodeURIComponent(clicks.url.split('created_at=lt.')[1]);
    const age = Date.now() - Date.parse(cutoff);
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(age - ninetyDays) < 5000, age);
    assert.equal(deletes.filter((row) => row.url.includes('/frfc_link_clicks?')).length, 1);
  } finally {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});
