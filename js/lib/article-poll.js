/* FanReactionsFC — "Who reacted best?" at the end of a news article.
   Loaded before app.js (see index.html). One switch hides the whole
   thing: set ARTICLE_POLL_ENABLED to false.

   Options are the creators linked from that article's body
   (/creators/<slug>), in first-seen order, named from frfc_streamers.
   Fewer than two named creators hides the poll. One tap stores one vote
   per browser per article (localStorage). Results are the vote share
   only: a percentage and a total, with a link to each creator page. */

const ARTICLE_POLL_ENABLED = true;
const ARTICLE_POLL_VOTES_KEY = 'frfc_article_poll_votes';
const ARTICLE_POLL_CLIENT_KEY = 'frfc_article_poll_client';
const ARTICLE_POLL_SLUG_MAX = 80;

const ARTICLE_POLL_COPY = {
  title: 'Who reacted best?',
  leadOpen: 'Tap a creator once. The share of votes appears after you vote.',
  leadResults: 'Share of votes on this article.',
  loading: 'Loading the vote share.',
  saving: 'Saving your vote.',
  unavailable: 'The vote share isn\'t available right now.',
  retry: 'That vote didn\'t save. You can try again.',
  storage: 'Voting needs browser storage on this device.',
  yours: 'Your vote',
  vote: 'Vote',
  group: 'Creators in this article',
};

const ARTICLE_POLL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTICLE_POLL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARTICLE_POLL_CLIENT_RE = ARTICLE_POLL_UUID_RE;

function articlePollEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function articlePollCreatorsFromBody(body) {
  const text = String(body || '');
  const re = /\/creators\/([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?![A-Za-z0-9-])/g;
  const seen = new Set();
  const slugs = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    const slug = match[1].toLowerCase();
    if (slug.length > ARTICLE_POLL_SLUG_MAX || !ARTICLE_POLL_SLUG_RE.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function articlePollOptions(body, creators) {
  const names = new Map();
  (creators || []).forEach(creator => {
    if (!creator) return;
    const slug = String(creator.slug || '').trim().toLowerCase();
    const name = String(creator.name || '').trim();
    if (!name || slug.length > ARTICLE_POLL_SLUG_MAX || !ARTICLE_POLL_SLUG_RE.test(slug)) return;
    if (!names.has(slug)) names.set(slug, name);
  });
  const options = [];
  articlePollCreatorsFromBody(body).forEach(slug => {
    if (!names.has(slug)) return;
    options.push({ slug: slug, name: names.get(slug) });
  });
  return options;
}

function articlePollReadVotes(storage) {
  if (!storage || typeof storage.getItem !== 'function') return {};
  let raw;
  try { raw = storage.getItem(ARTICLE_POLL_VOTES_KEY); }
  catch (e) { return {}; }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

function articlePollStoredVote(articleId, storage) {
  const id = String(articleId || '').trim().toLowerCase();
  if (!ARTICLE_POLL_UUID_RE.test(id)) return '';
  const slug = articlePollReadVotes(storage)[id];
  if (typeof slug !== 'string') return '';
  const clean = slug.trim().toLowerCase();
  if (clean.length > ARTICLE_POLL_SLUG_MAX || !ARTICLE_POLL_SLUG_RE.test(clean)) return '';
  return clean;
}

function articlePollRememberVote(articleId, slug, storage) {
  const id = String(articleId || '').trim().toLowerCase();
  const clean = String(slug || '').trim().toLowerCase();
  if (!ARTICLE_POLL_UUID_RE.test(id)) return false;
  if (clean.length > ARTICLE_POLL_SLUG_MAX || !ARTICLE_POLL_SLUG_RE.test(clean)) return false;
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return false;
  const votes = articlePollReadVotes(storage);
  const existing = votes[id];
  if (typeof existing === 'string' && ARTICLE_POLL_SLUG_RE.test(existing.trim().toLowerCase())) return false;
  votes[id] = clean;
  try {
    storage.setItem(ARTICLE_POLL_VOTES_KEY, JSON.stringify(votes));
  } catch (e) {
    return false;
  }
  return articlePollStoredVote(id, storage) === clean;
}

function articlePollRandomId() {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') cryptoObj.getRandomValues(bytes);
  else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function articlePollClientId(storage, makeId) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  let existing = '';
  try { existing = String(storage.getItem(ARTICLE_POLL_CLIENT_KEY) || ''); }
  catch (e) { return ''; }
  const current = existing.trim().toLowerCase();
  if (ARTICLE_POLL_CLIENT_RE.test(current)) return current;
  const maker = typeof makeId === 'function' ? makeId : articlePollRandomId;
  let next = '';
  try { next = String(maker() || '').trim().toLowerCase(); }
  catch (e) { return ''; }
  if (!ARTICLE_POLL_CLIENT_RE.test(next)) return '';
  try {
    if (typeof storage.setItem === 'function') storage.setItem(ARTICLE_POLL_CLIENT_KEY, next);
  } catch (e) { /* this tap can still be stored; the next visit mints another id */ }
  return next;
}

function articlePollPercents(counts) {
  const rows = (counts || []).map(row => ({
    slug: String(row && (row.slug || row.creator_slug) || ''),
    votes: Math.max(0, Math.floor(Number(row && row.votes) || 0)),
  }));
  const total = rows.reduce((sum, row) => sum + row.votes, 0);
  if (total <= 0) {
    return { total: 0, rows: rows.map(row => ({ slug: row.slug, votes: row.votes, percent: 0 })) };
  }
  const parts = rows.map((row, index) => ({
    slug: row.slug,
    votes: row.votes,
    percent: Math.floor((row.votes * 100) / total),
    remainder: (row.votes * 100) % total,
    index: index,
  }));
  let leftover = 100 - parts.reduce((sum, row) => sum + row.percent, 0);
  const order = parts.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; leftover > 0 && i < order.length; i++) {
    order[i].percent += 1;
    leftover -= 1;
  }
  return {
    total: total,
    rows: parts.map(row => ({ slug: row.slug, votes: row.votes, percent: row.percent })),
  };
}

function articlePollResultModel(options, counts) {
  const bySlug = new Map();
  (counts || []).forEach(row => {
    if (!row) return;
    const slug = String(row.slug || row.creator_slug || '').trim().toLowerCase();
    if (!slug || bySlug.has(slug)) return;
    bySlug.set(slug, Math.max(0, Math.floor(Number(row.votes) || 0)));
  });
  return articlePollPercents((options || []).map(opt => ({
    slug: opt.slug,
    votes: bySlug.has(opt.slug) ? bySlug.get(opt.slug) : 0,
  })));
}

function articlePollVoteLabel(total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  return n === 1 ? '1 vote' : n + ' votes';
}

function articlePollAnnounce(options, math, justVoted) {
  const rows = math && math.rows || [];
  const bits = (options || []).map((opt, index) => {
    const percent = rows[index] ? rows[index].percent : 0;
    return String(opt.name || opt.slug) + ' ' + percent + '%';
  });
  const head = (justVoted ? 'Your vote is counted. ' : '') + articlePollVoteLabel(math && math.total) + '.';
  return bits.length ? head + ' ' + bits.join(', ') + '.' : head;
}

function articlePollTrack(slug, club) {
  return ' data-frfc-link="poll" data-frfc-creator="' + articlePollEscape(slug) + '" data-frfc-club="' + articlePollEscape(club || '') + '"';
}

function articlePollChoicesHtml(options, club) {
  return '<div class="article-poll-options" role="group" aria-label="' + articlePollEscape(ARTICLE_POLL_COPY.group) + '">' +
    options.map(opt => {
      const name = articlePollEscape(opt.name);
      const slug = articlePollEscape(opt.slug);
      return '<div class="article-poll-option">' +
        '<a class="article-poll-name" href="/creators/' + slug + '"' + articlePollTrack(opt.slug, club) + '>' + name + '</a>' +
        '<button type="button" class="btn btn-primary article-poll-vote" data-article-poll-vote="' + slug + '" aria-label="' + articlePollEscape(ARTICLE_POLL_COPY.vote) + ' for ' + name + '">' + articlePollEscape(ARTICLE_POLL_COPY.vote) + '</button>' +
      '</div>';
    }).join('') +
  '</div>';
}

function articlePollResultsBodyHtml(options, counts, club, votedSlug) {
  const math = articlePollResultModel(options, counts);
  const chosen = String(votedSlug || '').trim().toLowerCase();
  const items = (options || []).map((opt, index) => {
    const percent = math.rows[index] ? math.rows[index].percent : 0;
    const yours = opt.slug === chosen
      ? '<span class="article-poll-yours">' + articlePollEscape(ARTICLE_POLL_COPY.yours) + '</span>'
      : '';
    return '<li class="article-poll-result">' +
      '<div class="article-poll-result-name">' +
        '<a class="article-poll-name" href="/creators/' + articlePollEscape(opt.slug) + '"' + articlePollTrack(opt.slug, club) + '>' + articlePollEscape(opt.name) + '</a>' +
        yours +
      '</div>' +
      '<span class="article-poll-pct">' + percent + '%</span>' +
      '<div class="article-poll-bar" aria-hidden="true"><span style="width:' + percent + '%"></span></div>' +
    '</li>';
  }).join('');
  return '<p class="article-poll-total">' + articlePollEscape(articlePollVoteLabel(math.total)) + '</p>' +
    '<ul class="article-poll-results">' + items + '</ul>';
}

function articlePollSectionHtml(input) {
  const enabled = input && Object.prototype.hasOwnProperty.call(input, 'enabled')
    ? input.enabled
    : ARTICLE_POLL_ENABLED;
  if (!enabled) return '';
  const articleId = String(input && input.articleId || '').trim().toLowerCase();
  if (!ARTICLE_POLL_UUID_RE.test(articleId)) return '';
  const options = articlePollOptions(input && input.body, input && input.creators);
  if (options.length < 2) return '';
  const club = input && input.club || '';
  const voted = input && input.storage ? articlePollStoredVote(articleId, input.storage) : '';
  const body = voted
    ? '<p class="article-poll-total">' + articlePollEscape(ARTICLE_POLL_COPY.loading) + '</p>'
    : articlePollChoicesHtml(options, club);
  const lead = voted ? ARTICLE_POLL_COPY.leadResults : ARTICLE_POLL_COPY.leadOpen;
  const status = voted ? ARTICLE_POLL_COPY.loading : '';
  return '<section class="article-poll" data-article-poll="' + articlePollEscape(articleId) + '" data-article-poll-state="' + (voted ? 'results' : 'open') + '" aria-labelledby="articlePollTitle">' +
    '<h2 id="articlePollTitle" class="article-poll-title">' + articlePollEscape(ARTICLE_POLL_COPY.title) + '</h2>' +
    '<p class="article-poll-lead" id="articlePollLead">' + articlePollEscape(lead) + '</p>' +
    '<div id="articlePollBody">' + body + '</div>' +
    '<p class="article-poll-status" id="articlePollStatus" aria-live="polite">' + articlePollEscape(status) + '</p>' +
  '</section>';
}

function articlePollMount(opts) {
  const enabled = opts && Object.prototype.hasOwnProperty.call(opts, 'enabled')
    ? opts.enabled
    : ARTICLE_POLL_ENABLED;
  if (!enabled || !opts) return;
  const root = opts.root;
  if (!root || typeof root.querySelector !== 'function' || typeof root.addEventListener !== 'function') return;
  if (typeof opts.insertVote !== 'function' || typeof opts.loadCounts !== 'function') return;
  const options = Array.isArray(opts.options) ? opts.options : [];
  const club = opts.club || '';
  const storage = opts.storage;
  const articleId = opts.articleId;
  const bodyEl = root.querySelector('#articlePollBody');
  const statusEl = root.querySelector('#articlePollStatus');
  const leadEl = root.querySelector('#articlePollLead');
  if (!bodyEl || !statusEl) return;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function showCounts(justVoted) {
    setStatus(ARTICLE_POLL_COPY.loading);
    let loaded = { ok: false, counts: [] };
    try { loaded = await opts.loadCounts(); }
    catch (e) { loaded = { ok: false }; }
    if (!loaded || loaded.ok !== true) {
      setStatus(ARTICLE_POLL_COPY.unavailable);
      if (!bodyEl.querySelector('.article-poll-results')) bodyEl.textContent = '';
      if (justVoted) {
        if (leadEl) leadEl.textContent = ARTICLE_POLL_COPY.leadResults;
        root.setAttribute('data-article-poll-state', 'results');
      }
      return;
    }
    if (root.isConnected === false) return;
    const math = articlePollResultModel(options, loaded.counts || []);
    const voted = articlePollStoredVote(articleId, storage);
    bodyEl.innerHTML = articlePollResultsBodyHtml(options, loaded.counts || [], club, voted);
    if (leadEl) leadEl.textContent = ARTICLE_POLL_COPY.leadResults;
    root.setAttribute('data-article-poll-state', 'results');
    setStatus(articlePollAnnounce(options, math, justVoted));
  }

  if (root.getAttribute('data-article-poll-state') === 'results') {
    showCounts(false);
    return;
  }

  let busy = false;
  root.addEventListener('click', async event => {
    const target = event && event.target;
    const btn = target && target.closest ? target.closest('[data-article-poll-vote]') : null;
    if (!btn || busy) return;
    if (articlePollStoredVote(articleId, storage)) {
      showCounts(false);
      return;
    }
    const slug = String(btn.getAttribute('data-article-poll-vote') || '');
    if (!options.some(opt => opt.slug === slug)) return;
    const clientId = articlePollClientId(storage);
    if (!clientId) {
      setStatus(ARTICLE_POLL_COPY.storage);
      return;
    }
    busy = true;
    root.setAttribute('aria-busy', 'true');
    const buttons = root.querySelectorAll('[data-article-poll-vote]');
    for (let i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    setStatus(ARTICLE_POLL_COPY.saving);
    let saved = { ok: false };
    try { saved = await opts.insertVote(slug, clientId); }
    catch (e) { saved = { ok: false }; }
    if (!saved || saved.ok !== true) {
      busy = false;
      root.setAttribute('aria-busy', 'false');
      for (let i = 0; i < buttons.length; i++) buttons[i].disabled = false;
      setStatus(ARTICLE_POLL_COPY.retry);
      return;
    }
    articlePollRememberVote(articleId, slug, storage);
    await showCounts(true);
    root.setAttribute('aria-busy', 'false');
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ARTICLE_POLL_ENABLED,
    ARTICLE_POLL_VOTES_KEY,
    ARTICLE_POLL_CLIENT_KEY,
    ARTICLE_POLL_COPY,
    articlePollCreatorsFromBody,
    articlePollOptions,
    articlePollStoredVote,
    articlePollRememberVote,
    articlePollClientId,
    articlePollPercents,
    articlePollResultModel,
    articlePollAnnounce,
    articlePollResultsBodyHtml,
    articlePollSectionHtml,
    articlePollMount,
  };
}
