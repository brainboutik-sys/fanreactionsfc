/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Admin Panel
   Full back-office: dashboard, creator CRUD, reviews, users, settings
   Exposed on window.Admin
   ═══════════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

var adminRole = null;
var adminPage = 'dashboard';
var allCreators = [];
var allReviews = [];
var allSubmissions = [];
var allUsers = [];
var adminLog = [];
var creatorSearch = '';
var creatorSort = 'name';
var creatorPage = 0;
var reviewSearch = '';
var PAGE_SIZE = 25;

// ── Auth check ───────────────────────────────────────────────────────────────
async function checkAdmin() {
  const { data } = await sb.from('frfc_admin_roles').select('role').eq('user_id', currentUser?.id).single();
  adminRole = data?.role || null;
  return !!adminRole;
}

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type) {
  type = type || 'success';
  var el = document.getElementById('adminToast');
  if (!el) { el = document.createElement('div'); el.id = 'adminToast'; el.className = 'admin-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'admin-toast ' + type + ' visible';
  setTimeout(function() { el.classList.remove('visible'); }, 3000);
}

// ── Log action ───────────────────────────────────────────────────────────────
async function logAction(action, entityType, entityId, details) {
  await sb.from('frfc_admin_log').insert({ user_id: currentUser.id, action: action, entity_type: entityType, entity_id: entityId, details: details || null });
}

// ── Data loading ─────────────────────────────────────────────────────────────
async function loadAdminData() {
  var [creatorsRes, reviewsRes, logRes, subsRes] = await Promise.all([
    sb.from('frfc_streamers').select('*').order('name'),
    sb.from('frfc_reviews').select('*').order('created_at', { ascending: false }),
    sb.from('frfc_admin_log').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('frfc_submissions').select('*').order('submitted_at', { ascending: false })
  ]);
  allCreators = creatorsRes.data || [];
  allReviews = reviewsRes.data || [];
  adminLog = logRes.data || [];
  allSubmissions = subsRes.data || [];
}

// ── Render shell ─────────────────────────────────────────────────────────────
function renderHTML() {
  var navItems = [
    { id: 'dashboard', icon: '&#9632;', label: 'Dashboard' },
    { id: 'creators',  icon: '&#9733;', label: 'Creators', badge: allCreators.length },
    { id: 'submissions', icon: '&#9993;', label: 'Submissions', badge: allSubmissions.filter(function(s){return s.status==='pending'}).length || null },
    { id: 'reviews',   icon: '&#9998;', label: 'Reviews', badge: allReviews.length },
    { id: 'users',     icon: '&#9823;', label: 'Users' },
    { id: 'settings',  icon: '&#9881;', label: 'Settings' },
    { id: 'logs',      icon: '&#9776;', label: 'Activity Log' }
  ];

  return '<div class="admin-layout">' +
    '<aside class="admin-sidebar" id="adminSidebar">' +
      '<div class="admin-sidebar-header">' +
        '<div class="admin-sidebar-title">Admin Panel</div>' +
        '<div class="admin-sidebar-user">' + escHtml(currentUser?.email || '') + '</div>' +
      '</div>' +
      '<nav class="admin-nav">' +
        navItems.map(function(n) {
          return '<button class="admin-nav-item' + (adminPage === n.id ? ' active' : '') + '" onclick="Admin.go(\'' + n.id + '\')">' +
            '<span class="nav-icon">' + n.icon + '</span>' + n.label +
            (n.badge ? '<span class="nav-badge">' + n.badge + '</span>' : '') +
          '</button>';
        }).join('') +
        '<div class="admin-nav-sep"></div>' +
        '<div class="admin-nav-back"><a href="/" class="admin-nav-item" onclick="event.preventDefault();navigate(\'/\')"><span class="nav-icon">&#8592;</span>Back to Site</a></div>' +
      '</nav>' +
    '</aside>' +
    '<main class="admin-main" id="adminContent">' +
      '<button class="admin-toggle-sidebar" onclick="document.getElementById(\'adminSidebar\').classList.toggle(\'open\')">&#9776;</button>' +
    '</main>' +
  '</div>' +
  '<div class="admin-modal-overlay" id="adminModalOverlay" onclick="if(event.target===this)Admin.closeModal()"><div class="admin-modal" id="adminModal"></div></div>';
}

// ── Navigation ───────────────────────────────────────────────────────────────
function go(page) {
  adminPage = page;
  renderSidebar();
  renderPage();
}

function renderSidebar() {
  document.querySelectorAll('.admin-nav-item').forEach(function(el) {
    var page = el.getAttribute('onclick')?.match(/go\('(\w+)'\)/)?.[1];
    el.classList.toggle('active', page === adminPage);
  });
}

function renderPage() {
  var content = document.getElementById('adminContent');
  var toggle = '<button class="admin-toggle-sidebar" onclick="document.getElementById(\'adminSidebar\').classList.toggle(\'open\')">&#9776;</button>';
  if (adminPage === 'dashboard')  content.innerHTML = toggle + renderDashboard();
  else if (adminPage === 'creators') content.innerHTML = toggle + renderCreators();
  else if (adminPage === 'submissions') content.innerHTML = toggle + renderSubmissions();
  else if (adminPage === 'reviews')  content.innerHTML = toggle + renderReviews();
  else if (adminPage === 'users')    content.innerHTML = toggle + renderUsers();
  else if (adminPage === 'settings') content.innerHTML = toggle + renderSettings();
  else if (adminPage === 'logs')     content.innerHTML = toggle + renderLogs();
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function renderDashboard() {
  var totalSubs = allCreators.reduce(function(s, c) { return s + (c.subscriber_count || 0); }, 0);
  var totalViews = allCreators.reduce(function(s, c) { return s + (c.total_view_count || 0); }, 0);
  var liveCount = allCreators.filter(function(c) { return c.is_live; }).length;
  var activeCount = allCreators.filter(function(c) { return c.latest_video_date && (Date.now() - new Date(c.latest_video_date).getTime()) < 30*24*60*60*1000; }).length;
  var leagueCounts = {};
  allCreators.forEach(function(c) { var l = c.league || 'Other'; leagueCounts[l] = (leagueCounts[l] || 0) + 1; });
  var topByViews = allCreators.slice().sort(function(a, b) { return (b.total_view_count || 0) - (a.total_view_count || 0); }).slice(0, 5);

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Dashboard</h1><div class="admin-page-subtitle">Overview of FanReactionsFC platform</div></div></div>' +

  '<div class="admin-stats">' +
    stat('Creators', allCreators.length, 'In database') +
    stat('Reviews', allReviews.length, 'Total ratings') +
    stat('Total Subscribers', fmtBig(totalSubs), 'Across all creators') +
    stat('Total Views', fmtBig(totalViews), 'Lifetime channel views') +
    stat('Live Now', liveCount, liveCount ? 'Streaming' : 'No one live') +
    stat('Active (30d)', activeCount, 'Uploaded recently') +
  '</div>' +

  '<div class="admin-quick-actions">' +
    '<div class="admin-quick-action" onclick="Admin.go(\'creators\')"><span class="qa-icon">&#9733;</span><span class="qa-label">Manage Creators</span><span class="qa-desc">Add, edit, delete</span></div>' +
    '<div class="admin-quick-action" onclick="Admin.openAddCreator()"><span class="qa-icon">&#43;</span><span class="qa-label">Add Creator</span><span class="qa-desc">New YouTube channel</span></div>' +
    '<div class="admin-quick-action" onclick="Admin.go(\'reviews\')"><span class="qa-icon">&#9998;</span><span class="qa-label">Reviews</span><span class="qa-desc">Moderate content</span></div>' +
    '<div class="admin-quick-action" onclick="Admin.runSync()"><span class="qa-icon">&#8635;</span><span class="qa-label">YouTube Sync</span><span class="qa-desc">Refresh all data</span></div>' +
  '</div>' +

  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">'+
    '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Creators by League</span></div><div class="admin-card-body">' +
      Object.entries(leagueCounts).sort(function(a,b){return b[1]-a[1]}).map(function(e) {
        var pct = Math.round(e[1] / allCreators.length * 100);
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="width:120px;font-size:.82rem;font-weight:600">' + escHtml(e[0]) + '</span><div style="flex:1;height:8px;background:var(--bg-hover);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--navy);border-radius:4px"></div></div><span style="font-size:.78rem;color:var(--text-dim);width:40px;text-align:right">' + e[1] + '</span></div>';
      }).join('') +
    '</div></div>' +
    '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Top by Views</span></div><div class="admin-card-body no-pad">' +
      '<div class="admin-activity">' + topByViews.map(function(c) {
        return '<div class="admin-activity-item"><div class="admin-activity-dot create"></div><div class="admin-activity-text"><strong>' + escHtml(c.name) + '</strong> &middot; ' + escHtml(c.team || '') + '</div><div class="admin-activity-time">' + fmtBig(c.total_view_count || 0) + ' views</div></div>';
      }).join('') + '</div>' +
    '</div></div>' +
  '</div>' +

  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Recent Activity</span></div><div class="admin-card-body no-pad">' +
    renderActivityList(adminLog.slice(0, 10)) +
  '</div></div>';
}

function stat(label, value, sub) {
  return '<div class="admin-stat"><div class="admin-stat-label">' + label + '</div><div class="admin-stat-value">' + value + '</div><div class="admin-stat-sub">' + sub + '</div></div>';
}

function fmtBig(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

// ── Creators page ────────────────────────────────────────────────────────────
function renderCreators() {
  var filtered = allCreators.slice();
  if (creatorSearch) {
    var q = creatorSearch.toLowerCase();
    filtered = filtered.filter(function(c) { return c.name.toLowerCase().includes(q) || (c.team || '').toLowerCase().includes(q) || (c.league || '').toLowerCase().includes(q); });
  }
  if (creatorSort === 'name') filtered.sort(function(a,b){return a.name.localeCompare(b.name)});
  else if (creatorSort === 'subs') filtered.sort(function(a,b){return (b.subscriber_count||0)-(a.subscriber_count||0)});
  else if (creatorSort === 'views') filtered.sort(function(a,b){return (b.total_view_count||0)-(a.total_view_count||0)});
  else if (creatorSort === 'recent') filtered.sort(function(a,b){return new Date(b.updated_at||0)-new Date(a.updated_at||0)});

  var totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  var paged = filtered.slice(creatorPage * PAGE_SIZE, (creatorPage + 1) * PAGE_SIZE);

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Creators</h1><div class="admin-page-subtitle">' + allCreators.length + ' creators in database</div></div><div class="admin-page-actions"><button class="btn-admin btn-admin-primary" onclick="Admin.openAddCreator()">+ Add Creator</button></div></div>' +

  '<div class="admin-table-wrap">' +
    '<div class="admin-table-toolbar">' +
      '<input class="admin-table-search" placeholder="Search creators..." value="' + escHtml(creatorSearch) + '" oninput="Admin.searchCreators(this.value)">' +
      '<select class="admin-table-filter" onchange="Admin.sortCreators(this.value)"><option value="name"' + (creatorSort==='name'?' selected':'') + '>Name</option><option value="subs"' + (creatorSort==='subs'?' selected':'') + '>Subscribers</option><option value="views"' + (creatorSort==='views'?' selected':'') + '>Views</option><option value="recent"' + (creatorSort==='recent'?' selected':'') + '>Recent</option></select>' +
    '</div>' +
    '<table class="admin-table"><thead><tr><th>Creator</th><th>Team</th><th>League</th><th>Subs</th><th>Views</th><th>Frequency</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
    paged.map(function(c) {
      var avatarHtml = c.avatar_url ? '<img class="row-avatar" src="' + c.avatar_url + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="row-avatar avatar-fallback" style="width:32px;height:32px;font-size:.6rem">' + (c.name||'?').substring(0,2).toUpperCase() + '</div>';
      return '<tr>' +
        '<td><div style="display:flex;align-items:center;gap:10px">' + avatarHtml + '<div><div class="row-name">' + escHtml(c.name) + '</div><div class="row-dim">' + escHtml(c.channel_url || '') + '</div></div></div></td>' +
        '<td>' + escHtml(c.team || '') + '</td>' +
        '<td><span class="admin-badge admin-badge-dim">' + escHtml(c.league || 'Other') + '</span></td>' +
        '<td>' + fmtBig(c.subscriber_count || 0) + '</td>' +
        '<td>' + fmtBig(c.total_view_count || 0) + '</td>' +
        '<td>' + escHtml(c.upload_frequency || '—') + '</td>' +
        '<td>' + (c.verified ? '<span class="admin-badge admin-badge-green">Verified</span>' : '') + (c.is_live ? ' <span class="admin-badge admin-badge-red">LIVE</span>' : '') + (c.featured ? ' <span class="admin-badge admin-badge-yellow">Featured</span>' : '') + (!c.verified && !c.is_live && !c.featured ? '<span class="admin-badge admin-badge-dim">Standard</span>' : '') + '</td>' +
        '<td><div class="row-actions"><button class="btn-admin btn-admin-ghost" onclick="Admin.editCreator(\'' + c.id + '\')">Edit</button><button class="btn-admin btn-admin-danger" onclick="Admin.deleteCreator(\'' + c.id + '\',\'' + escHtml(c.name).replace(/'/g,"\\'") + '\')">Del</button></div></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>' +
    '<div class="admin-table-footer"><span>Showing ' + (creatorPage*PAGE_SIZE+1) + '-' + Math.min((creatorPage+1)*PAGE_SIZE, filtered.length) + ' of ' + filtered.length + '</span><div class="admin-pagination">' +
      (creatorPage > 0 ? '<button onclick="Admin.creatorPrev()">Prev</button>' : '') +
      Array.from({length:Math.min(totalPages,5)},function(_,i){return '<button class="' + (i===creatorPage?'active':'') + '" onclick="Admin.creatorGoPage(' + i + ')">' + (i+1) + '</button>';}).join('') +
      (creatorPage < totalPages-1 ? '<button onclick="Admin.creatorNext()">Next</button>' : '') +
    '</div></div>' +
  '</div>';
}

var _searchTimer = null;
function searchCreators(q) {
  creatorSearch = q; creatorPage = 0;
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() {
    var el = document.querySelector('.admin-table-search');
    var pos = el ? el.selectionStart : 0;
    renderPage();
    var el2 = document.querySelector('.admin-table-search');
    if (el2) { el2.focus(); el2.setSelectionRange(pos, pos); }
  }, 150);
}
function sortCreators(s) { creatorSort = s; creatorPage = 0; renderPage(); }
function creatorGoPage(p) { creatorPage = p; renderPage(); }
function creatorPrev() { if (creatorPage > 0) { creatorPage--; renderPage(); } }
function creatorNext() { creatorPage++; renderPage(); }

// ── Creator CRUD ─────────────────────────────────────────────────────────────
function openAddCreator() {
  openCreatorForm(null);
}

function editCreator(id) {
  var c = allCreators.find(function(x){return x.id===id});
  if (c) openCreatorForm(c);
}

function buildTeamSelect(selectedLeague, selectedTeam) {
  var leagues = ['Premier League','Championship','La Liga','Serie A','Bundesliga','Ligue 1'];
  var teamsByLeague = {};
  // Build from TEAM_TO_LEAGUE (app.js global)
  Object.entries(TEAM_TO_LEAGUE).forEach(function(e) {
    var team = e[0], league = e[1];
    if (!teamsByLeague[league]) teamsByLeague[league] = [];
    teamsByLeague[league].push(team);
  });
  // Add Multi-Club / Other
  teamsByLeague['Other'] = ['Multi-Club / Other'];
  // Sort teams within each league
  Object.keys(teamsByLeague).forEach(function(l) { teamsByLeague[l].sort(); });

  var html = '<option value="">Select team...</option>';
  var leagueOrder = selectedLeague ? [selectedLeague] : leagues.concat(['Other']);
  if (selectedLeague) leagueOrder.push('Other');

  leagueOrder.forEach(function(l) {
    var teams = teamsByLeague[l];
    if (!teams || !teams.length) return;
    html += '<optgroup label="' + l + '">';
    teams.forEach(function(t) {
      html += '<option value="' + escHtml(t) + '"' + (t === selectedTeam ? ' selected' : '') + '>' + escHtml(t) + '</option>';
    });
    html += '</optgroup>';
  });
  return html;
}

function onLeagueChange() {
  var league = document.getElementById('cf_league').value;
  var teamSel = document.getElementById('cf_team');
  var curTeam = teamSel.value;
  teamSel.innerHTML = buildTeamSelect(league, curTeam);
}

function openCreatorForm(c) {
  var isEdit = !!c;
  var modal = document.getElementById('adminModal');
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()">&times;</button>' +
    '<div class="admin-modal-title">' + (isEdit ? 'Edit Creator' : 'Add Creator') + '</div>' +
    '<div class="admin-modal-sub">' + (isEdit ? 'Update ' + escHtml(c.name) : 'Add a new YouTube creator to the database') + '</div>' +
    formField('Channel Name', 'cf_name', c?.name || '') +
    formField('Channel URL', 'cf_channel', c?.channel_url || '') +
    '<div class="admin-form-grid">' +
      formField('League', 'cf_league', c?.league || '', 'select', ['Premier League','Championship','La Liga','Serie A','Bundesliga','Ligue 1'], 'Admin.onLeagueChange()') +
      '<div class="admin-form-row"><label class="admin-form-label" for="cf_team">Team</label><select class="admin-form-select" id="cf_team">' + buildTeamSelect(c?.league || '', c?.team || '') + '</select></div>' +
    '</div>' +
    '<div class="admin-form-grid">' +
      formCheck('Verified', 'cf_verified', c?.verified) +
      formCheck('Featured', 'cf_featured', c?.featured) +
    '</div>' +
    '<div class="admin-form-actions">' +
      '<button class="btn-admin btn-admin-ghost" onclick="Admin.closeModal()">Cancel</button>' +
      '<button class="btn-admin btn-admin-primary" onclick="Admin.saveCreator(\'' + (c?.id || '') + '\')">' + (isEdit ? 'Save Changes' : 'Add Creator') + '</button>' +
    '</div>';
  document.getElementById('adminModalOverlay').classList.add('open');
}

async function saveCreator(id) {
  var channelUrl = document.getElementById('cf_channel').value.trim();
  var name = document.getElementById('cf_name').value.trim();
  // Auto-generate live_url from channel_url (append /streams)
  var liveUrl = channelUrl ? channelUrl.replace(/\/+$/, '') + '/streams' : null;
  var data = {
    name: name,
    team: document.getElementById('cf_team').value,
    channel_url: channelUrl,
    league: document.getElementById('cf_league').value,
    slug: slugify(name),
    live_url: liveUrl,
    verified: document.getElementById('cf_verified').checked,
    featured: document.getElementById('cf_featured').checked,
    updated_at: new Date().toISOString()
  };
  if (!data.name) { toast('Channel name is required', 'error'); return; }
  if (!data.team) { toast('Team is required', 'error'); return; }

  var err;
  if (id) {
    var res = await sb.from('frfc_streamers').update(data).eq('id', id);
    err = res.error;
    if (!err) await logAction('update', 'creator', id, { name: data.name });
  } else {
    data.created_by = currentUser.id;
    var res = await sb.from('frfc_streamers').insert(data).select();
    err = res.error;
    if (!err) await logAction('create', 'creator', res.data?.[0]?.id, { name: data.name });
  }

  if (err) { toast(err.message, 'error'); return; }
  toast(id ? 'Creator updated' : 'Creator added', 'success');
  closeModal();
  await loadAdminData();
  renderPage();
}

async function deleteCreator(id, name) {
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  var { error } = await sb.from('frfc_streamers').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  await logAction('delete', 'creator', id, { name: name });
  toast('Creator deleted', 'success');
  await loadAdminData();
  renderPage();
}

// ── Submissions page ─────────────────────────────────────────────────────────
function renderSubmissions() {
  var pending = allSubmissions.filter(function(s){return s.status==='pending'});
  var reviewed = allSubmissions.filter(function(s){return s.status!=='pending'});

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Submissions</h1><div class="admin-page-subtitle">' + pending.length + ' pending review</div></div></div>' +

  (pending.length ? '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Pending Review</span></div><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Channel Name</th><th>Channel URL</th><th>Team</th><th>League</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>' +
    pending.map(function(s) {
      return '<tr>' +
        '<td class="row-name">' + escHtml(s.name) + '</td>' +
        '<td><a href="' + escHtml(s.channel_url) + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:.82rem">' + escHtml(s.channel_url).substring(0, 40) + '...</a></td>' +
        '<td>' + escHtml(s.team) + '</td>' +
        '<td><span class="admin-badge admin-badge-dim">' + escHtml(s.league) + '</span></td>' +
        '<td class="row-dim">' + timeAgo(s.submitted_at) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn-admin btn-admin-success" onclick="Admin.approveSubmission(\'' + s.id + '\')">Approve</button>' +
          '<button class="btn-admin btn-admin-danger" onclick="Admin.rejectSubmission(\'' + s.id + '\')">Reject</button>' +
        '</div></td></tr>';
    }).join('') +
  '</tbody></table></div></div>' : '<div class="admin-card"><div class="admin-card-body" style="text-align:center;color:var(--text-dim);padding:32px">No pending submissions</div></div>') +

  (reviewed.length ? '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Previously Reviewed</span></div><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Channel</th><th>Team</th><th>Status</th><th>Reviewed</th></tr></thead><tbody>' +
    reviewed.slice(0, 20).map(function(s) {
      return '<tr><td class="row-name">' + escHtml(s.name) + '</td><td>' + escHtml(s.team) + '</td><td>' +
        (s.status === 'approved' ? '<span class="admin-badge admin-badge-green">Approved</span>' : '<span class="admin-badge admin-badge-red">Rejected</span>') +
        '</td><td class="row-dim">' + (s.reviewed_at ? timeAgo(s.reviewed_at) : '—') + '</td></tr>';
    }).join('') +
  '</tbody></table></div></div>' : '');
}

async function approveSubmission(id) {
  var s = allSubmissions.find(function(x){return x.id===id});
  if (!s) return;

  // Create the creator in frfc_streamers
  var slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  var liveUrl = s.channel_url ? s.channel_url.replace(/\/+$/, '') + '/streams' : null;
  var { error } = await sb.from('frfc_streamers').insert({
    name: s.name,
    channel_url: s.channel_url,
    team: s.team,
    league: s.league,
    slug: slug,
    live_url: liveUrl,
    created_by: currentUser.id
  });
  if (error) { toast('Failed to create creator: ' + error.message, 'error'); return; }

  // Mark submission as approved
  await sb.from('frfc_submissions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id }).eq('id', id);
  await logAction('approve', 'submission', id, { name: s.name });
  toast(s.name + ' approved and added to database', 'success');
  await loadAdminData();
  renderPage();
}

async function rejectSubmission(id) {
  var s = allSubmissions.find(function(x){return x.id===id});
  if (!s) return;
  if (!confirm('Reject submission "' + s.name + '"?')) return;

  await sb.from('frfc_submissions').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id }).eq('id', id);
  await logAction('reject', 'submission', id, { name: s.name });
  toast(s.name + ' rejected', 'info');
  await loadAdminData();
  renderPage();
}

// ── Reviews page ─────────────────────────────────────────────────────────────
function renderReviews() {
  var filtered = allReviews.slice();
  if (reviewSearch) {
    var q = reviewSearch.toLowerCase();
    filtered = filtered.filter(function(r) {
      var creator = allCreators.find(function(c){return c.id===r.creator_id});
      return (r.review_text || '').toLowerCase().includes(q) || (creator?.name || '').toLowerCase().includes(q);
    });
  }

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Reviews</h1><div class="admin-page-subtitle">' + allReviews.length + ' total reviews</div></div></div>' +
  '<div class="admin-table-wrap">' +
    '<div class="admin-table-toolbar"><input class="admin-table-search" placeholder="Search reviews..." value="' + escHtml(reviewSearch) + '" oninput="Admin.searchReviews(this.value)"></div>' +
    '<table class="admin-table"><thead><tr><th>Creator</th><th>Rating</th><th>Review</th><th>Date</th><th>Actions</th></tr></thead><tbody>' +
    filtered.map(function(r) {
      var creator = allCreators.find(function(c){return c.id===r.creator_id});
      return '<tr><td class="row-name">' + escHtml(creator?.name || 'Unknown') + '</td>' +
        '<td>' + '★'.repeat(r.rating) + '<span style="color:var(--border)">' + '★'.repeat(5-r.rating) + '</span></td>' +
        '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.review_text || '—') + '</td>' +
        '<td class="row-dim">' + new Date(r.created_at).toLocaleDateString() + '</td>' +
        '<td><button class="btn-admin btn-admin-danger" onclick="Admin.deleteReview(\'' + r.id + '\')">Delete</button></td></tr>';
    }).join('') +
    (filtered.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:24px">No reviews yet</td></tr>' : '') +
    '</tbody></table></div>';
}

function searchReviews(q) { reviewSearch = q; renderPage(); }

async function deleteReview(id) {
  if (!confirm('Delete this review?')) return;
  var { error } = await sb.from('frfc_reviews').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  await logAction('delete', 'review', id);
  toast('Review deleted', 'success');
  await loadAdminData();
  renderPage();
}

// ── Users page ───────────────────────────────────────────────────────────────
function renderUsers() {
  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Users</h1><div class="admin-page-subtitle">Registered users and favorites</div></div></div>' +
  '<div class="admin-stats">' +
    stat('Auth Provider', 'Supabase Auth', 'Email/password') +
    stat('Admin Users', '1', 'super_admin role') +
  '</div>' +
  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">User Management</span></div><div class="admin-card-body">' +
    '<p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">User accounts are managed through Supabase Auth. Favorites and reviews are linked to auth.users via foreign keys.</p>' +
    '<a href="https://supabase.com/dashboard/project/dsxijgrpxsfywxuffbmt/auth/users" target="_blank" rel="noopener" class="btn-admin btn-admin-primary">Open Supabase Auth Dashboard</a>' +
  '</div></div>';
}

// ── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Settings</h1><div class="admin-page-subtitle">Platform configuration</div></div></div>' +
  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">YouTube API</span></div><div class="admin-card-body">' +
    '<div class="admin-form-row"><div class="admin-form-label">API Key</div><div style="font-size:.85rem;color:var(--text-dim);font-family:monospace">AIza...xcNA (configured in scripts)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Daily Quota</div><div style="font-size:.85rem">10,000 units/day (YouTube Data API v3)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Last Sync</div><div style="font-size:.85rem">' + getLastSync() + '</div></div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-top:8px"><button class="btn-admin btn-admin-primary" onclick="Admin.runSync()">Run YouTube Sync Now</button><span id="syncStatus" style="font-size:.82rem;color:var(--text-dim)"></span></div>' +
  '</div></div>' +

  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Platform Info</span></div><div class="admin-card-body">' +
    '<div class="admin-form-row"><div class="admin-form-label">Site URL</div><div style="font-size:.85rem">fanreactionsfc.com</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Hosting</div><div style="font-size:.85rem">Netlify (site ID: a845b6ad-3669-4634-b5df-f757ac227b71)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Database</div><div style="font-size:.85rem">Supabase (dsxijgrpxsfywxuffbmt)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Stack</div><div style="font-size:.85rem">Static SPA (HTML/CSS/JS), Supabase Postgres, YouTube Data API v3</div></div>' +
  '</div></div>' +

  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Danger Zone</span></div><div class="admin-card-body">' +
    '<button class="btn-admin btn-admin-danger" onclick="Admin.resetAllLive()">Reset All Live Status</button>' +
    ' <button class="btn-admin btn-admin-danger" onclick="Admin.clearAllReviews()">Clear All Reviews</button>' +
  '</div></div>';
}

function getLastSync() {
  var synced = allCreators.filter(function(c){return c.last_youtube_sync}).sort(function(a,b){return new Date(b.last_youtube_sync)-new Date(a.last_youtube_sync)});
  if (!synced.length) return 'Never';
  return timeAgo(synced[0].last_youtube_sync);
}

// ── In-browser YouTube Sync (via server-side proxy) ─────────────────────────
var syncRunning = false;

async function ytFetch(endpoint, params) {
  params.endpoint = endpoint;
  var url = '/.netlify/functions/youtube-proxy?' + new URLSearchParams(params);
  var res = await fetch(url);
  if (!res.ok) { var e = await res.json().catch(function(){return {}}); throw new Error(e.error?.message || res.statusText); }
  return res.json();
}

async function runSync() {
  if (syncRunning) { toast('Sync already running', 'info'); return; }
  syncRunning = true;
  toast('YouTube sync started...', 'info');

  var statusEl = document.getElementById('syncStatus');
  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  try {
    var total = allCreators.length;
    var ok = 0, fail = 0, quota = 0;

    for (var i = 0; i < allCreators.length; i++) {
      var c = allCreators[i];
      var handle = (c.channel_url || '').match(/@([A-Za-z0-9_.-]+)/);
      if (!handle) { fail++; continue; }
      handle = handle[1];
      setStatus('Syncing ' + (i+1) + '/' + total + ': ' + c.name);

      try {
        // 1. Channel stats
        quota += 5;
        var chData = await ytFetch('channels', { forHandle: handle, part: 'snippet,statistics,contentDetails' });
        var ch = chData.items?.[0];
        if (!ch) { fail++; continue; }

        var stats = ch.statistics || {};
        var snippet = ch.snippet || {};
        var uploadsPlaylist = ch.contentDetails?.relatedPlaylists?.uploads;

        var update = {
          youtube_channel_id: ch.id,
          subscriber_count: parseInt(stats.subscriberCount) || 0,
          total_view_count: parseInt(stats.viewCount) || 0,
          video_count: parseInt(stats.videoCount) || 0,
          channel_created_at: snippet.publishedAt || null,
          avatar_url: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || c.avatar_url,
          channel_country: snippet.country || null,
          is_live: false,
          live_video_id: null,
          last_youtube_sync: new Date().toISOString()
        };

        // 2. Latest videos from uploads playlist
        if (uploadsPlaylist) {
          try {
            quota += 3;
            var plData = await ytFetch('playlistItems', { playlistId: uploadsPlaylist, part: 'snippet', maxResults: 5 });
            var vids = (plData.items || []).map(function(item) {
              return { videoId: item.snippet?.resourceId?.videoId, publishedAt: item.snippet?.publishedAt, title: item.snippet?.title || '' };
            }).filter(function(v) { return v.videoId; });

            if (vids.length) {
              var latest = vids[0];
              update.latest_video_id = latest.videoId;
              update.latest_video_title = latest.title;
              update.latest_video_date = latest.publishedAt;
              update.latest_video_thumbnail = 'https://i.ytimg.com/vi/' + latest.videoId + '/mqdefault.jpg';

              // Get view count for latest video
              try {
                quota += 7;
                var vidData = await ytFetch('videos', { id: latest.videoId, part: 'statistics,liveStreamingDetails' });
                var vidDetail = vidData.items?.[0];
                if (vidDetail) {
                  update.latest_video_views = parseInt(vidDetail.statistics?.viewCount) || 0;
                  if (vidDetail.liveStreamingDetails?.actualStartTime && !vidDetail.liveStreamingDetails?.actualEndTime) {
                    update.is_live = true;
                    update.live_video_id = latest.videoId;
                  }
                }
              } catch(e) { /* video detail fetch failed, continue */ }

              // Upload frequency
              var dates = vids.map(function(v){return v.publishedAt}).filter(Boolean);
              if (dates.length >= 2) {
                var sorted = dates.map(function(d){return new Date(d).getTime()}).sort(function(a,b){return b-a});
                var gaps = [];
                for (var g = 0; g < sorted.length-1; g++) gaps.push((sorted[g]-sorted[g+1])/86400000);
                var avg = gaps.reduce(function(a,b){return a+b},0)/gaps.length;
                update.upload_frequency = avg<2?'Daily':avg<2.5?'5x/week':avg<3.5?'3x/week':avg<5?'2x/week':avg<10?'Weekly':avg<20?'Biweekly':avg<45?'Monthly':'Inactive';
              }
            }
          } catch(e) { /* playlist fetch failed, continue with channel data */ }
        }

        // 3. Write to Supabase
        await sb.from('frfc_streamers').update(update).eq('id', c.id);

        // 4. Subscriber history
        if (update.subscriber_count > 0) {
          await sb.from('frfc_subscriber_history').insert({ creator_id: c.id, subscriber_count: update.subscriber_count });
        }

        ok++;
      } catch(e) {
        fail++;
      }
    }

    await logAction('sync', 'youtube', null, { ok: ok, fail: fail, quota: quota });
    toast('Sync complete: ' + ok + ' updated, ' + fail + ' failed (~' + quota + ' quota)', 'success');
    await loadAdminData();
    renderPage();
  } catch(e) {
    toast('Sync error: ' + e.message, 'error');
  } finally {
    syncRunning = false;
  }
}

async function resetAllLive() {
  if (!confirm('Reset is_live to false for all creators?')) return;
  var { error } = await sb.from('frfc_streamers').update({ is_live: false, live_video_id: null }).neq('is_live', false);
  if (error) { toast(error.message, 'error'); return; }
  await logAction('update', 'settings', null, { action: 'reset_all_live' });
  toast('All live statuses reset', 'success');
  await loadAdminData();
  renderPage();
}

async function clearAllReviews() {
  if (!confirm('DELETE ALL REVIEWS? This cannot be undone!')) return;
  if (!confirm('Are you absolutely sure?')) return;
  var { error } = await sb.from('frfc_reviews').delete().gte('created_at', '2000-01-01');
  if (error) { toast(error.message, 'error'); return; }
  await logAction('delete', 'reviews', null, { action: 'clear_all' });
  toast('All reviews deleted', 'success');
  await loadAdminData();
  renderPage();
}

// ── Activity Log ─────────────────────────────────────────────────────────────
function renderLogs() {
  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Activity Log</h1><div class="admin-page-subtitle">Admin actions history</div></div></div>' +
  '<div class="admin-card"><div class="admin-card-body no-pad">' +
    renderActivityList(adminLog) +
    (adminLog.length === 0 ? '<div style="text-align:center;padding:24px;color:var(--text-dim)">No activity recorded yet</div>' : '') +
  '</div></div>';
}

function renderActivityList(items) {
  return '<div class="admin-activity">' + items.map(function(log) {
    var dotClass = log.action === 'create' ? 'create' : log.action === 'delete' ? 'delete' : log.action === 'sync' ? 'sync' : 'update';
    var desc = '<strong>' + escHtml(log.action) + '</strong>';
    if (log.entity_type) desc += ' ' + escHtml(log.entity_type);
    if (log.details?.name) desc += ' &mdash; ' + escHtml(log.details.name);
    return '<div class="admin-activity-item"><div class="admin-activity-dot ' + dotClass + '"></div><div class="admin-activity-text">' + desc + '</div><div class="admin-activity-time">' + timeAgo(log.created_at) + '</div></div>';
  }).join('') + '</div>';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formField(label, id, value, type, options, onchange) {
  type = type || 'text';
  var html = '<div class="admin-form-row"><label class="admin-form-label" for="' + id + '">' + label + '</label>';
  if (type === 'select') {
    html += '<select class="admin-form-select" id="' + id + '"' + (onchange ? ' onchange="' + onchange + '"' : '') + '>' + (options||[]).map(function(o){return '<option' + (o===value?' selected':'') + '>' + o + '</option>';}).join('') + '</select>';
  } else if (type === 'textarea') {
    html += '<textarea class="admin-form-input" id="' + id + '" rows="3" style="resize:vertical">' + escHtml(value) + '</textarea>';
  } else {
    html += '<input class="admin-form-input" id="' + id + '" type="text" value="' + escHtml(value) + '">';
  }
  return html + '</div>';
}

function formCheck(label, id, checked) {
  return '<div class="admin-form-row"><label class="admin-form-check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> ' + label + '</label></div>';
}

function closeModal() {
  document.getElementById('adminModalOverlay')?.classList.remove('open');
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadAdminData();
  renderPage();
}

// ── Public API ───────────────────────────────────────────────────────────────
window.Admin = {
  checkAdmin: checkAdmin,
  renderHTML: renderHTML,
  init: init,
  go: go,
  openAddCreator: openAddCreator,
  editCreator: editCreator,
  onLeagueChange: onLeagueChange,
  saveCreator: saveCreator,
  deleteCreator: deleteCreator,
  searchCreators: searchCreators,
  sortCreators: sortCreators,
  creatorGoPage: creatorGoPage,
  creatorPrev: creatorPrev,
  creatorNext: creatorNext,
  approveSubmission: approveSubmission,
  rejectSubmission: rejectSubmission,
  searchReviews: searchReviews,
  deleteReview: deleteReview,
  runSync: runSync,
  resetAllLive: resetAllLive,
  clearAllReviews: clearAllReviews,
  closeModal: closeModal,
  toast: toast
};

})();
