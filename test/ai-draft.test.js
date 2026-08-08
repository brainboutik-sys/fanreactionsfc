const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkMonthlyCap, buildDraftPrompt, finalizeDraft, DISCLOSURE, MONTHLY_CALL_CAP } = require('../netlify/functions/ai-draft.js');

test('monthly cap counts only runs from the current calendar month', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');
  const jobRuns = [
    { started_at: '2026-07-31T23:59:59.000Z' }, // last month — must not count
    { started_at: '2026-08-01T00:00:00.000Z' }, // first instant of this month — must count
    { started_at: '2026-08-14T00:00:00.000Z' },
  ];
  const result = checkMonthlyCap(jobRuns, 60, now);
  assert.equal(result.count, 2);
  assert.equal(result.exceeded, false);
});

test('cap is exceeded once the count reaches the limit (not only once it passes it)', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');
  const jobRuns = Array.from({ length: 5 }, () => ({ started_at: '2026-08-02T00:00:00.000Z' }));
  assert.equal(checkMonthlyCap(jobRuns, 5, now).exceeded, true);
  assert.equal(checkMonthlyCap(jobRuns, 6, now).exceeded, false);
});

test('default MONTHLY_CALL_CAP matches the agreed budget', () => {
  assert.equal(MONTHLY_CALL_CAP, 60);
});

test('prompt instructs the model not to invent facts and to return the three required fields', () => {
  const candidate = {
    working_title: 'Weekly Creator Rankings — 1 Aug to 8 Aug',
    type: 'weekly_ranking',
    payload: { sections: { fastest_growth_pct: [{ name: 'Richard Morse', pct: 35.1 }] } },
  };
  const prompt = buildDraftPrompt(candidate);
  assert.match(prompt.system, /only the facts/i);
  assert.match(prompt.system, /do not invent/i);
  assert.match(prompt.system, /title, summary, body/);
  // The user message must carry the real numbers through untouched —
  // the model should never have to guess or re-derive them.
  const parsedUser = JSON.parse(prompt.user);
  assert.equal(parsedUser.payload.sections.fastest_growth_pct[0].pct, 35.1);
});

test('finalizeDraft appends the disclosure and tags the draft as AI-generated', () => {
  const draft = finalizeDraft({ title: ' My Title ', summary: ' A summary ', body: ' Body text. ' });
  assert.equal(draft.title, 'My Title');
  assert.equal(draft.summary, 'A summary');
  assert.equal(draft.ai_generated, true);
  assert.ok(draft.body.startsWith('Body text.'));
  assert.ok(draft.body.endsWith(DISCLOSURE));
});

test('finalizeDraft coerces non-string fields defensively', () => {
  // Guards against a model response that technically parses as JSON but
  // has the wrong types (e.g. a number where a string was requested).
  const draft = finalizeDraft({ title: 123, summary: 'ok', body: 'text' });
  assert.equal(draft.title, '123');
});
