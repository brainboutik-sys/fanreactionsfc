/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Admin Panel
   Full back-office: dashboard, creator CRUD, submissions, users, settings
   Exposed on window.Admin
   ═══════════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

var adminRole = null;
var adminPage = 'dashboard';
var allCreators = [];
var allSubmissions = [];
var allArticles = [];
var allCandidates = [];
var allUsers = [];
var allRoles = [];
var adminLog = [];
var creatorSearch = '';
var creatorSort = 'name';
var creatorPage = 0;
var PAGE_SIZE = 25;
var currentPermissions = {}; // permission key -> true, for the signed-in user's role

// ── Auth check ───────────────────────────────────────────────────────────────
async function checkAdmin() {
  const { data } = await sb.from('frfc_admin_roles').select('role').eq('user_id', currentUser?.id).single();
  adminRole = data?.role || null;
  return !!adminRole;
}

// Loads the signed-in user's own permission set. This is a cosmetic
// convenience only — every permission-gated action is enforced server-side
// (RLS policies via frfc_has_permission(), or a Netlify function checking
// the same), so hiding a button here never IS the security boundary, it
// just avoids showing controls that would fail anyway.
async function loadPermissions() {
  currentPermissions = {};
  var roleRes = await sb.from('frfc_admin_roles').select('role').eq('user_id', currentUser.id).single();
  adminRole = roleRes.data ? roleRes.data.role : null;
  if (!adminRole) return;
  var res = await sb.from('frfc_role_permissions').select('permission_key').eq('role_slug', adminRole);
  (res.data || []).forEach(function(p) { currentPermissions[p.permission_key] = true; });
}

function can(permission) { return !!currentPermissions[permission]; }

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
  var [creatorsRes, logRes, subsRes, articlesRes, candidatesRes, rolesRes] = await Promise.all([
    sb.from('frfc_streamers').select('*').order('name'),
    sb.from('frfc_admin_log').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('frfc_submissions').select('*').order('submitted_at', { ascending: false }),
    sb.from('frfc_articles').select('*').order('updated_at', { ascending: false }),
    sb.from('frfc_story_candidates').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('frfc_roles').select('*').order('name')
  ]);
  allCreators = creatorsRes.data || [];
  adminLog = logRes.data || [];
  allSubmissions = subsRes.data || [];
  allArticles = articlesRes.data || [];
  allCandidates = candidatesRes.data || [];
  allRoles = rolesRes.data || [];
}

// ── Render shell ─────────────────────────────────────────────────────────────
// Nav items with a required permission are hidden until loadPermissions()
// has run — at renderHTML() time (before Admin.init()) currentPermissions
// is still empty, so those tabs are absent on first paint and appear once
// refreshNav() re-renders after permissions load. This is cosmetic only;
// the actual gate for every one of these pages' actions is server-side.
function navItems() {
  return [
    { id: 'dashboard', icon: '&#9632;', label: 'Dashboard' },
    { id: 'creators',  icon: '&#9733;', label: 'Creators', badge: allCreators.length },
    { id: 'submissions', icon: '&#9993;', label: 'Submissions', badge: allSubmissions.filter(function(s){return s.status==='pending'}).length || null },
    { id: 'news',      icon: '&#9998;', label: 'News', badge: allArticles.filter(function(a){return a.status==='draft'}).length || null },
    { id: 'queue',     icon: '&#9873;', label: 'Editorial Queue', badge: allCandidates.filter(function(c){return c.status==='evidence_ready' || c.status==='review_ready'}).length || null, permission: 'editorial_queue.manage' },
    { id: 'health',    icon: '&#9877;', label: 'Health', permission: 'health.view' },
    { id: 'users',     icon: '&#9823;', label: 'Users', permission: 'users.view' },
    { id: 'roles',     icon: '&#9878;', label: 'Roles', permission: 'roles.view' },
    { id: 'settings',  icon: '&#9881;', label: 'Settings', permission: 'settings.manage' },
    { id: 'logs',      icon: '&#9776;', label: 'Activity Log', permission: 'logs.view' }
  ].filter(function(n) { return !n.permission || can(n.permission); });
}

function renderNavHTML() {
  return navItems().map(function(n) {
    return '<button class="admin-nav-item' + (adminPage === n.id ? ' active' : '') + '" onclick="Admin.go(\'' + n.id + '\')">' +
      '<span class="nav-icon">' + n.icon + '</span>' + n.label +
      (n.badge ? '<span class="nav-badge">' + n.badge + '</span>' : '') +
    '</button>';
  }).join('') +
  '<div class="admin-nav-sep"></div>' +
  '<div class="admin-nav-back"><a href="/" class="admin-nav-item" onclick="event.preventDefault();navigate(\'/\')"><span class="nav-icon">&#8592;</span>Back to Site</a></div>';
}

// Re-renders the sidebar nav once permissions have loaded (see init()).
function refreshNav() {
  var nav = document.querySelector('.admin-nav');
  if (nav) nav.innerHTML = renderNavHTML();
}

function renderHTML() {
  return '<div class="admin-layout">' +
    '<aside class="admin-sidebar" id="adminSidebar">' +
      '<div class="admin-sidebar-header">' +
        '<div class="admin-sidebar-title">Admin Panel</div>' +
        '<div class="admin-sidebar-user">' + escHtml(currentUser?.email || '') + '</div>' +
      '</div>' +
      '<nav class="admin-nav">' + renderNavHTML() + '</nav>' +
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

// Pages gated on a permission — if the current page requires one the user
// doesn't have (e.g. reached via a stale bookmark or direct Admin.go()
// call), show a plain access-denied message instead of attempting to load
// data the server will reject anyway.
var PAGE_PERMISSIONS = { queue: 'editorial_queue.manage', health: 'health.view', users: 'users.view', roles: 'roles.view', settings: 'settings.manage', logs: 'logs.view' };

function renderPage() {
  var content = document.getElementById('adminContent');
  var toggle = '<button class="admin-toggle-sidebar" onclick="document.getElementById(\'adminSidebar\').classList.toggle(\'open\')">&#9776;</button>';
  var requiredPermission = PAGE_PERMISSIONS[adminPage];
  if (requiredPermission && !can(requiredPermission)) {
    content.innerHTML = toggle + '<div class="admin-page-header"><div><h1 class="admin-page-title">Access Denied</h1><div class="admin-page-subtitle">Your role doesn\'t include the &ldquo;' + requiredPermission + '&rdquo; permission.</div></div></div>';
    return;
  }
  if (adminPage === 'dashboard')  content.innerHTML = toggle + renderDashboard();
  else if (adminPage === 'creators') content.innerHTML = toggle + renderCreators();
  else if (adminPage === 'submissions') content.innerHTML = toggle + renderSubmissions();
  else if (adminPage === 'news')     content.innerHTML = toggle + renderNews();
  else if (adminPage === 'queue')    content.innerHTML = toggle + renderQueue();
  else if (adminPage === 'health')   { content.innerHTML = toggle + '<div class="admin-page-header"><div><h1 class="admin-page-title">Health</h1><div class="admin-page-subtitle">Loading…</div></div></div>'; loadAndRenderHealth(); }
  else if (adminPage === 'users')    { content.innerHTML = toggle + '<div class="admin-page-header"><div><h1 class="admin-page-title">Users</h1><div class="admin-page-subtitle">Loading…</div></div></div>'; loadAndRenderUsers(); }
  else if (adminPage === 'roles')    { content.innerHTML = toggle + '<div class="admin-page-header"><div><h1 class="admin-page-title">Roles</h1><div class="admin-page-subtitle">Loading…</div></div></div>'; loadAndRenderRoles(); }
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
    stat('Total Subscribers', formatNum(totalSubs), 'Across all creators') +
    stat('Total Views', formatNum(totalViews), 'Lifetime channel views') +
    stat('Live Now', liveCount, liveCount ? 'Streaming' : 'No one live') +
    stat('Active (30d)', activeCount, 'Uploaded recently') +
  '</div>' +

  '<div class="admin-quick-actions">' +
    '<div class="admin-quick-action" onclick="Admin.go(\'creators\')" role="button" tabindex="0"><span class="qa-icon">&#9733;</span><span class="qa-label">Manage Creators</span><span class="qa-desc">Add, edit, delete</span></div>' +
    '<div class="admin-quick-action" onclick="Admin.openAddCreator()" role="button" tabindex="0"><span class="qa-icon">&#43;</span><span class="qa-label">Add Creator</span><span class="qa-desc">New YouTube channel</span></div>' +
    '<div class="admin-quick-action" onclick="Admin.go(\'submissions\')" role="button" tabindex="0"><span class="qa-icon">&#9993;</span><span class="qa-label">Submissions</span><span class="qa-desc">Review pending</span></div>' +
    '<div class="admin-quick-action" onclick="Admin.runSync()" role="button" tabindex="0"><span class="qa-icon">&#8635;</span><span class="qa-label">YouTube Sync</span><span class="qa-desc">Refresh all data</span></div>' +
  '</div>' +

  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">'+
    '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Creators by League</span></div><div class="admin-card-body">' +
      Object.entries(leagueCounts).sort(function(a,b){return b[1]-a[1]}).map(function(e) {
        var pct = Math.round(e[1] / allCreators.length * 100);
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="width:120px;font-size:var(--fs-sm);font-weight:600">' + escHtml(e[0]) + '</span><div style="flex:1;height:8px;background:var(--bg-hover);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--navy);border-radius:4px"></div></div><span style="font-size:var(--fs-sm);color:var(--text-dim);width:40px;text-align:right">' + e[1] + '</span></div>';
      }).join('') +
    '</div></div>' +
    '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Top by Views</span></div><div class="admin-card-body no-pad">' +
      '<div class="admin-activity">' + topByViews.map(function(c) {
        return '<div class="admin-activity-item"><div class="admin-activity-dot create"></div><div class="admin-activity-text"><strong>' + escHtml(c.name) + '</strong> &middot; ' + escHtml(c.team || '') + '</div><div class="admin-activity-time">' + formatNum(c.total_view_count || 0) + ' views</div></div>';
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

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Creators</h1><div class="admin-page-subtitle">' + allCreators.length + ' creators in database</div></div><div class="admin-page-actions">' + (can('creators.create') ? '<button class="btn-admin btn-admin-primary" onclick="Admin.openAddCreator()">+ Add Creator</button>' : '') + '</div></div>' +

  '<div class="admin-table-wrap">' +
    '<div class="admin-table-toolbar">' +
      '<input class="admin-table-search" placeholder="Search creators..." value="' + escHtml(creatorSearch) + '" oninput="Admin.searchCreators(this.value)">' +
      '<select class="admin-table-filter" onchange="Admin.sortCreators(this.value)"><option value="name"' + (creatorSort==='name'?' selected':'') + '>Name</option><option value="subs"' + (creatorSort==='subs'?' selected':'') + '>Subscribers</option><option value="views"' + (creatorSort==='views'?' selected':'') + '>Views</option><option value="recent"' + (creatorSort==='recent'?' selected':'') + '>Recent</option></select>' +
    '</div>' +
    '<table class="admin-table"><thead><tr><th>Creator</th><th>Team</th><th>League</th><th>Subs</th><th>Views</th><th>Frequency</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
    paged.map(function(c) {
      var avatarHtml = c.avatar_url ? '<img class="row-avatar" src="' + c.avatar_url + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="row-avatar avatar-fallback" style="width:32px;height:32px;font-size:var(--fs-xs)">' + (c.name||'?').substring(0,2).toUpperCase() + '</div>';
      return '<tr>' +
        '<td><div style="display:flex;align-items:center;gap:10px">' + avatarHtml + '<div><div class="row-name">' + escHtml(c.name) + '</div><div class="row-dim">' + escHtml(c.channel_url || '') + '</div></div></div></td>' +
        '<td>' + escHtml(c.team || '') + '</td>' +
        '<td><span class="admin-badge admin-badge-dim">' + escHtml(c.league || 'Other') + '</span></td>' +
        '<td>' + formatNum(c.subscriber_count || 0) + '</td>' +
        '<td>' + formatNum(c.total_view_count || 0) + '</td>' +
        '<td>' + escHtml(c.upload_frequency || '—') + '</td>' +
        '<td>' + (c.verified ? '<span class="admin-badge admin-badge-green">Verified</span>' : '') + (c.is_live ? ' <span class="admin-badge admin-badge-red">LIVE</span>' : '') + (c.featured ? ' <span class="admin-badge admin-badge-yellow">Featured</span>' : '') + (!c.verified && !c.is_live && !c.featured ? '<span class="admin-badge admin-badge-dim">Standard</span>' : '') + '</td>' +
        '<td><div class="row-actions">' + (can('creators.edit') ? '<button class="btn-admin btn-admin-ghost" onclick="Admin.editCreator(\'' + c.id + '\')">Edit</button>' : '') + (can('creators.delete') ? '<button class="btn-admin btn-admin-danger" onclick="Admin.deleteCreator(\'' + c.id + '\',\'' + jsAttrStr(c.name) + '\')">Del</button>' : '') + '</div></td>' +
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
  modal.className = 'admin-modal';
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()" aria-label="Close">&times;</button>' +
    '<div class="admin-modal-title">' + (isEdit ? 'Edit Creator' : 'Add Creator') + '</div>' +
    '<div class="admin-modal-sub">' + (isEdit ? 'Update ' + escHtml(c.name) : 'Add a new YouTube creator to the database') + '</div>' +
    formField('Channel Name', 'cf_name', c?.name || '') +
    formField('Channel URL', 'cf_channel', c?.channel_url || '') +
    '<div class="admin-form-grid">' +
      formField('League', 'cf_league', c?.league || '', 'select', ['Premier League','Championship','La Liga','Serie A','Bundesliga','Ligue 1'], 'Admin.onLeagueChange()') +
      '<div class="admin-form-row"><label class="admin-form-label" for="cf_team">Team</label><select class="admin-form-select" id="cf_team">' + buildTeamSelect(c?.league || '', c?.team || '') + '</select></div>' +
    '</div>' +
    formField('Country Code', 'cf_country', c?.channel_country || '', 'text') +
    '<div style="font-size:var(--fs-xs);color:var(--text-muted,#888);margin:-8px 0 12px">2-letter ISO code (e.g. GB, US, FR). Only needed if YouTube doesn\'t provide one.</div>' +
    '<div class="admin-form-grid">' +
      formCheck('Verified', 'cf_verified', c?.verified) +
      formCheck('Featured', 'cf_featured', c?.featured) +
    '</div>' +
    '<div class="admin-form-actions">' +
      '<button class="btn-admin btn-admin-ghost" onclick="Admin.closeModal()">Cancel</button>' +
      '<button class="btn-admin btn-admin-primary" onclick="Admin.saveCreator(\'' + (c?.id || '') + '\')">' + (isEdit ? 'Save Changes' : 'Add Creator') + '</button>' +
    '</div>';
  var overlay = document.getElementById('adminModalOverlay');
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function saveCreator(id) {
  try {
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
      channel_country: document.getElementById('cf_country').value.trim().toUpperCase() || null,
      updated_at: new Date().toISOString()
    };
    if (!data.name) { toast('Channel name is required', 'error'); return; }
    if (!data.team) { toast('Team is required', 'error'); return; }

    var err, res;
    if (id) {
      res = await sb.from('frfc_streamers').update(data).eq('id', id);
      err = res.error;
      if (!err) await logAction('update', 'creator', id, { name: data.name });
    } else {
      data.created_by = currentUser.id;
      res = await sb.from('frfc_streamers').insert(data).select();
      err = res.error;
      if (!err) await logAction('create', 'creator', res.data?.[0]?.id, { name: data.name });
    }

    if (err) { toast(err.message, 'error'); return; }
    toast(id ? 'Creator updated' : 'Creator added', 'success');
    closeModal();
    await loadAdminData();
    renderPage();
  } catch (e) {
    console.error('saveCreator error:', e);
    toast('Error: ' + e.message, 'error');
  }
}

function deleteCreator(id, name) {
  confirmDialog('Delete "' + name + '"? This cannot be undone.', async function() {
    var res = await sb.from('frfc_streamers').delete().eq('id', id);
    if (res.error) { toast(res.error.message, 'error'); return; }
    await logAction('delete', 'creator', id, { name: name });
    toast('Creator deleted', 'success');
    await loadAdminData();
    renderPage();
  }, { title: 'Delete creator', confirmLabel: 'Delete' });
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
        '<td><a href="' + escHtml(s.channel_url) + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:var(--fs-sm)">' + escHtml(s.channel_url).substring(0, 40) + '...</a></td>' +
        '<td>' + escHtml(s.team) + '</td>' +
        '<td><span class="admin-badge admin-badge-dim">' + escHtml(s.league) + '</span></td>' +
        '<td class="row-dim">' + timeAgo(s.submitted_at) + '</td>' +
        '<td><div class="row-actions">' + (can('submissions.review') ?
          '<button class="btn-admin btn-admin-success" onclick="Admin.approveSubmission(\'' + s.id + '\')">Approve</button>' +
          '<button class="btn-admin btn-admin-danger" onclick="Admin.rejectSubmission(\'' + s.id + '\')">Reject</button>' : '') +
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

function rejectSubmission(id) {
  var s = allSubmissions.find(function(x){return x.id===id});
  if (!s) return;
  confirmDialog('Reject submission "' + s.name + '"?', async function() {
    await sb.from('frfc_submissions').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id }).eq('id', id);
    await logAction('reject', 'submission', id, { name: s.name });
    toast(s.name + ' rejected', 'info');
    await loadAdminData();
    renderPage();
  }, { title: 'Reject submission', confirmLabel: 'Reject' });
}

// ── News page ────────────────────────────────────────────────────────────────
function renderNews() {
  var published = allArticles.filter(function(a){return a.status==='published'});

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">News</h1><div class="admin-page-subtitle">' + allArticles.length + ' articles &middot; ' + published.length + ' published</div></div>' +
    (can('articles.create') ? '<button class="btn-admin btn-admin-primary" onclick="Admin.openAddArticle()">New Article</button>' : '') + '</div>' +

  (allArticles.length ? '<div class="admin-card"><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Title</th><th>Status</th><th>Tags</th><th>Updated</th><th>Actions</th></tr></thead><tbody>' +
    allArticles.map(function(a) {
      return '<tr>' +
        '<td class="row-name">' + escHtml(a.title) + '</td>' +
        '<td>' + (a.status === 'published' ? '<span class="admin-badge admin-badge-green">Published</span>' : '<span class="admin-badge admin-badge-dim">Draft</span>') + '</td>' +
        '<td style="font-size:var(--fs-sm);color:var(--text-dim)">' + (a.tags||[]).map(escHtml).join(', ') + '</td>' +
        '<td class="row-dim">' + timeAgo(a.updated_at) + '</td>' +
        '<td><div class="row-actions">' +
          (can('articles.edit') ? '<button class="btn-admin btn-admin-ghost" onclick="Admin.editArticle(\'' + a.id + '\')">Edit</button>' : '') +
          (can('articles.publish') ? (a.status === 'published'
            ? '<button class="btn-admin" onclick="Admin.unpublishArticle(\'' + a.id + '\')">Unpublish</button>'
            : '<button class="btn-admin btn-admin-success" onclick="Admin.publishArticle(\'' + a.id + '\')">Publish</button>') : '') +
          (can('articles.delete') ? '<button class="btn-admin btn-admin-danger" onclick="Admin.deleteArticle(\'' + a.id + '\',\'' + jsAttrStr(a.title) + '\')">Delete</button>' : '') +
        '</div></td></tr>';
    }).join('') + '</tbody></table></div></div>'
  : '<div class="admin-card"><div class="admin-card-body" style="text-align:center;color:var(--text-dim);padding:32px">No articles yet &mdash; click &ldquo;New Article&rdquo; to write your first one.</div></div>');
}

function openAddArticle() { openArticleForm(null); }

function editArticle(id) {
  var a = allArticles.find(function(x){return x.id===id});
  if (a) openArticleForm(a);
}

function openArticleForm(a) {
  var isEdit = !!a;
  // Generated up front (not on save) so the cover image can be uploaded to
  // its final storage path — article-covers/{id}/cover.ext — before the
  // article row exists at all. saveArticle() inserts using this same id
  // instead of letting the database default one, so the two always match.
  var articleId = a ? a.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  var modal = document.getElementById('adminModal');
  modal.className = 'admin-modal';
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()" aria-label="Close">&times;</button>' +
    '<div class="admin-modal-title">' + (isEdit ? 'Edit Article' : 'New Article') + '</div>' +
    '<div class="admin-modal-sub">' + (isEdit ? escHtml(a.title) : 'Draft a new article — nothing is public until you click Publish') + '</div>' +
    formField('Title', 'af_title', a?.title || '') +
    formField('Slug', 'af_slug', a?.slug || '') +
    '<div style="font-size:var(--fs-xs);color:var(--text-muted);margin:-8px 0 12px">URL: /news/<span id="af_slug_preview">' + escHtml(a?.slug || '') + '</span></div>' +
    formField('Dek (optional subtitle)', 'af_dek', a?.dek || '') +
    formField('Summary (used for the article card and search description)', 'af_summary', a?.summary || '', 'textarea') +
    '<div class="admin-form-row"><label class="admin-form-label" for="af_body">Body</label><textarea class="admin-form-input" id="af_body" rows="14" style="resize:vertical;font-family:inherit">' + escHtml(a?.body || '') + '</textarea></div>' +
    '<div class="admin-form-row">' +
      '<label class="admin-form-label">Cover Image <span style="font-weight:400;color:var(--text-muted)">— also used as the social share image (Facebook, X, Discord, etc.)</span></label>' +
      '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
        '<div id="af_cover_preview" style="width:160px;aspect-ratio:1200/630;border-radius:6px;overflow:hidden;background:var(--bg-hover);flex-shrink:0;border:1px solid var(--border)">' +
          (a?.cover_image_url ? '<img src="' + escHtml(a.cover_image_url) + '" alt="" style="width:100%;height:100%;object-fit:cover">' : '') +
        '</div>' +
        '<div>' +
          '<label for="af_cover_file" class="btn-admin btn-admin-ghost" style="cursor:pointer;display:inline-block">Upload image</label>' +
          '<input type="file" id="af_cover_file" accept="image/jpeg,image/png,image/webp" style="display:none">' +
          '<div style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:6px">JPEG or WebP, 1200&times;630px, under 4MB. That size/ratio is what Facebook, X, and Discord expect for a link preview.</div>' +
          '<div id="af_cover_msg" style="font-size:var(--fs-xs);margin-top:4px"></div>' +
        '</div>' +
      '</div>' +
      '<input type="hidden" id="af_cover" value="' + escHtml(a?.cover_image_url || '') + '">' +
    '</div>' +
    formField('Tags (comma-separated)', 'af_tags', (a?.tags||[]).join(', ')) +
    '<div class="admin-form-row"><label class="admin-form-label" for="af_team">Related Club (optional — cross-links the article from that club\'s page)</label><select class="admin-form-select" id="af_team">' + buildTeamSelect('', a?.related_team || '') + '</select></div>' +
    '<div class="admin-form-actions">' +
      '<button class="btn-admin btn-admin-ghost" onclick="Admin.closeModal()">Cancel</button>' +
      '<button class="btn-admin btn-admin-primary" onclick="Admin.saveArticle(\'' + (isEdit ? articleId : '') + '\',\'' + articleId + '\')">' + (isEdit ? 'Save Changes' : 'Save Draft') + '</button>' +
    '</div>';
  var overlay = document.getElementById('adminModalOverlay');
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
  document.getElementById('af_title').addEventListener('input', function() {
    if (!isEdit) document.getElementById('af_slug').value = slugify(this.value);
    document.getElementById('af_slug_preview').textContent = document.getElementById('af_slug').value;
  });
  document.getElementById('af_slug').addEventListener('input', function() {
    document.getElementById('af_slug_preview').textContent = this.value;
  });
  document.getElementById('af_cover_file').addEventListener('change', function(e) { handleArticleCoverUpload(e, articleId); });
}

async function handleArticleCoverUpload(e, articleId) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var msg = document.getElementById('af_cover_msg');
  msg.style.color = 'var(--text-dim)';
  msg.textContent = 'Uploading…';
  if (file.size > 4 * 1024 * 1024) { msg.style.color = 'var(--red)'; msg.textContent = 'Too large — max 4MB.'; return; }
  var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  var path = articleId + '/cover.' + ext;
  try {
    var session = (await sb.auth.getSession()).data.session;
    if (!session) { msg.style.color = 'var(--red)'; msg.textContent = 'Please sign in again.'; return; }
    var uploadRes = await fetch(SUPABASE_URL + '/storage/v1/object/article-covers/' + path, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body: file
    });
    if (!uploadRes.ok) { msg.style.color = 'var(--red)'; msg.textContent = 'Upload failed.'; return; }
    var publicUrl = SUPABASE_URL + '/storage/v1/object/public/article-covers/' + path + '?t=' + Date.now();
    document.getElementById('af_cover').value = publicUrl;
    document.getElementById('af_cover_preview').innerHTML = '<img src="' + publicUrl + '" alt="" style="width:100%;height:100%;object-fit:cover">';
    msg.style.color = 'var(--green)';
    msg.textContent = 'Uploaded!';
  } catch (err) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Upload failed: ' + err.message;
  }
}

async function saveArticle(id, articleId) {
  try {
    var title = document.getElementById('af_title').value.trim();
    var slug = document.getElementById('af_slug').value.trim() || slugify(title);
    var summary = document.getElementById('af_summary').value.trim();
    var body = document.getElementById('af_body').value.trim();
    if (!title) { toast('Title is required', 'error'); return; }
    if (!slug) { toast('Slug is required', 'error'); return; }
    if (!summary) { toast('Summary is required', 'error'); return; }
    if (!body) { toast('Body is required', 'error'); return; }

    var data = {
      title: title,
      slug: slug,
      dek: document.getElementById('af_dek').value.trim() || null,
      summary: summary,
      body: body,
      cover_image_url: document.getElementById('af_cover').value.trim() || null,
      tags: document.getElementById('af_tags').value.split(',').map(function(t){return t.trim()}).filter(Boolean),
      related_team: document.getElementById('af_team').value || null
    };

    var err, res, newId;
    if (id) {
      res = await sb.from('frfc_articles').update(data).eq('id', id);
      err = res.error;
      newId = id;
      if (!err) await logAction('update', 'article', id, { title: title });
    } else {
      // Uses the id generated when the form opened — the cover image (if
      // any) was already uploaded to article-covers/{articleId}/, so the
      // row has to be created with that same id, not a fresh database default.
      data.id = articleId;
      data.author_id = currentUser.id;
      res = await sb.from('frfc_articles').insert(data).select();
      err = res.error;
      newId = res.data && res.data[0] && res.data[0].id;
      if (!err) await logAction('create', 'article', newId, { title: title });
    }

    if (err) { toast(err.message, 'error'); return; }
    toast(id ? 'Article updated' : 'Draft saved', 'success');
    closeModal();
    await loadAdminData();
    renderPage();
  } catch (e) {
    console.error('saveArticle error:', e);
    toast('Error: ' + e.message, 'error');
  }
}

function publishArticle(id) {
  var a = allArticles.find(function(x){return x.id===id});
  if (!a) return;
  confirmDialog('Publish "' + a.title + '"? It becomes publicly visible and indexable immediately.', async function() {
    var res = await sb.rpc('frfc_set_article_status', { p_article_id: id, p_status: 'published' });
    if (res.error) { toast(res.error.message, 'error'); return; }
    await logAction('publish', 'article', id, { title: a.title });
    toast('Published', 'success');
    await loadAdminData();
    renderPage();
  }, { title: 'Publish article', confirmLabel: 'Publish', danger: false });
}

function unpublishArticle(id) {
  var a = allArticles.find(function(x){return x.id===id});
  if (!a) return;
  confirmDialog('Unpublish "' + a.title + '"? It will no longer be publicly visible.', async function() {
    var res = await sb.rpc('frfc_set_article_status', { p_article_id: id, p_status: 'draft' });
    if (res.error) { toast(res.error.message, 'error'); return; }
    await logAction('unpublish', 'article', id, { title: a.title });
    toast('Unpublished', 'info');
    await loadAdminData();
    renderPage();
  }, { title: 'Unpublish article', confirmLabel: 'Unpublish' });
}

function deleteArticle(id, title) {
  confirmDialog('Delete "' + title + '"? This cannot be undone.', async function() {
    var res = await sb.from('frfc_articles').delete().eq('id', id);
    if (res.error) { toast(res.error.message, 'error'); return; }
    await logAction('delete', 'article', id, { title: title });
    toast('Article deleted', 'success');
    await loadAdminData();
    renderPage();
  }, { title: 'Delete article', confirmLabel: 'Delete' });
}

// ── Editorial Queue ──────────────────────────────────────────────────────────
var STATUS_BADGE_CLASS = {
  detected: 'admin-badge-dim', evidence_ready: 'admin-badge-blue', drafting: 'admin-badge-blue',
  review_ready: 'admin-badge-yellow', approved: 'admin-badge-green', scheduled: 'admin-badge-green',
  published: 'admin-badge-green', rejected: 'admin-badge-red', generation_failed: 'admin-badge-red',
  validation_failed: 'admin-badge-red', publish_failed: 'admin-badge-red', archived: 'admin-badge-dim',
};
function candidateStatusBadge(status) {
  return '<span class="admin-badge ' + (STATUS_BADGE_CLASS[status] || 'admin-badge-dim') + '">' + escHtml(status.replace(/_/g, ' ')) + '</span>';
}

function renderQueue() {
  var active = allCandidates.filter(function(c) { return ['detected', 'evidence_ready', 'drafting', 'review_ready'].indexOf(c.status) !== -1; });
  var resolved = allCandidates.filter(function(c) { return active.indexOf(c) === -1; });

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Editorial Queue</h1><div class="admin-page-subtitle">Story candidates awaiting review</div></div>' +
    '<button class="btn-admin btn-admin-primary" id="genRankingBtn" onclick="Admin.generateWeeklyRanking()">Generate Weekly Ranking</button></div>' +

  (active.length ? '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Needs Review</span></div><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Score</th><th>Created</th><th>Actions</th></tr></thead><tbody>' +
    active.map(function(c) {
      return '<tr>' +
        '<td class="row-name">' + escHtml(c.working_title) + '</td>' +
        '<td style="font-size:var(--fs-sm);color:var(--text-dim)">' + escHtml(c.type.replace(/_/g, ' ')) + '</td>' +
        '<td>' + candidateStatusBadge(c.status) + '</td>' +
        '<td>' + (c.score == null ? '&mdash;' : c.score) + '</td>' +
        '<td class="row-dim">' + timeAgo(c.created_at) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn-admin btn-admin-primary" onclick="Admin.openCandidateDetail(\'' + c.id + '\')">Review</button>' +
        '</div></td></tr>';
    }).join('') + '</tbody></table></div></div>'
  : '<div class="admin-card"><div class="admin-card-body" style="text-align:center;color:var(--text-dim);padding:32px">Nothing waiting for review. Click &ldquo;Generate Weekly Ranking&rdquo; to create one from the last 7 days of data.</div></div>') +

  (resolved.length ? '<div class="admin-card" style="margin-top:16px"><div class="admin-card-header"><span class="admin-card-title">Resolved</span></div><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Title</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
    resolved.slice(0, 20).map(function(c) {
      return '<tr><td class="row-name">' + escHtml(c.working_title) + '</td><td>' + candidateStatusBadge(c.status) + '</td><td class="row-dim">' + timeAgo(c.updated_at) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>' : '');
}

async function generateWeeklyRanking() {
  var btn = document.getElementById('genRankingBtn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    var session = (await sb.auth.getSession()).data.session;
    var res = await fetch('/.netlify/functions/weekly-ranking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ periodDays: 7 }),
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) { toast(data.error || 'Failed to generate ranking', 'error'); return; }
    await logAction('generate', 'story_candidate', data.candidateId, { workingTitle: data.workingTitle });
    toast('Ranking generated: ' + data.workingTitle, 'success');
    if (data.dataQualityNotes && data.dataQualityNotes.length) {
      data.dataQualityNotes.forEach(function(n) { toast(n, 'info'); });
    }
    await loadAdminData();
    renderPage();
  } catch (e) {
    toast('Network error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Weekly Ranking'; }
  }
}

function rankTableHTML(title, rows, valueLabel, valueFn) {
  if (!rows || !rows.length) return '<p style="color:var(--text-muted);font-size:var(--fs-sm)">' + escHtml(title) + ': no qualifying data this period.</p>';
  return '<div style="margin-bottom:20px"><div class="admin-form-label" style="margin-bottom:8px">' + escHtml(title) + '</div><table class="admin-table"><thead><tr><th>#</th><th>Creator</th><th>Club</th><th>' + valueLabel + '</th></tr></thead><tbody>' +
    rows.map(function(r, i) {
      return '<tr><td>' + (i + 1) + '</td><td class="row-name">' + escHtml(r.name) + '</td><td style="color:var(--text-dim);font-size:var(--fs-sm)">' + escHtml(r.team || '') + '</td><td>' + valueFn(r) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function openCandidateDetail(id) {
  var c = allCandidates.find(function(x) { return x.id === id; });
  if (!c) return;
  var modal = document.getElementById('adminModal');
  var body = '';

  if (c.type === 'weekly_ranking') {
    var p = c.payload || {};
    var s = p.sections || {};
    body =
      '<p style="color:var(--text-dim);font-size:var(--fs-sm);margin-bottom:16px">' + escHtml(c.explanation || '') + '</p>' +
      (p.data_quality_notes && p.data_quality_notes.length ? p.data_quality_notes.map(function(n) { return '<div class="admin-badge admin-badge-yellow" style="display:block;margin-bottom:8px;white-space:normal;text-align:left">' + escHtml(n) + '</div>'; }).join('') : '') +
      rankTableHTML('Fastest Growth (%)', s.fastest_growth_pct, 'Growth', function(r) { return r.baseline + ' &rarr; ' + r.current + ' (' + (r.pct >= 0 ? '+' : '') + r.pct + '%)'; }) +
      rankTableHTML('Largest Absolute Gain', s.largest_absolute_gain, 'Growth', function(r) { return r.baseline + ' &rarr; ' + r.current + ' (' + (r.delta >= 0 ? '+' : '') + r.delta + ')'; }) +
      rankTableHTML('Most Active (new videos)', s.most_active, 'New videos', function(r) { return r.newVideos; });
  } else {
    body = '<p style="color:var(--text-dim)">No detail view built yet for candidate type &ldquo;' + escHtml(c.type) + '&rdquo;.</p>';
  }

  var canDraft = c.status === 'evidence_ready' && c.type === 'weekly_ranking';
  var canPublish = c.status === 'review_ready' || (c.payload && c.payload.draft);

  modal.className = 'admin-modal admin-modal-wide';
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()" aria-label="Close">&times;</button>' +
    '<div class="admin-modal-title">' + escHtml(c.working_title) + '</div>' +
    '<div class="admin-modal-sub">' + candidateStatusBadge(c.status) + ' &middot; Score: ' + (c.score == null ? '&mdash;' : c.score) + '</div>' +
    '<div style="max-height:50vh;overflow-y:auto;margin:16px 0">' + body + '</div>' +
    (c.payload && c.payload.draft ? '<div class="admin-card" style="margin-bottom:16px"><div class="admin-card-header"><span class="admin-card-title">Draft preview</span>' + (c.payload.draft.ai_generated ? '<span class="admin-badge admin-badge-blue" style="margin-left:8px">AI-assisted</span>' : '<span class="admin-badge admin-badge-dim" style="margin-left:8px">Templated</span>') + '</div><div class="admin-card-body"><strong>' + escHtml(c.payload.draft.title) + '</strong><p style="font-size:var(--fs-sm);color:var(--text-dim);margin-top:8px;white-space:pre-wrap">' + escHtml(c.payload.draft.summary) + '</p></div></div>' : '') +
    '<div class="admin-form-actions" style="justify-content:space-between">' +
      '<button class="btn-admin btn-admin-danger" onclick="Admin.rejectCandidate(\'' + c.id + '\')">Reject</button>' +
      '<div style="display:flex;gap:8px">' +
        (canDraft ? '<button class="btn-admin btn-admin-ghost" onclick="Admin.generateRankingDraft(\'' + c.id + '\')">Generate Draft</button>' : '') +
        (canDraft ? '<button class="btn-admin btn-admin-ghost" id="aiDraftBtn" onclick="Admin.generateAiDraft(\'' + c.id + '\')">Generate AI Draft</button>' : '') +
        (canPublish ? '<button class="btn-admin btn-admin-primary" onclick="Admin.approveAndPublishCandidate(\'' + c.id + '\')">Approve &amp; Publish</button>' : '') +
      '</div>' +
    '</div>';
  var overlay = document.getElementById('adminModalOverlay');
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

// E2.5 — deterministic templated draft, no AI. Turns the ranking payload
// into publish-ready title/summary/body text using the same plain-text
// paragraph convention as every other article (see newsBodyHTML in app.js).
function buildRankingDraft(candidate) {
  var p = candidate.payload || {};
  var s = p.sections || {};
  var fmt = function(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
  var title = candidate.working_title;
  var summary = 'This week\'s football creator rankings: fastest growth, biggest subscriber gains, and the most active channels.';

  var paras = [];
  paras.push('Here\'s how football YouTube creators performed between ' + fmt(p.period_start) + ' and ' + fmt(p.period_end) + '.');

  if (s.fastest_growth_pct && s.fastest_growth_pct.length) {
    var top = s.fastest_growth_pct[0];
    paras.push('FASTEST GROWTH: ' + top.name + (top.team ? ' (' + top.team + ')' : '') + ' posted the fastest subscriber growth this week, up ' + top.pct + '% from ' + top.baseline + ' to ' + top.current + ' subscribers.' +
      (s.fastest_growth_pct.length > 1 ? ' ' + s.fastest_growth_pct.slice(1, 5).map(function(r) { return r.name + ' (+' + r.pct + '%)'; }).join(', ') + ' round out the top five.' : ''));
  }

  if (s.largest_absolute_gain && s.largest_absolute_gain.length) {
    var topAbs = s.largest_absolute_gain[0];
    paras.push('BIGGEST GAIN: ' + topAbs.name + ' added the most subscribers in absolute terms, gaining ' + topAbs.delta.toLocaleString() + ' to reach ' + topAbs.current.toLocaleString() + '.');
  }

  if (s.most_active && s.most_active.length) {
    var topActive = s.most_active[0];
    paras.push('MOST ACTIVE: ' + topActive.name + ' published the most new videos this week (' + topActive.newVideos + ').');
  } else {
    paras.push('Upload-activity rankings will appear here once more weeks of data have been collected.');
  }

  paras.push('Rankings are computed directly from tracked subscriber and upload data — see each creator\'s profile on FanReactionsFC for their full history.');

  return { title: title, summary: summary, body: paras.join('\n\n') };
}

async function generateRankingDraft(id) {
  var c = allCandidates.find(function(x) { return x.id === id; });
  if (!c) return;
  var draft = buildRankingDraft(c);
  var payload = Object.assign({}, c.payload, { draft: draft });
  var res = await sb.from('frfc_story_candidates').update({ payload: payload, status: 'review_ready' }).eq('id', id);
  if (res.error) { toast(res.error.message, 'error'); return; }
  await sb.from('frfc_candidate_status_log').insert({ candidate_id: id, old_status: c.status, new_status: 'review_ready', changed_by: currentUser.id, note: 'Templated draft generated' });
  await logAction('generate_draft', 'story_candidate', id, { title: draft.title });
  toast('Draft generated', 'success');
  await loadAdminData();
  openCandidateDetail(id);
}

// E3.1 — AI-assisted alternative to buildRankingDraft(). Sends the
// already-computed, already-trusted candidate payload to the ai-draft
// Netlify function, which asks gpt-4o-mini to write prose around those
// numbers (never to invent new ones) and appends the AI-disclosure
// footer server-side.
async function generateAiDraft(id) {
  var btn = document.getElementById('aiDraftBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    var session = (await sb.auth.getSession()).data.session;
    var res = await fetch('/.netlify/functions/ai-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ candidateId: id }),
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) { toast(data.error || 'Failed to generate AI draft', 'error'); return; }
    toast('AI draft generated', 'success');
    await loadAdminData();
    openCandidateDetail(id);
  } catch (e) {
    toast('Network error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate AI Draft'; }
  }
}

async function approveAndPublishCandidate(id) {
  var c = allCandidates.find(function(x) { return x.id === id; });
  if (!c || !c.payload || !c.payload.draft) { toast('Generate a draft first', 'error'); return; }
  confirmDialog('Publish "' + c.payload.draft.title + '"? It goes live immediately.', async function() {
    var draft = c.payload.draft;
    var slug = slugify(draft.title) + '-' + new Date(c.created_at).toISOString().slice(0, 10);
    var articleRes = await sb.from('frfc_articles').insert({
      title: draft.title, slug: slug, summary: draft.summary, body: draft.body,
      tags: [c.type.replace(/_/g, ' ')], status: 'published', published_at: new Date().toISOString(),
      author_id: currentUser.id, ai_assisted: !!draft.ai_generated,
    }).select();
    if (articleRes.error) { toast('Publish failed: ' + articleRes.error.message, 'error'); return; }
    var articleId = articleRes.data[0].id;
    await sb.from('frfc_story_candidates').update({ status: 'published', article_id: articleId }).eq('id', id);
    await sb.from('frfc_candidate_status_log').insert({ candidate_id: id, old_status: c.status, new_status: 'published', changed_by: currentUser.id, note: 'Published as article ' + articleId });
    await logAction('publish', 'article', articleId, { title: draft.title, fromCandidate: id });
    toast('Published!', 'success');
    closeModal();
    await loadAdminData();
    renderPage();
  }, { title: 'Publish article', confirmLabel: 'Publish', danger: false });
}

function rejectCandidate(id) {
  var c = allCandidates.find(function(x) { return x.id === id; });
  if (!c) return;
  confirmDialog('Reject "' + c.working_title + '"?', async function() {
    await sb.from('frfc_story_candidates').update({ status: 'rejected' }).eq('id', id);
    await sb.from('frfc_candidate_status_log').insert({ candidate_id: id, old_status: c.status, new_status: 'rejected', changed_by: currentUser.id });
    await logAction('reject', 'story_candidate', id, { title: c.working_title });
    toast('Rejected', 'info');
    closeModal();
    await loadAdminData();
    renderPage();
  }, { title: 'Reject candidate', confirmLabel: 'Reject' });
}

// ── Health page ──────────────────────────────────────────────────────────────
// frfc_job_runs has no writers yet — this fills in once ingestion jobs
// (Epic 2 onward) start recording runs. The page itself is ready now so
// there's somewhere for that data to show up without a later UI change.
async function loadAndRenderHealth() {
  var content = document.getElementById('adminContent');
  var runs = [];
  try {
    var res = await sb.from('frfc_job_runs').select('*').order('started_at', { ascending: false }).limit(50);
    runs = res.data || [];
  } catch (e) { /* render with empty state below */ }

  var byType = {};
  runs.forEach(function(r) { if (!byType[r.job_type]) byType[r.job_type] = r; });
  var statusBadge = function(s) {
    if (s === 'success') return '<span class="admin-badge admin-badge-green">Success</span>';
    if (s === 'failed') return '<span class="admin-badge admin-badge-red">Failed</span>';
    if (s === 'partial') return '<span class="admin-badge admin-badge-dim">Partial</span>';
    return '<span class="admin-badge admin-badge-dim">Running</span>';
  };

  var html = '<div class="admin-page-header"><div><h1 class="admin-page-title">Health</h1><div class="admin-page-subtitle">Scheduled job status and history</div></div></div>';

  if (!runs.length) {
    html += '<div class="admin-card"><div class="admin-card-body" style="text-align:center;color:var(--text-dim);padding:32px">No job runs recorded yet. This page fills in automatically once ingestion jobs start writing to <code>frfc_job_runs</code>.</div></div>';
  } else {
    html += '<div class="admin-stats">' +
      Object.values(byType).map(function(r) {
        return stat(r.job_type, statusBadge(r.status), timeAgo(r.started_at));
      }).join('') +
    '</div>';
    html += '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Recent Runs</span></div><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Job</th><th>Status</th><th>Started</th><th>Processed</th><th>Failed</th><th>Quota</th></tr></thead><tbody>' +
      runs.map(function(r) {
        return '<tr><td class="row-name">' + escHtml(r.job_type) + '</td><td>' + statusBadge(r.status) + '</td><td class="row-dim">' + timeAgo(r.started_at) + '</td><td>' + r.items_processed + '</td><td>' + r.items_failed + '</td><td>' + (r.quota_used == null ? '&mdash;' : r.quota_used) + '</td></tr>';
      }).join('') +
    '</tbody></table></div></div>';
  }

  var toggle = '<button class="admin-toggle-sidebar" onclick="document.getElementById(\'adminSidebar\').classList.toggle(\'open\')">&#9776;</button>';
  content.innerHTML = toggle + html;
}

// ── Users page ───────────────────────────────────────────────────────────────
// Everything here goes through netlify/functions/admin-users.js, the one
// place in the app that talks to the Supabase Auth Admin API. Every action
// it performs is permission-checked server-side (see ACTION_PERMISSIONS in
// that file) — the can(...) checks below only decide what to show, never
// what's actually allowed.
async function callAdminUsers(action, payload) {
  var session = (await sb.auth.getSession()).data.session;
  var res = await fetch('/.netlify/functions/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify(Object.assign({ action: action }, payload)),
  });
  var data = await res.json().catch(function() { return {}; });
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadAndRenderUsers() {
  var content = document.getElementById('adminContent');
  var toggle = '<button class="admin-toggle-sidebar" onclick="document.getElementById(\'adminSidebar\').classList.toggle(\'open\')">&#9776;</button>';
  try {
    var data = await callAdminUsers('list', {});
    allUsers = data.users || [];
  } catch (e) {
    content.innerHTML = toggle + '<div class="admin-page-header"><div><h1 class="admin-page-title">Users</h1></div></div><div class="admin-card"><div class="admin-card-body" style="color:var(--red)">Failed to load users: ' + escHtml(e.message) + '</div></div>';
    return;
  }
  content.innerHTML = toggle + renderUsers();
}

function roleBadge(roleSlug) {
  if (!roleSlug) return '<span class="admin-badge admin-badge-dim">No role</span>';
  var r = allRoles.find(function(x) { return x.slug === roleSlug; });
  return '<span class="admin-badge admin-badge-blue">' + escHtml(r ? r.name : roleSlug) + '</span>';
}

function userRowActions(u) {
  var actions = [];
  if (can('users.assign_role')) actions.push('<button class="btn-admin btn-admin-ghost" onclick="Admin.openEditUserRole(\'' + u.id + '\')">Role</button>');
  if (can('users.deactivate')) {
    actions.push(u.deactivated
      ? '<button class="btn-admin btn-admin-ghost" onclick="Admin.reactivateUser(\'' + u.id + '\')">Reactivate</button>'
      : '<button class="btn-admin btn-admin-ghost" onclick="Admin.deactivateUser(\'' + u.id + '\',\'' + jsAttrStr(u.email) + '\')">Deactivate</button>');
  }
  if (can('users.reset_password')) actions.push('<button class="btn-admin btn-admin-ghost" onclick="Admin.resetUserPassword(\'' + jsAttrStr(u.email) + '\')">Reset Password</button>');
  if (can('users.delete') && can('database.destructive_actions')) actions.push('<button class="btn-admin btn-admin-danger" onclick="Admin.deleteUser(\'' + u.id + '\',\'' + jsAttrStr(u.email) + '\')">Delete</button>');
  return '<div class="row-actions">' + (actions.join('') || '&mdash;') + '</div>';
}

function renderUsers() {
  var rows = allUsers.map(function(u) {
    return '<tr>' +
      '<td class="row-name">' + escHtml(u.email) + '</td>' +
      '<td>' + roleBadge(u.role) + '</td>' +
      '<td>' + (u.deactivated ? '<span class="admin-badge admin-badge-red">Deactivated</span>' : '<span class="admin-badge admin-badge-green">Active</span>') + '</td>' +
      '<td class="row-dim">' + timeAgo(u.createdAt) + '</td>' +
      '<td class="row-dim">' + (u.lastSignInAt ? timeAgo(u.lastSignInAt) : '&mdash;') + '</td>' +
      '<td>' + userRowActions(u) + '</td>' +
    '</tr>';
  }).join('');

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Users</h1><div class="admin-page-subtitle">' + allUsers.length + ' application user' + (allUsers.length === 1 ? '' : 's') + '</div></div>' +
    (can('users.create') ? '<button class="btn-admin btn-admin-primary" onclick="Admin.openInviteUser()">+ Invite User</button>' : '') +
  '</div>' +
  '<div class="admin-card"><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:24px">No users found.</td></tr>') +
  '</tbody></table></div></div>';
}

function roleOptionsHTML(selected) {
  return allRoles.map(function(r) {
    return '<option value="' + escHtml(r.slug) + '"' + (r.slug === selected ? ' selected' : '') + '>' + escHtml(r.name) + '</option>';
  }).join('');
}

function openInviteUser() {
  var modal = document.getElementById('adminModal');
  modal.className = 'admin-modal';
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()" aria-label="Close">&times;</button>' +
    '<div class="admin-modal-title">Invite User</div>' +
    '<div class="admin-modal-sub">Sends a signup email — no password is set here.</div>' +
    '<div class="admin-form-row"><label class="admin-form-label">Email</label><input type="email" id="iu_email" placeholder="name@example.com"></div>' +
    '<div class="admin-form-row"><label class="admin-form-label">Role</label><select id="iu_role">' + roleOptionsHTML('editor') + '</select></div>' +
    '<div class="admin-form-actions"><button class="btn-admin btn-admin-ghost" onclick="Admin.closeModal()">Cancel</button><button class="btn-admin btn-admin-primary" onclick="Admin.submitInviteUser()">Send Invite</button></div>';
  var overlay = document.getElementById('adminModalOverlay');
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function submitInviteUser() {
  var email = document.getElementById('iu_email').value.trim();
  var role = document.getElementById('iu_role').value;
  if (!email) { toast('Email is required', 'error'); return; }
  try {
    await callAdminUsers('invite', { email: email, role: role });
    toast('Invite sent to ' + email, 'success');
    closeModal();
    await loadAndRenderUsers();
  } catch (e) { toast(e.message, 'error'); }
}

function openEditUserRole(userId) {
  var u = allUsers.find(function(x) { return x.id === userId; });
  if (!u) return;
  var modal = document.getElementById('adminModal');
  modal.className = 'admin-modal';
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()" aria-label="Close">&times;</button>' +
    '<div class="admin-modal-title">Change Role</div>' +
    '<div class="admin-modal-sub">' + escHtml(u.email) + '</div>' +
    '<div class="admin-form-row"><label class="admin-form-label">Role</label><select id="eur_role">' + roleOptionsHTML(u.role) + '</select></div>' +
    '<div class="admin-form-actions"><button class="btn-admin btn-admin-ghost" onclick="Admin.closeModal()">Cancel</button><button class="btn-admin btn-admin-primary" onclick="Admin.submitEditUserRole(\'' + userId + '\')">Save</button></div>';
  var overlay = document.getElementById('adminModalOverlay');
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function submitEditUserRole(userId) {
  var role = document.getElementById('eur_role').value;
  try {
    await callAdminUsers('assign_role', { userId: userId, role: role });
    toast('Role updated', 'success');
    closeModal();
    await loadAndRenderUsers();
  } catch (e) { toast(e.message, 'error'); }
}

function deactivateUser(userId, email) {
  confirmDialog('Deactivate "' + email + '"? They will immediately lose the ability to sign in.', async function() {
    try {
      await callAdminUsers('deactivate', { userId: userId });
      toast('User deactivated', 'info');
      await loadAndRenderUsers();
    } catch (e) { toast(e.message, 'error'); }
  }, { title: 'Deactivate user', confirmLabel: 'Deactivate' });
}

async function reactivateUser(userId) {
  try {
    await callAdminUsers('reactivate', { userId: userId });
    toast('User reactivated', 'success');
    await loadAndRenderUsers();
  } catch (e) { toast(e.message, 'error'); }
}

function resetUserPassword(email) {
  confirmDialog('Send a password-reset email to "' + email + '"?', async function() {
    try {
      await callAdminUsers('reset_password', { email: email });
      toast('Password-reset email sent', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }, { title: 'Reset password', confirmLabel: 'Send Email', danger: false });
}

function deleteUser(userId, email) {
  confirmDialog('Permanently delete "' + email + '"? This cannot be undone.', async function() {
    try {
      await callAdminUsers('delete', { userId: userId });
      toast('User deleted', 'success');
      await loadAndRenderUsers();
    } catch (e) { toast(e.message, 'error'); }
  }, { title: 'Delete user', confirmLabel: 'Delete' });
}

// ── Roles page ───────────────────────────────────────────────────────────────
// Roles are fully dynamic: the 3 seeded roles (Super Admin/Admin/Editor)
// are just starting points, editable and deletable like any other except
// for is_system-protected deletion. The catalog of checkable permissions
// itself is fixed (frfc_permissions) — only role→permission mappings and
// user→role assignments are dynamic.
var allPermissionsCatalog = [];
var allRolePermissions = [];

async function loadAndRenderRoles() {
  var content = document.getElementById('adminContent');
  var toggle = '<button class="admin-toggle-sidebar" onclick="document.getElementById(\'adminSidebar\').classList.toggle(\'open\')">&#9776;</button>';
  var [permsRes, rolePermsRes] = await Promise.all([
    sb.from('frfc_permissions').select('*').order('category'),
    sb.from('frfc_role_permissions').select('*'),
  ]);
  allPermissionsCatalog = permsRes.data || [];
  allRolePermissions = rolePermsRes.data || [];
  content.innerHTML = toggle + renderRoles();
}

function rolePermissionKeys(slug) {
  return allRolePermissions.filter(function(rp) { return rp.role_slug === slug; }).map(function(rp) { return rp.permission_key; });
}

function renderRoles() {
  var rows = allRoles.map(function(r) {
    var count = rolePermissionKeys(r.slug).length;
    return '<tr>' +
      '<td class="row-name">' + escHtml(r.name) + (r.is_system ? ' <span class="admin-badge admin-badge-dim">System</span>' : '') + '</td>' +
      '<td class="row-dim">' + escHtml(r.description || '') + '</td>' +
      '<td>' + count + ' / ' + allPermissionsCatalog.length + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn-admin btn-admin-ghost" onclick="Admin.openRoleDetail(\'' + r.slug + '\')">' + (can('roles.manage') ? 'Edit' : 'View') + '</button>' +
        (can('roles.manage') && !r.is_system ? '<button class="btn-admin btn-admin-danger" onclick="Admin.deleteRole(\'' + r.slug + '\',\'' + jsAttrStr(r.name) + '\')">Delete</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');

  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Roles</h1><div class="admin-page-subtitle">' + allRoles.length + ' role' + (allRoles.length === 1 ? '' : 's') + '</div></div>' +
    (can('roles.manage') ? '<button class="btn-admin btn-admin-primary" onclick="Admin.openNewRole()">+ New Role</button>' : '') +
  '</div>' +
  '<div class="admin-card"><div class="admin-card-body no-pad"><table class="admin-table"><thead><tr><th>Role</th><th>Description</th><th>Permissions</th><th>Actions</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:24px">No roles found.</td></tr>') +
  '</tbody></table></div></div>';
}

function openRoleDetail(slug) {
  var role = allRoles.find(function(r) { return r.slug === slug; });
  if (!role) return;
  var granted = rolePermissionKeys(slug);
  var editable = can('roles.manage');
  var byCategory = {};
  allPermissionsCatalog.forEach(function(p) { (byCategory[p.category] = byCategory[p.category] || []).push(p); });

  var body = Object.keys(byCategory).map(function(cat) {
    return '<div class="admin-form-label" style="margin:14px 0 6px">' + escHtml(cat) + '</div>' +
      byCategory[cat].map(function(p) {
        var checked = granted.indexOf(p.key) !== -1;
        return '<label class="admin-form-check" style="display:block;margin-bottom:6px" title="' + escHtml(p.description || '') + '">' +
          '<input type="checkbox" data-perm="' + escHtml(p.key) + '"' + (checked ? ' checked' : '') + (editable ? '' : ' disabled') + '> ' + escHtml(p.label) +
        '</label>';
      }).join('');
  }).join('');

  var modal = document.getElementById('adminModal');
  modal.className = 'admin-modal admin-modal-wide';
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()" aria-label="Close">&times;</button>' +
    '<div class="admin-modal-title">' + escHtml(role.name) + (role.is_system ? ' <span class="admin-badge admin-badge-dim">System</span>' : '') + '</div>' +
    '<div class="admin-modal-sub">' + escHtml(role.description || '') + '</div>' +
    '<div id="rolePermChecklist" style="max-height:50vh;overflow-y:auto;margin:16px 0">' + body + '</div>' +
    (editable ? '<div class="admin-form-actions"><button class="btn-admin btn-admin-ghost" onclick="Admin.closeModal()">Cancel</button><button class="btn-admin btn-admin-primary" onclick="Admin.saveRolePermissions(\'' + slug + '\')">Save</button></div>' : '');
  var overlay = document.getElementById('adminModalOverlay');
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function saveRolePermissions(slug) {
  var checked = [].slice.call(document.querySelectorAll('#rolePermChecklist input[type=checkbox]:checked')).map(function(el) { return el.getAttribute('data-perm'); });
  var del = await sb.from('frfc_role_permissions').delete().eq('role_slug', slug);
  if (del.error) { toast(del.error.message, 'error'); return; }
  if (checked.length) {
    var ins = await sb.from('frfc_role_permissions').insert(checked.map(function(k) { return { role_slug: slug, permission_key: k }; }));
    if (ins.error) { toast(ins.error.message, 'error'); return; }
  }
  await logAction('update_permissions', 'role', slug, { permissions: checked });
  toast('Permissions updated', 'success');
  closeModal();
  await loadAndRenderRoles();
  if (slug === adminRole) await loadPermissions(); // editing your own role takes effect immediately
}

function openNewRole() {
  var modal = document.getElementById('adminModal');
  modal.className = 'admin-modal';
  modal.innerHTML =
    '<button class="admin-modal-close" onclick="Admin.closeModal()" aria-label="Close">&times;</button>' +
    '<div class="admin-modal-title">New Role</div>' +
    '<div class="admin-form-row"><label class="admin-form-label">Name</label><input type="text" id="nr_name" placeholder="e.g. Content Moderator"></div>' +
    '<div class="admin-form-row"><label class="admin-form-label">Description</label><input type="text" id="nr_desc" placeholder="Optional"></div>' +
    '<div class="admin-form-actions"><button class="btn-admin btn-admin-ghost" onclick="Admin.closeModal()">Cancel</button><button class="btn-admin btn-admin-primary" onclick="Admin.submitNewRole()">Create</button></div>';
  var overlay = document.getElementById('adminModalOverlay');
  overlay.classList.add('open');
  activateModalA11y(overlay, modal, closeModal);
}

async function submitNewRole() {
  var name = document.getElementById('nr_name').value.trim();
  var description = document.getElementById('nr_desc').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  var slug = slugify(name);
  if (!slug) { toast('Name must contain letters or numbers', 'error'); return; }
  var res = await sb.from('frfc_roles').insert({ slug: slug, name: name, description: description || null });
  if (res.error) { toast(res.error.message, 'error'); return; }
  await logAction('create', 'role', slug, { name: name });
  toast('Role created', 'success');
  closeModal();
  await loadAdminData();
  await loadAndRenderRoles();
  openRoleDetail(slug); // jump straight to assigning its permissions
}

function deleteRole(slug, name) {
  confirmDialog('Delete role "' + name + '"? Users currently assigned this role keep it until you delete or reassign them individually — the delete will fail while anyone still has it.', async function() {
    var res = await sb.from('frfc_roles').delete().eq('slug', slug);
    if (res.error) { toast(res.error.message, 'error'); return; }
    await logAction('delete', 'role', slug, { name: name });
    toast('Role deleted', 'info');
    await loadAdminData();
    await loadAndRenderRoles();
  }, { title: 'Delete role', confirmLabel: 'Delete' });
}

// ── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  return '<div class="admin-page-header"><div><h1 class="admin-page-title">Settings</h1><div class="admin-page-subtitle">Platform configuration</div></div></div>' +
  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">YouTube API</span></div><div class="admin-card-body">' +
    '<div class="admin-form-row"><div class="admin-form-label">API Key</div><div style="font-size:var(--fs-base);color:var(--text-dim)">Configured server-side (Netlify env var YOUTUBE_API_KEY)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Daily Quota</div><div style="font-size:var(--fs-base)">10,000 units/day (YouTube Data API v3)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Last Sync</div><div style="font-size:var(--fs-base)">' + getLastSync() + '</div></div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-top:8px"><button class="btn-admin btn-admin-primary" onclick="Admin.runSync()">Run YouTube Sync Now</button><span id="syncStatus" style="font-size:var(--fs-sm);color:var(--text-dim)"></span></div>' +
  '</div></div>' +

  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Platform Info</span></div><div class="admin-card-body">' +
    '<div class="admin-form-row"><div class="admin-form-label">Site URL</div><div style="font-size:var(--fs-base)">fanreactionsfc.com</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Hosting</div><div style="font-size:var(--fs-base)">Netlify (site ID: a845b6ad-3669-4634-b5df-f757ac227b71)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Database</div><div style="font-size:var(--fs-base)">Supabase (dsxijgrpxsfywxuffbmt)</div></div>' +
    '<div class="admin-form-row"><div class="admin-form-label">Stack</div><div style="font-size:var(--fs-base)">Static SPA (HTML/CSS/JS), Supabase Postgres, YouTube Data API v3</div></div>' +
  '</div></div>' +

  '<div class="admin-card"><div class="admin-card-header"><span class="admin-card-title">Danger Zone</span></div><div class="admin-card-body">' +
    '<button class="btn-admin btn-admin-danger" onclick="Admin.resetAllLive()">Reset All Live Status</button>' +
  '</div></div>';
}

function getLastSync() {
  var synced = allCreators.filter(function(c){return c.last_youtube_sync}).sort(function(a,b){return new Date(b.last_youtube_sync)-new Date(a.last_youtube_sync)});
  if (!synced.length) return 'Never';
  return timeAgo(synced[0].last_youtube_sync);
}

// ── In-browser YouTube Sync (via server-side proxy) ─────────────────────────
// This intentionally duplicates a SUBSET of netlify/functions/sync-background.js
// (which also runs on a schedule, server-side, with the service-role key).
// It exists separately — not shared code — because sync-background.js is a
// Netlify *background function*: calling it over HTTP returns an empty 202
// immediately and the work continues out-of-band, so it can't drive the live
// "Syncing 4/260: creator name" progress UI below. There's no build step in
// this repo to share a module between browser JS and the Node function, so
// duplication is the pragmatic choice — just keep it deliberate, not silent.
//
// KNOWN GAP vs sync-background.js: this client version does NOT detect
// upcoming/scheduled livestreams (upcoming_video_* fields) — only
// sync-background.js does. If you add fields to one, check the other.
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

function resetAllLive() {
  confirmDialog('Reset is_live to false for all creators?', async function() {
    var res = await sb.from('frfc_streamers').update({ is_live: false, live_video_id: null }).neq('is_live', false);
    if (res.error) { toast(res.error.message, 'error'); return; }
    await logAction('update', 'settings', null, { action: 'reset_all_live' });
    toast('All live statuses reset', 'success');
    await loadAdminData();
    renderPage();
  }, { title: 'Reset live status', confirmLabel: 'Reset' });
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
  deactivateModalA11y();
  document.getElementById('adminModalOverlay')?.classList.remove('open');
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadPermissions();
  refreshNav();
  await loadAdminData();
  refreshNav(); // badges (e.g. pending submissions count) depend on loaded data too
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
  openAddArticle: openAddArticle,
  editArticle: editArticle,
  saveArticle: saveArticle,
  publishArticle: publishArticle,
  unpublishArticle: unpublishArticle,
  deleteArticle: deleteArticle,
  runSync: runSync,
  resetAllLive: resetAllLive,
  closeModal: closeModal,
  toast: toast,
  generateWeeklyRanking: generateWeeklyRanking,
  openCandidateDetail: openCandidateDetail,
  generateRankingDraft: generateRankingDraft,
  generateAiDraft: generateAiDraft,
  approveAndPublishCandidate: approveAndPublishCandidate,
  rejectCandidate: rejectCandidate,
  openInviteUser: openInviteUser,
  submitInviteUser: submitInviteUser,
  openEditUserRole: openEditUserRole,
  submitEditUserRole: submitEditUserRole,
  deactivateUser: deactivateUser,
  reactivateUser: reactivateUser,
  resetUserPassword: resetUserPassword,
  deleteUser: deleteUser,
  openRoleDetail: openRoleDetail,
  saveRolePermissions: saveRolePermissions,
  openNewRole: openNewRole,
  submitNewRole: submitNewRole,
  deleteRole: deleteRole
};

})();
