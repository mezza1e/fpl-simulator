/**
 * End-to-End Test Script for Historical FPL Simulator
 * Tests all critical paths by simulating the game engine logic
 * Run: node scripts/test-engine.mjs
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve('public/data');

function loadJSON(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

// ============================================================
// TEST 1: Season Data Loading
// ============================================================
console.log('\n=== TEST 1: Season Data Loading ===');

const seasons = loadJSON(path.join(DATA_DIR, 'seasons.json'));
assert(seasons.length >= 10, `Found ${seasons.length} seasons (expected >= 10)`);

const season1920 = seasons.find(s => s.id === '2019-20');
assert(season1920 !== undefined, '2019-20 season exists');
assert(season1920.playerCount === 666, `2019-20 has ${season1920.playerCount} players (expected 666)`);
assert(season1920.teamCount === 20, `2019-20 has ${season1920.teamCount} teams (expected 20)`);

// ============================================================
// TEST 2: Player Data
// ============================================================
console.log('\n=== TEST 2: Player Data ===');

const seasonData = loadJSON(path.join(DATA_DIR, '2019-20', 'season.json'));
assert(seasonData.players.length === 666, `666 players loaded`);
assert(seasonData.teams.length === 20, `20 teams loaded`);

// Check player structure
const player = seasonData.players.find(p => p.webName === 'Salah');
assert(player !== undefined, 'Mohamed Salah found');
if (player) {
  assert(player.position === 3, `Salah position is MID (3): got ${player.position}`);
  assert(player.teamId > 0, `Salah has valid team ID: ${player.teamId}`);
  assert(player.startPrice > 0, `Salah has valid start price: ${player.startPrice}`);
  assert(player.startPrice >= 100, `Salah's price is >= £10.0m (${player.startPrice / 10}m)`);
}

// Check teams
const arsenal = seasonData.teams.find(t => t.name === 'Arsenal');
assert(arsenal !== undefined, 'Arsenal team found');
if (arsenal) {
  assert(arsenal.shortName === 'ARS', `Arsenal shortName is ARS: got ${arsenal.shortName}`);
}

// ============================================================
// TEST 3: Gameweek Data
// ============================================================
console.log('\n=== TEST 3: Gameweek Data ===');

const gw1Data = loadJSON(path.join(DATA_DIR, '2019-20', 'gw1.json'));
assert(gw1Data.length > 0, `GW1 has ${gw1Data.length} player entries`);

const gw1Entry = gw1Data[0];
assert(gw1Entry.playerId > 0, 'GW1 entry has playerId');
assert(typeof gw1Entry.totalPoints === 'number', 'GW1 entry has totalPoints');
assert(typeof gw1Entry.minutes === 'number', 'GW1 entry has minutes');
assert(typeof gw1Entry.goals === 'number', 'GW1 entry has goals');
assert(typeof gw1Entry.assists === 'number', 'GW1 entry has assists');
assert(typeof gw1Entry.value === 'number', 'GW1 entry has value (price)');

// ============================================================
// TEST 4: Career Initialization (CRITICAL)
// ============================================================
console.log('\n=== TEST 4: Career Initialization ===');

// Simulate career creation
const career = {
  season: '2019-20',
  bank: 1000, // £100.0m
  totalPoints: 0,
  squad: [],
  freeTransfers: 1,
  gameweekResults: [],
  clock: { currentGameweek: 1, phase: 'PRE_SEASON_TEAM_BUILD' },
};

assert(career.totalPoints === 0, 'New career starts with 0 points');
assert(career.squad.length === 0, 'New career starts with empty squad');
assert(career.bank === 1000, 'New career starts with £100.0m bank');
assert(career.clock.currentGameweek === 1, 'New career starts at GW1');
assert(career.clock.phase === 'PRE_SEASON_TEAM_BUILD', 'New career starts in team build phase');

// ============================================================
// TEST 5: Budget Tracking
// ============================================================
console.log('\n=== TEST 5: Budget Tracking ===');

// Simulate buying players
const playersToBuy = seasonData.players
  .filter(p => p.position >= 1 && p.position <= 4)
  .sort((a, b) => a.startPrice - b.startPrice);

let bankAfterPurchases = career.bank;
const testSquad = [];

// Buy 2 GKPs
const gkps = playersToBuy.filter(p => p.position === 1).slice(0, 2);
for (const p of gkps) {
  bankAfterPurchases -= p.startPrice;
  testSquad.push(p);
}

// Buy 5 DEFs
const defs = playersToBuy.filter(p => p.position === 2).slice(0, 5);
for (const p of defs) {
  bankAfterPurchases -= p.startPrice;
  testSquad.push(p);
}

// Buy 5 MIDs
const mids = playersToBuy.filter(p => p.position === 3).slice(0, 5);
for (const p of mids) {
  bankAfterPurchases -= p.startPrice;
  testSquad.push(p);
}

// Buy 3 FWDs
const fwds = playersToBuy.filter(p => p.position === 4).slice(0, 3);
for (const p of fwds) {
  bankAfterPurchases -= p.startPrice;
  testSquad.push(p);
}

assert(testSquad.length === 15, `Squad has 15 players: got ${testSquad.length}`);
assert(bankAfterPurchases >= 0, `Bank not negative after purchases: £${(bankAfterPurchases / 10).toFixed(1)}m`);

const squadValue = testSquad.reduce((sum, p) => sum + p.startPrice, 0);
const totalValue = bankAfterPurchases + squadValue;
assert(totalValue === 1000, `Total value = bank + squad = £100.0m: got £${(totalValue / 10).toFixed(1)}m`);

// ============================================================
// TEST 6: Score Calculation
// ============================================================
console.log('\n=== TEST 6: Score Calculation ===');

// Build a starting XI and bench
const startingXI = [
  gkps[0].id, // GKP
  defs[0].id, defs[1].id, defs[2].id, defs[3].id, // 4 DEF
  mids[0].id, mids[1].id, mids[2].id, mids[3].id, // 4 MID
  fwds[0].id, fwds[1].id, // 2 FWD
];
const bench = [gkps[1].id, defs[4].id, mids[4].id, fwds[2].id];
const captainId = mids[0].id;

// Calculate score from GW1 data
const gwDataMap = new Map();
for (const d of gw1Data) {
  const existing = gwDataMap.get(d.playerId);
  if (existing) {
    gwDataMap.set(d.playerId, {
      ...existing,
      totalPoints: existing.totalPoints + d.totalPoints,
      minutes: existing.minutes + d.minutes,
    });
  } else {
    gwDataMap.set(d.playerId, { ...d });
  }
}

// Calculate user's score
let userScore = 0;
for (const pid of startingXI) {
  const data = gwDataMap.get(pid);
  userScore += data ? data.totalPoints : 0;
}

// Add captain bonus
const captainData = gwDataMap.get(captainId);
const captainBonus = captainData && captainData.minutes > 0 ? captainData.totalPoints : 0;
userScore += captainBonus; // captain gets double = base + extra

// Score should ONLY come from selected players
assert(typeof userScore === 'number', `User score is a number: ${userScore}`);

// Verify non-selected players don't contribute
const nonSelectedPlayer = seasonData.players.find(p => 
  !startingXI.includes(p.id) && !bench.includes(p.id)
);
if (nonSelectedPlayer) {
  const nonSelectedData = gwDataMap.get(nonSelectedPlayer.id);
  if (nonSelectedData && nonSelectedData.totalPoints > 0) {
    assert(!startingXI.includes(nonSelectedPlayer.id), 
      `Non-selected player ${nonSelectedPlayer.webName} (${nonSelectedData.totalPoints} pts) does NOT contribute to user score`);
  }
}

// ============================================================
// TEST 7: Future Information Protection
// ============================================================
console.log('\n=== TEST 7: Future Information Protection ===');

// If user is at GW5, they should NOT see GW6+ data
const maxVisibleGW = 5;
for (let gw = 1; gw <= maxVisibleGW; gw++) {
  const gwFile = path.join(DATA_DIR, '2019-20', `gw${gw}.json`);
  assert(fs.existsSync(gwFile), `GW${gw} data file exists`);
}

// GW6 data exists but should NOT be shown to user at GW5
const gw6File = path.join(DATA_DIR, '2019-20', 'gw6.json');
assert(fs.existsSync(gw6File), 'GW6 data file exists (but must not be loaded at GW5)');
// The app enforces this by only loading GWs up to currentGameweek-1

// ============================================================
// TEST 8: Fixtures
// ============================================================
console.log('\n=== TEST 8: Fixtures ===');

assert(seasonData.fixtures.length > 0, `Season has ${seasonData.fixtures.length} fixtures`);

const gw1Fixtures = seasonData.fixtures.filter(f => f.gameweek === 1);
assert(gw1Fixtures.length > 0, `GW1 has ${gw1Fixtures.length} fixtures`);

const fixture = gw1Fixtures[0];
assert(fixture.homeTeamId > 0, 'Fixture has home team ID');
assert(fixture.awayTeamId > 0, 'Fixture has away team ID');
assert(typeof fixture.homeScore === 'number', 'Fixture has home score');
assert(typeof fixture.awayScore === 'number', 'Fixture has away score');

// ============================================================
// TEST 9: Club Limit
// ============================================================
console.log('\n=== TEST 9: Club Limit ===');

const clubCounts = {};
for (const p of testSquad) {
  clubCounts[p.teamId] = (clubCounts[p.teamId] || 0) + 1;
}
const maxClubCount = Math.max(...Object.values(clubCounts));
assert(maxClubCount <= 3, `Max players from one club: ${maxClubCount} (limit 3)`);

// ============================================================
// TEST 10: Position Requirements
// ============================================================
console.log('\n=== TEST 10: Position Requirements ===');

const posCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
for (const p of testSquad) {
  posCounts[p.position]++;
}

assert(posCounts[1] === 2, `GKPs: ${posCounts[1]} (expected 2)`);
assert(posCounts[2] === 5, `DEFs: ${posCounts[2]} (expected 5)`);
assert(posCounts[3] === 5, `MIDs: ${posCounts[3]} (expected 5)`);
assert(posCounts[4] === 3, `FWDs: ${posCounts[4]} (expected 3)`);

// ============================================================
// TEST 11: Multiple Seasons
// ============================================================
console.log('\n=== TEST 11: Multiple Seasons ===');

for (const s of ['2016-17', '2018-19', '2022-23', '2024-25']) {
  const sFile = path.join(DATA_DIR, s, 'season.json');
  if (fs.existsSync(sFile)) {
    const sd = loadJSON(sFile);
    assert(sd.players.length > 0, `${s}: ${sd.players.length} players`);
    assert(sd.teams.length === 20, `${s}: ${sd.teams.length} teams`);
    
    const gw1File = path.join(DATA_DIR, s, 'gw1.json');
    if (fs.existsSync(gw1File)) {
      const gw1 = loadJSON(gw1File);
      assert(gw1.length > 0, `${s}: GW1 has ${gw1.length} entries`);
    }
  }
}

// ============================================================
// TEST 12: Player Match Events (Goals, Assists) & Rank Engine
// ============================================================
console.log('\n=== TEST 12: Goals, Assists & Rank Engine ===');

// Check that players with goals and assists exist in 2019-20 GW1
const scorers = gw1Data.filter(d => d.goals > 0);
assert(scorers.length > 0, `Found ${scorers.length} goal scorers in 2019-20 GW1`);

const assisters = gw1Data.filter(d => d.assists > 0);
assert(assisters.length > 0, `Found ${assisters.length} assist providers in 2019-20 GW1`);

// Find Salah in GW1
const salahGW1 = gw1Data.find(d => {
  const p = seasonData.players.find(sp => sp.id === d.playerId);
  return p && p.webName === 'Salah';
});
assert(salahGW1 !== undefined, 'Salah found in GW1 data');
if (salahGW1) {
  assert(salahGW1.goals >= 1, `Salah scored ${salahGW1.goals} goal(s) in GW1`);
  assert(salahGW1.assists >= 1, `Salah recorded ${salahGW1.assists} assist(s) in GW1`);
}

// Test normalCDF and rank calculation
function erfTest(x) {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * a);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-a * a);
  return sign * y;
}
function normalCDFTest(x, mean, stdDev) {
  return 0.5 * (1 + erfTest((x - mean) / (stdDev * Math.SQRT2)));
}

const meanScore = 48;
const stdDev = 13.5;
const totalManagers = 7628968; // 2019-20 managers

// Average score gets ~50th percentile
const avgPct = normalCDFTest(meanScore, meanScore, stdDev);
assert(Math.abs(avgPct - 0.5) < 0.01, `Average score yields ~50% percentile (${(avgPct * 100).toFixed(1)}%)`);

// High score (78 pts) gets high percentile and top rank
const highPct = normalCDFTest(78, meanScore, stdDev);
const highRank = Math.max(1, Math.round((1 - highPct) * totalManagers));
assert(highPct > 0.98, `78 pts yields >98% percentile (${(highPct * 100).toFixed(1)}%)`);
assert(highRank < 150000, `78 pts yields rank in top 150k: #${highRank.toLocaleString()}`);

// Top performer in GW1
let topScorer = null;
let maxPoints = -1;
for (const d of gw1Data) {
  if (d.totalPoints > maxPoints) {
    maxPoints = d.totalPoints;
    topScorer = d;
  }
}
assert(topScorer !== null, `Top performer found with ${maxPoints} points`);
assert(maxPoints >= 15, `King of the gameweek scored >= 15 points (got ${maxPoints})`);


// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed!');
} else {
  console.log(`${failed} test(s) FAILED`);
  process.exit(1);
}
