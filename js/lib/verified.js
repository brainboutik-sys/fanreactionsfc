/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — paid Verified creator tier
   Loaded before app.js (see index.html). Netlify functions must not
   require this file; they keep an equivalent copy of isCurrentlyVerified
   / sortVerifiedFirst / statsShareCopy. Tests assert those copies match.

   A creator counts as verified when the paid flag is true AND
   verified_until is null or in the future. The legacy `verified` column
   is a different admin flag and does not grant this tier.
   ═══════════════════════════════════════════════════════════════════════════ */

// Live Stripe Payment Link for the Verified tier. Do not create a Stripe
// product, price, Checkout Session, or webhook in this codebase. Verified
// status is set with SQL — see
// supabase/migrations/20261014120000_verified_creator_tier.sql
const VERIFIED_PRICE_LABEL = 'CHF 4/month';
const VERIFIED_STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/aFabJ03Rd2xw0KW4v0ffy00';

function isCurrentlyVerified(row, now) {
  if (!row) return false;
  const flag = row.isVerified !== undefined ? row.isVerified : row.is_verified;
  if (flag !== true) return false;
  const until = row.verifiedUntil !== undefined ? row.verifiedUntil : row.verified_until;
  if (until == null || until === '') return true;
  const ts = new Date(until).getTime();
  const clock = typeof now === 'number' ? now : (now instanceof Date ? now.getTime() : Date.now());
  return Number.isFinite(ts) && ts > clock;
}

// Stable partition. The caller passes the list in its existing order
// (subscriber count, name, recency, selection). Verified rows move ahead
// of the others and both groups keep their relative order.
function sortVerifiedFirst(list, now) {
  const pinned = [];
  const rest = [];
  for (const item of list || []) {
    if (isCurrentlyVerified(item, now)) pinned.push(item);
    else rest.push(item);
  }
  return pinned.concat(rest);
}

function verifiedBadgeHTML(row, now) {
  if (!isCurrentlyVerified(row, now)) return '';
  return '<span class="badge badge-verified" title="Verified creator">Verified</span>';
}

function verifiedFormatCount(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function statsMonthLabel(iso, now) {
  const parsed = iso ? new Date(iso) : null;
  const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(typeof now === 'number' ? now : Date.now());
  return d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function statsShareCopy(input) {
  const name = (input && input.name) || 'This creator';
  const subs = verifiedFormatCount(input && input.subscriberCount);
  const videos = verifiedFormatCount(input && input.videoCount);
  const month = (input && input.monthLabel) || 'This month';
  const latest = input && input.latestTitle ? ` Latest upload: ${input.latestTitle}.` : '';
  return {
    title: `${name} — ${month} YouTube stats | FanReactionsFC`,
    description: `${name} has ${subs} subscribers and ${videos} videos on YouTube. ${month} snapshot from FanReactionsFC.${latest} YouTube totals only — no channel analytics.`,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VERIFIED_PRICE_LABEL,
    VERIFIED_STRIPE_PAYMENT_LINK,
    isCurrentlyVerified,
    sortVerifiedFirst,
    verifiedBadgeHTML,
    verifiedFormatCount,
    statsMonthLabel,
    statsShareCopy,
  };
}
