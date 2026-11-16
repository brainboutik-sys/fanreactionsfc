// Page a PostgREST/Supabase read until the table window is exhausted.
//
// Supabase caps each response at db-max-rows (1000 on this project). A
// single unpaged GET silently returns the first 1000 rows ordered as
// requested — that is what made the 24 Aug 2026 weekly ranking see one
// snapshot per creator and report 0 creators. Callers must pass a stable
// order (a unique tie-break such as id) or offset pages can skip rows.

const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGES = 200;

function parseContentRange(header) {
  if (!header) return null;
  const match = /(\d+)-(\d+)\/(\d+|\*)/.exec(String(header).trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

function contentRangeHeader(res) {
  if (!res.headers || typeof res.headers.get !== 'function') return null;
  return res.headers.get('content-range') || res.headers.get('Content-Range');
}

async function fetchAllRows(url, options = {}) {
  const headers = options.headers || {};
  const pageSize = options.pageSize == null ? DEFAULT_PAGE_SIZE : options.pageSize;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('pageSize must be a positive integer');
  }

  const rows = [];
  let offset = 0;
  let stride = pageSize;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        ...headers,
        Range: `${offset}-${offset + stride - 1}`,
        'Range-Unit': 'items',
      },
    });

    // Offset is past the end. The rows already collected are complete.
    if (res.status === 416) return rows;
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (e) { detail = ''; }
      const error = new Error(`Supabase read failed (${res.status})`);
      error.status = res.status;
      error.detail = String(detail).slice(0, 300);
      throw error;
    }

    const page = await res.json();
    if (!Array.isArray(page)) throw new Error('Supabase read failed: expected a JSON array');
    if (page.length === 0) return rows;

    const range = parseContentRange(contentRangeHeader(res));
    if (range && range.start !== offset) {
      throw new Error('Supabase page did not start at the requested offset');
    }

    rows.push(...page);
    if (range && range.total != null && range.end + 1 >= range.total) return rows;

    // A short page is the last page, unless the server clamped the response
    // below the requested window (db-max-rows lower than pageSize). Content-Range
    // is what distinguishes that clamp from a genuine final page.
    if (page.length < stride) {
      const clamped = range
        && (range.total == null || range.end + 1 < range.total)
        && (range.end - range.start + 1) === page.length;
      if (!clamped) return rows;
      stride = page.length;
    }

    offset += page.length;
  }

  throw new Error(`Supabase read exceeded ${MAX_PAGES} pages`);
}

module.exports = {
  fetchAllRows,
  parseContentRange,
  DEFAULT_PAGE_SIZE,
  MAX_PAGES,
};
