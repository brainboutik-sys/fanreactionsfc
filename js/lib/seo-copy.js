/* FanReactionsFC SEO copy — Neil, 2026-10-17.
   Loaded before app.js. Netlify prerenders cannot require this file;
   the same functions are duplicated in netlify/functions/club-og.js
   and netlify/functions/news-article.js. Keep the copies in sync.

   Swap the template strings in HUB_COPY / ARTICLE_COPY. {N}, {Top} and
   {subs} are filled from live creator rows at render time. */

// SEO_COPY_START
// ── Club hub templates ────────────────────────────────────────────────────
const HUB_TITLE_MAX = 60;
const HUB_META_MAX = 155;
const HUB_COPY = {
  titleFull: 'Best {Club} Fan YouTubers ({YYYY}) – Ranked | FanReactionsFC',
  titleShort: 'Best {Club} Fan YouTubers {YYYY} | FanReactionsFC',
  meta: 'The {N} best {Club} fan YouTubers ranked: watchalongs, reactions and fan TV. #1 is {Top}. Updated {Month YYYY}.',
  metaNoRank: '{Club} fan YouTubers: watchalongs, reactions and fan TV. Updated {Month YYYY}.',
  h1: 'Best {Club} Fan YouTubers',
  intro: 'The best {Club} fan YouTuber right now is {Top}, the most-followed of {N} {Club} fan channels in our directory. Fan Reactions FC ranks independent fan channels only (watchalongs, match reactions and fan TV), never official club accounts.',
  method: 'Ranked by subscribers. Updated {Month YYYY}.',
  h2Ranked: 'Top {N} {Club} Fan YouTubers Ranked',
  h2Videos: 'Latest {Club} Fan Videos',
  h2Faq: '{Club} Fan YouTubers FAQ',
  h2How: 'How We Rank {Club} Fan Channels',
  h2Related: 'Related',
  howBody: 'Channels are ranked by YouTube subscribers, refreshed regularly. Only independent fan channels are listed.',
  faqBiggestQ: 'Who is the biggest {Club} fan YouTuber?',
  faqBiggestA: '{Top} is the most-followed {Club} fan channel in our directory, with {subs} subscribers.',
  faqWatchQ: 'Which {Club} fan YouTubers do watchalongs?',
  faqWatchA: '{Names} do {Club} watchalongs.',
  faqWatchAOne: '{Names} does {Club} watchalongs.',
  faqHowQ: 'How is this {Club} ranking made?',
  faqHowA: 'Channels are ranked by YouTube subscribers, refreshed regularly. Only independent fan channels are listed.',
  faqListQ: 'How do I get my {Club} channel listed?',
  faqListA: 'Submit it on the Become a creator page. Listing is free.',
  avatarAlt: '{Channel} - {Club} fan YouTuber',
  relatedAnchor: '{Club} fan YouTubers',
};

// ── Article templates ─────────────────────────────────────────────────────
const ARTICLE_TITLE_MAX = 60;
const ARTICLE_META_MAX = 155;
const ARTICLE_TITLE_SUFFIX = ' | FanReactionsFC';
const ARTICLE_COPY = {
  title: '{Club} fan YouTubers react: {Event} | FanReactionsFC',
  twoClub: '{A} and {B} fan YouTubers react to {Score}',
  preview: '{A} v {B} preview: fan YouTubers',
  metaLead: '{Club} fan YouTubers react to {Event}.',
  more: 'More {Club} fan YouTubers',
  coverAlt: '{Club} fan YouTubers react: {Headline}',
  updated: 'Updated {Date}',
  published: 'Published {Date}',
};

// Display names are the existing short names (Man City, not Manchester City).
// Headline aliases only where the longer name is unambiguous.
const SEO_CLUB_NAMES = [
  'Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Chelsea','Coventry','Crystal Palace','Everton','Fulham','Hull City','Ipswich','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham',
  'Birmingham','Blackburn','Bristol City','Burnley','Charlton','Derby','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','West Ham','Wolves','Wrexham','Luton',
  'Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes',
  'Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como',
  'Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli',
  'PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne',
];
const SEO_CLUB_SLUG_OVERRIDES = {
  'Man United': 'manchester-united',
  'Man City': 'manchester-city',
  'Nottm Forest': 'nottingham-forest',
  'Oxford Utd': 'oxford-united',
  'Sheffield Utd': 'sheffield-united',
  'Sheffield Wed': 'sheffield-wednesday',
  'West Brom': 'west-bromwich-albion',
};
const SEO_HEADLINE_ALIASES = [
  ['Manchester City', 'Man City'],
  ['Manchester United', 'Man United'],
  ['Man Utd', 'Man United'],
  ['Nottingham Forest', 'Nottm Forest'],
  ['Paris Saint-Germain', 'PSG'],
  ['Newcastle United', 'Newcastle'],
  ['West Ham United', 'West Ham'],
  ['Wolverhampton', 'Wolves'],
  ['Spurs', 'Tottenham'],
];

function seoFill(template, vars) {
  return String(template).replace(/\{([A-Za-z0-9 ]+)\}/g, function (_, key) {
    return vars && vars[key] != null ? String(vars[key]) : '';
  });
}

function seoSlugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function seoAsDate(now) {
  if (now instanceof Date) return now;
  const d = now ? new Date(now) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function seoYear(now) {
  return String(seoAsDate(now).getUTCFullYear());
}

function seoMonthYear(now) {
  return seoAsDate(now).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function seoClip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(0, max - 1));
  const sp = cut.lastIndexOf(' ');
  return ((sp > 40 ? cut.slice(0, sp) : cut).replace(/[.,;:]+$/, '')).trim() + '…';
}

function seoClipWords(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || max <= 0) return '';
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const sp = cut.lastIndexOf(' ');
  const out = (sp > 0 ? t.slice(0, sp) : t.slice(0, max)).trim();
  return out.replace(/[.,;:–\-]+$/, '').trim();
}

function hubTitle(club, now) {
  const yyyy = seoYear(now);
  const full = seoFill(HUB_COPY.titleFull, { Club: club, YYYY: yyyy });
  if (full.length <= HUB_TITLE_MAX) return full;
  return seoFill(HUB_COPY.titleShort, { Club: club, YYYY: yyyy });
}

function hubH1(club) {
  return seoFill(HUB_COPY.h1, { Club: club });
}

function hubMeta(club, count, topName, now) {
  const month = seoMonthYear(now);
  const n = Number(count) || 0;
  if (!topName || n < 1) {
    return seoClip(seoFill(HUB_COPY.metaNoRank, { Club: club, 'Month YYYY': month }), HUB_META_MAX);
  }
  return seoClip(seoFill(HUB_COPY.meta, {
    N: n,
    Club: club,
    Top: topName,
    'Month YYYY': month,
  }), HUB_META_MAX);
}

function hubIntro(club, count, topName) {
  if (!topName || !(Number(count) > 0)) return '';
  return seoFill(HUB_COPY.intro, { Club: club, N: count, Top: topName });
}

function hubMethod(now) {
  return seoFill(HUB_COPY.method, { 'Month YYYY': seoMonthYear(now) });
}

function hubRankedHeading(club, count) {
  const n = Number(count) || 0;
  if (n < 1) return '';
  return seoFill(HUB_COPY.h2Ranked, { N: n, Club: club });
}

function hubAvatarAlt(channel, club) {
  return seoFill(HUB_COPY.avatarAlt, { Channel: channel, Club: club });
}

// #1 / "most-followed" copy skips the paid slot. If that slot IS the
// subscriber leader, there is no #1 claim (the visible rank list is unchanged).
function hubClaimTop(creators, sponsored) {
  const list = creators || [];
  const leader = list[0];
  if (!leader || !leader.name) return null;
  const sid = sponsored && sponsored.id;
  if (sid && leader.id === sid) return null;
  const subs = leader.subscriber_count != null ? leader.subscriber_count : leader.subscriberCount;
  if (!(Number(subs) > 0)) return null;
  return leader;
}

function seoNameList(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return list[0] + ' and ' + list[1];
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

function buildHubFaqs(opts) {
  const club = opts && opts.club;
  const faqs = [];
  if (opts && opts.topName && opts.subs) {
    faqs.push({
      q: seoFill(HUB_COPY.faqBiggestQ, { Club: club }),
      a: seoFill(HUB_COPY.faqBiggestA, { Club: club, Top: opts.topName, subs: opts.subs }),
    });
  }
  const watch = (opts && opts.watchNames) || [];
  if (watch.length) {
    faqs.push({
      q: seoFill(HUB_COPY.faqWatchQ, { Club: club }),
      a: seoFill(watch.length === 1 ? HUB_COPY.faqWatchAOne : HUB_COPY.faqWatchA, {
        Club: club,
        Names: seoNameList(watch),
      }),
    });
  }
  faqs.push({
    q: seoFill(HUB_COPY.faqHowQ, { Club: club }),
    a: HUB_COPY.faqHowA,
  });
  faqs.push({
    q: seoFill(HUB_COPY.faqListQ, { Club: club }),
    a: HUB_COPY.faqListA,
  });
  return faqs;
}

function seoEscapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function seoClubMatchList() {
  const rows = SEO_CLUB_NAMES.map(function (name) { return { label: name, display: name }; });
  SEO_HEADLINE_ALIASES.forEach(function (pair) { rows.push({ label: pair[0], display: pair[1] }); });
  rows.sort(function (a, b) { return b.label.length - a.label.length; });
  return rows;
}

function articleClubName(related) {
  const raw = String(related || '').trim();
  if (!raw || /^(none|null|n\/a|undefined)$/i.test(raw)) return '';
  if (/^multi-club/i.test(raw)) return '';
  for (let i = 0; i < SEO_CLUB_NAMES.length; i++) {
    if (SEO_CLUB_NAMES[i].toLowerCase() === raw.toLowerCase()) return SEO_CLUB_NAMES[i];
  }
  const slug = seoSlugify(raw);
  if (!slug || slug === 'none' || slug === 'multi-club') return '';
  const keys = Object.keys(SEO_CLUB_SLUG_OVERRIDES);
  for (let i = 0; i < keys.length; i++) {
    if (SEO_CLUB_SLUG_OVERRIDES[keys[i]] === slug) return keys[i];
  }
  for (let i = 0; i < SEO_CLUB_NAMES.length; i++) {
    if (seoSlugify(SEO_CLUB_NAMES[i]) === slug) return SEO_CLUB_NAMES[i];
  }
  return '';
}

function clubsInHeadline(headline) {
  const text = String(headline || '');
  const found = [];
  seoClubMatchList().forEach(function (row) {
    if (found.some(function (f) { return f.display === row.display; })) return;
    const re = new RegExp('\\b' + seoEscapeReg(row.label) + '\\b', 'i');
    const idx = text.search(re);
    if (idx >= 0) found.push({ display: row.display, index: idx });
  });
  found.sort(function (a, b) { return a.index - b.index; });
  return found.map(function (f) { return f.display; });
}

function eventFromHeadline(headline) {
  let s = String(headline || '').replace(/\s+/g, ' ').trim();
  const react = s.match(/\bYouTubers\s+react\s+(?:as|to)\s+(.+)$/i);
  const preview = s.match(/\bYouTubers\s+preview\s+(.+)$/i);
  if (react) s = react[1];
  else if (preview) s = preview[1];
  return s.replace(/^[\s,.:;\-–]+/, '').replace(/[.\s]+$/, '').trim();
}

function fitArticleTitle(core) {
  let c = String(core || '').replace(/\s+/g, ' ').trim();
  c = c.replace(/\s*\|\s*FanReactionsFC\s*$/, '').trim();
  if (!c) c = 'FanReactionsFC';
  const full = c + ARTICLE_TITLE_SUFFIX;
  if (full.length <= ARTICLE_TITLE_MAX) return full;
  return seoClipWords(c, ARTICLE_TITLE_MAX - ARTICLE_TITLE_SUFFIX.length) + ARTICLE_TITLE_SUFFIX;
}

function articleSeoTitle(article) {
  const headline = (article && (article.title || article.headline)) || '';
  const primary = articleClubName(article && (article.related_team || article.relatedTeam));
  const mentioned = clubsInHeadline(headline);
  const other = mentioned.filter(function (name) { return name !== primary; })[0] || '';
  const pair = !primary && mentioned.length >= 2 ? mentioned : null;
  const a = primary || (pair ? pair[0] : '');
  const b = primary ? other : (pair ? pair[1] : '');
  const scoreMatch = String(headline).match(/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/);
  const score = scoreMatch ? scoreMatch[0].replace(/\s+/g, '') : '';
  if (a && b && /\bpreview\b/i.test(headline)) {
    return fitArticleTitle(seoFill(ARTICLE_COPY.preview, { A: a, B: b }));
  }
  if (a && b && score && /\breact\b/i.test(headline)) {
    return fitArticleTitle(seoFill(ARTICLE_COPY.twoClub, { A: a, B: b, Score: score }));
  }
  if (primary) {
    const event = eventFromHeadline(headline);
    const prefix = primary + ' fan YouTubers react: ';
    const budget = ARTICLE_TITLE_MAX - ARTICLE_TITLE_SUFFIX.length - prefix.length;
    const shortEvent = seoClipWords(event, budget);
    if (shortEvent) return prefix + shortEvent + ARTICLE_TITLE_SUFFIX;
    return fitArticleTitle(primary + ' fan YouTubers react');
  }
  return fitArticleTitle(headline);
}

function articleSeoMeta(article) {
  const headline = (article && (article.title || article.headline)) || '';
  const club = articleClubName(article && (article.related_team || article.relatedTeam));
  const event = eventFromHeadline(headline);
  const summary = String((article && (article.summary || article.dek)) || '').replace(/\s+/g, ' ').trim();
  let lead = '';
  if (club && event) lead = seoFill(ARTICLE_COPY.metaLead, { Club: club, Event: event });
  else if (club) lead = club + ' fan YouTubers react.';
  let text = lead;
  if (summary) {
    const leadFlat = lead.toLowerCase();
    if (!leadFlat || summary.toLowerCase() !== event.toLowerCase()) {
      text = (lead ? lead + ' ' : '') + summary;
    }
  }
  if (!text) text = headline;
  return seoClip(text, ARTICLE_META_MAX);
}

function articleMoreLabel(related) {
  const club = articleClubName(related);
  if (!club) return '';
  return seoFill(ARTICLE_COPY.more, { Club: club });
}

function articleCoverAlt(relatedOrClub, headline) {
  const fromRelated = articleClubName(relatedOrClub);
  const club = fromRelated || (SEO_CLUB_NAMES.indexOf(relatedOrClub) >= 0 ? relatedOrClub : '');
  const title = String(headline || '').replace(/\s+/g, ' ').trim();
  if (club && title) return seoFill(ARTICLE_COPY.coverAlt, { Club: club, Headline: title });
  return title;
}

function articleDateLine(published, updated) {
  const fmt = function (d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const pub = published ? new Date(published) : null;
  const upd = updated ? new Date(updated) : null;
  const pubOk = pub && !Number.isNaN(pub.getTime());
  const updOk = upd && !Number.isNaN(upd.getTime());
  if (pubOk && updOk && Math.abs(upd.getTime() - pub.getTime()) >= 60 * 60 * 1000) {
    return seoFill(ARTICLE_COPY.updated, { Date: fmt(upd) });
  }
  if (pubOk) return seoFill(ARTICLE_COPY.published, { Date: fmt(pub) });
  return '';
}

// SEO_COPY_END
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HUB_COPY: HUB_COPY,
    ARTICLE_COPY: ARTICLE_COPY,
    HUB_TITLE_MAX: HUB_TITLE_MAX,
    HUB_META_MAX: HUB_META_MAX,
    ARTICLE_TITLE_MAX: ARTICLE_TITLE_MAX,
    hubTitle: hubTitle,
    hubH1: hubH1,
    hubMeta: hubMeta,
    hubIntro: hubIntro,
    hubMethod: hubMethod,
    hubRankedHeading: hubRankedHeading,
    hubAvatarAlt: hubAvatarAlt,
    hubClaimTop: hubClaimTop,
    buildHubFaqs: buildHubFaqs,
    articleClubName: articleClubName,
    clubsInHeadline: clubsInHeadline,
    eventFromHeadline: eventFromHeadline,
    articleSeoTitle: articleSeoTitle,
    articleSeoMeta: articleSeoMeta,
    articleMoreLabel: articleMoreLabel,
    articleCoverAlt: articleCoverAlt,
    articleDateLine: articleDateLine,
    seoMonthYear: seoMonthYear,
  };
}
