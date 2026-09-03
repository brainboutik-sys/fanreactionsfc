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
