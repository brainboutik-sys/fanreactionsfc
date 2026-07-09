/* ═══════════════════════════════════════════════════════════════════════════
   FanReactionsFC — Team / League reference data
   Pure data, no logic. Loaded before app.js (see index.html) so its
   globals (LEAGUES, TEAM_CRESTS, TEAM_TO_LEAGUE, TEAM_COLORS,
   CONTENT_TYPES) are ready when app.js, admin.js, and generator.js run.
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
  'Arsenal': 'https://crests.football-data.org/57.svg',
  'Aston Villa': 'https://crests.football-data.org/58.svg',
  'Bournemouth': 'https://crests.football-data.org/1044.svg',
  'Brentford': 'https://a.espncdn.com/i/teamlogos/soccer/500/337.png',
  'Brighton': 'https://crests.football-data.org/397.svg',
  'Burnley': 'https://crests.football-data.org/328.svg',
  'Chelsea': 'https://crests.football-data.org/61.svg',
  'Crystal Palace': 'https://crests.football-data.org/354.svg',
  'Everton': 'https://crests.football-data.org/62.svg',
  'Fulham': 'https://crests.football-data.org/63.svg',
  'Leeds United': 'https://crests.football-data.org/341.svg',
  'Liverpool': 'https://crests.football-data.org/64.svg',
  'Man City': 'https://crests.football-data.org/65.svg',
  'Man United': 'https://crests.football-data.org/66.svg',
  'Newcastle': 'https://crests.football-data.org/67.svg',
  'Nottm Forest': 'https://crests.football-data.org/351.svg',
  'Sunderland': 'https://a.espncdn.com/i/teamlogos/soccer/500/366.png',
  'Tottenham': 'https://crests.football-data.org/73.svg',
  'West Ham': 'https://crests.football-data.org/563.svg',
  'Wolves': 'https://crests.football-data.org/76.svg',
  // ── Championship (EFL) ──
  'Birmingham': 'https://a.espncdn.com/i/teamlogos/soccer/500/392.png',
  'Blackburn': 'https://a.espncdn.com/i/teamlogos/soccer/500/365.png',
  'Bristol City': 'https://a.espncdn.com/i/teamlogos/soccer/500/333.png',
  'Charlton': 'https://a.espncdn.com/i/teamlogos/soccer/500/372.png',
  'Coventry': 'https://a.espncdn.com/i/teamlogos/soccer/500/388.png',
  'Derby': 'https://a.espncdn.com/i/teamlogos/soccer/500/374.png',
  'Hull': 'https://a.espncdn.com/i/teamlogos/soccer/500/306.png',
  'Ipswich': 'https://crests.football-data.org/349.svg',
  'Leicester': 'https://crests.football-data.org/338.svg',
  'Middlesbrough': 'https://a.espncdn.com/i/teamlogos/soccer/500/369.png',
  'Millwall': 'https://a.espncdn.com/i/teamlogos/soccer/500/391.png',
  'Norwich': 'https://a.espncdn.com/i/teamlogos/soccer/500/381.png',
  'Oxford Utd': 'https://a.espncdn.com/i/teamlogos/soccer/500/311.png',
  'Portsmouth': 'https://a.espncdn.com/i/teamlogos/soccer/500/385.png',
  'Preston': 'https://a.espncdn.com/i/teamlogos/soccer/500/394.png',
  'QPR': 'https://a.espncdn.com/i/teamlogos/soccer/500/334.png',
  'Sheffield Utd': 'https://crests.football-data.org/356.svg',
  'Sheffield Wed': 'https://a.espncdn.com/i/teamlogos/soccer/500/399.png',
  'Southampton': 'https://crests.football-data.org/340.svg',
  'Stoke': 'https://a.espncdn.com/i/teamlogos/soccer/500/336.png',
  'Swansea': 'https://a.espncdn.com/i/teamlogos/soccer/500/318.png',
  'Watford': 'https://a.espncdn.com/i/teamlogos/soccer/500/395.png',
  'West Brom': 'https://a.espncdn.com/i/teamlogos/soccer/500/383.png',
  'Wrexham': 'https://a.espncdn.com/i/teamlogos/soccer/500/352.png',
  // Luton Town — recently relegated; crest kept so legacy creator rows
  // still render a logo even though Luton isn't in either league list.
  'Luton': 'https://crests.football-data.org/389.svg',
  // ── La Liga ──
  'Barcelona': 'https://crests.football-data.org/81.svg',
  'Real Madrid': 'https://crests.football-data.org/86.svg',
  'Atletico Madrid': 'https://crests.football-data.org/78.svg',
  'Sevilla': 'https://crests.football-data.org/559.svg',
  'Real Betis': 'https://crests.football-data.org/90.svg',
  'Real Sociedad': 'https://crests.football-data.org/92.svg',
  'Villarreal': 'https://crests.football-data.org/94.svg',
  'Athletic Bilbao': 'https://crests.football-data.org/77.svg',
  'Valencia': 'https://crests.football-data.org/95.svg',
  'Celta Vigo': 'https://crests.football-data.org/558.svg',
  'Espanyol': 'https://crests.football-data.org/80.svg',
  'Getafe': 'https://crests.football-data.org/82.svg',
  'Osasuna': 'https://crests.football-data.org/79.svg',
  'Mallorca': 'https://crests.football-data.org/89.svg',
  'Rayo Vallecano': 'https://crests.football-data.org/87.svg',
  'Girona': 'https://crests.football-data.org/298.svg',
  'Las Palmas': 'https://crests.football-data.org/275.svg',
  'Alaves': 'https://crests.football-data.org/263.svg',
  'Valladolid': 'https://crests.football-data.org/250.svg',
  'Leganes': 'https://crests.football-data.org/745.svg',
  // ── Serie A ──
  'Juventus': 'https://crests.football-data.org/109.svg',
  'AC Milan': 'https://crests.football-data.org/98.svg',
  'Inter Milan': 'https://crests.football-data.org/108.svg',
  'Napoli': 'https://crests.football-data.org/113.png',
  'Roma': 'https://a.espncdn.com/i/teamlogos/soccer/500/104.png',
  'Lazio': 'https://crests.football-data.org/110.svg',
  'Atalanta': 'https://crests.football-data.org/102.svg',
  'Fiorentina': 'https://crests.football-data.org/99.svg',
  'Bologna': 'https://crests.football-data.org/103.svg',
  'Torino': 'https://crests.football-data.org/586.svg',
  'Udinese': 'https://crests.football-data.org/115.svg',
  'Monza': 'https://crests.football-data.org/5890.svg',
  'Empoli': 'https://a.espncdn.com/i/teamlogos/soccer/500/102.png',
  'Genoa': 'https://crests.football-data.org/107.svg',
  'Cagliari': 'https://crests.football-data.org/104.svg',
  'Lecce': 'https://a.espncdn.com/i/teamlogos/soccer/500/113.png',
  'Hellas Verona': 'https://crests.football-data.org/450.svg',
  'Parma': 'https://crests.football-data.org/112.svg',
  'Venezia': 'https://crests.football-data.org/454.svg',
  'Como': 'https://crests.football-data.org/472.svg',
  // ── Bundesliga ──
  'Bayern Munich': 'https://crests.football-data.org/5.svg',
  'Borussia Dortmund': 'https://crests.football-data.org/4.svg',
  'RB Leipzig': 'https://crests.football-data.org/721.svg',
  'Bayer Leverkusen': 'https://crests.football-data.org/3.svg',
  'Union Berlin': 'https://crests.football-data.org/28.svg',
  'Freiburg': 'https://crests.football-data.org/17.svg',
  'Eintracht Frankfurt': 'https://crests.football-data.org/19.svg',
  'Wolfsburg': 'https://crests.football-data.org/11.svg',
  'Mainz': 'https://crests.football-data.org/15.svg',
  'Borussia Monchengladbach': 'https://crests.football-data.org/18.svg',
  'Hoffenheim': 'https://crests.football-data.org/2.svg',
  'Werder Bremen': 'https://crests.football-data.org/12.svg',
  'Augsburg': 'https://crests.football-data.org/16.svg',
  'Bochum': 'https://crests.football-data.org/36.svg',
  'Heidenheim': 'https://crests.football-data.org/44.svg',
  'Stuttgart': 'https://crests.football-data.org/10.svg',
  'Holstein Kiel': 'https://crests.football-data.org/720.svg',
  'St. Pauli': 'https://crests.football-data.org/20.svg',
  // ── Ligue 1 ──
  'PSG': 'https://crests.football-data.org/524.svg',
  'Marseille': 'https://crests.football-data.org/516.svg',
  'Lyon': 'https://crests.football-data.org/523.svg',
  'Monaco': 'https://a.espncdn.com/i/teamlogos/soccer/500/174.png',
  'Lille': 'https://crests.football-data.org/521.svg',
  'Nice': 'https://a.espncdn.com/i/teamlogos/soccer/500/2502.png',
  'Rennes': 'https://crests.football-data.org/529.svg',
  'Lens': 'https://crests.football-data.org/546.svg',
  'Strasbourg': 'https://crests.football-data.org/576.svg',
  'Nantes': 'https://crests.football-data.org/543.svg',
  'Montpellier': 'https://crests.football-data.org/518.svg',
  'Toulouse': 'https://crests.football-data.org/511.svg',
  'Brest': 'https://crests.football-data.org/512.svg',
  'Reims': 'https://crests.football-data.org/547.svg',
  'Le Havre': 'https://crests.football-data.org/545.svg',
  'Auxerre': 'https://crests.football-data.org/519.svg',
  'Angers': 'https://crests.football-data.org/532.svg',
  'Saint-Etienne': 'https://a.espncdn.com/i/teamlogos/soccer/500/178.png'
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
