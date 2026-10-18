// Server-renders the /news listing (the hub) at /.netlify/functions/news.
// Individual /news/:slug articles stay in news-article.js.

const fs = require('fs');
const path = require('path');

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';
const SITE_URL = 'https://fanreactionsfc.com';

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
  ['Leeds', 'Leeds United'],
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
  let out = ((sp > 40 ? cut.slice(0, sp) : cut).replace(/[.,;:]+$/, '')).trim();
  if (unclosedQuoteIndex(out) >= 0) {
    const retreated = retreatOpenQuote(out);
    if (retreated && unclosedQuoteIndex(retreated) < 0) out = retreated;
  }
  return out + '…';
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

// Title-only shortenings. The directory name stays on the hub; the title
// uses one of these when the long name would push the event past 60 characters.
const SEO_TITLE_SHORT = {
  'Man United': 'Man Utd',
  'Crystal Palace': 'Palace',
  'Nottm Forest': 'Forest',
  'Sheffield Utd': 'Sheffield',
  'Sheffield Wed': 'Sheffield',
  'Borussia Dortmund': 'Dortmund',
  'Borussia Monchengladbach': 'Gladbach',
  'Bayer Leverkusen': 'Leverkusen',
  'Eintracht Frankfurt': 'Frankfurt',
  'Bayern Munich': 'Bayern',
  'Athletic Bilbao': 'Bilbao',
  'Atletico Madrid': 'Atletico',
  'Real Madrid': 'Madrid',
  'Real Sociedad': 'Sociedad',
  'Real Betis': 'Betis',
  'Rayo Vallecano': 'Vallecano',
  'Hellas Verona': 'Verona',
  'Inter Milan': 'Inter',
  'AC Milan': 'Milan',
};

function shorterClubLabel(name) {
  if (SEO_TITLE_SHORT[name] && SEO_TITLE_SHORT[name].length < name.length) return SEO_TITLE_SHORT[name];
  const parts = String(name || '').split(' ');
  if (parts.length < 2 || parts[0] === 'Man') return name;
  const tail = parts[parts.length - 1];
  if (/^(United|City|Town|Hotspur|Albion|Wanderers|Rovers|County)$/.test(tail)) return parts[0];
  return tail.length < name.length ? tail : name;
}

function eventWordBare(word) {
  return String(word || '').toLowerCase().replace(/[^a-z]/g, '');
}

function isEventVerb(word) {
  return /^(faces|face|facing|agrees|agree|agreed|agreeing|apologises|apologizes|apologise|apologize|apologised|apologized|calls|called|calling|wins|won|signs|signed|says|said|confirms|confirmed|hits|hit|scores|scored|returns|returned|misses|missed|suffers|suffered|beats|beat|draws|drew|sacks|sacked|appoints|appointed|leaves|left|joins|joined|extends|extended|rejects|rejected|admits|admitted|denies|denied|slams|slammed|praises|praised|undergoes|underwent|lands|landed|announces|announced|reveals|revealed|claims|claimed|loses|lost|makes|made|takes|took|gets|got|goes|went|backs|backed|fires|fired|quits|quit|stays|stayed|keeps|kept|breaks|broke|earns|earned|names|named|picks|picked|drops|dropped|reaches|reached|reach)$/.test(eventWordBare(word));
}

const EVENT_FILLER = {
  a: 1, an: 1, the: 1, his: 1, her: 1, their: 1, its: 1, in: 1, on: 1, at: 1, of: 1, to: 1, for: 1,
  after: 1, before: 1, as: 1, and: 1, with: 1, from: 1, into: 1, over: 1, about: 1, that: 1, this: 1,
  principle: 1, months: 1, month: 1, weeks: 1, week: 1, days: 1, day: 1, around: 1,
  one: 1, two: 1, three: 1, four: 1, five: 1, six: 1, seven: 1, eight: 1, nine: 1, ten: 1,
};

const VERB_TO_NOUN = {
  apologises: 'apology', apologizes: 'apology', apologise: 'apology', apologize: 'apology',
  apologised: 'apology', apologized: 'apology',
};

// Words a title must not end on. "out" is dangling unless the event is "{Name} out".
const TITLE_DANGLING = {
  to: 1, a: 1, an: 1, the: 1, at: 1, on: 1, of: 1, in: 1, and: 1, fan: 1, for: 1, as: 1, with: 1,
  from: 1, by: 1, v: 1, vs: 1, or: 1, out: 1, up: 1, into: 1, over: 1, after: 1,
  can: 1, could: 1, would: 1, will: 1, may: 1, might: 1, shall: 1, than: 1,
};

const SENTENCE_ABBREV = { mr: 1, mrs: 1, ms: 1, dr: 1, st: 1, v: 1, vs: 1 };

function titleWordKey(word) {
  return String(word || '').toLowerCase().replace(/[^a-z]/g, '');
}

function isDanglingWord(word) {
  return !!TITLE_DANGLING[titleWordKey(word)];
}

function titleCore(title) {
  return String(title || '').replace(/\s*\|\s*FanReactionsFC\s*$/, '').trim();
}

function isNameOut(text) {
  return /\b[A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)*\s+out$/.test(String(text || '').trim());
}

function acceptTitle(title) {
  if (!title || title.length > ARTICLE_TITLE_MAX || !String(title).endsWith(ARTICLE_TITLE_SUFFIX)) return false;
  const core = titleCore(title);
  if (!core) return false;
  if (isNameOut(core)) return true;
  return !isDanglingWord(core.split(/\s+/).pop());
}

// No hard clip. (a) full headline plus the suffix when that fits in 60.
// (b) the full headline, no suffix, when it is 70 characters or fewer.
// (c) the last clause boundary that still leaves 25 characters and an event.
// (d) the full headline up to 90 characters, no suffix.
// The headline's own casing is kept.
function clauseBoundaryEnds(text) {
  const lower = text.toLowerCase();
  const marks = [':', ' – ', ' - ', ',', ' as ', ' after ', ' over ', ' amid '];
  const ends = [];
  marks.forEach(function (mark) {
    const needle = mark.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      ends.push(at);
      from = at + 1;
    }
  });
  ends.sort(function (a, b) { return a - b; });
  return ends;
}

// "Liverpool YouTubers react" names no event. Skip that cut.
function cutIsLeadOnly(left) {
  const t = String(left || '').replace(/\s+/g, ' ').trim();
  if (/\b(?:react|preview)\s*$/i.test(t)) return true;
  if (/^(?:[\w'’.-]+\s+)+(?:fan\s+)?YouTubers$/i.test(t)) return true;
  return false;
}

function headlineTitle(headline) {
  const c = String(headline || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*\|\s*FanReactionsFC\s*$/, '').trim();
  if (!c) return 'Fan reactions';
  if ((c + ARTICLE_TITLE_SUFFIX).length <= ARTICLE_TITLE_MAX) return c + ARTICLE_TITLE_SUFFIX;
  if (c.length <= 70) return c;
  const ends = clauseBoundaryEnds(c);
  for (let i = ends.length - 1; i >= 0; i--) {
    const left = c.slice(0, ends[i]).trim();
    if (left.length < 25 || left.length > 90) continue;
    if (isDanglingWord(left.split(/\s+/).pop())) continue;
    if (cutIsLeadOnly(left)) continue;
    return left;
  }
  return c.length <= 90 ? c : c.slice(0, 90).trim();
}

function cleanSubject(words) {
  if (!words.length || words.length > 3) return false;
  for (let i = 0; i < words.length; i++) {
    if (!/^[A-Z]/.test(words[i])) return false;
    if (/^(YouTubers|React|Preview|Debate)$/i.test(words[i])) return false;
  }
  return true;
}

// Score lines only, e.g. "a 6-3 win at LASK" or "a 2-4 at the Etihad".
// Previews never qualify. Anything else is not a "react to" event.
function allowListEvent(event, headline) {
  if (/\bpreview\b/i.test(headline || '')) return '';
  const e = String(event || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  if (!e || e.length > 48) return '';
  if (/\b(youtubers|preview|debate|whether|react)\b/i.test(e)) return '';
  if (!/^(?:a\s+|an\s+)?\d{1,2}\s*[-–]\s*\d{1,2}(?:\s+[A-Za-z0-9][\w'’.-]*){0,6}$/.test(e)) return '';
  if (isDanglingWord(e.split(/\s+/).pop())) return '';
  return e;
}

// Title events are a short allow-list, never a clipped clause.
// "Reece James faces three months out" → "Reece James out".
// "Farke agrees a new deal in principle" → "Farke new deal".
// "Martinez apologises after his board outburst" → "Martinez apology".
function curatedEventPhrase(event) {
  const raw = String(event || '').replace(/\s+/g, ' ').trim();
  if (!raw || /\b(youtubers|preview|debate|whether)\b/i.test(raw)) return '';
  if (isNameOut(raw)) return raw;
  const score = allowListEvent(raw, '');
  if (score) return score;
  const words = raw.split(' ').filter(Boolean);
  let verbAt = -1;
  for (let i = 1; i < words.length; i++) {
    if (isEventVerb(words[i])) { verbAt = i; break; }
  }
  if (verbAt < 0) return '';
  const subject = words.slice(0, verbAt);
  if (!cleanSubject(subject)) return '';
  const verb = eventWordBare(words[verbAt]);
  const rest = words.slice(verbAt + 1);
  if (/^(after|following|as|once|when)\b/i.test(rest.join(' '))) {
    const noun = VERB_TO_NOUN[verb];
    return noun ? subject.concat([noun]).join(' ') : '';
  }
  const outcome = [];
  rest.forEach(function (word) {
    const bare = eventWordBare(word);
    if (!bare || EVENT_FILLER[bare]) return;
    outcome.push(word);
  });
  const outcomeText = outcome.join(' ');
  if (/^out$/i.test(outcomeText)) return subject.concat(['out']).join(' ');
  if (/^(?:new\s+)?(?:long-term\s+)?deal$/i.test(outcomeText)) return subject.concat(outcome).join(' ');
  return '';
}

function articleTitlePrefixes(club) {
  const names = [club];
  const short = shorterClubLabel(club);
  if (short && short !== club) names.push(short);
  const prefixes = [];
  names.forEach(function (name) {
    prefixes.push(name + ' fan YouTubers react: ');
    prefixes.push(name + ' YouTubers react: ');
  });
  return prefixes;
}

// Pack the whole event or nothing. Never drop words off the front of it.
function packArticleTitle(club, event) {
  const phrase = String(event || '').trim();
  if (!phrase) return '';
  const prefixes = articleTitlePrefixes(club);
  for (let i = 0; i < prefixes.length; i++) {
    const title = prefixes[i] + phrase + ARTICLE_TITLE_SUFFIX;
    if (acceptTitle(title)) return title;
  }
  return '';
}

function labelPairs(a, b) {
  const as = [a];
  const bs = [b];
  const sa = shorterClubLabel(a);
  const sb = shorterClubLabel(b);
  if (sa && sa !== a) as.push(sa);
  if (sb && sb !== b) bs.push(sb);
  const pairs = [];
  as.forEach(function (aa) {
    bs.forEach(function (bb) { pairs.push([aa, bb]); });
  });
  return pairs;
}

function isSeoWordChar(ch) {
  return /[A-Za-z0-9]/.test(ch || '');
}

// Straight or curly double quotes, plus a single quote used as a quotation
// mark. Apostrophes in don't / James's stay unmarked: a ' between word
// characters is not a quote.
function isSingleOpener(prev, next) {
  if (isSeoWordChar(prev) && isSeoWordChar(next)) return false;
  return isSeoWordChar(next) && (prev === '' || /[\s(\[{]/.test(prev));
}

function isSingleCloser(prev, ch, next) {
  if (ch !== "'" && ch !== '’' && ch !== '‘') return false;
  if (isSeoWordChar(prev) && isSeoWordChar(next)) return false;
  return (isSeoWordChar(prev) || /[.!?]/.test(prev)) && (next === '' || !isSeoWordChar(next));
}

function unclosedQuoteIndex(text) {
  let open = -1;
  let kind = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const prev = i > 0 ? text.charAt(i - 1) : '';
    const next = i + 1 < text.length ? text.charAt(i + 1) : '';
    if (kind === 'd') {
      if (ch === '"' || ch === '”') { kind = ''; open = -1; }
      continue;
    }
    if (kind === 's') {
      if (isSingleCloser(prev, ch, next)) { kind = ''; open = -1; }
      continue;
    }
    if (ch === '"' || ch === '“') { kind = 'd'; open = i; continue; }
    if ((ch === "'" || ch === '‘' || ch === '’') && isSingleOpener(prev, next)) {
      kind = 's';
      open = i;
    }
  }
  return open;
}

// A length cut or a !/?/. inside a quote leaves the opener unmatched.
// Back up to before that opener on a word boundary, or to the previous
// sentence when the leftover fragment is not itself a sentence.
function retreatOpenQuote(text) {
  let cut = String(text || '').replace(/\s+/g, ' ').trim();
  let guard = 0;
  while (unclosedQuoteIndex(cut) >= 0 && guard++ < 6) {
    const openAt = unclosedQuoteIndex(cut);
    let before = cut.slice(0, openAt);
    if (openAt > 0 && !/\s/.test(cut.charAt(openAt - 1))) {
      const sp = before.lastIndexOf(' ');
      if (sp > 0) before = before.slice(0, sp);
    }
    before = before.replace(/\s+$/, '').replace(/[.,;:]+$/, '').trim();
    const sentences = wholeSentences(before);
    if (sentences.length) {
      const last = sentences[sentences.length - 1];
      const at = before.lastIndexOf(last);
      const rest = before.slice(at + last.length).trim();
      if (rest) {
        if (last === cut) break;
        cut = last;
        continue;
      }
    }
    if (!before || before === cut) {
      cut = before;
      break;
    }
    cut = before;
  }
  return cut;
}

function balanceMetaQuotes(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || unclosedQuoteIndex(t) < 0) return t;
  const retreated = retreatOpenQuote(t);
  if (retreated && unclosedQuoteIndex(retreated) < 0) return retreated;
  return t;
}

// A sentence ends on ! or ?, or on '.' at the end of the text or followed by
// whitespace and a capital letter. Periods in £1.5m and after Mr/Mrs/Dr/St/v/vs do not end it.
// Punctuation inside an open quote is not a boundary, so a cut never drops
// the closing quote.
function wholeSentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const out = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    if (unclosedQuoteIndex(t.slice(0, i)) >= 0) continue;
    let boundary = false;
    if (ch === '!' || ch === '?') boundary = true;
    else if (ch === '.') {
      const word = ((t.slice(0, i).match(/[A-Za-z]+$/) || [''])[0]).toLowerCase();
      if (SENTENCE_ABBREV[word]) continue;
      const rest = t.slice(i + 1);
      boundary = rest === '' || /^\s+[A-Z]/.test(rest);
    }
    if (!boundary) continue;
    const sentence = t.slice(start, i + 1).trim();
    if (sentence) out.push(sentence);
    start = i + 1;
  }
  return out;
}

function firstSentence(text) {
  const sentences = wholeSentences(text);
  return sentences.length ? sentences[0] : '';
}

function parenStrippedSentence(sentence) {
  const noParen = String(sentence || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!noParen || noParen === sentence || !/[.!?]$/.test(noParen)) return '';
  return noParen;
}

function thatClause(sentence) {
  const source = String(sentence || '');
  const thatAt = source.toLowerCase().indexOf(' that ');
  if (thatAt < 0) return '';
  const fact = source.slice(thatAt + 6).trim();
  if (/^[A-Z]/.test(fact) && /[.!?]$/.test(fact)) return fact;
  return '';
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
  const isPreview = /\bpreview\b/i.test(headline);
  if (a && b && isPreview) {
    const pairs = labelPairs(a, b);
    for (let i = 0; i < pairs.length; i++) {
      const title = seoFill(ARTICLE_COPY.preview, { A: pairs[i][0], B: pairs[i][1] }) + ARTICLE_TITLE_SUFFIX;
      if (acceptTitle(title)) return title;
    }
    return headlineTitle(headline);
  }
  if (a && b && score && /\breact\b/i.test(headline)) {
    const pairs = labelPairs(a, b);
    for (let i = 0; i < pairs.length; i++) {
      const title = seoFill(ARTICLE_COPY.twoClub, { A: pairs[i][0], B: pairs[i][1], Score: score }) + ARTICLE_TITLE_SUFFIX;
      if (acceptTitle(title)) return title;
    }
    // The "react to {Score}" line is over 60. A shorter "react: {Score}"
    // fits some pairs; "fan" drops only when that is what keeps it in 60,
    // same as the single-club title prefixes.
    const fallback = headlineTitle(headline);
    if (fallback.length > ARTICLE_TITLE_MAX) {
      const shortTpls = [
        '{A} and {B} fan YouTubers react: {Score}',
        '{A} and {B} YouTubers react: {Score}',
      ];
      for (let t = 0; t < shortTpls.length; t++) {
        for (let i = 0; i < pairs.length; i++) {
          const title = seoFill(shortTpls[t], { A: pairs[i][0], B: pairs[i][1], Score: score }) + ARTICLE_TITLE_SUFFIX;
          if (acceptTitle(title)) return title;
        }
      }
    }
    return fallback;
  }
  if (primary && !isPreview) {
    const event = curatedEventPhrase(eventFromHeadline(headline));
    const packed = packArticleTitle(primary, event);
    if (packed) return packed;
    const bare = String(event || '').replace(/^(?:a|an)\s+/i, '');
    if (bare && bare !== event) {
      const packedBare = packArticleTitle(primary, bare);
      if (packedBare) return packedBare;
    }
  }
  return headlineTitle(headline);
}

function previewNamePair(headline, a, b) {
  if (a && b) return [a, b];
  const and = String(headline || '').match(/^(.*?)\s+and\s+(.*?)\s+YouTubers\s+preview\b/i);
  if (and) return [and[1].trim(), and[2].trim()];
  const versus = String(headline || '').match(/^(.*?)\s+v\s+(.*?)\s+preview\b/i);
  if (versus) return [versus[1].trim(), versus[2].trim()];
  if (a) return [a];
  return [];
}

function previewSeoMeta(pair, sentences) {
  const usable = sentences.filter(function (s) { return s && s.length <= ARTICLE_META_MAX; });
  if (pair.length >= 2) {
    const lead = pair[0] + ' v ' + pair[1] + ' preview:';
    for (let i = 0; i < sentences.length; i++) {
      const combo = lead + ' ' + sentences[i];
      if (sentences[i] && combo.length <= ARTICLE_META_MAX) return combo;
    }
    if (usable.length) return usable[0];
    return pair[0] + ' v ' + pair[1] + ' preview.';
  }
  if (usable.length) return usable[0];
  if (pair.length === 1) return pair[0] + ' preview.';
  return usable[0] || 'Match preview.';
}

function composeArticleSeoMeta(article) {
  const headline = (article && (article.title || article.headline)) || '';
  const club = articleClubName(article && (article.related_team || article.relatedTeam));
  const event = allowListEvent(eventFromHeadline(headline), headline);
  const summary = String((article && (article.summary || article.dek)) || '').replace(/\s+/g, ' ').trim();
  const sentences = wholeSentences(summary);
  if (/\bpreview\b/i.test(headline)) {
    const mentioned = clubsInHeadline(headline);
    const other = mentioned.filter(function (name) { return name !== club; })[0] || '';
    const pair = !club && mentioned.length >= 2 ? mentioned : null;
    const a = club || (pair ? pair[0] : '');
    const b = club ? other : (pair ? pair[1] : '');
    return previewSeoMeta(previewNamePair(headline, a, b), sentences);
  }
  let lead = '';
  if (club && event) lead = seoFill(ARTICLE_COPY.metaLead, { Club: club, Event: event });
  else if (club) lead = club + ' fan YouTubers react.';
  if (lead.length > ARTICLE_META_MAX) lead = club ? (club + ' fan YouTubers react.') : '';
  if (lead.length > ARTICLE_META_MAX) lead = '';
  // "Chelsea fan YouTubers react." repeats the summary when that summary
  // already says react, or already opens with the club name.
  const genericLead = club ? (club + ' fan YouTubers react.') : '';
  if (lead && lead === genericLead) {
    const startsWithClub = new RegExp('^' + seoEscapeReg(club) + '\\b', 'i').test(summary);
    if (startsWithClub || /\breact\b/i.test(summary)) lead = '';
  }
  const sentence = sentences[0] || '';
  const stripped = parenStrippedSentence(sentence);
  const inner = thatClause(stripped || sentence);
  const fromFirst = [];
  if (sentence) fromFirst.push(sentence);
  if (stripped) fromFirst.push(stripped);
  if (inner) fromFirst.push(inner);
  if (lead) {
    for (let i = 0; i < fromFirst.length; i++) {
      const combo = lead + ' ' + fromFirst[i];
      if (combo.length <= ARTICLE_META_MAX) return combo;
    }
  }
  for (let i = 0; i < fromFirst.length; i++) {
    if (fromFirst[i].length <= ARTICLE_META_MAX) return fromFirst[i];
  }
  for (let i = 1; i < sentences.length; i++) {
    if (lead) {
      const combo = lead + ' ' + sentences[i];
      if (combo.length <= ARTICLE_META_MAX) return combo;
    }
    if (sentences[i].length <= ARTICLE_META_MAX) return sentences[i];
  }
  if (lead) return lead;
  const mentioned = clubsInHeadline(headline);
  if (mentioned.length >= 2) {
    const both = mentioned[0] + ' and ' + mentioned[1] + ' fan YouTubers react.';
    if (both.length <= ARTICLE_META_MAX) return both;
  }
  if (mentioned.length === 1) return mentioned[0] + ' fan YouTubers react.';
  return 'Football fan YouTubers react.';
}

function articleSeoMeta(article) {
  return balanceMetaQuotes(composeArticleSeoMeta(article));
}

function articleMoreLabel(related) {
  const club = articleClubName(related);
  if (!club) return '';
  return seoFill(ARTICLE_COPY.more, { Club: club });
}

// related_team null / none has no hub. The first /clubs/<slug> in the body
// is used when that slug is a known club, so a two-club piece still links.
function articleHubClubFromBody(body) {
  const text = String(body || '');
  const re = /\/clubs\/([A-Za-z0-9-]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const name = articleClubName(m[1]);
    if (name) return name;
  }
  return '';
}

function articleMoreClub(article) {
  const fromRelated = articleClubName(article && (article.related_team || article.relatedTeam));
  if (fromRelated) return fromRelated;
  return articleHubClubFromBody(article && article.body);
}

function articleCoverAlt(relatedOrClub, headline) {
  const title = String(headline || '').replace(/\s+/g, ' ').trim();
  if (/\breact\b/i.test(title)) return title;
  const fromRelated = articleClubName(relatedOrClub);
  const club = fromRelated || (SEO_CLUB_NAMES.indexOf(relatedOrClub) >= 0 ? relatedOrClub : '');
  if (club && title) return seoFill(ARTICLE_COPY.coverAlt, { Club: club, Headline: title });
  return title;
}

// A same-day or next-day updated_at is a bulk touch, not an edit.
const ARTICLE_UPDATE_GAP_MS = 3 * 24 * 60 * 60 * 1000;

function articleUpdateIsMeaningful(published, updated) {
  const pub = published ? new Date(published) : null;
  const upd = updated ? new Date(updated) : null;
  if (!pub || Number.isNaN(pub.getTime()) || !upd || Number.isNaN(upd.getTime())) return false;
  return upd.getTime() - pub.getTime() >= ARTICLE_UPDATE_GAP_MS;
}

function articleDateLine(published, updated) {
  const fmt = function (d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const pub = published ? new Date(published) : null;
  const pubOk = pub && !Number.isNaN(pub.getTime());
  if (articleUpdateIsMeaningful(published, updated)) {
    return seoFill(ARTICLE_COPY.updated, { Date: fmt(new Date(updated)) });
  }
  if (pubOk) return seoFill(ARTICLE_COPY.published, { Date: fmt(pub) });
  return '';
}

function articleDateModified(published, updated) {
  if (articleUpdateIsMeaningful(published, updated)) return updated;
  const pub = published ? new Date(published) : null;
  if (pub && !Number.isNaN(pub.getTime())) return published;
  return undefined;
}

// SEO_COPY_END

const CLUB_SLUG_OVERRIDES = {
  'Man United': 'manchester-united',
  'Man City': 'manchester-city',
  'Nottm Forest': 'nottingham-forest',
  'Oxford Utd': 'oxford-united',
  'Sheffield Utd': 'sheffield-united',
  'Sheffield Wed': 'sheffield-wednesday',
  'West Brom': 'west-bromwich-albion',
  'Multi-Club / Other': 'multi-club',
};
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function clubPath(team) { return '/clubs/' + (CLUB_SLUG_OVERRIDES[team] || slugify(team)); }

let indexHtmlCache = null;
function readIndexHtml() {
  if (indexHtmlCache) return indexHtmlCache;
  const candidates = [
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, '..', '..', 'index.html'),
    path.join(__dirname, '..', '..', '..', 'index.html'),
  ];
  for (const p of candidates) {
    try {
      indexHtmlCache = fs.readFileSync(p, 'utf8');
      return indexHtmlCache;
    } catch {}
  }
  return null;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eventPathname(event) {
  if (event.rawUrl) {
    try { return new URL(event.rawUrl).pathname; } catch {}
  }
  return event.path || '';
}

function firstPartyCoverUrl(coverImageUrl) {
  const m = coverImageUrl && coverImageUrl.match(/\/article-covers\/([^/]+\/[^/?]+)/);
  return m ? `${SITE_URL}/article-covers/${m[1]}` : null;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, function (ch) {
    if (ch === '<') return '\\u003c';
    if (ch === '\u2028') return '\\u2028';
    return '\\u2029';
  });
}

function applyPage(html, { title, description, url, bodyHtml, jsonLd }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, () => `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta name="twitter:title"[^>]*>/, () => `<meta name="twitter:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, () => `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, () => `<meta property="og:url" content="${esc(url)}">`);
  out = out.replace(/<link rel="canonical"[^>]*>/, () => `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`);
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, () => `<main id="app">${bodyHtml}</main>`);
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`);
  return out;
}

function ssrFooter() {
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand"><img src="/img/logo-wide.png" alt="FanReactionsFC" class="footer-logo"></div>
            <div class="footer-desc">The definitive database of football YouTubers across Europe's top leagues.</div>
          </div>
          <div class="footer-col">
            <h4>Browse</h4>
            <a href="/discover">Discover Creators</a>
            <a href="/rankings">Rankings</a>
            <a href="/news">News</a>
            <a href="/become-a-creator">Become a Creator</a>
          </div>
          <div class="footer-col">
            <h4>Clubs</h4>
            <a href="/clubs/arsenal">Arsenal</a>
            <a href="/clubs/manchester-united">Manchester United</a>
            <a href="/clubs/liverpool">Liverpool</a>
            <a href="/clubs/chelsea">Chelsea</a>
            <a href="/clubs/tottenham">Tottenham</a>
          </div>
        </div>
      </div>
    </footer>`;
}

function siteGraph() {
  return [
    {
      '@type': 'Organization',
      '@id': SITE_URL + '/#organization',
      name: 'FanReactionsFC',
      url: SITE_URL,
      logo: SITE_URL + '/img/logo-wide.png',
      sameAs: [
        'https://www.youtube.com/@fanreactionsfc',
        'https://x.com/fanreactionsfc',
        'https://www.instagram.com/fanreactionsfc/',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': SITE_URL + '/#website',
      name: 'FanReactionsFC',
      url: SITE_URL,
      publisher: { '@id': SITE_URL + '/#organization' },
      potentialAction: {
        '@type': 'SearchAction',
        target: SITE_URL + '/discover?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/news/') {
    return {
      statusCode: 301,
      headers: { Location: SITE_URL + '/news', 'Cache-Control': 'public, max-age=86400' },
      body: '',
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let articles = [];
  if (sbKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/frfc_articles?select=slug,title,summary,cover_image_url,tags,related_team,published_at,updated_at&status=eq.published&order=published_at.desc&limit=50`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (res.ok) articles = await res.json();
    } catch { /* empty hub still gets unique head/body */ }
  }

  const title = 'FanReactionsFC News | Football Creator Coverage';
  const description = 'Football creator news, rankings, and fan-culture coverage from FanReactionsFC.';
  const url = SITE_URL + '/news';
  const dateModified = articles
    .map(a => a.updated_at || a.published_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || undefined;

  const cards = articles.map(a => {
    const cover = firstPartyCoverUrl(a.cover_image_url);
    const clubName = articleClubName(a.related_team);
    const club = clubName ? `<a href="${clubPath(clubName)}">${esc(clubName)}</a>` : '';
    const alt = articleCoverAlt(a.related_team, a.title);
    return `
      <article class="news-card">
        ${cover ? `<a href="/news/${esc(a.slug)}"><img src="${esc(cover)}" alt="${esc(alt)}" class="news-card-thumb"></a>` : ''}
        <div class="news-card-body">
          <h2 class="news-card-title"><a href="/news/${esc(a.slug)}">${esc(a.title)}</a></h2>
          ${a.summary ? `<p class="news-card-summary">${esc(a.summary)}</p>` : ''}
          <p class="news-card-meta">${a.published_at ? esc(String(a.published_at).split('T')[0]) : ''}${club ? ' · ' + club : ''}</p>
        </div>
      </article>`;
  }).join('');

  const bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">News</div>
            <h1 class="page-hero-title">FanReactionsFC News</h1>
            <p class="page-hero-subtitle">${esc(description)}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div class="news-grid">
        ${cards || '<div class="empty-state"><div class="es-title">No articles yet</div></div>'}
      </div>
      <p class="seo-more-links"><a href="/rankings">Best football fan YouTubers ranked</a> · <a href="/discover">Discover creators</a></p>
    </div>
    ${ssrFooter()}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat([
      Object.assign({
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: title,
        description,
        isPartOf: { '@id': SITE_URL + '/#website' },
      }, dateModified ? { dateModified } : {}),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: 'News', item: url },
        ],
      },
    ]),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=300, must-revalidate',
    },
    body: applyPage(html, { title, description, url, bodyHtml, jsonLd }),
  };
};
