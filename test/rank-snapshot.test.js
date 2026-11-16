const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const snapshot = require('../netlify/functions/rank-snapshot-background.js');

const ROOT = path.join(__dirname, '..');

function jsonResponse(body, ok = true, status = ok ? 200 : 500) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
  };
}

function withFetch(impl, fn) {
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const entry = {
      url: String(url),
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(entry);
    return impl(entry, calls);
  };
  return fn(calls).finally(() => {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  });
}

describe('rank snapshot', { concurrency: false }, () => {
  test('averages ratings to two decimal places and ignores non-numeric rows', () => {
    const averages = snapshot.aggregateRatings([
      { creator_id: 'a', rating: 5 },
      { creator_id: 'a', rating: 4 },
      { creator_id: 'a', rating: null },
      { creator_id: 'b', rating: 1 },
      { creator_id: 'b', rating: 2 },
      { creator_id: null, rating: 5 },
    ]);
    assert.equal(averages.get('a'), 4.5);
    assert.equal(averages.get('b'), 1.5);
    assert.equal(averages.has(null), false);
  });

  test('the Monday 03:00 UTC schedule is registered in netlify.toml', () => {
    assert.equal(snapshot.SCHEDULE, '0 3 * * 1');
    assert.equal(snapshot.config.schedule, snapshot.SCHEDULE);
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    const section = toml.split('[functions."rank-snapshot-background"]')[1];
    assert.ok(section, 'rank-snapshot-background schedule block missing from netlify.toml');
    const body = section.split(/\n\[/)[0];
    assert.match(body, /schedule = "0 3 \* \* 1"/);
  });

  test('the job does not call the YouTube Data API', () => {
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/rank-snapshot-background.js'), 'utf8');
    assert.equal(src.includes('googleapis.com'), false);
    assert.equal(src.includes('youtube/v3'), false);
  });

  test('refuses to run without the service role key', async () => {
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevFetch = global.fetch;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let called = false;
    global.fetch = async () => { called = true; return jsonResponse([]); };
    try {
      const res = await snapshot.handler();
      assert.equal(res.statusCode, 500);
      assert.equal(called, false);
      assert.match(JSON.parse(res.body).error, /SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      global.fetch = prevFetch;
      if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });

  test('pages past 1000 rows, snapshots every creator, and logs a successful run', async () => {
    const reviews = Array.from({ length: 1001 }, (_, i) => ({
      id: `r${i}`,
      creator_id: 'c0',
      rating: i % 2 === 0 ? 4 : 5,
    }));
    const creators = Array.from({ length: 1001 }, (_, i) => ({
      id: `c${i}`,
      subscriber_count: 1000 + i,
    }));

    await withFetch((entry) => {
      const url = new URL(entry.url);
      if (entry.method === 'POST' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([{ id: 'job-1' }]);
      }
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([], true, 204);
      }
      if (entry.method === 'GET' && url.pathname.endsWith('/frfc_reviews')) {
        const offset = Number(url.searchParams.get('offset'));
        return jsonResponse(reviews.slice(offset, offset + snapshot.PAGE_SIZE));
      }
      if (entry.method === 'GET' && url.pathname.endsWith('/frfc_streamers')) {
        const offset = Number(url.searchParams.get('offset'));
        return jsonResponse(creators.slice(offset, offset + snapshot.PAGE_SIZE));
      }
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_streamers')) {
        return jsonResponse([], true, 204);
      }
      return jsonResponse({ error: 'unexpected ' + entry.url }, false, 500);
    }, async (calls) => {
      const res = await snapshot.handler();
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, 1001);
      assert.equal(body.fail, 0);
      assert.equal(body.total, 1001);
      assert.equal(body.status, 'success');

      const reviewGets = calls.filter((c) => c.method === 'GET' && c.url.includes('/frfc_reviews'));
      const creatorGets = calls.filter((c) => c.method === 'GET' && c.url.includes('/frfc_streamers'));
      // A short page ends the scan, so 1001 rows is two requests, not a third empty one.
      assert.deepEqual(reviewGets.map((c) => new URL(c.url).searchParams.get('offset')), ['0', '1000']);
      assert.deepEqual(creatorGets.map((c) => new URL(c.url).searchParams.get('offset')), ['0', '1000']);
      for (const get of [...reviewGets, ...creatorGets]) {
        assert.equal(new URL(get.url).searchParams.get('limit'), '1000');
        assert.equal(new URL(get.url).searchParams.get('order'), 'id.asc');
      }

      const patches = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/frfc_streamers?'));
      assert.equal(patches.length, 1001);
      const ids = patches.map((p) => decodeURIComponent(p.url.split('id=eq.')[1]));
      assert.equal(ids[0], 'c0');
      assert.equal(ids[1000], 'c1000');
      assert.equal(patches[0].body.subscriber_count_prev, 1000);
      assert.equal(patches[0].body.avg_rating_prev, 4.5);
      assert.equal(patches[1000].body.subscriber_count_prev, 2000);
      assert.equal(patches[1000].body.avg_rating_prev, null);
      const stamped = new Set(patches.map((p) => p.body.rank_snapshot_at));
      assert.equal(stamped.size, 1);
      assert.equal(body.snapshot_at, patches[0].body.rank_snapshot_at);

      const start = calls.find((c) => c.method === 'POST' && c.url.includes('/frfc_job_runs'));
      assert.deepEqual(start.body, { job_type: 'rank-snapshot', status: 'running' });
      const finish = calls.find((c) => c.method === 'PATCH' && c.url.includes('/frfc_job_runs'));
      assert.equal(finish.url.includes('id=eq.job-1'), true);
      assert.equal(finish.body.status, 'success');
      assert.equal(finish.body.items_processed, 1001);
      assert.equal(finish.body.items_failed, 0);
      assert.equal(finish.body.quota_used, 0);
      assert.equal(Object.hasOwn(finish.body, 'error_summary'), false);
      assert.equal(typeof finish.body.finished_at, 'string');
      assert.equal(calls.some((c) => c.url.includes('googleapis.com') || c.url.includes('youtube')), false);
    });
  });

  test('logs a failed run when a paged read errors, and does not write snapshots', async () => {
    await withFetch((entry) => {
      const url = new URL(entry.url);
      if (entry.method === 'POST' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([{ id: 'job-err' }]);
      }
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([], true, 204);
      }
      if (url.pathname.endsWith('/frfc_reviews')) {
        return jsonResponse({ message: 'permission denied' }, false, 401);
      }
      return jsonResponse([], true, 204);
    }, async (calls) => {
      const res = await snapshot.handler();
      assert.equal(res.statusCode, 502);
      assert.match(JSON.parse(res.body).error, /frfc_reviews read failed \(401\)/);
      assert.equal(calls.some((c) => c.method === 'PATCH' && c.url.includes('/frfc_streamers?')), false);
      const finish = calls.find((c) => c.method === 'PATCH' && c.url.includes('/frfc_job_runs'));
      assert.equal(finish.body.status, 'failed');
      assert.equal(finish.body.items_processed, 0);
      assert.equal(finish.body.items_failed, 1);
      assert.equal(finish.body.quota_used, 0);
      assert.deepEqual(finish.body.error_summary, { message: 'frfc_reviews read failed (401)' });
    });
  });

  test('a partial creator update is logged as partial with an error summary', async () => {
    const creators = [
      { id: 'ok-1', subscriber_count: 10 },
      { id: 'bad-1', subscriber_count: 20 },
    ];
    await withFetch((entry) => {
      const url = new URL(entry.url);
      if (entry.method === 'POST' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([{ id: 'job-partial' }]);
      }
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([], true, 204);
      }
      if (entry.method === 'GET' && url.pathname.endsWith('/frfc_reviews')) return jsonResponse([]);
      if (entry.method === 'GET' && url.pathname.endsWith('/frfc_streamers')) return jsonResponse(creators);
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_streamers')) {
        const id = decodeURIComponent(url.search.split('id=eq.')[1]);
        if (id === 'bad-1') return jsonResponse({ message: 'nope' }, false, 409);
        return jsonResponse([], true, 204);
      }
      return jsonResponse({ error: 'unexpected' }, false, 500);
    }, async (calls) => {
      const res = await snapshot.handler();
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, 1);
      assert.equal(body.fail, 1);
      assert.equal(body.status, 'partial');
      const finish = calls.find((c) => c.method === 'PATCH' && c.url.includes('/frfc_job_runs'));
      assert.equal(finish.body.status, 'partial');
      assert.equal(finish.body.items_processed, 1);
      assert.equal(finish.body.items_failed, 1);
      assert.equal(finish.body.quota_used, 0);
      assert.equal(finish.body.error_summary.message, '1 of 2 creator snapshots failed');
      assert.deepEqual(finish.body.error_summary.sample_statuses, [409]);
    });
  });
});
