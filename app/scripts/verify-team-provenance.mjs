import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('TEST SUITE: Team Provenance & Mid-Season Transfers');
console.log('====================================================');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// 1. Semenyo in 2025-26
console.log('\n1. Testing Antoine Semenyo in 2025-26:');
const s25 = JSON.parse(fs.readFileSync('public/data/2025-26/season.json', 'utf8'));
const semenyo = s25.players.find(p => p.webName === 'Semenyo' || p.lastName === 'Semenyo');

assert(semenyo !== undefined, 'Semenyo exists in 2025-26');
assert(semenyo.teamName === 'Bournemouth', `Semenyo starting teamName is Bournemouth (got ${semenyo.teamName})`);
assert(semenyo.teamShortName === 'BOU', `Semenyo starting teamShortName is BOU (got ${semenyo.teamShortName})`);
assert(semenyo.teamId === 4, `Semenyo starting teamId is 4 (got ${semenyo.teamId})`);
assert(semenyo.teamByGameweek !== undefined, 'Semenyo has teamByGameweek timeline');
assert(semenyo.teamByGameweek[1] === 4, `Semenyo GW1 club is Bournemouth (id 4) (got ${semenyo.teamByGameweek[1]})`);
assert(semenyo.teamByGameweek[21] === 4, `Semenyo GW21 club is Bournemouth (id 4) (got ${semenyo.teamByGameweek[21]})`);
assert(semenyo.teamByGameweek[22] === 13, `Semenyo GW22 club is Man City (id 13) (got ${semenyo.teamByGameweek[22]})`);
assert(semenyo.teamByGameweek[38] === 13, `Semenyo GW38 club is Man City (id 13) (got ${semenyo.teamByGameweek[38]})`);

// 2. Cole Palmer in 2023-24
console.log('\n2. Testing Cole Palmer in 2023-24:');
const s23 = JSON.parse(fs.readFileSync('public/data/2023-24/season.json', 'utf8'));
const palmer = s23.players.find(p => p.webName === 'Palmer' && p.firstName === 'Cole');

assert(palmer !== undefined, 'Cole Palmer exists in 2023-24');
assert(palmer.teamName === 'Man City', `Cole Palmer starting team is Man City (got ${palmer.teamName})`);
assert(palmer.teamShortName === 'MCI', `Cole Palmer starting shortName is MCI (got ${palmer.teamShortName})`);
assert(palmer.teamId === 13, `Cole Palmer starting teamId is 13 (got ${palmer.teamId})`);
assert(palmer.teamByGameweek[1] === 13, `Cole Palmer GW1 is Man City (id 13)`);
assert(palmer.teamByGameweek[5] === 7, `Cole Palmer GW5 is Chelsea (id 7)`);
assert(palmer.teamByGameweek[38] === 7, `Cole Palmer GW38 is Chelsea (id 7)`);

// 3. Virgil van Dijk in 2017-18
console.log('\n3. Testing Virgil van Dijk in 2017-18:');
const s17 = JSON.parse(fs.readFileSync('public/data/2017-18/season.json', 'utf8'));
const vvd = s17.players.find(p => p.webName === 'van Dijk');

assert(vvd !== undefined, 'Van Dijk exists in 2017-18');
assert(vvd.teamName === 'Southampton', `Van Dijk starting team is Southampton (got ${vvd.teamName})`);
assert(vvd.teamShortName === 'SOU', `Van Dijk starting shortName is SOU (got ${vvd.teamShortName})`);
assert(vvd.teamId === 14, `Van Dijk starting teamId is 14 (got ${vvd.teamId})`);
assert(vvd.teamByGameweek[1] === 14, `Van Dijk GW1 is Southampton (id 14)`);
assert(vvd.teamByGameweek[25] === 10, `Van Dijk GW25 is Liverpool (id 10)`);
assert(vvd.teamByGameweek[38] === 10, `Van Dijk GW38 is Liverpool (id 10)`);

// 4. Anthony Gordon in 2022-23
console.log('\n4. Testing Anthony Gordon in 2022-23:');
const s22 = JSON.parse(fs.readFileSync('public/data/2022-23/season.json', 'utf8'));
const gordon = s22.players.find(p => p.webName === 'Gordon' && p.firstName === 'Anthony');

assert(gordon !== undefined, 'Anthony Gordon exists in 2022-23');
assert(gordon.teamName === 'Everton', `Gordon starting team is Everton (got ${gordon.teamName})`);
assert(gordon.teamShortName === 'EVE', `Gordon starting shortName is EVE (got ${gordon.teamShortName})`);
assert(gordon.teamId === 8, `Gordon starting teamId is 8 (got ${gordon.teamId})`);
assert(gordon.teamByGameweek[1] === 8, `Gordon GW1 is Everton (id 8)`);
assert(gordon.teamByGameweek[25] === 15, `Gordon GW25 is Newcastle (id 15)`);
assert(gordon.teamByGameweek[38] === 15, `Gordon GW38 is Newcastle (id 15)`);

// 5. Check integrity of all 11 seasons
console.log('\n5. Checking team integrity across all 11 seasons:');
const seasons = [
  '2016-17', '2017-18', '2018-19', '2019-20', '2020-21',
  '2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27'
];

let totalPlayersChecked = 0;
let totalMidSeasonTransfers = 0;

for (const season of seasons) {
  const sData = JSON.parse(fs.readFileSync(`public/data/${season}/season.json`, 'utf8'));
  const validTeamIds = new Set(sData.teams.map(t => t.id));
  
  let validSeason = true;
  for (const p of sData.players) {
    totalPlayersChecked++;
    if (!validTeamIds.has(p.teamId)) {
      validSeason = false;
      console.error(`Invalid teamId ${p.teamId} for player ${p.webName} in ${season}`);
      break;
    }
    if (!p.teamName || p.teamName === 'Unknown') {
      validSeason = false;
      console.error(`Missing teamName for player ${p.webName} in ${season}`);
      break;
    }
    if (!p.teamByGameweek) {
      validSeason = false;
      console.error(`Missing teamByGameweek for player ${p.webName} in ${season}`);
      break;
    }
    const distinctTeams = new Set(Object.values(p.teamByGameweek));
    if (distinctTeams.size > 1) {
      totalMidSeasonTransfers++;
    }
  }
  assert(validSeason, `Season ${season}: All ${sData.players.length} players have valid starting team & gameweek timeline`);
}

console.log(`\nTotal players checked across all seasons: ${totalPlayersChecked}`);
console.log(`Total mid-season transfer trajectories tracked: ${totalMidSeasonTransfers}`);

console.log('\n----------------------------------------------------');
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('----------------------------------------------------');

if (testsFailed > 0) process.exit(1);
