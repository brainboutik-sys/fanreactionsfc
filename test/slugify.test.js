const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../js/lib/slugify.js');

test('lowercases and hyphenates', () => {
  assert.equal(slugify('Fabrizio Romano'), 'fabrizio-romano');
});

test('collapses runs of non-alphanumeric characters into one hyphen', () => {
  assert.equal(slugify('The  Two   Marks Show!!'), 'the-two-marks-show');
});

test('strips leading and trailing hyphens', () => {
  assert.equal(slugify('  --Weekly Update--  '), 'weekly-update');
});

test('is idempotent — slugifying an already-slugged string is a no-op', () => {
  const once = slugify('Weekly Creator Rankings — 1 Aug to 8 Aug');
  assert.equal(slugify(once), once);
});

test('is deterministic for the same input', () => {
  const title = 'Weekly Creator Rankings — 1 Aug to 8 Aug';
  assert.equal(slugify(title), slugify(title));
});

// This is exactly why frfc_articles.slug has a UNIQUE constraint at the DB
// level, and why saveArticle()/approveAndPublishCandidate() both check
// res.error before treating a save as successful — slugify() alone cannot
// guarantee uniqueness, only normalization.
test('different titles can collide on the same slug', () => {
  assert.equal(slugify('Foo & Bar'), slugify('Foo, Bar'));
  assert.equal(slugify('Foo & Bar'), 'foo-bar');
});

test('non-ASCII characters are stripped, not transliterated', () => {
  assert.equal(slugify('Fábrizio Romano'), 'f-brizio-romano');
});

test('empty and all-punctuation strings slugify to an empty string', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify('!!!'), '');
});
