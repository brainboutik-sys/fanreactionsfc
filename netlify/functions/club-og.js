// Server-renders /clubs/:slug with unique title/canonical/H1, a visible
// creator table, ItemList + SportsTeam + BreadcrumbList JSON-LD, and 301s
// from legacy spaced/cased URLs onto lowercase hyphenated slugs.
//
// Unlike the old meta-only rewrite, a non-JS crawler sees the club name
// and the creator list in the raw HTML — same idea as news-article.js.
// The SPA still hydrates and replaces #app with its own render.

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
  ['Bayern', 'Bayern Munich'],
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

// "Manchester Derby" and "Emirates Derby" name the fixture, not Derby County.
function derbyNickname(text, index) {
  return /(?:Manchester|Emirates)\s+$/i.test(String(text || '').slice(0, index));
}

// For each display name, keep the earliest match across its labels and
// aliases, then sort. A later "Tottenham" must not beat an earlier "Spurs".
function clubHits(headline) {
  const text = String(headline || '');
  const best = Object.create(null);
  seoClubMatchList().forEach(function (row) {
    const re = new RegExp('\\b' + seoEscapeReg(row.label) + '\\b', 'ig');
    let match;
    while ((match = re.exec(text))) {
      if ((row.display === 'Derby' || row.label === 'Derby') && derbyNickname(text, match.index)) continue;
      const idx = match.index;
      const prev = best[row.display];
      if (!prev || idx < prev.index) {
        best[row.display] = { display: row.display, index: idx, label: row.label };
      }
      break;
    }
  });
  return Object.keys(best).map(function (key) { return best[key]; }).sort(function (a, b) {
    return a.index - b.index;
  });
}

function clubsInHeadline(headline) {
  return clubHits(headline).map(function (hit) { return hit.display; });
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

// Headline wording first when it is a shorter alias ("Spurs", "Bayern"),
// then the directory name, then the existing short label.
function labelChoices(name, surface) {
  const names = [];
  function add(n) {
    if (n && names.indexOf(n) < 0) names.push(n);
  }
  if (surface && surface.length < String(name || '').length) add(surface);
  add(name);
  const short = shorterClubLabel(name);
  if (short && short !== name) add(short);
  return names;
}

function articleTitlePrefixes(club, surface) {
  return labelChoices(club, surface).map(function (name) {
    return name + ' fan YouTubers react: ';
  });
}

// Pack the whole event or nothing. Never drop words off the front of it.
// "fan" stays. A title that only fits by dropping it is not a candidate.
function packArticleTitle(club, event, surface) {
  const phrase = String(event || '').trim();
  if (!phrase) return '';
  const prefixes = articleTitlePrefixes(club, surface);
  for (let i = 0; i < prefixes.length; i++) {
    const title = prefixes[i] + phrase + ARTICLE_TITLE_SUFFIX;
    if (acceptTitle(title)) return title;
  }
  return '';
}

function labelPairs(a, b, surfaces) {
  const as = labelChoices(a, surfaces && surfaces[a]);
  const bs = labelChoices(b, surfaces && surfaces[b]);
  const pairs = [];
  as.forEach(function (aa) {
    bs.forEach(function (bb) { pairs.push([aa, bb]); });
  });
  return pairs;
}

function isSeoWordChar(ch) {
  return /[A-Za-z0-9]/.test(ch || '');
}

// A ' is a quotation mark only when it opens at a word boundary and a closer
// follows. Apostrophes in don't / James's, and a word-initial '90s / 'Tis
// with no closer, stay plain text. A " after a word character (6" screen)
// is an inch mark, not an opener. A " that opens a quotation and never
// closes is the one unclosed quote index callers retreat from.
function isSingleOpener(prev, next) {
  if (isSeoWordChar(prev) && isSeoWordChar(next)) return false;
  return isSeoWordChar(next) && (prev === '' || /[\s(\[{]/.test(prev));
}

function isSingleCloser(prev, ch, next) {
  if (ch !== "'" && ch !== '’' && ch !== '‘') return false;
  if (isSeoWordChar(prev) && isSeoWordChar(next)) return false;
  return (isSeoWordChar(prev) || /[.!?]/.test(prev)) && (next === '' || !isSeoWordChar(next));
}

function isDoubleOpener(ch, prev) {
  if (ch === '“') return true;
  return ch === '"' && !isSeoWordChar(prev);
}

// One forward pass over precomputed closer indexes. Matched pairs are spans.
// An opening " with no partner is left hanging; an opening ' with no partner
// is ignored. O(n), so a long summary does not rescan each prefix.
function scanQuotes(text) {
  const n = text.length;
  const nextDbl = new Array(n);
  const nextSgl = new Array(n);
  let nd = -1;
  let ns = -1;
  for (let i = n - 1; i >= 0; i--) {
    nextDbl[i] = nd;
    nextSgl[i] = ns;
    const ch = text.charAt(i);
    const prev = i > 0 ? text.charAt(i - 1) : '';
    const next = i + 1 < n ? text.charAt(i + 1) : '';
    if (ch === '"' || ch === '”') nd = i;
    if (isSingleCloser(prev, ch, next)) ns = i;
  }
  const spans = [];
  let hanging = -1;
  for (let i = 0; i < n; i++) {
    const ch = text.charAt(i);
    const prev = i > 0 ? text.charAt(i - 1) : '';
    const next = i + 1 < n ? text.charAt(i + 1) : '';
    if (isDoubleOpener(ch, prev)) {
      const c = nextDbl[i];
      if (c > i) {
        spans.push(i, c);
        i = c;
        continue;
      }
      hanging = i;
      break;
    }
    if ((ch === "'" || ch === '‘' || ch === '’') && isSingleOpener(prev, next)) {
      const c = nextSgl[i];
      if (c > i) {
        spans.push(i, c);
        i = c;
      }
    }
  }
  return { spans: spans, hanging: hanging };
}

function unclosedQuoteIndex(text) {
  return scanQuotes(String(text || '')).hanging;
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
function abbrevBefore(text, i) {
  let word = '';
  for (let j = i - 1; j >= 0 && word.length < 4; j--) {
    const ch = text.charAt(j);
    if (!/[A-Za-z]/.test(ch)) break;
    word = ch + word;
  }
  if (word.length > 3) return '';
  return word.toLowerCase();
}

function periodEndsSentence(text, i) {
  let j = i + 1;
  if (j >= text.length) return true;
  if (!/\s/.test(text.charAt(j))) return false;
  while (j < text.length && /\s/.test(text.charAt(j))) j++;
  return j < text.length && /[A-Z]/.test(text.charAt(j));
}

function wholeSentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const scanned = scanQuotes(t);
  const spans = scanned.spans;
  const hanging = scanned.hanging;
  const out = [];
  let start = 0;
  let spanAt = 0;
  for (let i = 0; i < t.length; i++) {
    if (hanging >= 0 && i > hanging) continue;
    while (spanAt + 1 < spans.length && spans[spanAt + 1] < i) spanAt += 2;
    if (spanAt < spans.length && i > spans[spanAt] && i <= spans[spanAt + 1]) continue;
    const ch = t.charAt(i);
    let boundary = false;
    if (ch === '!' || ch === '?') boundary = true;
    else if (ch === '.') {
      if (SENTENCE_ABBREV[abbrevBefore(t, i)]) continue;
      boundary = periodEndsSentence(t, i);
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

function surfaceMap(hits) {
  const map = Object.create(null);
  hits.forEach(function (hit) { map[hit.display] = hit.label; });
  return map;
}

function twoClubTitles(a, b, score, surfaces, template) {
  return labelPairs(a, b, surfaces).map(function (pair) {
    return seoFill(template, { A: pair[0], B: pair[1], Score: score }) + ARTICLE_TITLE_SUFFIX;
  });
}

function fanPackedTitles(club, event, surface) {
  const phrase = String(event || '').trim();
  if (!club || !phrase) return [];
  return labelChoices(club, surface).map(function (name) {
    return name + ' fan YouTubers react: ' + phrase + ARTICLE_TITLE_SUFFIX;
  });
}

function firstFanTitle(titles) {
  for (let i = 0; i < titles.length; i++) {
    if (titles[i] && titles[i].indexOf('fan YouTubers') !== -1 && acceptTitle(titles[i])) return titles[i];
  }
  return '';
}

function rememberTitles(bucket, titles) {
  titles.forEach(function (title) {
    if (title && bucket.indexOf(title) < 0) bucket.push(title);
  });
}

function shortestFanTitle(titles) {
  let best = '';
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    if (!title || title.indexOf('fan YouTubers') === -1 || !title.endsWith(ARTICLE_TITLE_SUFFIX)) continue;
    if (!best || title.length < best.length) best = title;
  }
  return best;
}

// Keep "fan" only when the full title, suffix included, fits in 60.
// Only the lowercase "fan" this code inserted is removed. A "Fan" the
// headline already had stays, and the event text stays intact.
function applyFanCap(title, headline) {
  if (!title || title.length <= ARTICLE_TITLE_MAX || title.indexOf('fan YouTubers') === -1) return title;
  const base = String(headline || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*\|\s*FanReactionsFC\s*$/, '');
  const core = String(title).replace(/\s*\|\s*FanReactionsFC\s*$/, '').trim();
  if (core === base && base.indexOf('fan YouTubers') !== -1) return title;
  return title.replace(/fan YouTubers/g, 'YouTubers');
}

function forceFanTitle(headline) {
  let s = String(headline || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*\|\s*FanReactionsFC\s*$/, '').trim();
  if (!s) s = 'Fan reactions';
  if (!/fan YouTubers/i.test(s) && /YouTubers/i.test(s)) {
    s = s.replace(/YouTubers/i, 'fan YouTubers');
  }
  return s + ARTICLE_TITLE_SUFFIX;
}

// No curated event. Keep the headline, swap in a shorter club label when the
// headline used a longer one, and always add "fan YouTubers" plus the suffix.
function fanHeadlineTitles(headline, club, surface) {
  const base = String(headline || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*\|\s*FanReactionsFC\s*$/, '').trim();
  const titles = [];
  function add(text) {
    const title = forceFanTitle(text);
    if (title && titles.indexOf(title) < 0) titles.push(title);
  }
  if (!club) {
    add(base);
    return titles;
  }
  const names = labelChoices(club, surface);
  const needles = [];
  function pushNeedle(n) {
    if (n && needles.indexOf(n) < 0) needles.push(n);
  }
  pushNeedle(surface);
  pushNeedle(club);
  names.forEach(pushNeedle);
  needles.sort(function (a, b) { return b.length - a.length; });
  let matched = '';
  for (let i = 0; i < needles.length; i++) {
    if (new RegExp('\\b' + seoEscapeReg(needles[i]) + '\\b', 'i').test(base)) {
      matched = needles[i];
      break;
    }
  }
  if (!matched) {
    add(base);
    return titles;
  }
  const re = new RegExp('\\b' + seoEscapeReg(matched) + '\\b', 'i');
  names.forEach(function (name) {
    add(name.toLowerCase() === matched.toLowerCase() ? base : base.replace(re, name));
  });
  add(base);
  return titles;
}

function articleSeoTitle(article) {
  const headline = (article && (article.title || article.headline)) || '';
  const primary = articleClubName(article && (article.related_team || article.relatedTeam));
  const hits = clubHits(headline);
  const mentioned = hits.map(function (hit) { return hit.display; });
  const surfaces = surfaceMap(hits);
  const other = mentioned.filter(function (name) { return name !== primary; })[0] || '';
  const pair = !primary && mentioned.length >= 2 ? mentioned : null;
  const a = primary || (pair ? pair[0] : '');
  const b = primary ? other : (pair ? pair[1] : '');
  const scoreMatch = String(headline).match(/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/);
  const score = scoreMatch ? scoreMatch[0].replace(/\s+/g, '') : '';
  const isPreview = /\bpreview\b/i.test(headline);
  if (a && b && isPreview) {
    const titles = labelPairs(a, b, surfaces).map(function (pair) {
      return seoFill(ARTICLE_COPY.preview, { A: pair[0], B: pair[1] }) + ARTICLE_TITLE_SUFFIX;
    });
    const fit = firstFanTitle(titles);
    if (fit) return fit;
    const over = shortestFanTitle(titles);
    if (over) return applyFanCap(over, headline);
    return applyFanCap(forceFanTitle(headline), headline);
  }
  const candidates = [];
  function take(titles) {
    rememberTitles(candidates, titles);
    return firstFanTitle(titles);
  }
  // related_team set is a single-club article, even if the opponent is named.
  const twoClub = !primary && pair && score && /\breact\b/i.test(headline);
  if (twoClub) {
    const fitTo = take(twoClubTitles(pair[0], pair[1], score, surfaces, ARTICLE_COPY.twoClub));
    if (fitTo) return fitTo;
    const fitColon = take(twoClubTitles(pair[0], pair[1], score, surfaces, '{A} and {B} fan YouTubers react: {Score}'));
    if (fitColon) return fitColon;
  }
  const packClub = (primary || (twoClub ? pair[0] : '') || (mentioned.length === 1 ? mentioned[0] : ''));
  if (packClub && !isPreview) {
    const event = curatedEventPhrase(eventFromHeadline(headline));
    const surface = surfaces[packClub] || '';
    const fit = take(fanPackedTitles(packClub, event, surface));
    if (fit) return fit;
    const bare = String(event || '').replace(/^(?:a|an)\s+/i, '');
    if (bare && bare !== event) {
      const fitBare = take(fanPackedTitles(packClub, bare, surface));
      if (fitBare) return fitBare;
    }
  }
  const over = applyFanCap(shortestFanTitle(candidates), headline);
  if (over) return over;
  const leadClub = primary || (mentioned.length === 1 ? mentioned[0] : '');
  const rewritten = fanHeadlineTitles(headline, leadClub && !isPreview ? leadClub : '', leadClub ? (surfaces[leadClub] || '') : '');
  const fitLead = firstFanTitle(rewritten);
  if (fitLead) return fitLead;
  const shortLead = applyFanCap(shortestFanTitle(rewritten), headline);
  if (shortLead) return shortLead;
  return applyFanCap(forceFanTitle(headline), headline);
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
  // Drop "Club fan YouTubers react." only for the sentence that is used,
  // and only when that sentence already starts with the club or says
  // "react". A later sentence that does neither keeps the prefix. If the
  // prefix would push that sentence past 155, the sentence stands alone.
  const genericLead = club ? (club + ' fan YouTubers react.') : '';
  const clubRe = club ? new RegExp('^' + seoEscapeReg(club) + '\\b', 'i') : null;
  function dropsPrefix(sentence) {
    if (!lead || lead !== genericLead) return false;
    if (clubRe && clubRe.test(sentence)) return true;
    return /\breact\b/i.test(sentence);
  }
  function takePreferred(sentence) {
    if (!sentence) return '';
    // A sentence that already names the club or says "react" is the one
    // to use, with no prefix, as soon as it fits. A shorter later clause
    // must not bring the prefix back.
    if (dropsPrefix(sentence)) return sentence.length <= ARTICLE_META_MAX ? sentence : '';
    if (!lead) return '';
    const combo = lead + ' ' + sentence;
    return combo.length <= ARTICLE_META_MAX ? combo : '';
  }
  const sentence = sentences[0] || '';
  const stripped = parenStrippedSentence(sentence);
  const inner = thatClause(stripped || sentence);
  const fromFirst = [];
  if (sentence) fromFirst.push(sentence);
  if (stripped) fromFirst.push(stripped);
  if (inner) fromFirst.push(inner);
  for (let i = 0; i < fromFirst.length; i++) {
    const picked = takePreferred(fromFirst[i]);
    if (picked) return picked;
  }
  for (let i = 0; i < fromFirst.length; i++) {
    if (fromFirst[i].length <= ARTICLE_META_MAX) return fromFirst[i];
  }
  for (let i = 1; i < sentences.length; i++) {
    const picked = takePreferred(sentences[i]);
    if (picked) return picked;
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

function relatedTeamUnset(article) {
  const raw = article && (Object.prototype.hasOwnProperty.call(article, 'related_team') ? article.related_team : article.relatedTeam);
  if (raw == null) return true;
  return /^(none|null|n\/a|undefined)$/i.test(String(raw).trim()) || String(raw).trim() === '';
}

// related_team null / none has no hub. A body /clubs/<slug> link is used
// only when the headline names exactly two known clubs, and then only the
// club whose hub link appears first. Other unset articles get no footer.
function articleMoreClub(article) {
  const fromRelated = articleClubName(article && (article.related_team || article.relatedTeam));
  if (fromRelated) return fromRelated;
  if (!relatedTeamUnset(article)) return '';
  const headline = (article && (article.title || article.headline)) || '';
  if (clubsInHeadline(headline).length !== 2) return '';
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
const CLUB_SLUG_ALIASES = {
  'man-united': 'Man United', 'man-utd': 'Man United', 'manutd': 'Man United', 'manchester-united': 'Man United',
  'man-city': 'Man City', 'manchester-city': 'Man City',
  'nottm-forest': 'Nottm Forest', 'nottingham-forest': 'Nottm Forest', 'notts-forest': 'Nottm Forest',
  'oxford-utd': 'Oxford Utd', 'oxford-united': 'Oxford Utd',
  'sheffield-utd': 'Sheffield Utd', 'sheffield-united': 'Sheffield Utd',
  'sheffield-wed': 'Sheffield Wed', 'sheffield-wednesday': 'Sheffield Wed',
  'west-brom': 'West Brom', 'west-bromwich-albion': 'West Brom',
  'psg': 'PSG', 'paris-saint-germain': 'PSG',
  'multi-club': 'Multi-Club / Other', 'multi-club-other': 'Multi-Club / Other',
};
const CLUB_DISPLAY_NAMES = [
  'Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Chelsea','Coventry','Crystal Palace','Everton','Fulham','Hull City','Ipswich','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham',
  'Birmingham','Blackburn','Bristol City','Burnley','Charlton','Derby','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','West Ham','Wolves','Wrexham','Luton',
  'Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes',
  'Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como',
  'Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli',
  'PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne',
  'Multi-Club / Other',
];

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function clubSlug(team) { return CLUB_SLUG_OVERRIDES[team] || slugify(team); }
function clubPath(team, suffix) { return '/clubs/' + clubSlug(team) + (suffix || ''); }

function resolveClub(raw, extraTeams) {
  let input = String(raw || '').replace(/\+/g, ' ').trim();
  try { input = decodeURIComponent(input); } catch { /* already decoded */ }
  input = input.replace(/\/+$/, '').trim();
  if (!input) return null;
  const known = new Set(CLUB_DISPLAY_NAMES.concat(extraTeams || []));
  if (known.has(input)) return input;
  const lower = input.toLowerCase();
  for (const name of known) if (name.toLowerCase() === lower) return name;
  const slugged = slugify(input);
  if (!slugged) return null;
  if (CLUB_SLUG_ALIASES[slugged] && known.has(CLUB_SLUG_ALIASES[slugged])) return CLUB_SLUG_ALIASES[slugged];
  for (const [name, slug] of Object.entries(CLUB_SLUG_OVERRIDES)) {
    if (slug === slugged && known.has(name)) return name;
  }
  for (const name of known) if (slugify(name) === slugged) return name;
  return null;
}

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

function formatNum(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// Paid Verified tier. Keep in sync with js/lib/verified.js.
// The legacy `verified` column is not this flag.
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

async function fetchAllStreamers(supabaseUrl, sbKey) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const order = '&order=subscriber_count.desc.nullslast&limit=1000';
  const base = `${supabaseUrl}/rest/v1/frfc_streamers?select=`;
  const extended = 'id,name,slug,team,league,subscriber_count,last_youtube_sync,updated_at,channel_url,avatar_url,description,is_verified,verified_until,content_types,latest_video_id,latest_video_title,latest_video_date,latest_video_thumbnail,upload_frequency,channel_country';
  const withTier = 'id,name,slug,team,subscriber_count,last_youtube_sync,updated_at,channel_url,avatar_url,description,is_verified,verified_until';
  const legacy = 'id,name,slug,team,subscriber_count,last_youtube_sync,updated_at,channel_url,avatar_url,description';
  // Prefer the columns the hub template renders (format, latest video,
  // country). Fall back if this database is older so the page still renders.
  let res = await fetch(base + extended + order, { headers });
  if (!res.ok) res = await fetch(base + withTier + order, { headers });
  if (!res.ok) res = await fetch(base + legacy + order, { headers });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function eventPathname(event) {
  if (event.rawUrl) {
    try { return new URL(event.rawUrl).pathname; } catch {}
  }
  return event.path || '';
}

function htmlResponse(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': statusCode === 200
        ? 'public, s-maxage=300, must-revalidate'
        : 'public, s-maxage=60, must-revalidate',
    }, extraHeaders || {}),
    body,
  };
}

function redirect301(toPath) {
  return {
    statusCode: 301,
    headers: { Location: SITE_URL + toPath, 'Cache-Control': 'public, max-age=86400' },
    body: '',
  };
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, function (ch) {
    if (ch === '<') return '\\u003c';
    if (ch === '\u2028') return '\\u2028';
    return '\\u2029';
  });
}

function applyPage(html, { title, description, url, bodyHtml, jsonLd, noindex }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:title"[^>]*>/, () => `<meta property="og:title" content="${esc(title)}">`);
  out = out.replace(/<meta name="twitter:title"[^>]*>/, () => `<meta name="twitter:title" content="${esc(title)}">`);
  out = out.replace(/<meta property="og:description"[^>]*>/, () => `<meta property="og:description" content="${esc(description)}">`);
  out = out.replace(/<meta property="og:url"[^>]*>/, () => `<meta property="og:url" content="${esc(url)}">`);
  if (noindex) {
    out = out.replace('<head>', () => '<head>\n  <meta name="robots" content="noindex, follow">');
  }
  out = out.replace(/<link rel="canonical"[^>]*>/, () => (noindex
    ? '<link rel="canonical" id="canonicalLink" href="">'
    : `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`));
  out = out.replace(/<main id="app">[\s\S]*?<\/main>/, () => `<main id="app">${bodyHtml}</main>`);
  if (jsonLd) {
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`);
  }
  return out;
}

function ssrFooter(clubs) {
  const clubLinks = (clubs || []).slice(0, 40).map(t => `<a href="${clubPath(t)}">${esc(t)}</a>`).join('');
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
            <h4>FanReactionsFC</h4>
            <a href="https://www.youtube.com/@fanreactionsfc" target="_blank" rel="noopener">YouTube</a>
            <a href="https://x.com/fanreactionsfc" target="_blank" rel="noopener">X</a>
            <a href="https://www.instagram.com/fanreactionsfc/" target="_blank" rel="noopener">Instagram</a>
            <a href="/contact">Contact</a>
          </div>
        </div>
        ${clubLinks ? `<div class="footer-clubs"><h4>Clubs</h4><div class="footer-club-links">${clubLinks}</div></div>` : ''}
      </div>
    </footer>`;
}

function notFoundHtml(html, reqPath) {
  const body = `
    <div class="container section-message">
      <div class="empty-state">
        <div class="es-title">Page not found</div>
        <p style="color:var(--text-dim);margin-bottom:16px">No page at <code>${esc(reqPath)}</code>.</p>
        <a href="/discover" class="btn btn-primary">Browse creators</a>
      </div>
    </div>
    ${ssrFooter(['Arsenal','Man United','Liverpool','Chelsea','Tottenham'])}`;
  return applyPage(html, {
    title: 'Page Not Found | FanReactionsFC',
    description: 'This page does not exist on FanReactionsFC.',
    url: SITE_URL + reqPath,
    bodyHtml: body,
    noindex: true,
  });
}

// Duplicated from js/lib/club-sponsorship.js — this function file cannot
// require a shared module. Keep the two copies in sync.
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

// Same club → league map as js/data/teams.js. Used only to pick 4–6
// same-league hubs that already have creators. Not a second taxonomy.
const HUB_LEAGUE_CLUBS = {
  'Premier League': ['Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Chelsea','Coventry','Crystal Palace','Everton','Fulham','Hull City','Ipswich','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham'],
  'Championship': ['Birmingham','Blackburn','Bristol City','Burnley','Charlton','Derby','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','West Ham','Wolves','Wrexham'],
  'La Liga': ['Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes'],
  'Serie A': ['Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como'],
  'Bundesliga': ['Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli'],
  'Ligue 1': ['PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne'],
};
const HUB_LEAGUE_OF = {};
Object.entries(HUB_LEAGUE_CLUBS).forEach(([league, teams]) => {
  teams.forEach(t => { HUB_LEAGUE_OF[t] = league; });
});

function relatedHubClubs(club, directory) {
  const league = HUB_LEAGUE_OF[club];
  if (!league) return [];
  const counts = {};
  for (const row of directory || []) {
    const team = row && row.team;
    if (!team || team === club || team === 'Multi-Club / Other') continue;
    if (HUB_LEAGUE_OF[team] !== league) continue;
    counts[team] = (counts[team] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([name]) => name);
}

function watchalongNames(creators) {
  return (creators || []).filter(c => {
    const types = c.content_types || c.contentTypes || [];
    return types.some(t => String(t).toLowerCase() === 'watchalong');
  }).slice(0, 3).map(c => c.name).filter(Boolean);
}

function oneSentence(description) {
  const text = String(description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentenceMatch = text.match(/^.*?[.!?](\s|$)/);
  const sentence = (sentenceMatch ? sentenceMatch[0] : text).trim();
  if (sentence.length <= 180) return sentence;
  const clipped = sentence.slice(0, 177);
  const lastSpace = clipped.lastIndexOf(' ');
  return ((lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trim()) + '…';
}

function syncedMonth(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function videoDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function latestFanVideos(creators) {
  return (creators || [])
    .map(c => ({
      id: c.latest_video_id || '',
      title: c.latest_video_title || '',
      date: c.latest_video_date || '',
      thumb: c.latest_video_thumbnail || '',
      name: c.name || '',
      slug: c.slug || slugify(c.name || ''),
    }))
    .filter(v => v.id && v.name)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 8);
}

// The sponsored creator is omitted. Positions are 1..N over the organic
// list only, matching the visible rank numbers and numberOfItems.
function hubItemList(club, creators, sponsored) {
  const sid = sponsored && sponsored.id;
  const elements = [];
  (creators || []).forEach((c) => {
    if (!c || !c.name) return;
    if (sid && c.id === sid) return;
    const slug = c.slug || slugify(c.name);
    const itemUrl = `${SITE_URL}/creators/${slug}`;
    const node = { '@type': 'Person', name: c.name, url: itemUrl };
    if (/^https?:\/\//i.test(c.channel_url || '')) node.sameAs = c.channel_url;
    if (/^https?:\/\//i.test(c.avatar_url || '')) node.image = c.avatar_url;
    elements.push({
      '@type': 'ListItem',
      position: elements.length + 1,
      url: itemUrl,
      name: c.name,
      item: node,
    });
  });
  return {
    '@type': 'ItemList',
    name: `Best ${club} fan YouTubers`,
    numberOfItems: elements.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: elements,
  };
}

function faqAnswerHtml(faq) {
  if (faq.a === HUB_COPY.faqListA) {
    return 'Submit it on the <a href="/become-a-creator">Become a creator</a> page. Listing is free.';
  }
  return esc(faq.a);
}

async function fetchClubNews(supabaseUrl, sbKey, club) {
  try {
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_articles?select=slug,title,published_at&status=eq.published&related_team=eq.${encodeURIComponent(clubSlug(club))}&order=published_at.desc&limit=3`,
      { headers }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

exports.handler = async (event) => {
  const html = readIndexHtml();
  if (!html) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'index.html not available' };
  }

  const reqPath = eventPathname(event);
  if (reqPath === '/clubs' || reqPath === '/clubs/') {
    return redirect301('/discover');
  }

  const videosMatch = reqPath.match(/^\/clubs\/([^\/\?]+)\/videos\/?$/);
  const clubMatch = reqPath.match(/^\/clubs\/([^\/\?]+)\/?$/);
  const rawSeg = videosMatch ? videosMatch[1] : (clubMatch ? clubMatch[1] : '');
  const isVideos = !!videosMatch;
  const hadTrailingSlash = /\/$/.test(reqPath);

  if (!rawSeg) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let extraTeams = [];
  let creators = [];
  let directory = [];
  if (sbKey) {
    try {
      const rows = await fetchAllStreamers(supabaseUrl, sbKey);
      directory = rows;
      extraTeams = [...new Set(rows.map(r => r.team).filter(Boolean))];
      // resolve first, then filter — team name must be the display name
      const maybe = resolveClub(rawSeg, extraTeams);
      if (maybe) creators = rows.filter(r => r.team === maybe);
    } catch { /* resolve against the static list below */ }
  }

  const club = resolveClub(rawSeg, extraTeams);
  if (!club) {
    return htmlResponse(404, notFoundHtml(html, reqPath));
  }

  const canonicalPath = clubPath(club, isVideos ? '/videos' : '');
  if (hadTrailingSlash || decodeURIComponent(rawSeg) !== clubSlug(club)) {
    const qs = event.rawQuery ? '?' + event.rawQuery : (event.queryStringParameters && Object.keys(event.queryStringParameters).length
      ? '?' + new URLSearchParams(event.queryStringParameters).toString()
      : '');
    return redirect301(canonicalPath + qs);
  }

  // Organic order is subscriber count only. The Verified pin box below
  // is a separate HTML section filtered from this array. Do not sort
  // verified creators to the front of `creators` — ItemList JSON-LD is
  // built from this same order.
  creators.sort((a, b) => (b.subscriber_count || 0) - (a.subscriber_count || 0));
  // Paid slot only. Failure, a missing table, or an inactive window hides
  // the card. This never reorders `creators` and never adds a row to it.
  let sponsoredCreator = null;
  if (sbKey && !isVideos) {
    sponsoredCreator = await fetchActiveSponsorship(supabaseUrl, sbKey, clubSlug(club), directory);
  }
  const url = SITE_URL + canonicalPath;
  const otherClubs = extraTeams.filter(t => t && t !== club && t !== 'Multi-Club / Other').sort();
  const dateModified = creators
    .map(c => c.last_youtube_sync || c.updated_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || undefined;

  if (isVideos) {
    const title = `Latest ${club} Videos | FanReactionsFC`;
    const description = `Recent ${club} reaction and watchalong videos from creators tracked on FanReactionsFC.`;
    const rows = creators.filter(c => c.name);
    const bodyHtml = `
      <div class="page-hero">
        <div class="container">
          <a href="${clubPath(club)}" class="page-hero-back">&larr; ${esc(club)}</a>
          <div class="page-hero-inner">
            <div class="page-hero-text">
              <div class="page-hero-eyebrow">Latest Videos</div>
              <h1 class="page-hero-title">${esc(club)} Videos</h1>
              <p class="page-hero-subtitle">${rows.length} creator${rows.length !== 1 ? 's' : ''} covering ${esc(club)}.</p>
            </div>
          </div>
        </div>
      </div>
      <div class="container section">
        <ul class="seo-list">
          ${rows.map(c => `<li><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a> — <a href="${clubPath(club)}">${esc(club)}</a></li>`).join('')}
        </ul>
      </div>
      ${ssrFooter(otherClubs)}`;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': siteGraph().concat([
        {
          '@type': 'CollectionPage',
          name: title,
          url,
          dateModified,
          isPartOf: { '@id': SITE_URL + '/#website' },
        },
      ]),
    };
    return htmlResponse(200, applyPage(html, { title, description, url, bodyHtml, jsonLd }));
  }

  // /clubs/multi-club keeps its existing directory copy. It is not a club hub.
  const isMultiClub = club === 'Multi-Club / Other';
  const top = creators[0];
  const sid = sponsoredCreator && sponsoredCreator.id;
  const organic = creators.filter(c => !(sid && c.id === sid));
  const claimTop = isMultiClub ? null : hubClaimTop(organic, null);
  const title = isMultiClub
    ? `${club} Football YouTubers | FanReactionsFC`
    : hubTitle(club, new Date());
  const description = isMultiClub
    ? (creators.length
      ? `${creators.length} ${club} content creator${creators.length !== 1 ? 's' : ''} on YouTube — watchalongs, reactions, and fan commentary.${top ? ` The most-followed is ${top.name}${top.subscriber_count ? ` with ${formatNum(top.subscriber_count)} subscribers` : ''}.` : ''}`
      : `FanReactionsFC club page for ${club} YouTube creators — watchalongs, reactions, and fan commentary.`)
    : hubMeta(club, organic.length, claimTop && claimTop.name, new Date());

  const verifiedPinned = creators.filter(c => isCurrentlyVerified(c));
  const verifiedBox = verifiedPinned.length ? `
      <section class="club-verified-slot" aria-labelledby="club-verified-heading">
        <div class="club-verified-kicker">Pinned</div>
        <p id="club-verified-heading" class="club-verified-title">Verified creators</p>
        <p class="club-verified-note">Paid Verified tier. This box sits above the club ranking and does not change the order below.</p>
        <ul class="seo-list">
          ${verifiedPinned.map(c => `<li><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a> <span class="badge badge-verified">Verified</span>${c.subscriber_count ? ` · ${formatNum(c.subscriber_count)} subscribers` : ''}</li>`).join('')}
        </ul>
      </section>` : '';

  let bodyHtml;
  let itemList;
  let faqs = [];
  if (isMultiClub) {
    const tableRows = organic.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><a href="/creators/${esc(c.slug || slugify(c.name))}">${esc(c.name)}</a>${isCurrentlyVerified(c) ? ' <span class="badge badge-verified">Verified</span>' : ''}</td>
      <td>${c.subscriber_count ? formatNum(c.subscriber_count) : '—'}</td>
    </tr>`).join('');
    bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <a href="/discover" class="page-hero-back">&larr; All clubs</a>
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">Football Club</div>
            <h1 class="page-hero-title">${esc(club)} Football YouTubers</h1>
            <p class="page-hero-subtitle">${esc(description)}</p>
            <div class="page-hero-meta">
              <span class="page-hero-tag">${creators.length} creator${creators.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <div class="club-feature-slots">
        ${sponsoredCreator ? sponsoredSlotHtml(club, sponsoredCreator) : ''}
        ${verifiedBox}
      </div>
      ${organic.length ? `
      <table class="seo-table">
        <thead><tr><th>#</th><th>Creator</th><th>Subscribers</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>` : `
      <div class="empty-state">
        <div class="es-title">No creators yet</div>
        <p>Know a great ${esc(club)} YouTuber? <a href="/submit">Suggest a creator</a>.</p>
      </div>`}
      <p class="seo-more-links"><a href="/rankings">See all ranked creators</a> · <a href="/discover">Discover more clubs</a></p>
    </div>
    ${ssrFooter(otherClubs)}`;
    itemList = {
      '@type': 'ItemList',
      name: `${club} football YouTubers`,
      numberOfItems: Math.min(organic.length, 50),
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      itemListElement: organic.slice(0, 50).map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/creators/${c.slug || slugify(c.name)}`,
        name: c.name,
      })),
    };
  } else {
    const rankedHeading = hubRankedHeading(club, organic.length);
    const intro = hubIntro(club, organic.length, claimTop && claimTop.name);
    const subsLabel = claimTop && claimTop.subscriber_count ? formatNum(claimTop.subscriber_count) : '';
    faqs = buildHubFaqs({
      club,
      topName: claimTop && claimTop.name,
      subs: subsLabel,
      watchNames: watchalongNames(organic),
    });
    const tableRows = organic.map((c, i) => {
      const slug = c.slug || slugify(c.name);
      const avatar = /^https?:\/\//i.test(c.avatar_url || '')
        ? `<img class="hub-avatar" src="${esc(c.avatar_url)}" alt="${esc(hubAvatarAlt(c.name, club))}" loading="lazy">`
        : '';
      const types = Array.isArray(c.content_types) ? c.content_types.slice(0, 4) : [];
      const badges = types.length ? `<span class="hub-badges">${types.map(t => `<span class="cc-tag">${esc(t)}</span>`).join('')}</span>` : '';
      const blurb = oneSentence(c.description);
      const freq = c.upload_frequency && c.upload_frequency !== 'Unknown' && c.upload_frequency !== 'Inactive'
        ? c.upload_frequency : '';
      const synced = syncedMonth(c.last_youtube_sync);
      const country = c.channel_country ? String(c.channel_country).toUpperCase() : '';
      const yt = /^https?:\/\//i.test(c.channel_url || '')
        ? `<a href="${esc(c.channel_url)}" target="_blank" rel="noopener">YouTube</a>` : '';
      const subs = c.subscriber_count ? `${formatNum(c.subscriber_count)} subscribers` : '—';
      const extra = [synced ? `as of ${synced}` : '', freq, country].filter(Boolean).join(' · ');
      return `
    <tr>
      <td>${i + 1}</td>
      <td>${avatar}<a href="/creators/${esc(slug)}">${esc(c.name)}</a>${isCurrentlyVerified(c) ? ' <span class="badge badge-verified">Verified</span>' : ''}${badges}${blurb ? `<div class="hub-blurb">${esc(blurb)}</div>` : ''}</td>
      <td>${esc(subs)}${extra ? `<div class="hub-asof">${esc(extra)}</div>` : ''}${yt ? `<div>${yt}</div>` : ''}</td>
    </tr>`;
    }).join('');
    const videos = latestFanVideos(creators);
    const videoHtml = videos.length ? `
      <section class="hub-section">
        <h2>${esc(seoFill(HUB_COPY.h2Videos, { Club: club }))}</h2>
        <ul class="hub-videos">
          ${videos.map(v => {
            const thumb = /^https?:\/\//i.test(v.thumb || '')
              ? `<img src="${esc(v.thumb)}" alt="${esc(v.title || v.name)}" loading="lazy">` : '';
            const when = videoDay(v.date);
            return `<li>${thumb}<a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title || 'Latest upload')}</a><div class="hub-video-meta">${esc(v.name)}${when ? ` · ${esc(when)}` : ''}</div></li>`;
          }).join('')}
        </ul>
      </section>` : '';
    const related = relatedHubClubs(club, directory);
    const news = sbKey ? await fetchClubNews(supabaseUrl, sbKey, club) : [];
    const relatedHtml = (related.length || news.length) ? `
      <section class="hub-section">
        <h2>${esc(HUB_COPY.h2Related)}</h2>
        ${related.length ? `<ul class="seo-list">${related.map(name => `<li><a href="${clubPath(name)}">${esc(seoFill(HUB_COPY.relatedAnchor, { Club: name }))}</a></li>`).join('')}</ul>` : ''}
        ${news.length ? `<ul class="seo-list">${news.map(a => `<li><a href="/news/${esc(a.slug)}">${esc(a.title)}</a></li>`).join('')}</ul>` : ''}
      </section>` : '';
    bodyHtml = `
    <div class="page-hero">
      <div class="container">
        <nav class="hub-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Home</a> <span aria-hidden="true">›</span>
          <a href="/discover">Discover</a> <span aria-hidden="true">›</span>
          <span>${esc(club)}</span>
        </nav>
        <div class="page-hero-inner">
          <div class="page-hero-text">
            <div class="page-hero-eyebrow">${esc(HUB_LEAGUE_OF[club] || 'Football Club')}</div>
            <h1 class="page-hero-title">${esc(hubH1(club))}</h1>
            ${intro ? `<p class="page-hero-subtitle hub-aeo">${esc(intro)}</p>` : ''}
            <p class="hub-method">${esc(hubMethod(new Date()))}</p>
            <div class="page-hero-meta">
              <span class="page-hero-tag">${organic.length} creator${organic.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="container section">
      <!-- Featured sponsorship and the Verified pin sit outside the ranked
           table. Neither is a ListItem and neither changes rank numbers. -->
      <div class="club-feature-slots">
        ${sponsoredCreator ? sponsoredSlotHtml(club, sponsoredCreator) : ''}
        ${verifiedBox}
      </div>
      ${rankedHeading ? `
      <section class="hub-section" id="club-organic-ranking">
        <h2>${esc(rankedHeading)}</h2>
        <table class="seo-table">
          <thead><tr><th>#</th><th>Creator</th><th>Subscribers</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>` : `
      <div class="empty-state">
        <div class="es-title">No creators yet</div>
        <p>Know a great ${esc(club)} YouTuber? <a href="/submit">Suggest a creator</a>.</p>
      </div>`}
      ${videoHtml}
      <section class="hub-section">
        <h2>${esc(seoFill(HUB_COPY.h2Faq, { Club: club }))}</h2>
        <dl class="hub-faq">
          ${faqs.map(f => `<dt>${esc(f.q)}</dt><dd>${faqAnswerHtml(f)}</dd>`).join('')}
        </dl>
      </section>
      <section class="hub-section">
        <h2>${esc(seoFill(HUB_COPY.h2How, { Club: club }))}</h2>
        <p>${esc(HUB_COPY.howBody)}</p>
        <p class="seo-more-links"><a href="/rankings">Best Football Fan YouTubers Ranked</a></p>
      </section>
      ${relatedHtml}
    </div>
    ${ssrFooter(otherClubs)}`;
    itemList = hubItemList(club, creators, sponsoredCreator);
  }

  const collectionPage = {
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name: isMultiClub ? 'Multi-club football creators' : title,
    description,
    isPartOf: { '@id': SITE_URL + '/#website' },
    mainEntity: itemList,
  };
  if (dateModified) collectionPage.dateModified = dateModified;
  const graphNodes = [];
  if (!isMultiClub) {
    collectionPage.about = { '@id': url + '#team' };
    graphNodes.push({
      '@type': 'SportsTeam',
      '@id': url + '#team',
      name: club,
      sport: 'Soccer',
      url,
    });
  }
  graphNodes.push(collectionPage);
  graphNodes.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: 'Discover', item: SITE_URL + '/discover' },
      { '@type': 'ListItem', position: 3, name: isMultiClub ? 'Multi-club' : club, item: url },
    ],
  });
  if (!isMultiClub && faqs.length) {
    graphNodes.push({
      '@type': 'FAQPage',
      mainEntity: faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': siteGraph().concat(graphNodes),
  };

  return htmlResponse(200, applyPage(html, { title, description, url, bodyHtml, jsonLd }));
};

async function fetchActiveSponsorship(supabaseUrl, sbKey, clubSlugValue, directory) {
  try {
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Accept: 'application/json' };
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_club_sponsorships?club_slug=eq.${encodeURIComponent(clubSlugValue)}&select=creator_id,starts_at,ends_at&limit=1`,
      { headers }
    );
    if (!res.ok) return null;
    const payload = await res.json();
    const row = (Array.isArray(payload) ? payload : [])[0];
    if (!isSponsorshipActive(row, new Date())) return null;
    let creator = (directory || []).find(r => r && r.id === row.creator_id);
    if (!creator) {
      const one = await fetch(
        `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(row.creator_id)}&select=id,name,slug,team,subscriber_count,channel_url,avatar_url,description&limit=1`,
        { headers }
      );
      if (one.ok) {
        const found = await one.json();
        creator = Array.isArray(found) ? found[0] : null;
      }
    }
    if (!creator || !creator.name) return null;
    return creator;
  } catch {
    return null;
  }
}

exports.isSponsorshipActive = isSponsorshipActive;
exports.sponsoredSlotHtml = sponsoredSlotHtml;
