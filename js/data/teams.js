/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Team / League reference data
   Pure data, no logic. Loaded before app.js (see index.html) so its
   globals (LEAGUES, TEAM_CRESTS, TEAM_TO_LEAGUE, TEAM_COLORS,
   CONTENT_TYPES) are ready when app.js, admin.js, and generator.js run.

   Club crests in TEAM_CRESTS are self-hosted under /img/crests/ (mirrored
   from crests.football-data.org / a.espncdn.com so club pages don't depend
   on a third party's uptime/caching). Club crests and trademarks remain the
   property of their respective owners; used here for identification only.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Content types ─────────────────────────────────────────────────────────
const CONTENT_TYPES = [
  'Reactions', 'Watchalong', 'Match Review', 'Tactical',
  'Banter', 'News', 'Podcast', 'Highlights', 'Fan Cam', 'Compilation'
];

// ── Leagues ───────────────────────────────────────────────────────────────
const LEAGUES = [
  { name: 'Premier League', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', code: 'PL',  logo: '/img/leagues/premier-league.png' },
  { name: 'La Liga',         flag: '🇪🇸', code: 'LL',  logo: '/img/leagues/la-liga.png' },
  { name: 'Serie A',         flag: '🇮🇹', code: 'SA',  logo: '/img/leagues/serie-a.png' },
  { name: 'Bundesliga',      flag: '🇩🇪', code: 'BL',  logo: '/img/leagues/bundesliga.png' },
  { name: 'Ligue 1',         flag: '🇫🇷', code: 'L1',  logo: '/img/leagues/ligue-1.png' },
  { name: 'Championship',   flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', code: 'ELC', logo: '/img/leagues/championship.png' }
];

// ── Club crests (football-data.org SVGs) ──────────────────────────────────
const TEAM_CRESTS = {
  // ── Premier League ──
  'Arsenal': '/img/crests/arsenal.svg',
  'Aston Villa': '/img/crests/aston-villa.svg',
  'Bournemouth': '/img/crests/bournemouth.svg',
  'Brentford': '/img/crests/brentford.png',
  'Brighton': '/img/crests/brighton.svg',
  'Burnley': '/img/crests/burnley.svg',
  'Chelsea': '/img/crests/chelsea.svg',
  'Crystal Palace': '/img/crests/crystal-palace.svg',
  'Everton': '/img/crests/everton.svg',
  'Fulham': '/img/crests/fulham.svg',
  'Leeds United': '/img/crests/leeds-united.svg',
  'Liverpool': '/img/crests/liverpool.svg',
  'Man City': '/img/crests/man-city.svg',
  'Man United': '/img/crests/man-united.svg',
  'Newcastle': '/img/crests/newcastle.svg',
  'Nottm Forest': '/img/crests/nottm-forest.svg',
  'Sunderland': '/img/crests/sunderland.png',
  'Tottenham': '/img/crests/tottenham.svg',
  'West Ham': '/img/crests/west-ham.svg',
  'Wolves': '/img/crests/wolves.svg',
  // ── Championship (EFL) ──
  'Birmingham': '/img/crests/birmingham.png',
  'Blackburn': '/img/crests/blackburn.png',
  'Bristol City': '/img/crests/bristol-city.png',
  'Charlton': '/img/crests/charlton.png',
  'Coventry': '/img/crests/coventry.png',
  'Derby': '/img/crests/derby.png',
  'Hull': '/img/crests/hull.png',
  'Ipswich': '/img/crests/ipswich.svg',
  'Leicester': '/img/crests/leicester.svg',
  'Middlesbrough': '/img/crests/middlesbrough.png',
  'Millwall': '/img/crests/millwall.png',
  'Norwich': '/img/crests/norwich.png',
  'Oxford Utd': '/img/crests/oxford-utd.png',
  'Portsmouth': '/img/crests/portsmouth.png',
  'Preston': '/img/crests/preston.png',
  'QPR': '/img/crests/qpr.png',
  'Sheffield Utd': '/img/crests/sheffield-utd.svg',
  'Sheffield Wed': '/img/crests/sheffield-wed.png',
  'Southampton': '/img/crests/southampton.svg',
  'Stoke': '/img/crests/stoke.png',
  'Swansea': '/img/crests/swansea.png',
  'Watford': '/img/crests/watford.png',
  'West Brom': '/img/crests/west-brom.png',
  'Wrexham': '/img/crests/wrexham.png',
  // Luton Town — recently relegated; crest kept so legacy creator rows
  // still render a logo even though Luton isn't in either league list.
  'Luton': '/img/crests/luton.svg',
  // ── La Liga ──
  'Barcelona': '/img/crests/barcelona.svg',
  'Real Madrid': '/img/crests/real-madrid.svg',
  'Atletico Madrid': '/img/crests/atletico-madrid.svg',
  'Sevilla': '/img/crests/sevilla.svg',
  'Real Betis': '/img/crests/real-betis.svg',
  'Real Sociedad': '/img/crests/real-sociedad.svg',
  'Villarreal': '/img/crests/villarreal.svg',
  'Athletic Bilbao': '/img/crests/athletic-bilbao.svg',
  'Valencia': '/img/crests/valencia.svg',
  'Celta Vigo': '/img/crests/celta-vigo.svg',
  'Espanyol': '/img/crests/espanyol.svg',
  'Getafe': '/img/crests/getafe.svg',
  'Osasuna': '/img/crests/osasuna.svg',
  'Mallorca': '/img/crests/mallorca.svg',
  'Rayo Vallecano': '/img/crests/rayo-vallecano.svg',
  'Girona': '/img/crests/girona.svg',
  'Las Palmas': '/img/crests/las-palmas.svg',
  'Alaves': '/img/crests/alaves.svg',
  'Valladolid': '/img/crests/valladolid.svg',
  'Leganes': '/img/crests/leganes.svg',
  // ── Serie A ──
  'Juventus': '/img/crests/juventus.svg',
  'AC Milan': '/img/crests/ac-milan.svg',
  'Inter Milan': '/img/crests/inter-milan.svg',
  'Napoli': '/img/crests/napoli.png',
  'Roma': '/img/crests/roma.png',
  'Lazio': '/img/crests/lazio.svg',
  'Atalanta': '/img/crests/atalanta.svg',
  'Fiorentina': '/img/crests/fiorentina.svg',
  'Bologna': '/img/crests/bologna.svg',
  'Torino': '/img/crests/torino.svg',
  'Udinese': '/img/crests/udinese.svg',
  'Monza': '/img/crests/monza.svg',
  'Empoli': '/img/crests/empoli.png',
  'Genoa': '/img/crests/genoa.svg',
  'Cagliari': '/img/crests/cagliari.svg',
  'Lecce': '/img/crests/lecce.png',
  'Hellas Verona': '/img/crests/hellas-verona.svg',
  'Parma': '/img/crests/parma.svg',
  'Venezia': '/img/crests/venezia.svg',
  'Como': '/img/crests/como.svg',
  // ── Bundesliga ──
  'Bayern Munich': '/img/crests/bayern-munich.svg',
  'Borussia Dortmund': '/img/crests/borussia-dortmund.svg',
  'RB Leipzig': '/img/crests/rb-leipzig.svg',
  'Bayer Leverkusen': '/img/crests/bayer-leverkusen.svg',
  'Union Berlin': '/img/crests/union-berlin.svg',
  'Freiburg': '/img/crests/freiburg.svg',
  'Eintracht Frankfurt': '/img/crests/eintracht-frankfurt.svg',
  'Wolfsburg': '/img/crests/wolfsburg.svg',
  'Mainz': '/img/crests/mainz.svg',
  'Borussia Monchengladbach': '/img/crests/borussia-monchengladbach.svg',
  'Hoffenheim': '/img/crests/hoffenheim.svg',
  'Werder Bremen': '/img/crests/werder-bremen.svg',
  'Augsburg': '/img/crests/augsburg.svg',
  'Bochum': '/img/crests/bochum.svg',
  'Heidenheim': '/img/crests/heidenheim.svg',
  'Stuttgart': '/img/crests/stuttgart.svg',
  'Holstein Kiel': '/img/crests/holstein-kiel.svg',
  'St. Pauli': '/img/crests/st-pauli.svg',
  // ── Ligue 1 ──
  'PSG': '/img/crests/psg.svg',
  'Marseille': '/img/crests/marseille.svg',
  'Lyon': '/img/crests/lyon.svg',
  'Monaco': '/img/crests/monaco.png',
  'Lille': '/img/crests/lille.svg',
  'Nice': '/img/crests/nice.png',
  'Rennes': '/img/crests/rennes.svg',
  'Lens': '/img/crests/lens.svg',
  'Strasbourg': '/img/crests/strasbourg.svg',
  'Nantes': '/img/crests/nantes.svg',
  'Montpellier': '/img/crests/montpellier.svg',
  'Toulouse': '/img/crests/toulouse.svg',
  'Brest': '/img/crests/brest.svg',
  'Reims': '/img/crests/reims.svg',
  'Le Havre': '/img/crests/le-havre.svg',
  'Auxerre': '/img/crests/auxerre.svg',
  'Angers': '/img/crests/angers.svg',
  'Saint-Etienne': '/img/crests/saint-etienne.png'
};

// ── Team → League mapping ─────────────────────────────────────────────────
const TEAM_TO_LEAGUE = {};
(function buildLeagueMap() {
  const map = {
    'Premier League': ['Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Burnley','Chelsea','Crystal Palace','Everton','Fulham','Leeds United','Liverpool','Man City','Man United','Newcastle','Nottm Forest','Sunderland','Tottenham','West Ham','Wolves'],
    'Championship': ['Birmingham','Blackburn','Bristol City','Charlton','Coventry','Derby','Hull','Ipswich','Leicester','Middlesbrough','Millwall','Norwich','Oxford Utd','Portsmouth','Preston','QPR','Sheffield Utd','Sheffield Wed','Southampton','Stoke','Swansea','Watford','West Brom','Wrexham'],
    'La Liga': ['Barcelona','Real Madrid','Atletico Madrid','Sevilla','Real Betis','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Celta Vigo','Espanyol','Getafe','Osasuna','Mallorca','Rayo Vallecano','Girona','Las Palmas','Alaves','Valladolid','Leganes'],
    'Serie A': ['Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Torino','Udinese','Monza','Empoli','Genoa','Cagliari','Lecce','Hellas Verona','Parma','Venezia','Como'],
    'Bundesliga': ['Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Union Berlin','Freiburg','Eintracht Frankfurt','Wolfsburg','Mainz','Borussia Monchengladbach','Hoffenheim','Werder Bremen','Augsburg','Bochum','Heidenheim','Stuttgart','Holstein Kiel','St. Pauli'],
    'Ligue 1': ['PSG','Marseille','Lyon','Monaco','Lille','Nice','Rennes','Lens','Strasbourg','Nantes','Montpellier','Toulouse','Brest','Reims','Le Havre','Auxerre','Angers','Saint-Etienne']
  };
  for (const [league, teams] of Object.entries(map)) {
    teams.forEach(t => TEAM_TO_LEAGUE[t] = league);
  }
})();

// ── Team brand colours (primary, secondary) ─────────────────────────────
const TEAM_COLORS = {
  'Arsenal':['#EF0107','#FFFFFF'],'Aston Villa':['#670E36','#95BFE5'],'Bournemouth':['#DA291C','#000000'],'Brentford':['#E30613','#FBB800'],
  'Brighton':['#0057B8','#FFFFFF'],'Burnley':['#6C1D45','#99D6EA'],'Chelsea':['#034694','#FFFFFF'],'Crystal Palace':['#1B458F','#C4122E'],
  'Everton':['#003399','#FFFFFF'],'Fulham':['#000000','#FFFFFF'],'Leeds United':['#1D428A','#FFCD00'],'Liverpool':['#C8102E','#FFFFFF'],
  'Man City':['#6CABDD','#1C2C5B'],'Man United':['#DA291C','#FBE122'],'Newcastle':['#241F20','#FFFFFF'],'Nottm Forest':['#DD0000','#FFFFFF'],
  'Sunderland':['#EB172B','#FFFFFF'],'Tottenham':['#132257','#FFFFFF'],'West Ham':['#7A263A','#1BB1E7'],'Wolves':['#FDB913','#231F20'],
  'Barcelona':['#A50044','#004D98'],'Real Madrid':['#FEBE10','#00529F'],'Atletico Madrid':['#CB3524','#FFFFFF'],
  'Sevilla':['#D6001C','#FFFFFF'],'Real Betis':['#00954C','#FFFFFF'],'Villarreal':['#FFCD00','#005187'],
  'Juventus':['#000000','#FFFFFF'],'AC Milan':['#FB090B','#000000'],'Inter Milan':['#010E80','#FCBB09'],
  'Napoli':['#12A0D7','#FFFFFF'],'Roma':['#8E1F2F','#F0BC42'],'Lazio':['#87D8F7','#FFFFFF'],
  'Bayern Munich':['#DC052D','#FFFFFF'],'Borussia Dortmund':['#FDE100','#000000'],'RB Leipzig':['#DD0741','#FFFFFF'],
  'Bayer Leverkusen':['#E32221','#000000'],'Eintracht Frankfurt':['#E1000F','#000000'],
  'PSG':['#004170','#DA291C'],'Marseille':['#2FAEE0','#FFFFFF'],'Lyon':['#1A3C8F','#ED1C24'],
  'Monaco':['#E7001E','#FFFFFF'],'Lille':['#D20026','#FFFFFF'],
  'Leicester':['#003090','#FDBE11'],'Southampton':['#D71920','#FFFFFF'],'Sheffield Utd':['#EE2737','#FFFFFF'],
  'Ipswich':['#0044AA','#FFFFFF'],'Norwich':['#00A650','#FFF200'],'Watford':['#FBEE23','#ED2127'],
  'Birmingham':['#0000FF','#FFFFFF'],'Derby':['#000000','#FFFFFF'],'Stoke':['#E03A3E','#1B449C'],
  'QPR':['#1D5BA4','#FFFFFF'],'Swansea':['#000000','#FFFFFF'],'West Brom':['#122F67','#FFFFFF'],
  'Multi-Club / Other':['#F6BE06','#061A5D']
};
