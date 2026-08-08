/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — slugify()
   Loaded before app.js (see index.html) so its global is ready when
   app.js, admin.js, and generator.js run. Kept in its own file (rather
   than inline in app.js) so it can be unit tested with a plain require()
   — no DOM, no bundler.
   ═══════════════════════════════════════════════════════════════════════════ */

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { slugify };
}
