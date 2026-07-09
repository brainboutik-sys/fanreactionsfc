/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Community Feature Requests module
   Extracted from app.js; loaded after app.js (see index.html). All refs to
   core globals (sb, currentUser, openModal, navigate, renderFooter, escHtml,
   timeAgo) are runtime-only.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Feature Requests ─────────────────────────────────────────────────────
// Data access uses the supabase-js `sb` client (RLS-aware). Backing tables:
// frfc_feature_requests / _votes / _comments / _comment_likes / _status_log.

const FR_CATEGORIES = [
  'Website Features','Mobile Experience','Watch Along Features','Community Features',
  'Statistics & Data','User Profiles','Notifications','Fantasy & Prediction Games','Other'
];

// Small inline SVG icon set for the Feature Requests page — replaces emoji
// (📌💬🔒❤️), which renders inconsistently across OS/browsers and reads as
// a mismatched style next to the site's crest/logo art. 14–16px, currentColor
// so each inherits its container's text color.
const FR_ICONS = {
  pin: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1c-2.3 0-4.2 1.9-4.2 4.2 0 3.2 4.2 8.3 4.2 8.3s4.2-5.1 4.2-8.3C12.2 2.9 10.3 1 8 1zm0 5.7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>',
  comment: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6l-3.5 3V12H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/></svg>',
  lockClosed: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  lockOpen: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/></svg>',
  heartFilled: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 13.6 2.6 8.5C1 7 1 4.6 2.6 3.2c1.5-1.4 3.8-1.2 5.1.3l.3.4.3-.4c1.3-1.5 3.6-1.7 5.1-.3 1.6 1.4 1.6 3.8 0 5.3L8 13.6z"/></svg>',
  heartOutline: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 13.6 2.6 8.5C1 7 1 4.6 2.6 3.2c1.5-1.4 3.8-1.2 5.1.3l.3.4.3-.4c1.3-1.5 3.6-1.7 5.1-.3 1.6 1.4 1.6 3.8 0 5.3L8 13.6z"/></svg>',
  bell: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 2a4 4 0 0 0-4 4v2.6L2.7 11h10.6L12 8.6V6a4 4 0 0 0-4-4z"/><path d="M6.5 13.2a1.6 1.6 0 0 0 3 0"/></svg>',
};

// rgb triplets mirror the hex values of the design-system tokens below so
// the badge background can use plain rgba() — color-mix() isn't supported
// in older Safari and was silently dropping these backgrounds/borders.
const FR_STATUSES = {
  open:           { label: 'Open',           color: 'var(--blue)',   rgb: '59,130,246' },
  under_review:   { label: 'Under Review',   color: 'var(--yellow)', rgb: '246,190,6' },
  planned:        { label: 'Planned',        color: 'var(--purple)', rgb: '139,92,246' },
  in_development: { label: 'In Development', color: 'var(--orange)', rgb: '249,115,22' },
  released:       { label: 'Released',       color: 'var(--green)',  rgb: '46,204,113' },
  declined:       { label: 'Declined',       color: 'var(--red)',    rgb: '230,57,70' }
};

function frStatusBadge(status) {
  const s = FR_STATUSES[status] || FR_STATUSES.open;
  return `<span class="fr-status" style="--fr-status-color:${s.color};--fr-status-rgb:${s.rgb}">${s.label}</span>`;
}

// Placeholder cards shaped like real .fr-card rows, shown while the list
// fetches from Supabase.
function frSkeletonCards(count = 4) {
  return Array(count).fill(`
    <div class="fr-card fr-card--skeleton">
      <div class="fr-vote-col">
        <div class="skeleton" style="width:40px;height:32px;border-radius:var(--radius-sm)"></div>
        <div class="skeleton" style="width:20px;height:16px;margin-top:4px"></div>
      </div>
      <div class="fr-card-body">
        <div class="skeleton" style="width:60%;height:16px;margin-bottom:10px"></div>
        <div class="skeleton" style="width:90%;height:12px;margin-bottom:6px"></div>
        <div class="skeleton" style="width:75%;height:12px;margin-bottom:10px"></div>
        <div class="skeleton" style="width:120px;height:11px"></div>
      </div>
    </div>`).join('');
}

// Cache the admin check per session so we don't re-query on every render.
let _frIsAdmin = null;
async function frCheckAdmin() {
  if (!currentUser) return false;
  if (_frIsAdmin !== null) return _frIsAdmin;
  try {
    const { data } = await sb.from('frfc_admin_roles').select('role').eq('user_id', currentUser.id);
    _frIsAdmin = !!(data && data.length);
  } catch (_) { _frIsAdmin = false; }
  return _frIsAdmin;
}

let _frCache = [];
let _frUserVotes = new Set();

async function renderFeatureRequests() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="fr-hero">
      <div class="container">
        <h1>Community Feature Requests</h1>
        <p class="fr-hero-sub">Help shape the future of Fan Reactions FC.</p>
        <button class="btn btn-primary fr-suggest-btn" onclick="openFeatureSubmitModal()">+ Suggest a Feature</button>
      </div>
    </div>
    <div class="container fr-container">
      <div class="fr-toolbar">
        <div class="fr-search-wrap">
          <input type="text" class="fr-search" id="frSearch" placeholder="Search ideas..." oninput="frSearchInput()">
        </div>
        <div class="fr-filters">
          <select id="frCategoryFilter" class="fr-select" onchange="filterFeatureRequests()">
            <option value="">All Categories</option>
            ${FR_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <select id="frStatusFilter" class="fr-select" onchange="filterFeatureRequests()">
            <option value="">All Statuses</option>
            ${Object.entries(FR_STATUSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
          </select>
          <select id="frSort" class="fr-select" onchange="filterFeatureRequests()">
            <option value="popular">Most Popular</option>
            <option value="newest">Newest</option>
            <option value="trending">Trending</option>
            <option value="updated">Recently Updated</option>
          </select>
        </div>
      </div>
      <div id="frList" class="fr-list">${frSkeletonCards()}</div>
    </div>
    ${renderFooter()}`;
  await loadFeatureRequests();
}

async function loadFeatureRequests() {
  const { data, error } = await sb.from('frfc_feature_requests')
    .select('*').is('merged_into', null)
    .order('is_pinned', { ascending: false })
    .order('vote_count', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    const el = document.getElementById('frList');
    if (el) el.innerHTML = '<div class="fr-empty">Could not load feature requests.</div>';
    return;
  }
  _frCache = data || [];
  if (currentUser) {
    const { data: votes } = await sb.from('frfc_feature_votes').select('feature_id').eq('user_id', currentUser.id);
    _frUserVotes = new Set((votes || []).map(v => v.feature_id));
  } else {
    _frUserVotes = new Set();
  }
  filterFeatureRequests();
}

let _frSearchTimer = null;
function frSearchInput() {
  clearTimeout(_frSearchTimer);
  _frSearchTimer = setTimeout(filterFeatureRequests, 150);
}

function filterFeatureRequests() {
  const search = (document.getElementById('frSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('frCategoryFilter')?.value || '';
  const status = document.getElementById('frStatusFilter')?.value || '';
  const sort = document.getElementById('frSort')?.value || 'popular';
  let filtered = _frCache.filter(r => {
    if (cat && r.category !== cat) return false;
    if (status && r.status !== status) return false;
    if (search && !r.title.toLowerCase().includes(search) && !r.description.toLowerCase().includes(search)) return false;
    return true;
  });
  if (sort === 'popular') filtered.sort((a, b) => (b.is_pinned - a.is_pinned) || (b.vote_count - a.vote_count));
  else if (sort === 'newest') filtered.sort((a, b) => (b.is_pinned - a.is_pinned) || new Date(b.created_at) - new Date(a.created_at));
  else if (sort === 'trending') filtered.sort((a, b) => {
    const aAge = (Date.now() - new Date(a.created_at).getTime()) / 3600000;
    const bAge = (Date.now() - new Date(b.created_at).getTime()) / 3600000;
    return (b.is_pinned - a.is_pinned) || ((b.vote_count / (bAge + 2)) - (a.vote_count / (aAge + 2)));
  });
  else if (sort === 'updated') filtered.sort((a, b) => (b.is_pinned - a.is_pinned) || new Date(b.updated_at) - new Date(a.updated_at));
  const list = document.getElementById('frList');
  if (!list) return;
  if (!filtered.length) { list.innerHTML = '<div class="fr-empty">No feature requests found.</div>'; return; }
  list.innerHTML = filtered.map(r => {
    const voted = _frUserVotes.has(r.id);
    return `
      <div class="fr-card ${r.is_pinned ? 'fr-card--pinned' : ''}">
        <div class="fr-vote-col">
          <button class="fr-vote-btn ${voted ? 'fr-vote-btn--active' : ''}" onclick="event.stopPropagation();toggleFeatureVote('${r.id}')" title="${voted ? 'Remove vote' : 'Upvote'}" aria-pressed="${voted}" aria-label="${voted ? 'Remove your vote for' : 'Upvote'} ${escHtml(r.title)}">
            <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M7 0l7 10H0z" fill="currentColor"/></svg>
          </button>
          <span class="fr-vote-count">${r.vote_count}</span>
        </div>
        <a class="fr-card-body" href="/community/features/${r.id}">
          <div class="fr-card-header">
            ${r.is_pinned ? `<span class="fr-pin" title="Pinned">${FR_ICONS.pin}</span>` : ''}
            <h3 class="fr-card-title">${escHtml(r.title)}</h3>
            ${frStatusBadge(r.status)}
          </div>
          <p class="fr-card-desc">${escHtml(r.description.length > 140 ? r.description.slice(0, 140) + '…' : r.description)}</p>
          <div class="fr-card-meta">
            <span class="fr-card-cat">${escHtml(r.category)}</span>
            <span class="fr-meta-icon">${FR_ICONS.comment} ${r.comment_count}</span>
            <span>${timeAgo(r.created_at)}</span>
          </div>
        </a>
      </div>`;
  }).join('');
}

async function toggleFeatureVote(featureId) {
  if (!currentUser) { openModal('signin', 'vote'); return; }
  const hasVote = _frUserVotes.has(featureId);
  const card = _frCache.find(r => r.id === featureId);
  // vote_count is maintained by a DB trigger on the votes table; the client
  // only inserts/deletes the vote row and updates the UI optimistically.
  if (hasVote) {
    _frUserVotes.delete(featureId);
    if (card) card.vote_count = Math.max(0, card.vote_count - 1);
    filterFeatureRequests();
    updateDetailVoteUI(featureId, false, card?.vote_count);
    const { error } = await sb.from('frfc_feature_votes').delete().eq('feature_id', featureId).eq('user_id', currentUser.id);
    if (error) { _frUserVotes.add(featureId); if (card) card.vote_count++; filterFeatureRequests(); updateDetailVoteUI(featureId, true, card?.vote_count); }
  } else {
    _frUserVotes.add(featureId);
    if (card) card.vote_count++;
    filterFeatureRequests();
    updateDetailVoteUI(featureId, true, card?.vote_count);
    const { error } = await sb.from('frfc_feature_votes').insert({ feature_id: featureId, user_id: currentUser.id });
    if (error) { _frUserVotes.delete(featureId); if (card) card.vote_count = Math.max(0, card.vote_count - 1); filterFeatureRequests(); updateDetailVoteUI(featureId, false, card?.vote_count); }
  }
}

function updateDetailVoteUI(featureId, voted, count) {
  const btn = document.querySelector('.fr-detail-vote-btn');
  const countEl = document.querySelector('.fr-detail-vote-count');
  if (btn) {
    btn.classList.toggle('fr-vote-btn--active', voted);
    btn.title = voted ? 'Remove vote' : 'Upvote this idea';
    btn.setAttribute('aria-pressed', voted);
    btn.setAttribute('aria-label', (voted ? 'Remove your vote' : 'Upvote this idea'));
  }
  if (countEl && count !== undefined) countEl.textContent = count;
}

// Follow/unfollow a feature request. Followers get an email when an admin
// changes the request's status (trg_frfc_notify_status → notify-feature-status
// edge function → Resend). The row insert/delete is all the client does.
async function toggleFeatureFollow(featureId) {
  if (!currentUser) { openModal('signin', 'follow'); return; }
  const btn = document.getElementById('frFollowBtn');
  const label = document.getElementById('frFollowLabel');
  const countEl = document.getElementById('frFollowCount');
  const wasFollowing = btn?.classList.contains('fr-follow-btn--active');
  const currentCount = parseInt((countEl?.textContent || '').match(/\d+/)?.[0] || 0);

  // Optimistic UI, rolled back if the write fails
  const setUI = (on, count) => {
    if (btn) {
      btn.classList.toggle('fr-follow-btn--active', on);
      btn.setAttribute('aria-pressed', on);
      btn.title = on ? 'Unfollow' : 'Get emailed when the status changes';
    }
    if (label) label.textContent = on ? 'Following' : 'Follow';
    if (countEl) countEl.textContent = count > 0 ? count + ' follower' + (count !== 1 ? 's' : '') : '';
  };

  if (wasFollowing) {
    setUI(false, Math.max(0, currentCount - 1));
    const { error } = await sb.from('frfc_feature_follows').delete().eq('feature_id', featureId).eq('user_id', currentUser.id);
    if (error) setUI(true, currentCount);
  } else {
    setUI(true, currentCount + 1);
    const { error } = await sb.from('frfc_feature_follows').insert({ feature_id: featureId, user_id: currentUser.id });
    if (error) setUI(false, currentCount);
  }
}

function openFeatureSubmitModal() {
  if (!currentUser) { openModal('signin', 'submitFeature'); return; }
  const overlay = document.getElementById('authOverlay');
  const modal = document.getElementById('authModal');
  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
    <h2>Suggest a Feature</h2>
    <p class="modal-sub">Describe your idea and the community will vote on it.</p>
    <label>Title</label>
    <input type="text" id="frTitle" placeholder="Short, descriptive title" maxlength="120">
    <label>Category</label>
    <select id="frCategory" class="fr-select" style="width:100%;margin-bottom:14px">
      ${FR_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
    <label>Description</label>
    <textarea id="frDesc" placeholder="Explain what you'd like and why it matters..." style="width:100%;min-height:120px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.88rem;resize:vertical;margin-bottom:14px"></textarea>
    <button class="btn btn-primary" style="width:100%" onclick="submitFeatureRequest()">Submit Idea</button>
    <div class="auth-msg" id="frMsg"></div>`;
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function submitFeatureRequest() {
  const title = document.getElementById('frTitle')?.value.trim();
  const category = document.getElementById('frCategory')?.value;
  const description = document.getElementById('frDesc')?.value.trim();
  const msg = document.getElementById('frMsg');
  if (!title || title.length < 5) { msg.textContent = 'Title must be at least 5 characters.'; msg.style.color = 'var(--red)'; return; }
  if (!description || description.length < 20) { msg.textContent = 'Description must be at least 20 characters.'; msg.style.color = 'var(--red)'; return; }
  msg.textContent = 'Submitting...'; msg.style.color = 'var(--text-dim)';
  const { error } = await sb.from('frfc_feature_requests').insert({ user_id: currentUser.id, title, description, category });
  if (error) { msg.textContent = error.message || 'Failed to submit.'; msg.style.color = 'var(--red)'; return; }
  closeModal();
  if (currentRoute.page === 'features') { await loadFeatureRequests(); } else { navigate('/community/features'); }
}

async function renderFeatureDetail(featureId) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container fr-detail-container">
      <div class="skeleton" style="width:140px;height:14px;margin-bottom:20px"></div>
      <div class="fr-detail">
        <div class="fr-detail-sidebar">
          <div class="skeleton" style="width:52px;height:40px;border-radius:var(--radius-sm)"></div>
          <div class="skeleton" style="width:24px;height:20px;margin-top:6px"></div>
        </div>
        <div class="fr-detail-main">
          <div class="skeleton" style="width:70%;height:24px;margin-bottom:14px"></div>
          <div class="skeleton" style="width:40%;height:14px;margin-bottom:24px"></div>
          <div class="skeleton" style="width:100%;height:14px;margin-bottom:8px"></div>
          <div class="skeleton" style="width:95%;height:14px;margin-bottom:8px"></div>
          <div class="skeleton" style="width:80%;height:14px"></div>
        </div>
      </div>
    </div>`;
  const { data, error } = await sb.from('frfc_feature_requests').select('*').eq('id', featureId).limit(1);
  if (error || !data || !data.length) {
    app.innerHTML = `<div class="container" style="padding:60px 20px;text-align:center"><div class="empty-state"><div class="es-icon">&#128269;</div><div class="es-title">Feature request not found</div><a href="/community/features" class="btn btn-primary" style="margin-top:12px">Back to Features</a></div></div>${renderFooter()}`;
    return;
  }
  const r = data[0];
  if (r.merged_into) { navigate(`/community/features/${r.merged_into}`, false); return; }
  updatePageMeta(`${r.title} | Feature Requests | FanReactionsFC`, r.description.slice(0, 160));
  if (currentUser) {
    const { data: votes } = await sb.from('frfc_feature_votes').select('feature_id').eq('user_id', currentUser.id).eq('feature_id', featureId);
    _frUserVotes = new Set((votes || []).map(v => v.feature_id));
  }
  const voted = _frUserVotes.has(r.id);
  const isAdmin = await frCheckAdmin();
  const { data: logData } = await sb.from('frfc_feature_status_log').select('*').eq('feature_id', featureId).order('created_at', { ascending: false });
  const statusLog = logData || [];

  // Follow state: is the current user following, and how many followers total?
  let following = false;
  let followerCount = 0;
  try {
    const { count } = await sb.from('frfc_feature_follows').select('id', { count: 'exact', head: true }).eq('feature_id', featureId);
    followerCount = count || 0;
    if (currentUser) {
      const { data: mine } = await sb.from('frfc_feature_follows').select('id').eq('feature_id', featureId).eq('user_id', currentUser.id);
      following = !!(mine && mine.length);
    }
  } catch (_) { /* non-critical */ }
  app.innerHTML = `
    <div class="container fr-detail-container">
      <a href="/community/features" class="fr-back-link">← All Feature Requests</a>
      <div class="fr-detail">
        <div class="fr-detail-sidebar">
          <button class="fr-vote-btn fr-detail-vote-btn ${voted ? 'fr-vote-btn--active' : ''}" onclick="toggleFeatureVote('${r.id}')" title="${voted ? 'Remove vote' : 'Upvote this idea'}" aria-pressed="${voted}" aria-label="${voted ? 'Remove your vote' : 'Upvote this idea'}">
            <svg width="18" height="12" viewBox="0 0 14 10" aria-hidden="true"><path d="M7 0l7 10H0z" fill="currentColor"/></svg>
          </button>
          <span class="fr-detail-vote-count">${r.vote_count}</span>
          <span class="fr-detail-vote-label">votes</span>
          <button class="fr-follow-btn ${following ? 'fr-follow-btn--active' : ''}" id="frFollowBtn" onclick="toggleFeatureFollow('${r.id}')" aria-pressed="${following}" aria-label="${following ? 'Unfollow this request' : 'Follow this request for status updates'}" title="${following ? 'Unfollow' : 'Get emailed when the status changes'}">
            ${FR_ICONS.bell} <span id="frFollowLabel">${following ? 'Following' : 'Follow'}</span>
          </button>
          <span class="fr-follow-count" id="frFollowCount">${followerCount > 0 ? followerCount + ' follower' + (followerCount !== 1 ? 's' : '') : ''}</span>
        </div>
        <div class="fr-detail-main">
          <div class="fr-detail-header">
            <h1 class="fr-detail-title">${escHtml(r.title)}</h1>
            ${frStatusBadge(r.status)}
          </div>
          <div class="fr-detail-meta">
            <span class="fr-card-cat">${escHtml(r.category)}</span>
            <span>${timeAgo(r.created_at)}</span>
            <span class="fr-meta-icon">${FR_ICONS.comment} ${r.comment_count} comments</span>
          </div>
          <div class="fr-detail-desc">${escHtml(r.description).replace(/\n/g, '<br>')}</div>
          ${r.admin_response ? `
            <div class="fr-official-response">
              <div class="fr-official-label">Official Response</div>
              <p>${escHtml(r.admin_response).replace(/\n/g, '<br>')}</p>
              ${r.admin_response_at ? `<div class="fr-official-time">${timeAgo(r.admin_response_at)}</div>` : ''}
            </div>` : ''}
          ${statusLog.length ? `
            <div class="fr-status-timeline">
              <h3>Status History</h3>
              ${statusLog.map(l => `
                <div class="fr-status-event">
                  ${frStatusBadge(l.new_status)}
                  ${l.note ? `<span class="fr-status-note">${escHtml(l.note)}</span>` : ''}
                  <span class="fr-status-time">${timeAgo(l.created_at)}</span>
                </div>`).join('')}
            </div>` : ''}
          ${isAdmin ? renderFeatureAdminPanel(r) : ''}
          <div class="fr-comments-section" id="frComments">
            <h3>Discussion</h3>
            ${r.is_locked ? `<p class="fr-locked-notice">${FR_ICONS.lockClosed} This discussion is locked.</p>` : ''}
            <div id="frCommentList"><div style="color:var(--text-dim);font-size:.85rem">Loading comments...</div></div>
            ${!r.is_locked ? `
              <div class="fr-comment-form" id="frCommentForm">
                <textarea id="frCommentBody" placeholder="${currentUser ? 'Add a comment...' : 'Sign in to comment'}" ${currentUser ? '' : 'disabled'} style="width:100%;min-height:80px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.88rem;resize:vertical"></textarea>
                <button class="btn btn-primary" style="margin-top:8px" onclick="postFeatureComment('${r.id}')" ${currentUser ? '' : 'disabled'}>Post Comment</button>
                <span class="auth-msg" id="frCommentMsg"></span>
              </div>` : ''}
          </div>
        </div>
      </div>
    </div>
    ${renderFooter()}`;
  loadFeatureComments(featureId);
}

function renderFeatureAdminPanel(r) {
  return `
    <div class="fr-admin-panel">
      <h3>Admin Actions</h3>
      <div class="fr-admin-row">
        <label>Status</label>
        <select id="frAdminStatus" class="fr-select">
          ${Object.entries(FR_STATUSES).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <input type="text" id="frAdminStatusNote" placeholder="Note (optional)" class="fr-admin-note-input">
        <button class="btn btn-primary btn-sm" onclick="adminUpdateFeatureStatus('${r.id}')">Update Status</button>
      </div>
      <div class="fr-admin-row">
        <label>Official Response</label>
        <textarea id="frAdminResponse" style="width:100%;min-height:60px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.85rem;resize:vertical">${r.admin_response ? escHtml(r.admin_response) : ''}</textarea>
        <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="adminPostOfficialResponse('${r.id}')">Save Response</button>
      </div>
      <div class="fr-admin-row fr-admin-toggles">
        <button class="btn btn-sm btn-ghost" onclick="adminToggleFeaturePin('${r.id}', ${!r.is_pinned})">${FR_ICONS.pin} ${r.is_pinned ? 'Unpin' : 'Pin'}</button>
        <button class="btn btn-sm btn-ghost" onclick="adminToggleFeatureLock('${r.id}', ${!r.is_locked})">${r.is_locked ? FR_ICONS.lockOpen + ' Unlock' : FR_ICONS.lockClosed + ' Lock'}</button>
        <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="adminDeleteFeatureRequest('${r.id}')">🗑 Delete</button>
      </div>
      <div class="fr-admin-row">
        <label>Merge Into (paste target feature ID)</label>
        <input type="text" id="frMergeTarget" placeholder="Target feature ID" style="flex:1">
        <button class="btn btn-sm btn-ghost" onclick="adminMergeFeature('${r.id}')">Merge</button>
      </div>
      <div class="auth-msg" id="frAdminMsg"></div>
    </div>`;
}

async function adminUpdateFeatureStatus(featureId) {
  const newStatus = document.getElementById('frAdminStatus')?.value;
  const note = document.getElementById('frAdminStatusNote')?.value.trim();
  const msg = document.getElementById('frAdminMsg');
  if (!newStatus) return;
  const { error } = await sb.from('frfc_feature_requests').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', featureId);
  if (error) { msg.textContent = 'Failed to update status.'; msg.style.color = 'var(--red)'; return; }
  await sb.from('frfc_feature_status_log').insert({ feature_id: featureId, new_status: newStatus, changed_by: currentUser.id, note: note || null });
  msg.textContent = 'Status updated!'; msg.style.color = 'var(--green)';
  setTimeout(() => renderFeatureDetail(featureId), 800);
}

async function adminPostOfficialResponse(featureId) {
  const body = document.getElementById('frAdminResponse')?.value.trim();
  const msg = document.getElementById('frAdminMsg');
  const { error } = await sb.from('frfc_feature_requests').update({ admin_response: body || null, admin_response_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', featureId);
  if (error) { msg.textContent = 'Failed to save response.'; msg.style.color = 'var(--red)'; return; }
  msg.textContent = 'Response saved!'; msg.style.color = 'var(--green)';
  setTimeout(() => renderFeatureDetail(featureId), 800);
}

async function adminToggleFeaturePin(featureId, pinned) {
  await sb.from('frfc_feature_requests').update({ is_pinned: pinned }).eq('id', featureId);
  renderFeatureDetail(featureId);
}

async function adminToggleFeatureLock(featureId, locked) {
  await sb.from('frfc_feature_requests').update({ is_locked: locked }).eq('id', featureId);
  renderFeatureDetail(featureId);
}

function adminDeleteFeatureRequest(featureId) {
  confirmDialog('Delete this feature request permanently?', async () => {
    await sb.from('frfc_feature_requests').delete().eq('id', featureId);
    navigate('/community/features');
  }, { title: 'Delete feature request', confirmLabel: 'Delete' });
}

async function adminMergeFeature(sourceId) {
  const targetId = document.getElementById('frMergeTarget')?.value.trim();
  const msg = document.getElementById('frAdminMsg');
  if (!targetId) { msg.textContent = 'Enter target feature ID.'; msg.style.color = 'var(--red)'; return; }
  const { error } = await sb.rpc('frfc_feature_merge', { p_source_id: sourceId, p_target_id: targetId });
  if (error) { msg.textContent = error.message || 'Merge failed.'; msg.style.color = 'var(--red)'; return; }
  msg.textContent = 'Merged! Redirecting...'; msg.style.color = 'var(--green)';
  setTimeout(() => navigate(`/community/features/${targetId}`), 800);
}

async function loadFeatureComments(featureId) {
  const { data } = await sb.from('frfc_feature_comments').select('*').eq('feature_id', featureId).order('created_at', { ascending: true });
  const comments = data || [];
  let userLikes = new Set();
  if (currentUser && comments.length) {
    const { data: likes } = await sb.from('frfc_feature_comment_likes').select('comment_id')
      .eq('user_id', currentUser.id).in('comment_id', comments.map(c => c.id));
    userLikes = new Set((likes || []).map(l => l.comment_id));
  }
  const topLevel = comments.filter(c => !c.parent_id);
  const replies = {};
  comments.filter(c => c.parent_id).forEach(c => { (replies[c.parent_id] = replies[c.parent_id] || []).push(c); });
  const list = document.getElementById('frCommentList');
  if (!list) return;
  if (!comments.length) { list.innerHTML = '<p style="color:var(--text-dim);font-size:.85rem">No comments yet. Be the first to share your thoughts!</p>'; return; }
  function renderComment(c, isReply = false) {
    const liked = userLikes.has(c.id);
    return `
      <div class="fr-comment ${isReply ? 'fr-comment--reply' : ''} ${c.is_official ? 'fr-comment--official' : ''}">
        <div class="fr-comment-header">
          ${c.is_official ? '<span class="fr-official-badge">Official</span>' : ''}
          <span class="fr-comment-time">${timeAgo(c.created_at)}</span>
        </div>
        <div class="fr-comment-body">${escHtml(c.body).replace(/\n/g, '<br>')}</div>
        <div class="fr-comment-actions">
          <button class="fr-like-btn ${liked ? 'fr-like-btn--active' : ''}" onclick="toggleCommentLike('${c.id}','${featureId}')" aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'} this comment">
            ${liked ? FR_ICONS.heartFilled : FR_ICONS.heartOutline} ${c.like_count}
          </button>
          ${!isReply && currentUser ? `<button class="fr-reply-btn" onclick="showReplyForm('${c.id}','${featureId}')">Reply</button>` : ''}
        </div>
        <div id="replyForm_${c.id}"></div>
        ${(replies[c.id] || []).map(rp => renderComment(rp, true)).join('')}
      </div>`;
  }
  list.innerHTML = topLevel.map(c => renderComment(c)).join('');
}

function showReplyForm(parentId, featureId) {
  const container = document.getElementById(`replyForm_${parentId}`);
  if (!container) return;
  if (container.innerHTML.trim()) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="fr-reply-form">
      <textarea id="replyBody_${parentId}" placeholder="Write a reply..." style="width:100%;min-height:50px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-family:inherit;font-size:.84rem;resize:vertical"></textarea>
      <button class="btn btn-primary btn-sm" style="margin-top:4px" onclick="postFeatureComment('${featureId}','${parentId}')">Reply</button>
    </div>`;
}

async function postFeatureComment(featureId, parentId) {
  if (!currentUser) { openModal('signin', 'comment'); return; }
  const isReply = !!parentId;
  const bodyEl = isReply ? document.getElementById(`replyBody_${parentId}`) : document.getElementById('frCommentBody');
  const body = bodyEl?.value.trim();
  const msg = document.getElementById('frCommentMsg');
  if (!body) { if (msg) { msg.textContent = 'Comment cannot be empty.'; msg.style.color = 'var(--red)'; } return; }
  // is_official and comment_count are derived server-side (trigger checks
  // frfc_admin_roles); the client just inserts the comment row.
  const { error } = await sb.from('frfc_feature_comments').insert({ feature_id: featureId, user_id: currentUser.id, parent_id: parentId || null, body });
  if (error) { if (msg) { msg.textContent = error.message || 'Failed to post comment.'; msg.style.color = 'var(--red)'; } return; }
  bodyEl.value = '';
  loadFeatureComments(featureId);
}

async function toggleCommentLike(commentId, featureId) {
  if (!currentUser) { openModal('signin', 'like'); return; }
  const btn = event.target.closest('.fr-like-btn');
  const isLiked = btn?.classList.contains('fr-like-btn--active');
  // like_count is maintained by a DB trigger on the likes table.
  if (isLiked) {
    await sb.from('frfc_feature_comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id);
  } else {
    await sb.from('frfc_feature_comment_likes').insert({ comment_id: commentId, user_id: currentUser.id });
  }
  loadFeatureComments(featureId);
}
