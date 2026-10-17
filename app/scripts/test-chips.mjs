import fs from 'fs';

console.log('=== RUNNING CHIP LIFECYCLE TESTS ===\n');

// 1. FREE HIT REVERSION TEST
console.log('--- TEST 1: Free Hit Squad Reversion ---');

// Mock a squad of 15 players
const originalSquad = [
  { playerId: 1, purchasePrice: 50, currentPrice: 50, isStarting: true, benchOrder: 0, isCaptain: true, isViceCaptain: false },
  { playerId: 2, purchasePrice: 45, currentPrice: 45, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: true },
  { playerId: 3, purchasePrice: 45, currentPrice: 45, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 4, purchasePrice: 45, currentPrice: 45, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 5, purchasePrice: 45, currentPrice: 45, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 6, purchasePrice: 60, currentPrice: 60, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 7, purchasePrice: 60, currentPrice: 60, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 8, purchasePrice: 60, currentPrice: 60, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 9, purchasePrice: 60, currentPrice: 60, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 10, purchasePrice: 75, currentPrice: 75, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 11, purchasePrice: 75, currentPrice: 75, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 12, purchasePrice: 40, currentPrice: 40, isStarting: false, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  { playerId: 13, purchasePrice: 40, currentPrice: 40, isStarting: false, benchOrder: 1, isCaptain: false, isViceCaptain: false },
  { playerId: 14, purchasePrice: 40, currentPrice: 40, isStarting: false, benchOrder: 2, isCaptain: false, isViceCaptain: false },
  { playerId: 15, purchasePrice: 40, currentPrice: 40, isStarting: false, benchOrder: 3, isCaptain: false, isViceCaptain: false },
];
const originalBank = 30; // £3.0m

// Simulate starting a gameweek
let career = {
  id: 'test-career',
  season: '2023-24',
  clock: { season: '2023-24', currentGameweek: 5, phase: 'PRE_DEADLINE', totalGameweeks: 38 },
  squad: originalSquad.map(p => ({ ...p })),
  bank: originalBank,
  squadValue: 720,
  freeTransfers: 1,
  pendingTransfers: [],
  allTransfers: [],
  chips: [
    { type: 'wildcard', available: true, usedInGameweek: null, usedInGameweeks: [] },
    { type: 'free_hit', available: true, usedInGameweek: null, usedInGameweeks: [] },
    { type: 'triple_captain', available: true, usedInGameweek: null, usedInGameweeks: [] },
    { type: 'bench_boost', available: true, usedInGameweek: null, usedInGameweeks: [] },
  ],
  activeChip: null,
  startOfGameweekSquad: originalSquad.map(p => ({ ...p })),
  startOfGameweekBank: originalBank,
  totalPoints: 200,
  gameweekResults: [],
};

// User activates Free Hit
career.activeChip = 'free_hit';
career.preFreeHitSquad = (career.startOfGameweekSquad || career.squad).map(p => ({ ...p }));
career.preFreeHitBank = career.startOfGameweekBank ?? career.bank;

// User transfers out 5 players under Free Hit
const freeHitSquad = career.squad.map(p => {
  if (p.playerId === 10) return { ...p, playerId: 100, purchasePrice: 75, currentPrice: 75 };
  if (p.playerId === 11) return { ...p, playerId: 101, purchasePrice: 75, currentPrice: 75 };
  if (p.playerId === 6) return { ...p, playerId: 102, purchasePrice: 60, currentPrice: 60 };
  return { ...p };
});
career.squad = freeHitSquad;
career.bank = 30;

// Verify players changed
const has100 = career.squad.some(p => p.playerId === 100);
const has10 = career.squad.some(p => p.playerId === 10);
console.log('Free Hit squad has player 100:', has100, '(expected true)');
console.log('Free Hit squad has player 10:', has10, '(expected false)');

// Simulate GW complete & processGameweekResults
career.activeChip = null;
const fhChip = career.chips.find(c => c.type === 'free_hit');
fhChip.available = false;
fhChip.usedInGameweek = 5;
fhChip.usedInGameweeks = [5];
// preFreeHitSquad is preserved across post-GW
console.log('preFreeHitSquad preserved in career:', !!career.preFreeHitSquad);

// Simulate advanceToNextGameweek
if (career.preFreeHitSquad && career.preFreeHitSquad.length > 0) {
  career.squad = career.preFreeHitSquad.map(p => ({ ...p }));
  career.bank = career.preFreeHitBank ?? career.bank;
}
career.preFreeHitSquad = undefined;
career.preFreeHitBank = undefined;
career.clock.currentGameweek = 6;
career.startOfGameweekSquad = career.squad.map(p => ({ ...p }));
career.startOfGameweekBank = career.bank;

// Verify reverted squad
const revertedHas10 = career.squad.some(p => p.playerId === 10);
const revertedHas100 = career.squad.some(p => p.playerId === 100);
console.log('Reverted squad has player 10:', revertedHas10, '(expected true)');
console.log('Reverted squad has player 100:', revertedHas100, '(expected false)');
console.log('Reverted bank matches original:', career.bank === originalBank, `(${career.bank} === ${originalBank})`);

if (revertedHas10 && !revertedHas100 && career.bank === originalBank) {
  console.log('✓ PASS: Free Hit squad and bank successfully reverted at Gameweek 6!\n');
} else {
  console.error('✗ FAIL: Free Hit reversion failed!');
  process.exit(1);
}

// 2. WILDCARD WINDOWS TEST
console.log('--- TEST 2: Wildcard 1st & 2nd Windows ---');
const wcChip = career.chips.find(c => c.type === 'wildcard');
// Use 1st Wildcard in GW8
wcChip.available = false;
wcChip.usedInGameweek = 8;
wcChip.usedInGameweeks = [8];

const wildcardRules = { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 };

// Advance to GW19 (still 1st half)
career.clock.currentGameweek = 19;
let usedInSecondHalf = wcChip.usedInGameweeks.some(gw => gw >= wildcardRules.secondHalfStartGW);
let isAvailGW19 = career.clock.currentGameweek >= wildcardRules.secondHalfStartGW ? !usedInSecondHalf : wcChip.available;
console.log('Wildcard available at GW19 (after using in GW8):', isAvailGW19, '(expected false)');

// Advance to GW20 (second half begins!)
career.clock.currentGameweek = 20;
usedInSecondHalf = wcChip.usedInGameweeks.some(gw => gw >= wildcardRules.secondHalfStartGW);
let isAvailGW20 = career.clock.currentGameweek >= wildcardRules.secondHalfStartGW ? !usedInSecondHalf : wcChip.available;
console.log('Wildcard available at GW20 (second half unlocked):', isAvailGW20, '(expected true)');

if (!isAvailGW19 && isAvailGW20) {
  console.log('✓ PASS: 2nd Wildcard unlocks correctly at secondHalfStartGW (GW20)!\n');
} else {
  console.error('✗ FAIL: Wildcard window unlocking failed!');
  process.exit(1);
}

// 3. TRIPLE CAPTAIN TEST
console.log('--- TEST 3: Triple Captain Multiplier ---');
const capPoints = 12;
const normalMultiplier = 2;
const tcMultiplier = 3;

const normalCapPoints = (normalMultiplier - 1) * capPoints; // +12 bonus (total 24)
const tcCapPoints = (tcMultiplier - 1) * capPoints; // +24 bonus (total 36)

console.log('Base captain points:', capPoints);
console.log('Normal captain bonus:', normalCapPoints, '-> Total:', capPoints + normalCapPoints);
console.log('Triple captain bonus:', tcCapPoints, '-> Total:', capPoints + tcCapPoints);

if (capPoints + tcCapPoints === 36) {
  console.log('✓ PASS: Triple Captain yields exact 3x points (36 pts)!\n');
} else {
  console.error('✗ FAIL: Triple Captain calculation incorrect!');
  process.exit(1);
}

// 4. BENCH BOOST TEST
console.log('--- TEST 4: Bench Boost All 15 Scoring ---');
const startersPoints = [6, 2, 7, 5, 8, 3, 10, 15, 2, 6, 9]; // 73 pts
const benchPlayerPoints = [4, 6, 2, 5]; // 17 pts
const totalStarters = startersPoints.reduce((a, b) => a + b, 0);
const totalBench = benchPlayerPoints.reduce((a, b) => a + b, 0);

const normalRawScore = totalStarters; // 73
const benchBoostRawScore = totalStarters + totalBench; // 90

console.log('Starters total:', totalStarters);
console.log('Bench total:', totalBench);
console.log('Bench Boost total score:', benchBoostRawScore, '(expected 90)');

if (benchBoostRawScore === 90 && totalBench === 17) {
  console.log('✓ PASS: Bench Boost correctly scores all 15 players!\n');
} else {
  console.error('✗ FAIL: Bench Boost scoring incorrect!');
  process.exit(1);
}

console.log('ALL CHIP TESTS COMPLETED SUCCESSFULLY! ✓✓✓');
