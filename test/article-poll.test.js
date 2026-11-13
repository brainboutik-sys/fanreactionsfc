const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lib = require('../js/lib/article-poll.js');

const ARTICLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const CREATORS = [
  { slug: 'aftv', name: 'AFTV' },
  { slug: 'toffee', name: 'Toffee TV' },
  { slug: 'the-red-men', name: 'The Red Men' },
];

function memory(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    dump: data,
  };
}

function bodyWith(slugs) {
  return slugs.map(slug => 'Watch [' + slug + '](/creators/' + slug + ').').join('\n\n');
}

test('the poll ships behind one boolean switch', () => {
  assert.equal(typeof lib.ARTICLE_POLL_ENABLED, 'boolean');
  assert.equal(lib.ARTICLE_POLL_ENABLED, true);
  const html = lib.articlePollSectionHtml({
    enabled: false,
    articleId: ARTICLE,
    body: bodyWith(['aftv', 'toffee']),
    creators: CREATORS,
  });
  assert.equal(html, '');
});

test('options come from /creators/<slug> links, first appearance, deduped', () => {
  const body = [
    'Start with [The Red Men](https://fanreactionsfc.com/creators/The-Red-Men).',
    'Again /creators/the-red-men and then [AFTV](/creators/aftv).',
    'A stats path still counts: https://fanreactionsfc.com/creators/toffee/stats?ref=1',
    'Not a creator link: /creator/aftv or https://evil.example/creators-aftv',
    'A trailing hyphen is not a slug: /creators/aftv-',
  ].join('\n\n');
  assert.deepEqual(lib.articlePollCreatorsFromBody(body), ['the-red-men', 'aftv', 'toffee']);
  assert.deepEqual(lib.articlePollOptions(body, CREATORS), [
    { slug: 'the-red-men', name: 'The Red Men' },
    { slug: 'aftv', name: 'AFTV' },
    { slug: 'toffee', name: 'Toffee TV' },
  ]);
});

test('a creator with no directory name is left out, and one option hides the poll', () => {
  const body = bodyWith(['aftv', 'not-in-the-directory', 'aftv']);
  assert.deepEqual(lib.articlePollCreatorsFromBody(body), ['aftv', 'not-in-the-directory']);
  assert.deepEqual(lib.articlePollOptions(body, CREATORS), [{ slug: 'aftv', name: 'AFTV' }]);
  assert.equal(lib.articlePollSectionHtml({
    articleId: ARTICLE,
    body: body,
    creators: CREATORS,
  }), '');
  assert.equal(lib.articlePollSectionHtml({
    articleId: ARTICLE,
    body: bodyWith(['aftv', 'toffee']),
    creators: [],
  }), '');
  assert.equal(lib.articlePollSectionHtml({
    articleId: 'not-a-uuid',
    body: bodyWith(['aftv', 'toffee']),
    creators: CREATORS,
  }), '');
});

test('the open poll uses buttons, creator links, and the poll click type', () => {
  const html = lib.articlePollSectionHtml({
    articleId: ARTICLE,
    body: 'See [AFTV <script>](/creators/aftv) and [Toffee](/creators/toffee).',
    creators: [
      { slug: 'aftv', name: 'AFTV <script>' },
      { slug: 'toffee', name: 'Toffee TV' },
    ],
    club: 'Arsenal',
  });
  assert.match(html, /data-article-poll-state="open"/);
  assert.match(html, /Who reacted best\?/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="Vote for AFTV &lt;script&gt;"/);
  assert.match(html, /href="\/creators\/aftv"/);
  assert.match(html, /data-frfc-link="poll" data-frfc-creator="aftv" data-frfc-club="Arsenal"/);
  assert.match(html, /data-frfc-link="poll" data-frfc-creator="toffee" data-frfc-club="Arsenal"/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /worst|winner|loser|ranking|sponsored|\bpaid\b/i);
  const order = [...html.matchAll(/data-frfc-creator="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['aftv', 'toffee']);
});

test('a stored vote renders the results shell instead of another ballot', () => {
  const storage = memory();
  assert.equal(lib.articlePollRememberVote(ARTICLE, 'toffee', storage), true);
  const html = lib.articlePollSectionHtml({
    articleId: ARTICLE.toUpperCase(),
    body: bodyWith(['aftv', 'toffee']),
    creators: CREATORS,
    storage: storage,
  });
  assert.match(html, /data-article-poll-state="results"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /data-article-poll-vote=/);
  assert.match(html, /Share of votes on this article\./);
});

test('the localStorage guard keeps one vote per article', () => {
  const storage = memory();
  assert.equal(lib.articlePollStoredVote(ARTICLE, storage), '');
  assert.equal(lib.articlePollRememberVote(ARTICLE, 'AFTV', storage), true);
  assert.equal(lib.articlePollStoredVote(ARTICLE, storage), 'aftv');
  assert.equal(lib.articlePollRememberVote(ARTICLE, 'toffee', storage), false);
  assert.equal(lib.articlePollStoredVote(ARTICLE, storage), 'aftv');
  assert.equal(lib.articlePollRememberVote(OTHER, 'toffee', storage), true);
  assert.equal(lib.articlePollStoredVote(OTHER, storage), 'toffee');
  assert.equal(lib.articlePollStoredVote(ARTICLE, storage), 'aftv');

  const broken = memory({ [lib.ARTICLE_POLL_VOTES_KEY]: '{not json' });
  assert.equal(lib.articlePollStoredVote(ARTICLE, broken), '');
  assert.equal(lib.articlePollRememberVote(ARTICLE, 'aftv', broken), true);
  assert.equal(lib.articlePollStoredVote(ARTICLE, broken), 'aftv');

  const list = memory({ [lib.ARTICLE_POLL_VOTES_KEY]: '[]' });
  assert.equal(lib.articlePollStoredVote(ARTICLE, list), '');
  assert.equal(lib.articlePollRememberVote('', 'aftv', storage), false);
  assert.equal(lib.articlePollRememberVote(ARTICLE, '', storage), false);
});

test('the browser id is created once and reused', () => {
  const storage = memory();
  assert.equal(lib.articlePollClientId(storage, () => CLIENT), CLIENT);
  assert.equal(storage.dump[lib.ARTICLE_POLL_CLIENT_KEY], CLIENT);
  assert.equal(lib.articlePollClientId(storage, () => OTHER), CLIENT);

  const junk = memory({ [lib.ARTICLE_POLL_CLIENT_KEY]: 'not-a-uuid' });
  assert.equal(lib.articlePollClientId(junk, () => CLIENT), CLIENT);
  assert.equal(lib.articlePollClientId(memory(), () => 'nope'), '');
});

test('percentages are integers, keep option order, and sum to 100', () => {
  const even = lib.articlePollPercents([
    { slug: 'a', votes: 1 },
    { slug: 'b', votes: 1 },
    { slug: 'c', votes: 1 },
  ]);
  assert.equal(even.total, 3);
  assert.deepEqual(even.rows.map(row => row.percent), [34, 33, 33]);
  assert.deepEqual(even.rows.map(row => row.slug), ['a', 'b', 'c']);
  assert.equal(even.rows.reduce((sum, row) => sum + row.percent, 0), 100);

  const split = lib.articlePollPercents([
    { creator_slug: 'aftv', votes: 2 },
    { creator_slug: 'toffee', votes: 1 },
  ]);
  assert.deepEqual(split.rows.map(row => row.percent), [67, 33]);
  assert.equal(split.rows.reduce((sum, row) => sum + row.percent, 0), 100);

  const all = lib.articlePollPercents([{ slug: 'aftv', votes: 5 }, { slug: 'toffee', votes: 0 }]);
  assert.deepEqual(all.rows.map(row => row.percent), [100, 0]);

  const none = lib.articlePollPercents([{ slug: 'aftv', votes: 0 }, { slug: 'toffee', votes: 'nope' }]);
  assert.equal(none.total, 0);
  assert.deepEqual(none.rows.map(row => row.percent), [0, 0]);

  const five = lib.articlePollPercents([1, 1, 1, 1, 1].map((votes, i) => ({ slug: 'c' + i, votes })));
  assert.deepEqual(five.rows.map(row => row.percent), [20, 20, 20, 20, 20]);
});

test('result copy is the vote share, with a tracked link per creator', () => {
  const options = [
    { slug: 'aftv', name: 'AFTV' },
    { slug: 'toffee', name: 'Toffee TV' },
  ];
  const counts = [{ creator_slug: 'toffee', votes: 1 }, { creator_slug: 'aftv', votes: 2 }];
  const math = lib.articlePollResultModel(options, counts);
  const html = lib.articlePollResultsBodyHtml(options, counts, 'Arsenal', 'aftv');
  const said = lib.articlePollAnnounce(options, math, true);
  assert.match(html, /3 votes/);
  assert.match(html, />67%</);
  assert.match(html, />33%</);
  assert.match(html, /Your vote/);
  assert.match(html, /data-frfc-link="poll" data-frfc-creator="aftv"/);
  assert.match(html, /href="\/creators\/toffee"/);
  assert.equal(said, 'Your vote is counted. 3 votes. AFTV 67%, Toffee TV 33%.');
  assert.doesNotMatch(html + said, /worst|winner|loser|ranking|sponsored|\bpaid\b/i);
  Object.keys(lib.ARTICLE_POLL_COPY).forEach(key => {
    if (key === 'title') return;
    assert.equal(String(lib.ARTICLE_POLL_COPY[key]).toLowerCase().includes('best'), false, key);
  });
});

function pollNode(id, attrs, children) {
  const node = {
    id: id || '',
    attrs: Object.assign({}, attrs || {}),
    children: children || [],
    parent: null,
    disabled: false,
    isConnected: true,
    _text: '',
    _html: '',
    _listeners: {},
    get textContent() { return this._text; },
    set textContent(value) { this._text = String(value); },
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); },
    querySelector(sel) { return walk(this, sel)[0] || null; },
    querySelectorAll(sel) { return walk(this, sel); },
    closest(sel) {
      let current = this;
      while (current) {
        if (nodeMatches(current, sel)) return current;
        current = current.parent;
      }
      return null;
    },
  };
  node.children.forEach(child => { child.parent = node; });
  return node;
}

function nodeMatches(node, sel) {
  if (sel.charAt(0) === '#') return node.id === sel.slice(1);
  if (sel.charAt(0) === '[') {
    const name = sel.slice(1, -1);
    return Object.prototype.hasOwnProperty.call(node.attrs, name);
  }
  return false;
}

function walk(node, sel) {
  const found = [];
  (node.children || []).forEach(child => {
    if (nodeMatches(child, sel)) found.push(child);
    walk(child, sel).forEach(item => found.push(item));
  });
  return found;
}

test('one tap stores a single vote and then shows the share', async () => {
  const storage = memory();
  const options = [
    { slug: 'aftv', name: 'AFTV' },
    { slug: 'the-red-men', name: 'The Red Men' },
  ];
  const html = lib.articlePollSectionHtml({
    articleId: ARTICLE,
    body: bodyWith(['aftv', 'the-red-men']),
    creators: options,
    club: 'Liverpool',
    storage: storage,
  });
  assert.match(html, /id="articlePollBody"/);
  const status = pollNode('articlePollStatus');
  const lead = pollNode('articlePollLead');
  const aftv = pollNode('', { 'data-article-poll-vote': 'aftv' });
  const red = pollNode('', { 'data-article-poll-vote': 'the-red-men' });
  const body = pollNode('articlePollBody', {}, [aftv, red]);
  const root = pollNode('', { 'data-article-poll-state': 'open' }, [lead, body, status]);
  const inserted = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  lib.articlePollMount({
    root: root,
    articleId: ARTICLE,
    options: options,
    club: 'Liverpool',
    storage: storage,
    insertVote: async (slug, clientId) => {
      inserted.push({ slug, clientId });
      await gate;
      return { ok: true };
    },
    loadCounts: async () => ({
      ok: true,
      counts: [{ creator_slug: 'aftv', votes: 1 }, { creator_slug: 'the-red-men', votes: 1 }],
    }),
  });
  const click = root._listeners.click[0];
  const first = click({ target: red });
  const second = click({ target: aftv });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].slug, 'the-red-men');
  assert.match(inserted[0].clientId, /^[0-9a-f-]{36}$/);
  assert.equal(red.disabled, true);
  assert.equal(aftv.disabled, true);
  assert.equal(status.textContent, 'Saving your vote.');
  release();
  await first;
  await second;
  assert.equal(inserted.length, 1);
  assert.equal(lib.articlePollStoredVote(ARTICLE, storage), 'the-red-men');
  assert.match(body.innerHTML, /50%/);
  assert.match(body.innerHTML, /data-frfc-link="poll" data-frfc-creator="the-red-men" data-frfc-club="Liverpool"/);
  assert.match(body.innerHTML, /Your vote/);
  assert.equal(status.textContent, 'Your vote is counted. 2 votes. AFTV 50%, The Red Men 50%.');
  assert.equal(root.getAttribute('data-article-poll-state'), 'results');
  assert.doesNotMatch(status.textContent, /worst|winner|loser|ranking|sponsored|\bpaid\b/i);
});

test('a browser that already voted loads the share and does not insert', async () => {
  const storage = memory();
  assert.equal(lib.articlePollRememberVote(ARTICLE, 'aftv', storage), true);
  const options = [
    { slug: 'aftv', name: 'AFTV' },
    { slug: 'toffee', name: 'Toffee TV' },
  ];
  const status = pollNode('articlePollStatus');
  const lead = pollNode('articlePollLead');
  const body = pollNode('articlePollBody');
  const root = pollNode('', { 'data-article-poll-state': 'results' }, [lead, body, status]);
  let inserts = 0;
  lib.articlePollMount({
    root: root,
    articleId: ARTICLE,
    options: options,
    club: 'Everton',
    storage: storage,
    insertVote: async () => { inserts += 1; return { ok: true }; },
    loadCounts: async () => ({ ok: true, counts: [{ creator_slug: 'aftv', votes: 3 }, { creator_slug: 'toffee', votes: 1 }] }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inserts, 0);
  assert.match(body.innerHTML, />75%</);
  assert.match(body.innerHTML, />25%</);
  assert.match(body.innerHTML, /Your vote/);
  assert.equal(status.textContent, '4 votes. AFTV 75%, Toffee TV 25%.');
  assert.equal(lead.textContent, 'Share of votes on this article.');
});

test('the article page, flag, and click logger are wired for the poll', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8');
  const click = fs.readFileSync(path.join(root, 'netlify/functions/link-click.js'), 'utf8');
  const pollAt = html.indexOf('/js/lib/article-poll.js');
  const appAt = html.indexOf('/js/app.js');
  assert.ok(pollAt > -1 && appAt > pollAt);
  assert.match(app, /js\/lib\/article-poll\.js → articlePollSectionHtml\(\); ARTICLE_POLL_ENABLED/);
  assert.match(app, /function articlePollMarkup\(article\)/);
  assert.match(app, /if \(typeof ARTICLE_POLL_ENABLED !== 'undefined' && !ARTICLE_POLL_ENABLED\) return ''/);
  assert.match(app, /function mountArticlePoll\(article\)/);
  assert.match(app, /mountArticlePoll\(article\)/);
  assert.match(app, /frfc_article_poll_counts/);
  assert.match(app, /frfc_article_poll_votes/);
  const bodyAt = app.indexOf('class="news-article-body"');
  const markupAt = app.indexOf('${articlePollMarkup(article)}');
  const relatedAt = app.indexOf('creatorLinksHTML(article.creator_links)');
  assert.ok(bodyAt > -1 && bodyAt < markupAt && markupAt < relatedAt);
  assert.match(css, /\.article-poll\{/);
  assert.match(css, /\.article-poll-vote\{[^}]*min-height:44px/);
  assert.match(click, /data\.link === 'live' \|\| data\.link === 'channel' \|\| data\.link === 'poll'/);
  const send = app.match(/function sendCreatorLinkClick\(slug, link, club\) \{[\s\S]*?\n\}/);
  assert.ok(send);
  assert.match(send[0], /link !== 'live' && link !== 'channel' && link !== 'poll'/);
  assert.doesNotMatch(send[0], /localStorage|sessionStorage|userAgent|currentUser|cookie|fingerprint/i);
});

test('the migration allows anon insert, hides raw rows, and widens link_type', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261113100000_frfc_article_poll_votes.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.frfc_article_poll_votes/);
  assert.match(sql, /article_id uuid not null references public\.frfc_articles \(id\) on delete cascade/);
  assert.match(sql, /creator_slug text not null/);
  assert.match(sql, /client_id text not null/);
  assert.match(sql, /created_at timestamptz not null default now\(\)/);
  assert.match(sql, /unique \(article_id, client_id\)/);
  assert.match(sql, /char_length\(creator_slug\) between 1 and 80/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.frfc_article_poll_votes from public, anon, authenticated/);
  assert.match(sql, /grant insert on table public\.frfc_article_poll_votes to anon, authenticated/);
  assert.match(sql, /grant usage, select on sequence public\.frfc_article_poll_votes_id_seq to anon, authenticated/);
  assert.doesNotMatch(sql, /grant select on table public\.frfc_article_poll_votes to anon/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /function public\.frfc_article_poll_counts\(p_article_id uuid\)/);
  assert.match(sql, /grant execute on function public\.frfc_article_poll_counts\(uuid\) to anon, authenticated, service_role/);
  assert.match(sql, /drop policy if exists frfc_article_poll_votes_insert/);
  assert.match(sql, /for insert/);
  assert.match(sql, /to anon, authenticated/);
  assert.match(sql, /frfc_article_poll_vote_ok\(article_id, creator_slug, client_id\)/);
  assert.match(sql, /link_type in \('live', 'channel', 'poll'\)/);
  assert.match(sql, /Not applied by the app or by CI/);
  const table = sql.slice(sql.indexOf('create table'), sql.indexOf(');'));
  assert.doesNotMatch(table, /ip_address|user_agent|user_id|cookie/i);
});
