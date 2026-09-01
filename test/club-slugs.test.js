const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  clubSlug,
  clubPath,
  resolveClub,
  decodeClubSegment,
} = require('../js/lib/club-slugs.js');

test('canonical slugs expand abbreviated display names', () => {
  assert.equal(clubSlug('Man United'), 'manchester-united');
  assert.equal(clubSlug('Man City'), 'manchester-city');
  assert.equal(clubSlug('Nottm Forest'), 'nottingham-forest');
  assert.equal(clubSlug('Arsenal'), 'arsenal');
});

test('clubPath is slash-prefixed and has no trailing slash', () => {
  assert.equal(clubPath('Man United'), '/clubs/manchester-united');
  assert.equal(clubPath('Arsenal', '/videos'), '/clubs/arsenal/videos');
});

test('resolves spaced, encoded, and cased legacy URLs', () => {
  assert.equal(resolveClub('Man United'), 'Man United');
  assert.equal(resolveClub('Man%20United'), 'Man United');
  assert.equal(resolveClub('Arsenal'), 'Arsenal');
  assert.equal(resolveClub('arsenal'), 'Arsenal');
  assert.equal(resolveClub('ARSENAL'), 'Arsenal');
  assert.equal(resolveClub('Nottm%20Forest'), 'Nottm Forest');
});

test('resolves old slugify forms and the new hyphenated slugs', () => {
  assert.equal(resolveClub('man-united'), 'Man United');
  assert.equal(resolveClub('manchester-united'), 'Man United');
  assert.equal(resolveClub('nottm-forest'), 'Nottm Forest');
  assert.equal(resolveClub('nottingham-forest'), 'Nottm Forest');
  assert.equal(resolveClub('arsenal'), 'Arsenal');
});

test('decodeClubSegment handles plus-as-space and trailing slashes', () => {
  assert.equal(decodeClubSegment('Man+United'), 'Man United');
  assert.equal(decodeClubSegment('arsenal/'), 'arsenal');
});

test('unknown clubs do not resolve', () => {
  assert.equal(resolveClub('not-a-real-club'), null);
  assert.equal(resolveClub(''), null);
  assert.equal(resolveClub('about'), null);
});

test('extra team names from the DB can resolve even if not in the static list', () => {
  assert.equal(resolveClub('Some New Club', ['Some New Club']), 'Some New Club');
  assert.equal(resolveClub('some-new-club', ['Some New Club']), 'Some New Club');
});
