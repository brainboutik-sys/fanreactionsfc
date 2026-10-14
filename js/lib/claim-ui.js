/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Claim-channel modal markup
   Loaded after js/lib/html.js. Every interpolated value goes through
   escHtml so a creator name or code cannot break out of the dialog.
   ═══════════════════════════════════════════════════════════════════════════ */

function claimEsc(s) {
  if (typeof escHtml === 'function') return escHtml(s);
  if (typeof require === 'function') return require('./html.js').escHtml(s);
  throw new Error('escHtml is not loaded');
}

function renderClaimModalHtml(opts) {
  const options = opts || {};
  const name = claimEsc(options.creatorName || 'this channel');
  const close = '<button type="button" class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>';
  const intro = `<h2>Claim this channel</h2>
    <p class="modal-sub">Verify you run <strong>${name}</strong> to manage a short bio and your social links on this profile.</p>`;

  if (options.state !== 'ready') {
    return `${close}
      ${intro}
      <p id="claimMsg" class="auth-msg">${options.state === 'loading' ? 'Generating a verification code…' : ''}</p>`;
  }

  const code = claimEsc(options.code || '');
  const expires = claimEsc(options.expiresLabel || 'in 24 hours');
  return `${close}
    ${intro}
    <ol style="font-size:var(--fs-base);color:var(--text-dim);line-height:1.7;padding-left:20px;margin-bottom:14px">
      <li>Open your channel's <strong>About</strong> section on YouTube.</li>
      <li>Add this code anywhere in the description: <code id="claimCode" style="background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-weight:700;color:var(--text)">${code}</code></li>
      <li>Save, wait a moment for YouTube to update, then click Verify. The code expires ${expires} and is shown only once.</li>
    </ol>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn btn-ghost" id="claimCopyBtn">Copy code</button>
      <button type="button" class="btn btn-primary" id="claimVerifyBtn" style="flex:1">Verify</button>
    </div>
    <p id="claimMsg" class="auth-msg"></p>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderClaimModalHtml };
}
