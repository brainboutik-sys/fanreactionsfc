const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function extractConstAssign(src, name) {
  const needle = `const ${name} = `;
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`missing const ${name}`);
  return src.slice(start, src.indexOf(';', start) + 1);
}

function htmlEscaper(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function loadFn(file, fnName, escName) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const sandbox = { [escName]: htmlEscaper };
  vm.runInNewContext(
    `${extractConstAssign(src, 'YOUTUBE_URL_RE')}\n${extractFunction(src, fnName)}\nthis.${fnName} = ${fnName};`,
    sandbox
  );
  return sandbox[fnName];
}

const newsBodyHTML = loadFn('js/app.js', 'newsBodyHTML', 'escHtml');
const bodyHtml = loadFn('netlify/functions/news-article.js', 'bodyHtml', 'esc');

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YT_EMBED = '<div class="news-video-embed"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>';
const NAMED = '[GBFC](https://fanreactionsfc.com/creators/gbfc)';
const NAMED_A = '<a href="https://fanreactionsfc.com/creators/gbfc">GBFC</a>';

const CASES = [
  ['## Arsenal', '<h2>Arsenal</h2>'],
  [NAMED, `<p>${NAMED_A}</p>`],
  [YT, YT_EMBED],
  ['[xss](javascript:alert(1))', '<p>[xss](javascript:alert(1))</p>'],
  ['Hello world.', '<p>Hello world.</p>'],
  ['Para one.\n\nPara two.', '<p>Para one.</p><p>Para two.</p>'],
  [`## Arsenal\n\nWatch ${NAMED}.\n\n${YT}`, `<h2>Arsenal</h2><p>Watch ${NAMED_A}.</p>${YT_EMBED}`],
  ['## See [GBFC](https://fanreactionsfc.com/creators/gbfc)', `<h2>See ${NAMED_A}</h2>`],
  ['Read [GBFC](/creators/gbfc) here.', '<p>Read <a href="/creators/gbfc">GBFC</a> here.</p>'],
  ['[xss](data:text/html,hi)', '<p>[xss](data:text/html,hi)</p>'],
  ['[xss](//evil.example/path)', '<p>[xss](//evil.example/path)</p>'],
  ['The score was 1 | 0 after extra time.', '<p>The score was 1 | 0 after extra time.</p>'],
  ['| not | a table |\n| still | just text |', '<p>| not | a table |\n| still | just text |</p>'],
  [
    '| Club | Score |\n| --- | --- |\n| Chelsea | 2 |\n| Everton | 0 |',
    '<div class="news-table-wrap"><table class="news-table"><thead><tr><th scope="col">Club</th><th scope="col">Score</th></tr></thead><tbody><tr><td>Chelsea</td><td>2</td></tr><tr><td>Everton</td><td>0</td></tr></tbody></table></div>',
  ],
  [
    '| Player | Goals |\n| --- | ---: |\n| Neto | 2 |',
    '<div class="news-table-wrap"><table class="news-table"><thead><tr><th scope="col">Player</th><th scope="col" style="text-align:right">Goals</th></tr></thead><tbody><tr><td>Neto</td><td style="text-align:right">2</td></tr></tbody></table></div>',
  ],
  [
    '| A | B | C |\n| :--- | :---: | ---: |\n| left | mid | right |',
    '<div class="news-table-wrap"><table class="news-table"><thead><tr><th scope="col">A</th><th scope="col" style="text-align:center">B</th><th scope="col" style="text-align:right">C</th></tr></thead><tbody><tr><td>left</td><td style="text-align:center">mid</td><td style="text-align:right">right</td></tr></tbody></table></div>',
  ],
  [
    '| Channel |\n| --- |\n| [GBFC](https://fanreactionsfc.com/creators/gbfc) |',
    `<div class="news-table-wrap"><table class="news-table"><thead><tr><th scope="col">Channel</th></tr></thead><tbody><tr><td>${NAMED_A}</td></tr></tbody></table></div>`,
  ],
  [
    '| Note |\n| --- |\n| <script>alert(1)</script> |',
    '<div class="news-table-wrap"><table class="news-table"><thead><tr><th scope="col">Note</th></tr></thead><tbody><tr><td>&lt;script&gt;alert(1)&lt;/script&gt;</td></tr></tbody></table></div>',
  ],
  [
    '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n| 3 | 4 | 5 | 6 |',
    '<div class="news-table-wrap"><table class="news-table"><thead><tr><th scope="col">A</th><th scope="col">B</th><th scope="col">C</th><th scope="col"></th></tr></thead><tbody><tr><td>1</td><td>2</td><td></td><td></td></tr><tr><td>3</td><td>4</td><td>5</td><td>6</td></tr></tbody></table></div>',
  ],
];

for (const [input, expected] of CASES) {
  test(`SPA and SSR stay in sync: ${JSON.stringify(input).slice(0, 60)}`, () => {
    assert.equal(newsBodyHTML(input), bodyHtml(input));
    assert.equal(newsBodyHTML(input), expected);
  });
}

test('## Arsenal becomes an H2, not a paragraph', () => {
  const html = newsBodyHTML('## Arsenal');
  assert.equal(html, '<h2>Arsenal</h2>');
  assert.doesNotMatch(html, /<p>/);
});

test('named link [GBFC](https://…) becomes an <a> whose text is GBFC', () => {
  const html = newsBodyHTML(NAMED);
  assert.match(html, /<a href="https:\/\/fanreactionsfc\.com\/creators\/gbfc">GBFC<\/a>/);
  assert.equal(html, `<p>${NAMED_A}</p>`);
});

test('YouTube URL on its own line still embeds', () => {
  assert.equal(newsBodyHTML(YT), YT_EMBED);
  assert.equal(bodyHtml(YT), YT_EMBED);
});

test('[xss](javascript:alert(1)) does not become an href', () => {
  const html = newsBodyHTML('[xss](javascript:alert(1))');
  assert.doesNotMatch(html, /href\s*=/i);
  assert.match(html, /\[xss\]\(javascript:alert\(1\)\)/);
});

test('plain paragraph body is unchanged', () => {
  assert.equal(newsBodyHTML('Hello world.'), '<p>Hello world.</p>');
  assert.equal(bodyHtml('Hello world.'), '<p>Hello world.</p>');
});

// Verbatim renderers from main (304f205), before the table branch.
// newsBodyHTML is the previous js/app.js function; bodyHtml is the previous
// netlify/functions/news-article.js function. Indentation matches main.
const mainNewsBodyHTML = (function () {
function escHtml(s) { return htmlEscaper(s); }
const YOUTUBE_URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&]\S*)?$/;

function newsBodyHTML(body) {
  function isSafeHref(url) {
    const u = String(url).trim();
    return /^https?:\/\//i.test(u) || (/^\//.test(u) && !u.startsWith('//'));
  }
  function inline(text) {
    const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = LINK_RE.exec(text)) !== null) {
      out += escHtml(text.slice(last, m.index));
      const href = m[2].trim();
      if (isSafeHref(href)) out += `<a href="${escHtml(href)}">${escHtml(m[1])}</a>`;
      else out += escHtml(m[0]);
      last = m.index + m[0].length;
    }
    out += escHtml(text.slice(last));
    return out;
  }
  return body.split(/\n\s*\n/).map(p => {
    const trimmed = p.trim();
    const m = trimmed.match(YOUTUBE_URL_RE);
    if (m) return `<div class="news-video-embed"><iframe src="https://www.youtube.com/embed/${m[1]}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    if (/^##[ \t]+/.test(trimmed) && !trimmed.includes('\n')) {
      return `<h2>${inline(trimmed.replace(/^##[ \t]+/, '').trim())}</h2>`;
    }
    return `<p>${inline(trimmed)}</p>`;
  }).join('');
}
return newsBodyHTML;
})();

const mainBodyHtml = (function () {
function esc(s) { return htmlEscaper(s); }
const YOUTUBE_URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&]\S*)?$/;

function bodyHtml(body) {
  function isSafeHref(url) {
    const u = String(url).trim();
    return /^https?:\/\//i.test(u) || (/^\//.test(u) && !u.startsWith('//'));
  }
  function inline(text) {
    const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = LINK_RE.exec(text)) !== null) {
      out += esc(text.slice(last, m.index));
      const href = m[2].trim();
      if (isSafeHref(href)) out += `<a href="${esc(href)}">${esc(m[1])}</a>`;
      else out += esc(m[0]);
      last = m.index + m[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }
  return body.split(/\n\s*\n/).map(p => {
    const trimmed = p.trim();
    const m = trimmed.match(YOUTUBE_URL_RE);
    if (m) return `<div class="news-video-embed"><iframe src="https://www.youtube.com/embed/${m[1]}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    if (/^##[ \t]+/.test(trimmed) && !trimmed.includes('\n')) {
      return `<h2>${inline(trimmed.replace(/^##[ \t]+/, '').trim())}</h2>`;
    }
    return `<p>${inline(trimmed)}</p>`;
  }).join('');
}
return bodyHtml;
})();

function chunkIsTable(chunk) {
  const lines = String(chunk).trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every(l => l.charAt(0) === '|')) return false;
  let sep = lines[1].trim();
  if (sep.charAt(0) === '|') sep = sep.slice(1);
  if (sep.charAt(sep.length - 1) === '|') sep = sep.slice(0, -1);
  const cells = sep.split('|').map(c => c.trim());
  return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c));
}

function bodyHasTable(body) {
  return String(body).split(/\n\s*\n/).some(chunkIsTable);
}

test('non-table bodies match the main renderers', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/published-articles.json'), 'utf8'));
  assert.ok(rows.length >= 60);
  let checked = 0;
  for (const row of rows) {
    if (typeof row.body !== 'string' || bodyHasTable(row.body)) continue;
    assert.equal(newsBodyHTML(row.body), mainNewsBodyHTML(row.body), row.slug);
    assert.equal(bodyHtml(row.body), mainBodyHtml(row.body), row.slug);
    checked++;
  }
  assert.equal(checked, rows.filter(row => typeof row.body === 'string' && !bodyHasTable(row.body)).length);

  const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/nontable-bodies.json'), 'utf8'));
  assert.ok(samples.length >= 6);
  const kinds = { paragraph: false, heading: false, youtube: false, link: false, stars: false, pipes: false };
  for (const body of samples) {
    assert.equal(bodyHasTable(body), false, body);
    assert.equal(newsBodyHTML(body), mainNewsBodyHTML(body), body);
    assert.equal(bodyHtml(body), mainBodyHtml(body), body);
    if (body.includes('\n\n') && !body.includes('##') && !body.includes('http')) kinds.paragraph = true;
    if (body.includes('## ')) kinds.heading = true;
    if (/youtube\.com/.test(body)) kinds.youtube = true;
    if (body.includes('](')) kinds.link = true;
    if (body.includes('**')) kinds.stars = true;
    if (body.includes('|')) kinds.pipes = true;
  }
  assert.deepEqual(kinds, { paragraph: true, heading: true, youtube: true, link: true, stars: true, pipes: true });

  for (const [input] of CASES) {
    if (bodyHasTable(input)) continue;
    assert.equal(newsBodyHTML(input), mainNewsBodyHTML(input));
    assert.equal(bodyHtml(input), mainBodyHtml(input));
  }
});
