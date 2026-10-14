/* FanReactionsFC — sponsored featured creator on a club hub.
   Loaded before app.js. Netlify prerenders cannot require this file;
   the same two functions are duplicated in netlify/functions/club-og.js.
   Keep the copies in sync.

   A club has zero or one row. The card is shown only while the window
   is active: starts_at is null or <= now, and ends_at is null or > now.
   The slot never carries a rank and never edits the organic list. */

function isSponsorshipActive(row, now) {
  if (!row || !row.creator_id) return false;
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(t)) return false;
  if (row.starts_at) {
    const start = new Date(row.starts_at).getTime();
    if (Number.isNaN(start) || start > t) return false;
  }
  if (row.ends_at) {
    const end = new Date(row.ends_at).getTime();
    if (Number.isNaN(end) || end <= t) return false;
  }
  return true;
}

function sponsorshipEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sponsorshipSlug(name, slug) {
  const ready = String(slug || '').trim();
  if (ready) return ready;
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function sponsorshipBlurb(description) {
  const text = String(description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentenceMatch = text.match(/^.*?[.!?](\s|$)/);
  const sentence = (sentenceMatch ? sentenceMatch[0] : text).trim();
  if (sentence.length <= 180) return sentence;
  const clipped = sentence.slice(0, 177);
  const lastSpace = clipped.lastIndexOf(' ');
  return ((lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trim()) + '…';
}

function sponsorshipSubs(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function sponsorshipHttpUrl(url) {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) return '';
  return value;
}

function sponsorshipInitials(name) {
  return (String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').substring(0, 2) || '?').toUpperCase();
}

// Visible "Sponsored" and "Featured" labels. No rank. Every anchor uses
// rel="sponsored noopener". Not an h2 — the organic list owns the ranking.
function sponsoredSlotHtml(clubName, creator) {
  const name = creator && creator.name ? String(creator.name) : '';
  if (!clubName || !name) return '';
  const subs = creator.subscriberCount != null ? creator.subscriberCount : creator.subscriber_count;
  const slug = sponsorshipSlug(name, creator.slug);
  const profile = slug ? '/creators/' + encodeURIComponent(slug).replace(/%2F/gi, '') : '';
  const youtube = sponsorshipHttpUrl(creator.channel || creator.channel_url);
  const avatar = sponsorshipHttpUrl(creator.avatar || creator.avatar_url);
  const blurb = sponsorshipBlurb(creator.description);
  const alt = name + ' – ' + clubName + ' fan YouTuber';
  const portrait = avatar
    ? `<img class="sponsored-slot-avatar" src="${sponsorshipEscape(avatar)}" alt="${sponsorshipEscape(alt)}" loading="lazy">`
    : `<div class="sponsored-slot-fallback" aria-hidden="true">${sponsorshipEscape(sponsorshipInitials(name))}</div>`;
  const subsLine = Number(subs) > 0
    ? `<p class="sponsored-slot-subs">${sponsorshipEscape(sponsorshipSubs(subs))} subscribers</p>`
    : '';
  const blurbLine = blurb ? `<p class="sponsored-slot-blurb">${sponsorshipEscape(blurb)}</p>` : '';
  const youtubeLink = youtube
    ? `<a class="sponsored-slot-yt" href="${sponsorshipEscape(youtube)}" target="_blank" rel="sponsored noopener">Watch on YouTube</a>`
    : '';
  return `<section class="sponsored-slot" aria-label="Sponsored">
  <div class="sponsored-slot-labels">
    <span class="sponsored-badge">Sponsored</span>
    <span class="sponsored-badge sponsored-badge-featured">Featured</span>
  </div>
  <p class="sponsored-slot-heading">Sponsored: Featured ${sponsorshipEscape(clubName)} creator</p>
  <div class="sponsored-slot-body">
    ${portrait}
    <div class="sponsored-slot-copy">
      ${profile ? `<a class="sponsored-slot-name" href="${sponsorshipEscape(profile)}" rel="sponsored noopener">${sponsorshipEscape(name)}</a>` : `<span class="sponsored-slot-name">${sponsorshipEscape(name)}</span>`}
      ${subsLine}
      ${blurbLine}
      ${youtubeLink}
    </div>
  </div>
</section>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isSponsorshipActive, sponsoredSlotHtml };
}
