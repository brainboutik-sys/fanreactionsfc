/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — HTML escaping and URL allowlisting
   Loaded before app.js (see index.html). Kept here so node --test can
   require() it with no DOM and no bundler.
   ═══════════════════════════════════════════════════════════════════════════ */

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only http(s) URLs are safe to put in href/src. javascript:, data:, and
// credentialed URLs are dropped so a stored profile link cannot run script
// or leak a username/password into the page.
function safeUrl(s) {
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch (e) {
    return '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escHtml, safeUrl };
}
