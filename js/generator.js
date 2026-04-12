/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC.com — Description Generator
   Integrated SPA module, exposed on window.Gen
   ═══════════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

// ── Constants (generator-specific) ───────────────────────────────────────────
const EMOTIONS = [
  {label:"Anger / Frustration",words:["FUMING \u{1F621}","LIVID \u{1F92C}","OUTRAGED \u{1F624}","INFURIATED \u{1F525}","FURIOUS \u{1F620}","ANNOYED \u{1F612}","INCENSED \u{1F4A2}","FRUSTRATED \u{1F623}","BITTER \u{1F63E}","MIFFED \u{1F624}"]},
  {label:"Disappointment / Sadness",words:["GUTTED \u{1F61E}","HEARTBROKEN \u{1F494}","CRESTFALLEN \u{1F614}","DEJECTED \u{1F61F}","MISERABLE \u{1F629}","DOWNCAST \u{1F613}","DESPONDENT \u{1F616}","WOEFUL \u{1F62D}","MELANCHOLY \u{1F622}","RESIGNED \u{1FAE0}"]},
  {label:"Happiness / Joy",words:["ELATED \u{1F601}","EUPHORIC \u{1F973}","JUBILANT \u{1F389}","OVERJOYED \u{1F606}","THRILLED \u{1F603}","TRIUMPHANT \u{1F3C6}","ECSTATIC \u{1F929}","CHEERFUL \u{1F604}","SATISFIED \u{1F60A}","RELIEVED \u{1F60C}"]},
  {label:"Disbelief / Surprise",words:["STUNNED \u{1F633}","SPEECHLESS \u{1F636}","SHOCKED \u{1F631}","FLABBERGASTED \u{1F92F}","DUMBFOUNDED \u{1FAE8}","GOBSMACKED \u{1F632}","BAFFLED \u{1F635}","BEWILDERED \u{1F615}","DAZED \u{1F914}","OVERCOME \u{1F627}"]}
];

const FIXED_IG = 'https://www.instagram.com/fanreactionsfc/';
const FIXED_X = 'https://x.com/FanReactionsFC';
const PROMO_BLOCK = '\u{1F455} Grab your kit with an exclusive 8% discount \u2014 use code FRFC at checkout: https://www.okayjersey.com\n\u{1F3A8} Get your custom LINEUP BUILDER stream layout here: https://www.stream-builder.co.uk/?referral=FanReactionsFC';

// ── State ────────────────────────────────────────────────────────────────────
var videoType = 'fan', counter = 0, homeGoals = 0, awayGoals = 0;
var tsData = [], chData = [];
var syncDismissed = false;
var customTeams = [];
var _keyHandler = null;

// ── HTML Template ────────────────────────────────────────────────────────────
function renderHTML() {
  return `
  <!-- Sticky status bar -->
  <div class="status-bar" id="statusBar">
    <span class="status-label">&#10003; Content generated</span>
    <div class="status-actions">
      <button class="status-btn green" onclick="Gen.scrollToOutput()">View Output</button>
      <button class="status-btn" onclick="Gen.copyAll(this)">Copy All</button>
      <button class="status-btn" onclick="Gen.confirmReset()">New Video</button>
    </div>
  </div>

  <div class="gen-wrap">
    <div class="gen-header">
      <h1>Description <span class="accent">Generator</span></h1>
      <p>Title &middot; Description &middot; Tags &mdash; ready to paste</p>
      <div class="gen-header-actions">
        <button class="btn btn-secondary btn-sm" onclick="Gen.confirmReset()">&#8634; New Video</button>
      </div>
    </div>

    <!-- Validation -->
    <div class="validation-banner" id="validationBanner">
      <span>!</span>
      <ul id="validationList"></ul>
    </div>

    <!-- 1. Type -->
    <div class="gen-card">
      <div class="gen-card-title"><span class="step-num">1</span>Video Type</div>
      <div class="type-tabs">
        <button class="type-tab active" onclick="Gen.setType('fan')">&#9917; Fan Reactions</button>
        <button class="type-tab" onclick="Gen.setType('mixed')">&#129309; Mixed Fans</button>
        <button class="type-tab" onclick="Gen.setType('rivals')">&#128520; Rivals &amp; Haters</button>
        <button class="type-tab" onclick="Gen.setType('postmatch')">&#127908; Post-Match</button>
        <button class="type-tab" onclick="Gen.setType('transfer')">&#128240; Signing / Sacking</button>
      </div>
    </div>

    <!-- 2. Match Details -->
    <div class="gen-card">
      <div class="gen-card-title"><span class="step-num">2</span>Match Details</div>
      <div class="gap">
        <div class="score-row">
          <div class="score-field"><label class="field-label">Home Team</label><select id="teamA" onchange="Gen.onTeamSelect(this);Gen.updateGoalLabels();Gen.checkScoreSync()"><option value="">Select team...</option></select></div>
          <div class="score-vs">VS</div>
          <div class="score-field"><label class="field-label">Away Team</label><select id="teamB" onchange="Gen.onTeamSelect(this);Gen.updateGoalLabels();Gen.checkScoreSync()"><option value="">Select team...</option></select></div>
        </div>
      </div>
      <div class="grid3 gap">
        <div><label class="field-label">Home Score</label><input type="number" id="scoreA" min="0" value="0" oninput="Gen.checkScoreSync()"></div>
        <div><label class="field-label">Away Score</label><input type="number" id="scoreB" min="0" value="0" oninput="Gen.checkScoreSync()"></div>
        <div><label class="field-label">Competition</label>
          <select id="competition">
            <option>Premier League</option>
            <option>Champions League</option>
            <option>Europa League</option>
            <option>FA Cup</option>
            <option>Carabao Cup</option>
            <option>Conference League</option>
          </select>
        </div>
      </div>

      <!-- Score sync banner -->
      <div class="score-sync-banner" id="scoreSyncBanner">
        <span id="scoreSyncMsg">Add timestamps for these goals?</span>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <button class="btn-sync" id="btnSyncYes" onclick="Gen.syncGoalsFromScore()">Auto-add Goals</button>
          <button class="btn-sync-dismiss" onclick="Gen.dismissSync()">&times;</button>
        </div>
      </div>

      <!-- Emotion -->
      <div style="margin-top:4px">
        <label class="field-label">Emotion / Headline Word</label>
        <div class="emotion-input-row">
          <input type="text" id="emotion" placeholder="Type or pick from grid below..." oninput="Gen.onEmotionType()">
          <button class="btn-clear" onclick="Gen.clearEmotion()">&times; Clear</button>
        </div>
        <div class="emotion-grid" id="emotionGrid"></div>
      </div>

      <div id="rivalRow" style="display:none;margin-top:16px">
        <label class="field-label">Rival Team (fans celebrating)</label>
        <select id="rivalTeam" onchange="Gen.onTeamSelect(this)"><option value="">Select team...</option></select>
      </div>
      <div id="transferRow" style="display:none;margin-top:16px">
        <div class="grid2 gap">
          <div><label class="field-label">Player / Manager Name</label><input type="text" id="transferName" placeholder="e.g. Kylian Mbapp\u00e9"></div>
          <div><label class="field-label">Event Type</label>
            <select id="transferType">
              <option value="signing">Signing</option>
              <option value="sacking">Sacking</option>
              <option value="departure">Departure</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. Timestamps -->
    <div class="gen-card" id="tsCard">
      <div class="gen-card-title"><span class="step-num">3</span>Timestamps</div>
      <div class="ts-intro">
        <div class="ts-time-fixed">00:00</div>
        <div class="ts-label-fixed">Introduction (fixed)</div>
      </div>
      <div id="tsList" class="ts-list"></div>
      <div class="btn-add-wrap">
        <button class="btn-add" onclick="Gen.addGoal('A')">&#9917; <span id="goalALabel">Home</span> Goal</button>
        <button class="btn-add" onclick="Gen.addGoal('B')">&#9917; <span id="goalBLabel">Away</span> Goal</button>
        <button class="btn-add" onclick="Gen.addEvent('Red Card')">&#128997; Red Card</button>
        <button class="btn-add" onclick="Gen.addEvent('VAR Decision')">&#128250; VAR</button>
        <button class="btn-add" onclick="Gen.addEvent('Penalty')">&#127919; Penalty</button>
        <button class="btn-add" onclick="Gen.addCustomEvent()">+ Custom</button>
      </div>
    </div>

    <!-- 4. Channels -->
    <div class="gen-card">
      <div class="gen-card-title"><span class="step-num">4</span>Featured YouTube Channels</div>
      <div id="chList" class="ch-list"></div>
      <button class="btn-add" onclick="Gen.addChannel()">+ Add Channel</button>
    </div>

    <!-- 5. Social -->
    <div class="gen-card">
      <div class="gen-card-title"><span class="step-num">5</span>Social Links</div>
      <div class="grid3">
        <div><label class="field-label">Instagram</label><div class="social-locked"><span class="lock-icon">Locked</span>fanreactionsfc</div></div>
        <div><label class="field-label">TikTok</label><input type="text" id="linkTT" placeholder="Your TikTok URL"></div>
        <div><label class="field-label">X / Twitter</label><div class="social-locked"><span class="lock-icon">Locked</span>FanReactionsFC</div></div>
      </div>
    </div>

    <button class="btn-generate" id="btnGenerate" onclick="Gen.generate()">&#9889; Generate Content</button>

    <!-- Output -->
    <div class="output-section" id="outputSection">
      <hr class="gen-divider">
      <div class="copy-all-row">
        <button class="btn-copy-all" id="btnCopyAll" onclick="Gen.copyAll(this)">&#11015; Copy All to Clipboard</button>
      </div>
      <div class="output-block">
        <div class="output-header">
          <span class="output-label">Title</span>
          <div class="output-right">
            <span class="tag-count" id="titleCharCount"></span>
            <button class="btn-copy" onclick="Gen.copyField('outTitle',this)">Copy</button>
          </div>
        </div>
        <div class="output-text" id="outTitle"></div>
      </div>
      <div class="output-block">
        <div class="output-header">
          <span class="output-label">Description</span>
          <button class="btn-copy" onclick="Gen.copyField('outDesc',this)">Copy</button>
        </div>
        <div class="output-text" id="outDesc"></div>
      </div>
      <div class="output-block">
        <div class="output-header">
          <div class="output-right">
            <span class="output-label">Tags</span>
            <span class="tag-count" id="tagCount"></span>
          </div>
          <button class="btn-copy" onclick="Gen.copyField('outTags',this)">Copy</button>
        </div>
        <div class="output-text" id="outTags"></div>
      </div>
    </div>
  </div>`;
}

// ── Init & Cleanup ───────────────────────────────────────────────────────────
function init() {
  // Reset state for fresh render
  videoType = 'fan'; counter = 0; homeGoals = 0; awayGoals = 0;
  tsData.length = 0; chData.length = 0;
  syncDismissed = false; customTeams.length = 0;

  renderEmotions();
  populateTeamDropdowns();
  autoSelectCompetition();
  document.getElementById('tsList').innerHTML = '<div class="empty-hint">No timestamps yet \u2014 add goals and events below.</div>';
  document.getElementById('chList').innerHTML = '<div class="empty-hint">No channels added yet.</div>';
  addChannel(); addChannel(); addChannel();

  // Keyboard shortcut: Ctrl+Enter to generate
  _keyHandler = function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); }
  };
  document.addEventListener('keydown', _keyHandler);
}

function cleanup() {
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }
}

// ── Teams (uses app.js globals: TEAM_TO_LEAGUE, creators) ────────────────────
function getAllTeams() {
  var staticTeams = Object.keys(TEAM_TO_LEAGUE);
  var dbTeams = creators.map(function(c) { return c.team; }).filter(Boolean);
  return [...new Set([...staticTeams, ...dbTeams, ...customTeams])].sort();
}

function buildTeamOptions() {
  return getAllTeams().map(function(t) {
    return '<option value="' + t + '">' + t + '</option>';
  }).join('') + '<option value="__add__">+ Add team\u2026</option>';
}

function populateTeamDropdowns() {
  var opts = buildTeamOptions();
  ['teamA', 'teamB', 'rivalTeam'].forEach(function(id) {
    var sel = document.getElementById(id); if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">Select team...</option>' + opts;
    if (cur && cur !== '__add__') sel.value = cur;
  });
}

function onTeamSelect(sel) {
  if (sel.value !== '__add__') return;
  var name = prompt('Enter team name:');
  if (name && name.trim()) {
    var t = name.trim();
    if (!customTeams.includes(t)) customTeams.push(t);
    populateTeamDropdowns();
    sel.value = t;
  } else { sel.value = ''; }
  if (sel.id === 'teamA' || sel.id === 'teamB') { updateGoalLabels(); checkScoreSync(); }
}

// ── Competition auto-select ──────────────────────────────────────────────────
function autoSelectCompetition() {
  var day = new Date().getDay();
  var sel = document.getElementById('competition');
  if (day === 2 || day === 3) sel.value = 'Champions League';
  else if (day === 4 || day === 0) sel.value = 'Europa League';
  else sel.value = 'Premier League';
}

// ── Emotions ─────────────────────────────────────────────────────────────────
function renderEmotions() {
  document.getElementById('emotionGrid').innerHTML = EMOTIONS.map(function(cat) {
    return '<div class="emotion-cat"><div class="emotion-cat-title">' + cat.label + '</div><div class="emotion-words">' + cat.words.map(function(w) {
      return '<button class="etag" onclick="Gen.pickEmotion(this,\'' + w.replace(/'/g, "&#39;") + '\')">' + w + '</button>';
    }).join('') + '</div></div>';
  }).join('');
}

function pickEmotion(el, w) {
  document.querySelectorAll('.etag').forEach(function(e) { e.classList.remove('active'); });
  el.classList.add('active');
  document.getElementById('emotion').value = w;
}

function clearEmotion() {
  document.querySelectorAll('.etag').forEach(function(e) { e.classList.remove('active'); });
  document.getElementById('emotion').value = '';
}

function onEmotionType() {
  document.querySelectorAll('.etag').forEach(function(e) { e.classList.remove('active'); });
}

// ── Video Type ───────────────────────────────────────────────────────────────
function setType(t) {
  videoType = t;
  document.querySelectorAll('.type-tab').forEach(function(el, i) {
    el.classList.toggle('active', ['fan', 'mixed', 'rivals', 'postmatch', 'transfer'][i] === t);
  });
  document.getElementById('rivalRow').style.display    = t === 'rivals'   ? 'block' : 'none';
  document.getElementById('transferRow').style.display  = t === 'transfer' ? 'block' : 'none';
  document.getElementById('tsCard').style.display       = t === 'transfer' ? 'none'  : 'block';
}

// ── Goal labels ──────────────────────────────────────────────────────────────
function updateGoalLabels() {
  var a = document.getElementById('teamA').value || 'Home';
  var b = document.getElementById('teamB').value || 'Away';
  document.getElementById('goalALabel').textContent = a;
  document.getElementById('goalBLabel').textContent = b;
  document.querySelectorAll('[data-lteam]').forEach(function(el) {
    el.textContent = (el.dataset.lteam === 'A' ? a : b) + ' Goal';
    el.className = 'ts-badge ' + (el.dataset.lteam === 'A' ? 'goal-home' : 'goal-away');
  });
  document.querySelectorAll('.ts-score').forEach(function(el) {
    el.textContent = a + ' ' + el.dataset.hs + '-' + el.dataset.as + ' ' + b;
  });
}

// ── Score sync ───────────────────────────────────────────────────────────────
function checkScoreSync() {
  if (syncDismissed) return;
  var sA = parseInt(document.getElementById('scoreA').value) || 0;
  var sB = parseInt(document.getElementById('scoreB').value) || 0;
  var totalScoreGoals = sA + sB;
  var existingGoals = tsData.filter(function(t) { return t.type === 'goal'; }).length;
  var diff = totalScoreGoals - existingGoals;
  var banner = document.getElementById('scoreSyncBanner');
  if (diff > 0 && totalScoreGoals > 0) {
    document.getElementById('scoreSyncMsg').textContent = 'Score shows ' + sA + '-' + sB + ' (' + diff + ' goal' + (diff > 1 ? 's' : '') + ' missing timestamps). Auto-add them?';
    banner.classList.add('visible');
  } else { banner.classList.remove('visible'); }
}

function syncGoalsFromScore() {
  var sA = parseInt(document.getElementById('scoreA').value) || 0;
  var sB = parseInt(document.getElementById('scoreB').value) || 0;
  var existA = tsData.filter(function(t) { return t.type === 'goal' && t.team === 'A'; }).length;
  var existB = tsData.filter(function(t) { return t.type === 'goal' && t.team === 'B'; }).length;
  for (var i = 0; i < Math.max(0, sA - existA); i++) addGoal('A');
  for (var i = 0; i < Math.max(0, sB - existB); i++) addGoal('B');
  document.getElementById('scoreSyncBanner').classList.remove('visible');
  syncDismissed = true;
}

function dismissSync() {
  document.getElementById('scoreSyncBanner').classList.remove('visible');
  syncDismissed = true;
}

// ── Timestamps ───────────────────────────────────────────────────────────────
function addGoal(team) {
  if (team === 'A') homeGoals++; else awayGoals++;
  var id = ++counter, first = tsData.length === 0;
  tsData.push({ id: id, type: 'goal', team: team, hs: homeGoals, as: awayGoals, first: first });
  _appendTs(tsData[tsData.length - 1]);
  checkScoreSync();
}

function addEvent(label) {
  var id = ++counter, first = tsData.length === 0;
  tsData.push({ id: id, type: 'event', label: label, first: first });
  _appendTs(tsData[tsData.length - 1]);
}

function addCustomEvent() {
  var label = prompt('Event name (e.g. "Penalty miss"):');
  if (label) addEvent(label);
}

function _appendTs(ts) {
  var list = document.getElementById('tsList');
  var hint = list.querySelector('.empty-hint'); if (hint) hint.remove();
  var a = document.getElementById('teamA').value || 'Home';
  var b = document.getElementById('teamB').value || 'Away';
  var defaultVal = ts.first ? '00:26' : '';
  var goalClass = ts.type === 'goal' ? (ts.team === 'A' ? 'goal-home' : 'goal-away') : 'event';
  var div = document.createElement('div');
  div.className = 'ts-row'; div.dataset.tsid = ts.id;
  div.draggable = true;
  var inner = ts.type === 'goal'
    ? '<span class="ts-badge ' + goalClass + '" data-lteam="' + ts.team + '">' + (ts.team === 'A' ? a : b) + ' Goal</span><span class="ts-score" data-hs="' + ts.hs + '" data-as="' + ts.as + '">' + a + ' ' + ts.hs + '-' + ts.as + ' ' + b + '</span><input type="text" placeholder="\u2026" class="ts-note" data-id="' + ts.id + '">'
    : '<span class="ts-badge event">' + ts.label + '</span><input type="text" placeholder="\u2026" class="ts-note" data-id="' + ts.id + '">';
  div.innerHTML = '<input type="text" placeholder="00:00" value="' + defaultVal + '" class="ts-time-input" data-id="' + ts.id + '" oninput="Gen.formatTimeInput(this)" onblur="Gen.onTimeBlur(this)" maxlength="5"><div class="ts-inner">' + inner + '</div><div class="drag-handle" title="Drag to reorder">\u2807</div><button class="btn-remove" onclick="Gen.removeTs(' + ts.id + ')">&times;</button>';
  div.addEventListener('dragstart', onDragStart);
  div.addEventListener('dragover', onDragOver);
  div.addEventListener('drop', onDrop);
  div.addEventListener('dragend', onDragEnd);
  list.appendChild(div);
  autoSortTimestamps();
}

function removeTs(id) {
  var idx = tsData.findIndex(function(t) { return t.id === id; }); if (idx === -1) return;
  tsData.splice(idx, 1);
  var el = document.querySelector('.ts-row[data-tsid="' + id + '"]'); if (el) el.remove();
  homeGoals = 0; awayGoals = 0;
  tsData.forEach(function(t, i) {
    if (t.type === 'goal') { if (t.team === 'A') homeGoals++; else awayGoals++; t.hs = homeGoals; t.as = awayGoals; }
    t.first = (i === 0);
  });
  updateGoalLabels();
  if (!tsData.length) document.getElementById('tsList').innerHTML = '<div class="empty-hint">No timestamps yet \u2014 add goals and events below.</div>';
  syncDismissed = false; checkScoreSync();
}

// ── Channels (uses app.js global: creators) ──────────────────────────────────
function channelsByTeam() {
  var m = {};
  creators.forEach(function(c) {
    if (!c.team || !c.channel) return;
    (m[c.team] = m[c.team] || []).push({ name: c.name, url: c.channel });
  });
  return m;
}

function addChannel() {
  var id = ++counter; chData.push({ id: id }); _appendCh(id);
}

function _appendCh(id) {
  var list = document.getElementById('chList');
  var hint = list.querySelector('.empty-hint'); if (hint) hint.remove();
  var map = channelsByTeam();
  var teamOpts = Object.keys(map).sort().map(function(t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
  var div = document.createElement('div');
  div.className = 'ch-row'; div.dataset.chid = id;
  div.innerHTML = '<select class="ch-team" data-id="' + id + '" onchange="Gen.onTeamChange(this,' + id + ')"><option value="">Select team...</option>' + teamOpts + '</select><select class="ch-chan" data-id="' + id + '" onchange="Gen.onChanChange(this,' + id + ')"><option value="">\u2014 pick team first \u2014</option></select><a href="#" class="ch-link empty" id="chLink' + id + '" target="_blank" rel="noopener" title="Open channel">\u2197</a><button class="btn-remove" onclick="Gen.removeChannel(' + id + ')">&times;</button>';
  list.appendChild(div);
}

function removeChannel(id) {
  chData.splice(chData.findIndex(function(c) { return c.id === id; }), 1);
  var el = document.querySelector('.ch-row[data-chid="' + id + '"]'); if (el) el.remove();
  if (!chData.length) document.getElementById('chList').innerHTML = '<div class="empty-hint">No channels added yet.</div>';
}

function onTeamChange(sel, id) {
  var t = sel.value, ch = document.querySelector('.ch-chan[data-id="' + id + '"]');
  var map = channelsByTeam();
  if (!t || !map[t]) { ch.innerHTML = '<option value="">\u2014 pick team first \u2014</option>'; updateChLink(id, ''); return; }
  var sorted = map[t].slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
  ch.innerHTML = '<option value="">Select channel...</option>' + sorted.map(function(c) { return '<option value="' + c.url + '">' + c.name + '</option>'; }).join('');
  updateChLink(id, '');
}

function onChanChange(sel, id) { updateChLink(id, sel.value); }

function updateChLink(id, url) {
  var link = document.getElementById('chLink' + id);
  if (!link) return;
  if (url) { link.href = url; link.classList.remove('empty'); }
  else { link.href = '#'; link.classList.add('empty'); }
}

function chName(id) { var s = document.querySelector('.ch-chan[data-id="' + id + '"]'); return s ? s.options[s.selectedIndex]?.text || '' : ''; }
function chUrl(id) { return document.querySelector('.ch-chan[data-id="' + id + '"]')?.value || ''; }

// ── Tags ─────────────────────────────────────────────────────────────────────
function buildTags(list) {
  var out = [], len = 0;
  for (var i = 0; i < list.length; i++) {
    var s = list[i].trim(); if (!s) continue;
    var add = out.length === 0 ? s.length : s.length + 2;
    if (len + add > 500) break;
    out.push(s); len += add;
  }
  return out.join(', ');
}

function plainEmotion(e) { return e.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '').trim(); }

// ── Validation ───────────────────────────────────────────────────────────────
function validate() {
  var errors = [];
  if (!document.getElementById('teamA').value.trim()) errors.push('Home team name is missing');
  if (!document.getElementById('teamB').value.trim()) errors.push('Away team name is missing');
  if (!document.getElementById('emotion').value.trim()) errors.push('No emotion word selected');
  var banner = document.getElementById('validationBanner');
  var list = document.getElementById('validationList');
  if (errors.length) {
    list.innerHTML = errors.map(function(e) { return '<li>' + e + '</li>'; }).join('');
    banner.classList.add('visible');
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  banner.classList.remove('visible');
  return true;
}

// ── Reset ────────────────────────────────────────────────────────────────────
function confirmReset() {
  if (!confirm('Start a new video? All current data will be cleared.')) return;
  resetAll();
}

function resetAll() {
  tsData.length = 0; chData.length = 0;
  homeGoals = 0; awayGoals = 0; counter = 0; syncDismissed = false;
  ['teamA', 'teamB', 'emotion', 'rivalTeam', 'transferName', 'linkTT'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  populateTeamDropdowns();
  document.getElementById('scoreA').value = 0;
  document.getElementById('scoreB').value = 0;
  autoSelectCompetition();
  document.querySelectorAll('.etag').forEach(function(e) { e.classList.remove('active'); });
  document.getElementById('tsList').innerHTML = '<div class="empty-hint">No timestamps yet \u2014 add goals and events below.</div>';
  document.getElementById('chList').innerHTML = '<div class="empty-hint">No channels added yet.</div>';
  document.getElementById('outputSection').classList.remove('visible');
  document.getElementById('statusBar').classList.remove('visible');
  document.getElementById('validationBanner').classList.remove('visible');
  document.getElementById('scoreSyncBanner').classList.remove('visible');
  document.getElementById('goalALabel').textContent = 'Home';
  document.getElementById('goalBLabel').textContent = 'Away';
  setType('fan');
  addChannel(); addChannel(); addChannel();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Generate ─────────────────────────────────────────────────────────────────
function generate() {
  if (!validate()) return;

  var tA = document.getElementById('teamA').value.trim();
  var tB = document.getElementById('teamB').value.trim();
  var sA = document.getElementById('scoreA').value, sB = document.getElementById('scoreB').value;
  var score = sA + '-' + sB, comp = document.getElementById('competition').value;
  var emotRaw = document.getElementById('emotion').value.trim().toUpperCase();
  var emotPlain = plainEmotion(emotRaw);
  var rival = document.getElementById('rivalTeam').value.trim() || 'Rival';
  var tName = document.getElementById('transferName').value.trim() || 'Player';
  var tType = document.getElementById('transferType').value;
  var tt = document.getElementById('linkTT').value.trim();

  var lines = [{ time: '00:00', label: 'Introduction' }];
  tsData.forEach(function(ts, i) {
    var rawTime = document.querySelector('.ts-time-input[data-id="' + ts.id + '"]')?.value || '';
    var time = (i === 0 && !rawTime) ? '00:26' : (rawTime || '00:26');
    var note = document.querySelector('.ts-note[data-id="' + ts.id + '"]')?.value || '';
    var label = ts.type === 'goal' ? tA + ' ' + ts.hs + '-' + ts.as + ' ' + tB + (note ? ' \u2014 ' + note : '') : ts.label + (note ? ' \u2014 ' + note : '');
    lines.push({ time: time, label: label });
  });
  var tsBlock = lines.map(function(l) { return l.time ? l.time + ' \u2013 ' + l.label : l.label; }).join('\n');

  var chLines = chData.map(function(ch) {
    var name = chName(ch.id), url = chUrl(ch.id);
    if (!name || name === 'Select channel...' || name === '\u2014 pick team first \u2014') return null;
    return '\u26BD ' + name + ' \u2014 ' + url;
  }).filter(Boolean);
  var chBlock = chLines.length ? chLines.join('\n') : '\u26BD [Add channel credits above]';
  var social = ['\u{1F4F8} Instagram: ' + FIXED_IG, tt ? '\u{1F3B5} TikTok: ' + tt : '', '\u{1F426} X: ' + FIXED_X].filter(Boolean).join('\n');

  var title = '', desc = '', tags = [];
  if (videoType === 'fan') {
    title = tA + ' Fans ' + emotRaw + ' Reactions to ' + tA + ' ' + score + ' ' + tB + ' | ' + comp + ' Fan Reactions';
    desc = tA + ' fans react to ' + tA + ' ' + score + ' ' + tB + ' \u2014 every goal, every moment, every emotion. Watch die-hard ' + tA + ' supporters experience every goal, every near-miss, and every heart-stopping moment of this ' + comp + ' match in real time. From pure ecstasy to absolute heartbreak \u2014 this is what football means to real fans.\n\n\u23F1\uFE0F TIMESTAMPS\n' + tsBlock + '\n\n\u{1F4FA} FAN CHANNELS IN THIS VIDEO\nShow some love \u2014 subscribe to the creators who appear:\n' + chBlock + '\n\n\u2014\n\n' + PROMO_BLOCK + '\n\n\u{1F514} Subscribe for fan reaction compilations posted the moment the final whistle blows \u2014 Premier League and Champions League every matchday.\n\n' + social;
    tags = [tA + ' Fan Reaction', tA + ' Fans React', tA + ' vs ' + tB, tA + ' ' + score + ' ' + tB, comp + ' Fan Reactions', 'Football Fan Reactions', tA + ' goal reaction', tA + ' watchalong', 'Premier League Fan Reactions', 'Champions League Fan Reactions', 'fan reactions football', tA + ' fans ' + emotPlain.toLowerCase(), tB + ' fan reaction', 'fan reactions compilation', 'football reactions'];
  } else if (videoType === 'mixed') {
    title = tA + ' & ' + tB + ' Fans ' + emotRaw + ' Reactions to ' + tA + ' ' + score + ' ' + tB + ' | ' + comp + ' Fan Reactions';
    desc = tA + ' and ' + tB + ' fans react to ' + tA + ' ' + score + ' ' + tB + ' \u2014 every goal, every moment, every emotion from both sides. Watch die-hard supporters from both clubs experience every goal, every near-miss, and every heart-stopping moment of this ' + comp + ' match in real time. From pure ecstasy to absolute heartbreak \u2014 this is what football means to real fans.\n\n\u23F1\uFE0F TIMESTAMPS\n' + tsBlock + '\n\n\u{1F4FA} FAN CHANNELS IN THIS VIDEO\nShow some love \u2014 subscribe to the creators who appear:\n' + chBlock + '\n\n\u2014\n\n' + PROMO_BLOCK + '\n\n\u{1F514} Subscribe for fan reaction compilations posted the moment the final whistle blows \u2014 Premier League and Champions League every matchday.\n\n' + social;
    tags = [tA + ' Fan Reaction', tB + ' Fan Reaction', tA + ' ' + tB + ' Fans React', tA + ' vs ' + tB, tA + ' ' + score + ' ' + tB, comp + ' Fan Reactions', 'Football Fan Reactions', tA + ' goal reaction', tB + ' goal reaction', 'Premier League Fan Reactions', 'Champions League Fan Reactions', 'fan reactions football', 'mixed fan reactions', 'fan reactions compilation', 'football reactions'];
  } else if (videoType === 'rivals') {
    title = rival + ' Fans ' + emotRaw + ' Watching ' + tA + ' ' + score + ' ' + tB + ' | ' + comp + ' Rivals Reactions';
    desc = rival + ' fans react to ' + tB + "'s " + score + ' defeat \u2014 and they are absolutely loving every second of it. Watch rival supporters celebrate, mock, and revel in ' + tB + "'s misery as the goals go in. Pure schadenfreude. This is football at its most ruthless.\n\n\u23F1\uFE0F TIMESTAMPS\n" + tsBlock + '\n\n\u{1F4FA} FAN CHANNELS IN THIS VIDEO\nShow some love \u2014 subscribe to the creators who appear:\n' + chBlock + '\n\n\u2014\n\n' + PROMO_BLOCK + '\n\n\u{1F514} Subscribe \u2014 new reaction compilations posted at full time, every Premier League and Champions League matchday.\n\n' + social;
    tags = [rival + ' Fans React', tB + ' Fan Reactions', 'Rivals React', 'Haters React', tA + ' ' + score + ' ' + tB, comp + ' Rivals Reactions', 'Football Schadenfreude', rival + ' reaction to ' + tB, 'Premier League Rivals Reactions', tB + ' fans ' + emotPlain.toLowerCase(), 'fan reactions', 'rivals and haters', 'football fan reactions', 'schadenfreude football', tA + ' ' + tB + ' reaction'];
  } else if (videoType === 'postmatch') {
    title = tA + ' & ' + tB + ' Fans ' + emotRaw + ' Post-Match Reactions | ' + tA + ' ' + score + ' ' + tB + ' | ' + comp;
    desc = tA + ' ' + score + ' ' + tB + ' \u2014 post-match fan reactions. Watch ' + tA + ' and ' + tB + ' fans process what just happened. The highs, the lows, the disbelief, the fury \u2014 unfiltered and in real time.\n\n\u23F1\uFE0F TIMESTAMPS\n' + tsBlock + '\n\n\u{1F4FA} FAN CHANNELS IN THIS VIDEO\n' + chBlock + '\n\n\u2014\n\n' + PROMO_BLOCK + '\n\n\u{1F514} Subscribe \u2014 post-match reactions and fan compilation videos every Premier League and Champions League matchday.\n\n' + social;
    tags = [tA + ' Post Match Reaction', tB + ' Post Match Reaction', tA + ' ' + score + ' ' + tB, 'Post Match Fan Reactions', comp + ' Post Match', tA + ' fans', tB + ' fans', 'full time reaction', 'Football Fan Reactions', 'Premier League Post Match', 'Champions League Post Match', emotPlain.toLowerCase() + ' fans', tA + ' ' + tB + ' reaction', 'football fan reactions', 'post match reactions'];
  } else {
    var verb = tType === 'signing' ? 'SIGNS' : tType === 'sacking' ? 'SACKED' : 'LEAVES';
    var vd = tType === 'signing' ? 'joining' : tType === 'sacking' ? 'being sacked from' : 'leaving';
    title = tA + ' Fans ' + emotRaw + ' as ' + tName + ' ' + verb + ' | ' + comp + ' Fan Reactions';
    desc = tA + ' fans react to ' + tName + ' ' + vd + ' ' + tA + '. Every emotion, every take, unfiltered \u2014 this is what it means to be a football fan when the news breaks.\n\n\u{1F4FA} FAN CHANNELS IN THIS VIDEO\n' + chBlock + '\n\n\u2014\n\n' + PROMO_BLOCK + '\n\n\u{1F514} Subscribe \u2014 reaction compilations posted immediately as the news breaks.\n\n' + social;
    tags = [tA + ' Fan Reaction', tName + ' ' + tA, tA + ' ' + tType, tName + ' reaction', 'Football Transfer Reaction', comp + ' Transfer', tA + ' fans', tName + ' ' + verb.toLowerCase(), 'football fan reactions', 'Premier League transfer', tA + ' transfer news', 'fan reactions', tName, 'football news reaction'];
  }

  var tagsStr = buildTags(tags);
  document.getElementById('outTitle').textContent = title;
  document.getElementById('outDesc').textContent = desc;
  document.getElementById('outTags').textContent = tagsStr;

  var tLen = title.length;
  var tcc = document.getElementById('titleCharCount');
  tcc.textContent = tLen + '/100';
  tcc.className = 'tag-count ' + (tLen > 100 ? 'tag-warn' : (tLen > 85 ? 'tag-warn' : 'tag-ok'));

  var cnt = document.getElementById('tagCount');
  cnt.textContent = tagsStr.length + '/500 chars';
  cnt.className = 'tag-count ' + (tagsStr.length <= 500 ? 'tag-ok' : 'tag-warn');

  var out = document.getElementById('outputSection');
  out.classList.add('visible');
  document.getElementById('statusBar').classList.add('visible');
  setTimeout(function() { out.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
}

// ── Copy ─────────────────────────────────────────────────────────────────────
function scrollToOutput() {
  document.getElementById('outputSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyField(id, btn) {
  navigator.clipboard.writeText(document.getElementById(id).textContent).then(function() {
    btn.textContent = '\u2713 Copied'; btn.classList.add('copied');
    setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

function copyAll(btn) {
  var title = document.getElementById('outTitle').textContent;
  var desc = document.getElementById('outDesc').textContent;
  var tags = document.getElementById('outTags').textContent;
  if (!title) { alert('Generate content first!'); return; }
  var sep = '\u2500'.repeat(60);
  var all = 'TITLE:\n' + title + '\n\n' + sep + '\n\nDESCRIPTION:\n' + desc + '\n\n' + sep + '\n\nTAGS:\n' + tags;
  navigator.clipboard.writeText(all).then(function() {
    var orig = btn.textContent || btn.innerHTML;
    btn.textContent = '\u2713 All Copied!'; btn.classList.add('copied');
    setTimeout(function() { btn.textContent = orig; btn.classList.remove('copied'); }, 2500);
  });
}

// ── Time input formatter ─────────────────────────────────────────────────────
function formatTimeInput(input) {
  var d = input.value.replace(/[^0-9]/g, '');
  if (d.length > 4) d = d.slice(0, 4);
  input.value = d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d;
}

function onTimeBlur() { autoSortTimestamps(); }

// ── Auto-sort timestamps ─────────────────────────────────────────────────────
function timeToSeconds(t) {
  if (!t || !t.includes(':')) return Infinity;
  var parts = t.split(':');
  return parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0);
}

function autoSortTimestamps() {
  var list = document.getElementById('tsList');
  var rows = [].slice.call(list.querySelectorAll('.ts-row'));
  if (rows.length < 2) return;
  var withTimes = rows.map(function(row) {
    var timeEl = row.querySelector('.ts-time-input');
    var val = timeEl ? timeEl.value : '';
    return { row: row, secs: timeToSeconds(val), val: val };
  });
  if (!withTimes.some(function(r) { return r.val && r.val.includes(':'); })) return;
  withTimes.sort(function(a, b) { return a.secs - b.secs; });
  withTimes.forEach(function(item) { list.appendChild(item.row); });
  recalcScores();
}

function recalcScores() {
  var list = document.getElementById('tsList');
  var rows = [].slice.call(list.querySelectorAll('.ts-row'));
  var tA = document.getElementById('teamA').value || 'Home';
  var tB = document.getElementById('teamB').value || 'Away';
  var ha = 0, hb = 0;
  rows.forEach(function(row) {
    var id = row.dataset.tsid;
    var ts = tsData.find(function(t) { return t.id == id; });
    if (!ts || ts.type !== 'goal') return;
    if (ts.team === 'A') ha++; else hb++;
    ts.hs = ha; ts.as = hb;
    var badge = row.querySelector('[data-lteam]');
    if (badge) badge.textContent = (ts.team === 'A' ? tA : tB) + ' Goal';
    var scoreEl = row.querySelector('.ts-score');
    if (scoreEl) { scoreEl.dataset.hs = ha; scoreEl.dataset.as = hb; scoreEl.textContent = tA + ' ' + ha + '-' + hb + ' ' + tB; }
  });
  homeGoals = ha; awayGoals = hb;
}

// ── Drag and drop ────────────────────────────────────────────────────────────
var dragSrcEl = null;

function onDragStart(e) {
  dragSrcEl = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.tsid);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.ts-row').forEach(function(r) { r.classList.remove('drag-over'); });
  this.classList.add('drag-over');
  return false;
}

function onDrop(e) {
  e.stopPropagation();
  if (dragSrcEl !== this) {
    var list = document.getElementById('tsList');
    var rows = [].slice.call(list.querySelectorAll('.ts-row'));
    var srcIdx = rows.indexOf(dragSrcEl);
    var tgtIdx = rows.indexOf(this);
    if (srcIdx < tgtIdx) list.insertBefore(dragSrcEl, this.nextSibling);
    else list.insertBefore(dragSrcEl, this);
  }
  document.querySelectorAll('.ts-row').forEach(function(r) { r.classList.remove('drag-over'); });
  return false;
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.ts-row').forEach(function(r) { r.classList.remove('drag-over'); });
}

// ── Public API ───────────────────────────────────────────────────────────────
window.Gen = {
  renderHTML: renderHTML,
  init: init,
  cleanup: cleanup,
  setType: setType,
  onTeamSelect: onTeamSelect,
  updateGoalLabels: updateGoalLabels,
  checkScoreSync: checkScoreSync,
  syncGoalsFromScore: syncGoalsFromScore,
  dismissSync: dismissSync,
  pickEmotion: pickEmotion,
  clearEmotion: clearEmotion,
  onEmotionType: onEmotionType,
  addGoal: addGoal,
  addEvent: addEvent,
  addCustomEvent: addCustomEvent,
  removeTs: removeTs,
  addChannel: addChannel,
  removeChannel: removeChannel,
  onTeamChange: onTeamChange,
  onChanChange: onChanChange,
  generate: generate,
  confirmReset: confirmReset,
  scrollToOutput: scrollToOutput,
  copyField: copyField,
  copyAll: copyAll,
  formatTimeInput: formatTimeInput,
  onTimeBlur: onTimeBlur
};

})();
