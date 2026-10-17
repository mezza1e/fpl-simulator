/**
 * Data Preprocessing Script
 * Converts CSV data from the Vaastav FPL repository into optimized JSON
 * Run: node --loader ts-node/esm scripts/preprocess.mjs
 */
import fs from 'fs';
import path from 'path';

const DATA_REPO = path.resolve('../data-repo/data');
const OUTPUT_DIR = path.resolve('public/data');

// Seasons to process
const SEASONS = [
  '2016-17', '2017-18', '2018-19', '2019-20', '2020-21',
  '2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27',
];

function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  
  // Parse header
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function toNumber(val, defaultVal = 0) {
  if (val === '' || val === undefined || val === null || val === 'None' || val === 'NA' || val === 'False' || val === 'True') return defaultVal;
  const n = Number(val);
  return isNaN(n) ? defaultVal : n;
}

function toString(val) {
  if (val === 'None' || val === undefined || val === null) return null;
  return String(val).trim() || null;
}

// Short name generation for teams without short_name field
const TEAM_SHORT_NAMES = {
  'Arsenal': 'ARS', 'Aston Villa': 'AVL', 'Bournemouth': 'BOU', 'Brentford': 'BRE',
  'Brighton': 'BHA', 'Burnley': 'BUR', 'Chelsea': 'CHE', 'Crystal Palace': 'CRY',
  'Everton': 'EVE', 'Fulham': 'FUL', 'Hull': 'HUL', 'Ipswich': 'IPS',
  'Leeds': 'LEE', 'Leicester': 'LEI', 'Liverpool': 'LIV', 'Luton': 'LUT',
  'Man City': 'MCI', 'Man Utd': 'MUN', 'Middlesbrough': 'MID', 'Newcastle': 'NEW',
  'Norwich': 'NOR', 'Nott\'m Forest': 'NFO', 'Sheffield Utd': 'SHU', 'Southampton': 'SOU',
  'Stoke': 'STK', 'Sunderland': 'SUN', 'Swansea': 'SWA', 'Spurs': 'TOT',
  'Tottenham': 'TOT', 'Watford': 'WAT', 'West Brom': 'WBA', 'West Ham': 'WHU',
  'Wolves': 'WOL', 'Huddersfield': 'HUD', 'Cardiff': 'CAR',
  'Brighton and Hove Albion': 'BHA', 'Nottingham Forest': 'NFO',
};

function getShortName(teamName) {
  if (TEAM_SHORT_NAMES[teamName]) return TEAM_SHORT_NAMES[teamName];
  // Generate from first 3 chars
  return teamName.substring(0, 3).toUpperCase();
}

const KNOWN_INJURIES = {
  // 2016-17
  '2016-17:Coutinho': 'Ankle ligament injury',
  '2016-17:Kane': 'Ankle ligament injury',
  '2016-17:Cazorla': 'Achilles tendon rupture',
  '2016-17:Ibrahimovic': 'Cruciate ligament (ACL) injury',
  '2016-17:Welbeck': 'Cartilage knee injury',
  '2016-17:Kompany': 'Groin / Calf strain',
  '2016-17:Cresswell': 'Knee ligament injury',
  '2016-17:Bolasie': 'Cruciate ligament (ACL) injury',
  '2016-17:Wilson': 'Cruciate ligament (ACL) injury',
  '2016-17:Hazard': 'Ankle fracture',
  '2016-17:Mane': 'Meniscus knee injury',
  '2016-17:Gundogan': 'Cruciate ligament (ACL) injury',
  '2016-17:Lamela': 'Hip injury / surgery',
  '2016-17:Rose': 'Medial knee ligament injury',
  // 2017-18
  '2017-18:Mendy': 'Cruciate ligament (ACL) rupture',
  '2017-18:Lanzini': 'Cruciate ligament (ACL) injury',
  '2017-18:Chamberlain': 'Cruciate ligament (ACL) injury',
  '2017-18:Morata': 'Back injury',
  // 2018-19
  '2018-19:De Bruyne': 'Lateral collateral ligament knee injury',
  '2018-19:Gomez': 'Fractured lower leg',
  '2018-19:Holding': 'Cruciate ligament (ACL) rupture',
  '2018-19:Bellerin': 'Cruciate ligament (ACL) rupture',
  '2018-19:Welbeck': 'Ankle fracture / surgery',
  // 2019-20
  '2019-20:Laporte': 'Meniscus cartilage knee damage',
  '2019-20:Sane': 'Cruciate ligament (ACL) rupture',
  '2019-20:Rashford': 'Double back stress fracture',
  '2019-20:Kane': 'Hamstring tendon rupture',
  '2019-20:Son': 'Arm fracture surgery',
  // 2020-21
  '2020-21:van Dijk': 'Cruciate ligament (ACL) rupture',
  '2020-21:Gomez': 'Patella tendon rupture',
  '2020-21:Matip': 'Ankle ligament injury',
  '2020-21:Jimenez': 'Fractured skull surgery',
  // 2021-22
  '2021-22:Chilwell': 'Cruciate ligament (ACL) rupture',
  '2021-22:Bamford': 'Plantar fascia rupture',
  // 2022-23
  '2022-23:James': 'Hamstring strain / knee injury',
  '2022-23:Diaz': 'Lateral collateral knee ligament',
  '2022-23:Jesus': 'Medial collateral knee ligament',
  // 2023-24
  '2023-24:De Bruyne': 'Hamstring tendon surgery',
  '2023-24:Timber': 'Cruciate ligament (ACL) rupture',
  '2023-24:Mings': 'Cruciate ligament (ACL) rupture',
  '2023-24:Buendia': 'Cruciate ligament (ACL) rupture',
  '2023-24:Haaland': 'Foot bone stress injury',
  '2023-24:Pope': 'Dislocated shoulder surgery',
  '2023-24:Botman': 'Cruciate ligament (ACL) rupture',
};

function getPlayerInjuryReason(season, player, rawNews, weeksOut) {
  const key1 = `${season}:${player.webName}`;
  const key2 = `${season}:${player.lastName}`;
  if (KNOWN_INJURIES[key1]) return KNOWN_INJURIES[key1];
  if (KNOWN_INJURIES[key2]) return KNOWN_INJURIES[key2];

  if (rawNews) {
    const lower = rawNews.toLowerCase();
    if (lower.includes('hamstring')) return 'Hamstring injury';
    if (lower.includes('knee') || lower.includes('acl') || lower.includes('meniscus')) return 'Knee injury';
    if (lower.includes('ankle')) return 'Ankle injury';
    if (lower.includes('calf')) return 'Calf injury';
    if (lower.includes('groin')) return 'Groin strain';
    if (lower.includes('thigh')) return 'Thigh strain';
    if (lower.includes('achilles')) return 'Achilles tendon injury';
    if (lower.includes('foot') || lower.includes('toe')) return 'Foot injury';
    if (lower.includes('back')) return 'Back injury';
    if (lower.includes('shoulder')) return 'Shoulder injury';
    if (lower.includes('illness')) return 'Illness';
  }

  if (weeksOut === 1) return 'Knock / Muscle tightness';
  if (weeksOut <= 3) return 'Hamstring strain';
  if (weeksOut <= 6) return 'Ankle ligament injury';
  if (weeksOut <= 10) return 'Knee ligament injury';
  return 'Major joint injury / Surgery';
}

function processTeams(seasonPath, season) {
  const filePath = path.join(seasonPath, 'teams.csv');
  
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const rows = parseCSV(raw);
    
    return rows.map(r => ({
      id: toNumber(r.id),
      code: toNumber(r.code),
      name: r.name || '',
      shortName: r.short_name || getShortName(r.name || ''),
      strength: toNumber(r.strength),
      strengthOverallHome: toNumber(r.strength_overall_home),
      strengthOverallAway: toNumber(r.strength_overall_away),
      strengthAttackHome: toNumber(r.strength_attack_home),
      strengthAttackAway: toNumber(r.strength_attack_away),
      strengthDefenceHome: toNumber(r.strength_defence_home),
      strengthDefenceAway: toNumber(r.strength_defence_away),
    }));
  }
  
  // Fallback: use master_team_list.csv
  const masterPath = path.join(DATA_REPO, 'master_team_list.csv');
  if (fs.existsSync(masterPath)) {
    const raw = fs.readFileSync(masterPath, 'utf-8');
    const rows = parseCSV(raw);
    
    return rows
      .filter(r => r.season === season)
      .map(r => ({
        id: toNumber(r.team),
        code: toNumber(r.team), // use team ID as code fallback
        name: r.team_name || '',
        shortName: getShortName(r.team_name || ''),
        strength: 3,
        strengthOverallHome: 1100,
        strengthOverallAway: 1100,
        strengthAttackHome: 1100,
        strengthAttackAway: 1100,
        strengthDefenceHome: 1100,
        strengthDefenceAway: 1100,
      }));
  }
  
  return [];
}

function processPlayers(seasonPath, teams, playerGWTeamMap, totalGameweeks) {
  const rawPath = path.join(seasonPath, 'players_raw.csv');
  
  if (!fs.existsSync(rawPath)) return [];
  
  const rawContent = fs.readFileSync(rawPath, 'utf-8');
  const rawRows = parseCSV(rawContent);
  
  // Build team lookup
  const teamMap = {};
  teams.forEach(t => { teamMap[t.id] = t; });
  
  // Filter out non-player elements (element_type > 4 or < 1, e.g. managers in 2024-25)
  const validPlayerRows = rawRows.filter(r => {
    const pos = toNumber(r.element_type, 1);
    return pos >= 1 && pos <= 4;
  });

  return validPlayerRows.map(r => {
    const pId = toNumber(r.id);
    const rawTeamId = toNumber(r.team);
    const gwTeamMap = (playerGWTeamMap && playerGWTeamMap.get(pId)) || new Map();
    const sortedGWs = Array.from(gwTeamMap.keys()).sort((a, b) => a - b);

    // Starting club: GW1 club if available, else debut GW club, else fallback to raw club
    let startingTeamId = rawTeamId;
    if (gwTeamMap.has(1)) {
      startingTeamId = gwTeamMap.get(1);
    } else if (sortedGWs.length > 0) {
      startingTeamId = gwTeamMap.get(sortedGWs[0]);
    }

    // Build complete teamByGameweek timeline
    const teamByGameweek = {};
    let curTeam = startingTeamId;
    for (let gw = 1; gw <= totalGameweeks; gw++) {
      if (gwTeamMap.has(gw)) {
        curTeam = gwTeamMap.get(gw);
      }
      teamByGameweek[gw] = curTeam;
    }

    const team = teamMap[startingTeamId] || { name: 'Unknown', shortName: '???' };
    
    return {
      id: pId,
      code: toNumber(r.code),
      firstName: r.first_name || '',
      lastName: r.second_name || '',
      webName: r.web_name || r.second_name || '',
      position: toNumber(r.element_type, 1),
      teamId: startingTeamId,
      teamName: team.name,
      teamShortName: team.shortName,
      teamByGameweek,
      startPrice: toNumber(r.now_cost, 50),
      status: mapStatus(r.status),
      news: toString(r.news),
      newsAdded: toString(r.news_added),
      chanceOfPlayingThisRound: r.chance_of_playing_this_round !== '' && r.chance_of_playing_this_round !== 'None' ? toNumber(r.chance_of_playing_this_round, null) : null,
      chanceOfPlayingNextRound: r.chance_of_playing_next_round !== '' && r.chance_of_playing_next_round !== 'None' ? toNumber(r.chance_of_playing_next_round, null) : null,
      provenance: 'verified',
    };
  });
}

function mapStatus(raw) {
  const s = (raw || '').toLowerCase();
  if (s === 'a') return 'a';
  if (s === 'd') return 'd';
  if (s === 'i') return 'i';
  if (s === 's') return 's';
  if (s === 'u') return 'u';
  return 'n';
}

function processFixtures(seasonPath, teams, fixtureMap) {
  const filePath = path.join(seasonPath, 'fixtures.csv');
  const teamMap = {};
  teams.forEach(t => { teamMap[t.id] = t; });

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const rows = parseCSV(raw);
    
    return rows.map(r => {
      const homeId = toNumber(r.team_h);
      const awayId = toNumber(r.team_a);
      const homeTeam = teamMap[homeId] || { name: 'Unknown', shortName: '???' };
      const awayTeam = teamMap[awayId] || { name: 'Unknown', shortName: '???' };
      
      return {
        id: toNumber(r.id),
        gameweek: r.event === 'None' || r.event === '' ? null : toNumber(r.event),
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeTeamName: homeTeam.name,
        awayTeamName: awayTeam.name,
        homeTeamShortName: homeTeam.shortName,
        awayTeamShortName: awayTeam.shortName,
        homeScore: r.team_h_score === 'None' || r.team_h_score === '' ? null : toNumber(r.team_h_score),
        awayScore: r.team_a_score === 'None' || r.team_a_score === '' ? null : toNumber(r.team_a_score),
        finished: r.finished === 'True' || r.finished === 'true',
        kickoffTime: toString(r.kickoff_time),
      };
    });
  }

  // Fallback: reconstruct fixtures from gameweek deductions (for seasons 2016-17 and 2017-18)
  if (!fixtureMap || fixtureMap.size === 0) return [];

  const fixtureList = Array.from(fixtureMap.values()).map(f => {
    const homeTeam = teamMap[f.homeTeamId] || { name: 'Unknown', shortName: '???' };
    const awayTeam = teamMap[f.awayTeamId] || { name: 'Unknown', shortName: '???' };
    return {
      id: f.id,
      gameweek: f.gameweek,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      homeTeamName: homeTeam.name,
      awayTeamName: awayTeam.name,
      homeTeamShortName: homeTeam.shortName,
      awayTeamShortName: awayTeam.shortName,
      homeScore: f.homeScore,
      awayScore: f.awayScore,
      finished: true,
      kickoffTime: f.kickoffTime,
    };
  });

  return fixtureList.sort((a, b) => a.id - b.id);
}

function processGameweeks(seasonPath, teams) {
  const gwDir = path.join(seasonPath, 'gws');
  if (!fs.existsSync(gwDir)) return { gameweekData: {}, playerGWTeamMap: new Map(), fixtureMap: new Map() };
  
  const teamByName = new Map();
  const teamByShortName = new Map();
  teams.forEach(t => {
    teamByName.set(t.name.toLowerCase(), t.id);
    if (t.shortName) teamByShortName.set(t.shortName.toLowerCase(), t.id);
  });

  const gwFiles = fs.readdirSync(gwDir).filter(f => f.match(/^gw\d+\.csv$/));
  const gameweekData = {};
  const playerGWTeamMap = new Map();
  const fixtureMap = new Map();
  
  for (const file of gwFiles) {
    const gwNum = parseInt(file.replace('gw', '').replace('.csv', ''));
    const content = fs.readFileSync(path.join(gwDir, file), 'utf-8');
    const rows = parseCSV(content);

    // Build fixture home/away map for this GW
    const gwFixtureMap = new Map();
    for (const r of rows) {
      const fixId = r.fixture ? toNumber(r.fixture) : null;
      const oppId = toNumber(r.opponent_team);
      const wasHome = r.was_home === 'True' || r.was_home === 'true';
      if (!fixId || !oppId) continue;
      if (!gwFixtureMap.has(fixId)) {
        gwFixtureMap.set(fixId, {
          id: fixId,
          gameweek: gwNum,
          homeTeamId: null,
          awayTeamId: null,
          homeScore: r.team_h_score !== '' && r.team_h_score !== undefined ? toNumber(r.team_h_score) : null,
          awayScore: r.team_a_score !== '' && r.team_a_score !== undefined ? toNumber(r.team_a_score) : null,
          kickoffTime: toString(r.kickoff_time),
        });
      }
      const entry = gwFixtureMap.get(fixId);
      if (wasHome) entry.awayTeamId = oppId;
      else entry.homeTeamId = oppId;
    }

    // Merge into season fixtureMap
    for (const [id, f] of gwFixtureMap.entries()) {
      if (!fixtureMap.has(id)) fixtureMap.set(id, f);
    }
    
    gameweekData[gwNum] = rows.map(r => {
      const pId = toNumber(r.element);
      const wasHome = r.was_home === 'True' || r.was_home === 'true';
      const fixId = r.fixture ? toNumber(r.fixture) : null;
      let rowTeamId = null;

      if (r.team) {
        const tStr = r.team.trim().toLowerCase();
        rowTeamId = teamByName.get(tStr) || teamByShortName.get(tStr) || null;
      } else if (fixId && gwFixtureMap.has(fixId)) {
        const fEntry = gwFixtureMap.get(fixId);
        rowTeamId = wasHome ? fEntry.homeTeamId : fEntry.awayTeamId;
      }

      if (rowTeamId && pId) {
        if (!playerGWTeamMap.has(pId)) playerGWTeamMap.set(pId, new Map());
        playerGWTeamMap.get(pId).set(gwNum, rowTeamId);
      }

      return {
        playerId: pId,
        gameweek: gwNum,
        teamId: rowTeamId || undefined,
        totalPoints: toNumber(r.total_points),
        minutes: toNumber(r.minutes),
        goals: toNumber(r.goals_scored),
        assists: toNumber(r.assists),
        cleanSheets: toNumber(r.clean_sheets),
        goalsConceded: toNumber(r.goals_conceded),
        ownGoals: toNumber(r.own_goals),
        penaltiesSaved: toNumber(r.penalties_saved),
        penaltiesMissed: toNumber(r.penalties_missed),
        yellowCards: toNumber(r.yellow_cards),
        redCards: toNumber(r.red_cards),
        saves: toNumber(r.saves),
        bonus: toNumber(r.bonus),
        bps: toNumber(r.bps),
        influence: r.influence ? toNumber(r.influence) : null,
        creativity: r.creativity ? toNumber(r.creativity) : null,
        threat: r.threat ? toNumber(r.threat) : null,
        ictIndex: r.ict_index ? toNumber(r.ict_index) : null,
        value: toNumber(r.value, 50),
        wasHome,
        opponentTeamId: toNumber(r.opponent_team),
        kickoffTime: toString(r.kickoff_time),
        round: gwNum,
        selected: r.selected ? toNumber(r.selected) : null,
        transfersIn: r.transfers_in ? toNumber(r.transfers_in) : null,
        transfersOut: r.transfers_out ? toNumber(r.transfers_out) : null,
        name: r.name || null,
      };
    });
  }
  
  return { gameweekData, playerGWTeamMap, fixtureMap };
}

function processSeason(season) {
  const seasonPath = path.join(DATA_REPO, season);
  
  if (!fs.existsSync(seasonPath)) {
    console.log(`  Skipping ${season} - directory not found`);
    return null;
  }
  
  console.log(`  Processing ${season}...`);
  
  const teams = processTeams(seasonPath, season);
  const { gameweekData, playerGWTeamMap, fixtureMap } = processGameweeks(seasonPath, teams);
  const totalGameweeks = Object.keys(gameweekData).length;
  const players = processPlayers(seasonPath, teams, playerGWTeamMap, totalGameweeks);
  const fixtures = processFixtures(seasonPath, teams, fixtureMap);

  // Position minimum floors in official FPL:
  // GKP (1): £4.0m (40), DEF (2): £4.0m (40), MID (3): £4.5m (45), FWD (4): £4.5m (45)
  const POSITION_FLOORS = { 1: 40, 2: 40, 3: 45, 4: 45 };

  // Build dynamic weekly player status and price timeline for each player across all gameweeks
  const playerGWMap = new Map();
  for (let gw = 1; gw <= totalGameweeks; gw++) {
    const list = gameweekData[gw] || [];
    list.forEach(d => {
      if (!playerGWMap.has(d.playerId)) playerGWMap.set(d.playerId, []);
      playerGWMap.get(d.playerId).push(d);
    });
  }

  players.forEach(p => {
    const minFloor = POSITION_FLOORS[p.position] || 40;
    const history = playerGWMap.get(p.id) || [];
    history.sort((a, b) => a.gameweek - b.gameweek);

    // Debut starting price: earliest gameweek with value > 0, clamped by position minimum floor
    const firstValRecord = history.find(h => h.value && h.value > 0);
    const rawStart = firstValRecord ? firstValRecord.value : p.startPrice;
    p.startPrice = Math.max(minFloor, rawStart);

    // Build complete gameweek price timeline
    const pricesByGameweek = {};
    let lastKnownPrice = p.startPrice;
    for (let gw = 1; gw <= totalGameweeks; gw++) {
      const gwEntry = history.find(h => h.gameweek === gw);
      if (gwEntry && gwEntry.value && gwEntry.value > 0) {
        lastKnownPrice = gwEntry.value;
      }
      pricesByGameweek[gw] = lastKnownPrice;
    }
    p.pricesByGameweek = pricesByGameweek;

    const totalSeasonMins = history.reduce((sum, d) => sum + (d.minutes || 0), 0);
    const statusByGameweek = {};

    history.forEach(h => {
      const gw = h.gameweek;
      const prev = history.find(d => d.gameweek === gw - 1);

      // 1. Suspension from red card in prior week
      if (prev && prev.redCards > 0) {
        const reason = 'Red card suspension';
        const expectedReturn = `Expected back in 1 week (Gameweek ${gw + 1})`;
        statusByGameweek[gw] = {
          status: 's',
          chance: 0,
          reason,
          expectedReturn,
          weeksOut: 1,
          news: `Suspended (Red card) - ${expectedReturn}`
        };
        return;
      }

      // 2. Check DNP (0 minutes)
      if (h.minutes === 0) {
        const playedBefore = history.filter(d => d.gameweek < gw && d.minutes > 0).length;
        const nextMatch = history.find(d => d.gameweek > gw && d.minutes > 0);

        if (playedBefore > 0 && nextMatch) {
          const weeksOut = nextMatch.gameweek - gw;
          const reason = getPlayerInjuryReason(season, p, p.news, weeksOut);
          const expectedReturn = weeksOut === 1
            ? `Expected back in 1 week (Gameweek ${nextMatch.gameweek})`
            : `Expected back in ${weeksOut} weeks (Gameweek ${nextMatch.gameweek})`;
          statusByGameweek[gw] = {
            status: 'i',
            chance: 0,
            reason,
            expectedReturn,
            weeksOut,
            news: `${reason} - ${expectedReturn}`
          };
        } else if (playedBefore > 0 && !nextMatch && totalSeasonMins >= 250) {
          const weeksOut = totalGameweeks - gw + 1;
          const reason = getPlayerInjuryReason(season, p, p.news, weeksOut);
          const expectedReturn = `Ruled out for season (~${weeksOut} weeks remaining)`;
          statusByGameweek[gw] = {
            status: 'i',
            chance: 0,
            reason,
            expectedReturn,
            weeksOut,
            news: `${reason} - ${expectedReturn}`
          };
        } else if (playedBefore === 0 && nextMatch && totalSeasonMins >= 250) {
          const weeksOut = nextMatch.gameweek - gw;
          const reason = getPlayerInjuryReason(season, p, p.news, weeksOut);
          const expectedReturn = weeksOut === 1
            ? `Expected back in 1 week (Gameweek ${nextMatch.gameweek})`
            : `Expected back in ${weeksOut} weeks (Gameweek ${nextMatch.gameweek})`;
          statusByGameweek[gw] = {
            status: 'i',
            chance: 0,
            reason: `${reason} (Pre-season recovery)`,
            expectedReturn,
            weeksOut,
            news: `${reason} - ${expectedReturn}`
          };
        } else if (totalSeasonMins === 0) {
          statusByGameweek[gw] = {
            status: 'u',
            chance: 0,
            reason: 'Not in first-team squad',
            expectedReturn: 'Unknown return date',
            weeksOut: null,
            news: 'Not in matchday squad - Unknown return date'
          };
        }
        return;
      }

      // 3. Check knock / returning from injury
      if (h.minutes > 0 && h.minutes < 45 && prev && prev.minutes === 0 && totalSeasonMins >= 400) {
        statusByGameweek[gw] = {
          status: 'd',
          chance: 75,
          reason: 'Match fitness / Late fitness test',
          expectedReturn: 'Available from bench',
          weeksOut: 0,
          news: 'Knock / Match fitness - 75% chance of playing'
        };
      }
    });

    if (Object.keys(statusByGameweek).length > 0) {
      p.statusByGameweek = statusByGameweek;
    }

    // Set initial GW1 status based on GW1 availability
    const gw1Status = statusByGameweek[1];
    if (gw1Status) {
      p.status = gw1Status.status;
      p.chanceOfPlayingThisRound = gw1Status.chance;
      p.news = gw1Status.news;
      p.reason = gw1Status.reason;
      p.expectedReturn = gw1Status.expectedReturn;
      p.weeksOut = gw1Status.weeksOut;
    } else {
      p.status = 'a';
      p.chanceOfPlayingThisRound = 100;
      p.news = null;
      p.reason = null;
      p.expectedReturn = null;
      p.weeksOut = null;
    }
  });
  
  const seasonData = {
    season,
    teams,
    players,
    fixtures,
    totalGameweeks,
  };
  
  return { seasonData, gameweekData };
}

function main() {
  console.log('FPL Data Preprocessor');
  console.log('====================');
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const availableSeasons = [];
  
  for (const season of SEASONS) {
    const result = processSeason(season);
    if (!result) continue;
    
    const { seasonData, gameweekData } = result;
    
    // Write season metadata (players, teams, fixtures)
    const seasonDir = path.join(OUTPUT_DIR, season);
    if (!fs.existsSync(seasonDir)) {
      fs.mkdirSync(seasonDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(seasonDir, 'season.json'),
      JSON.stringify(seasonData)
    );
    
    // Write each gameweek separately for lazy loading
    for (const [gw, data] of Object.entries(gameweekData)) {
      fs.writeFileSync(
        path.join(seasonDir, `gw${gw}.json`),
        JSON.stringify(data)
      );
    }
    
    availableSeasons.push({
      id: season,
      label: season.replace('-', '/'),
      totalGameweeks: seasonData.totalGameweeks,
      playerCount: seasonData.players.length,
      teamCount: seasonData.teams.length,
    });
    
    console.log(`    ${seasonData.players.length} players, ${seasonData.teams.length} teams, ${seasonData.totalGameweeks} gameweeks`);
  }
  
  // Write seasons index
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'seasons.json'),
    JSON.stringify(availableSeasons)
  );
  
  console.log(`\nDone! Processed ${availableSeasons.length} seasons.`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main();
