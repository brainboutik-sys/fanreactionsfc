const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllRows, parseContentRange, DEFAULT_PAGE_SIZE, MAX_PAGES } = require('../netlify/functions/_shared/supabase-page.js');

function response({ status = 200, body = [], contentRange = null }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-range' ? contentRange : null;
      },
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

test('parseContentRange reads PostgREST totals and unknown totals', () => {
  assert.deepEqual(parseContentRange('0-999/2283'), { start: 0, end: 999, total: 2283 });
  assert.deepEqual(parseContentRange('1000-1999/*'), { start: 1000, end: 1999, total: null });
  assert.equal(parseContentRange('*/0'), null);
  assert.equal(parseContentRange(null), null);
});

test('pages past the 1000-row cap until Content-Range says the window is done', async () => {
  const ranges = [];
  const pages = [
    { body: Array.from({ length: 1000 }, (_, i) => ({ id: i })), range: '0-999/2283' },
    { body: Array.from({ length: 1000 }, (_, i) => ({ id: 1000 + i })), range: '1000-1999/2283' },
    { body: Array.from({ length: 283 }, (_, i) => ({ id: 2000 + i })), range: '2000-2282/2283' },
  ];
  let n = 0;
  const rows = await fetchAllRows('https://example.test/rest/v1/frfc_subscriber_history?order=recorded_at.asc,id.asc', {
    headers: { apikey: 'service', Authorization: 'Bearer service' },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://example.test/rest/v1/frfc_subscriber_history?order=recorded_at.asc,id.asc');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.apikey, 'service');
      assert.equal(options.headers.Authorization, 'Bearer service');
      assert.equal(options.headers['Range-Unit'], 'items');
      ranges.push(options.headers.Range);
      const page = pages[n++];
      return response({ status: 206, body: page.body, contentRange: page.range });
    },
  });

  assert.deepEqual(ranges, ['0-999', '1000-1999', '2000-2999']);
  assert.equal(rows.length, 2283);
  assert.equal(rows[0].id, 0);
  assert.equal(rows[2282].id, 2282);
  assert.equal(DEFAULT_PAGE_SIZE, 1000);
});

test('an exact multiple of the page size stops on the empty following page', async () => {
  const ranges = [];
  const rows = await fetchAllRows('https://example.test/rows', {
    pageSize: 2,
    fetchImpl: async (url, options) => {
      ranges.push(options.headers.Range);
      if (options.headers.Range === '0-1') {
        return response({ status: 206, body: [{ id: 1 }, { id: 2 }], contentRange: '0-1/*' });
      }
      assert.equal(options.headers.Range, '2-3');
      return response({ status: 416, body: { message: 'Requested range not satisfiable' }, contentRange: '*/2' });
    },
  });
  assert.deepEqual(ranges, ['0-1', '2-3']);
  assert.deepEqual(rows.map(r => r.id), [1, 2]);
});

test('follows a server max-rows clamp below the requested page size', async () => {
  const ranges = [];
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const rows = await fetchAllRows('https://example.test/rows', {
    pageSize: 1000,
    fetchImpl: async (url, options) => {
      const range = options.headers.Range;
      ranges.push(range);
      const [start, end] = range.split('-').map(Number);
      // Server refuses to return more than 2 rows, and only reports a total
      // on the final page. This is the clamp the 1000-row cap produces when
      // the requested window is wider than db-max-rows.
      const cappedEnd = Math.min(end, start + 1, all.length - 1);
      if (start >= all.length) return response({ status: 416, contentRange: '*/5' });
      const body = all.slice(start, cappedEnd + 1);
      const last = start + body.length - 1;
      const total = last + 1 >= all.length ? String(all.length) : '*';
      return response({ status: 206, body, contentRange: `${start}-${last}/${total}` });
    },
  });
  assert.deepEqual(ranges, ['0-999', '2-3', '4-5']);
  assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'c', 'd', 'e']);
});

test('a non-OK read throws instead of returning a short page', async () => {
  await assert.rejects(
    () => fetchAllRows('https://example.test/rows', {
      fetchImpl: async () => response({ status: 500, body: { message: 'db down' } }),
    }),
    /Supabase read failed \(500\)/
  );
});

test('a JSON object instead of a row array throws', async () => {
  await assert.rejects(
    () => fetchAllRows('https://example.test/rows', {
      fetchImpl: async () => response({ status: 200, body: { message: 'not rows' } }),
    }),
    /expected a JSON array/
  );
});

test('a page that does not start at the requested offset throws', async () => {
  await assert.rejects(
    () => fetchAllRows('https://example.test/rows', {
      pageSize: 2,
      fetchImpl: async () => response({
        status: 206,
        body: [{ id: 1 }, { id: 2 }],
        contentRange: '10-11/*',
      }),
    }),
    /did not start at the requested offset/
  );
});

test('pageSize must be a positive integer and the page cap fails closed', async () => {
  await assert.rejects(
    () => fetchAllRows('https://example.test/rows', { pageSize: 0, fetchImpl: async () => { throw new Error('should not fetch'); } }),
    /pageSize must be a positive integer/
  );

  let calls = 0;
  await assert.rejects(
    () => fetchAllRows('https://example.test/rows', {
      pageSize: 1,
      fetchImpl: async (url, options) => {
        calls += 1;
        const start = Number(options.headers.Range.split('-')[0]);
        return response({ status: 206, body: [{ id: start }], contentRange: `${start}-${start}/*` });
      },
    }),
    new RegExp(`exceeded ${MAX_PAGES} pages`)
  );
  assert.equal(calls, MAX_PAGES);
});
