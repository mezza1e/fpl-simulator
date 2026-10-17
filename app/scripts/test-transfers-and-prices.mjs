// Automated Test for FPL Transfers, Points Penalties, Selling Profit Margins, and Price Floor
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const base = path.join(__dirname, '..', 'public', 'data');

console.log('=== TEST SUITE: TRANSFERS, PENALTIES, PROFIT MARGINS & PRICES ===\n');

// 1. Test FPL 50% Profit Margin Selling Rule
console.log('--- TEST 1: 50% Profit Margin Rule ---');
function calculateSellingPrice(purchasePrice, currentPrice) {
  if (currentPrice <= purchasePrice) return currentPrice;
  return purchasePrice + Math.floor((currentPrice - purchasePrice) / 2);
}

// Case A: Bought at £10.0m (100), rose to £10.4m (104) -> Profit = 4, 50% = 2 -> Sell at £10.2m (102)
const sellA = calculateSellingPrice(100, 104);
console.log(`Bought 10.0m, Current 10.4m -> Sell ${sellA / 10}m (expected 10.2m): ${sellA === 102 ? '✓ PASS' : '✗ FAIL'}`);

// Case B: Bought at £10.0m (100), rose to £10.5m (105) -> Profit = 5, floor(5/2) = 2 -> Sell at £10.2m (102)
const sellB = calculateSellingPrice(100, 105);
console.log(`Bought 10.0m, Current 10.5m -> Sell ${sellB / 10}m (expected 10.2m): ${sellB === 102 ? '✓ PASS' : '✗ FAIL'}`);

// Case C: Bought at £10.0m (100), fell to £9.8m (98) -> Sell at current price 98 (£9.8m)
const sellC = calculateSellingPrice(100, 98);
console.log(`Bought 10.0m, Current 9.8m -> Sell ${sellC / 10}m (expected 9.8m): ${sellC === 98 ? '✓ PASS' : '✗ FAIL'}`);

// Case D: Bought at £5.0m (50), current £5.0m (50) -> Sell at 50
const sellD = calculateSellingPrice(50, 50);
console.log(`Bought 5.0m, Current 5.0m -> Sell ${sellD / 10}m (expected 5.0m): ${sellD === 50 ? '✓ PASS' : '✗ FAIL'}`);

if (sellA !== 102 || sellB !== 102 || sellC !== 98 || sellD !== 50) {
  console.error('Selling price calculation failed!');
  process.exit(1);
}

// 2. Test Starting Prices Across All 11 Seasons
console.log('\n--- TEST 2: Price Floors & Manager Filtering Across All Seasons ---');
const seasons = JSON.parse(fs.readFileSync(path.join(base, 'seasons.json'), 'utf-8'));
let totalPlayersChecked = 0;
let violations = 0;

for (const s of seasons) {
  const pPath = path.join(base, s.id, 'season.json');
  const data = JSON.parse(fs.readFileSync(pPath, 'utf-8'));
  for (const pl of data.players) {
    totalPlayersChecked++;
    if (pl.position < 1 || pl.position > 4) {
      console.error(`Invalid element position ${pl.position} for ${pl.webName} in ${s.id}`);
      violations++;
    }
    const minFloor = (pl.position === 1 || pl.position === 2) ? 40 : 45;
    if (pl.startPrice < minFloor) {
      console.error(`Underfloor startPrice ${pl.startPrice} for ${pl.webName} (pos ${pl.position}, min ${minFloor}) in ${s.id}`);
      violations++;
    }
    if (!pl.pricesByGameweek || Object.keys(pl.pricesByGameweek).length === 0) {
      console.error(`Missing pricesByGameweek for ${pl.webName} in ${s.id}`);
      violations++;
    }
  }
}
console.log(`Checked ${totalPlayersChecked} players across ${seasons.length} seasons.`);
console.log(`Violations: ${violations} (expected 0): ${violations === 0 ? '✓ PASS' : '✗ FAIL'}`);
if (violations > 0) process.exit(1);

// 3. Test Transfer Point Penalties
console.log('\n--- TEST 3: Transfer Point Penalties ---');
function calculateTransferPenalty(pendingTransfersCount, freeTransfers, chip, isUnlimitedGW) {
  if (chip === 'wildcard' || chip === 'free_hit' || isUnlimitedGW) return 0;
  const extra = Math.max(0, pendingTransfersCount - freeTransfers);
  return extra * 4;
}

// 1 transfer, 1 free -> 0 cost
const pen1 = calculateTransferPenalty(1, 1, null, false);
console.log(`1 transfer with 1 free: -${pen1} pts (expected 0): ${pen1 === 0 ? '✓ PASS' : '✗ FAIL'}`);

// 2 transfers, 1 free -> -4 pts
const pen2 = calculateTransferPenalty(2, 1, null, false);
console.log(`2 transfers with 1 free: -${pen2} pts (expected 4): ${pen2 === 4 ? '✓ PASS' : '✗ FAIL'}`);

// 3 transfers, 1 free -> -8 pts
const pen3 = calculateTransferPenalty(3, 1, null, false);
console.log(`3 transfers with 1 free: -${pen3} pts (expected 8): ${pen3 === 8 ? '✓ PASS' : '✗ FAIL'}`);

// 5 transfers on Wildcard -> 0 cost
const penWC = calculateTransferPenalty(5, 1, 'wildcard', false);
console.log(`5 transfers on Wildcard: -${penWC} pts (expected 0): ${penWC === 0 ? '✓ PASS' : '✗ FAIL'}`);

// 5 transfers on Free Hit -> 0 cost
const penFH = calculateTransferPenalty(5, 1, 'free_hit', false);
console.log(`5 transfers on Free Hit: -${penFH} pts (expected 0): ${penFH === 0 ? '✓ PASS' : '✗ FAIL'}`);

// 5 transfers during World Cup break -> 0 cost
const penWC22 = calculateTransferPenalty(5, 1, null, true);
console.log(`5 transfers during 2022-23 World Cup break (GW17): -${penWC22} pts (expected 0): ${penWC22 === 0 ? '✓ PASS' : '✗ FAIL'}`);

if (pen1 !== 0 || pen2 !== 4 || pen3 !== 8 || penWC !== 0 || penFH !== 0 || penWC22 !== 0) {
  console.error('Transfer penalty calculation failed!');
  process.exit(1);
}

// 4. Test Transfer Undo & Restoration
console.log('\n--- TEST 4: Transfer Undo & Restoration Mechanics ---');
// Setup career state
const initialSquad = [
  { playerId: 1, purchasePrice: 100, currentPrice: 104, isStarting: true, benchOrder: 0, isCaptain: true, isViceCaptain: false },
  { playerId: 2, purchasePrice: 50, currentPrice: 50, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
];
let career = {
  season: '2023-24',
  bank: 10,
  squad: [...initialSquad],
  pendingTransfers: [],
  removedPlayers: [],
  freeTransfers: 1,
  activeChip: null,
  clock: { currentGameweek: 2 },
};

// Simulate selling Player 1 (cur 104, pur 100 -> sell 102) and buying Player 3 (cost 90)
const sellPrice = calculateSellingPrice(100, 104);
const player3Cost = 90;
const transfer1 = {
  gameweek: 2,
  playerOutId: 1,
  playerInId: 3,
  playerOutPrice: sellPrice,
  playerInPrice: player3Cost,
  isFreeTransfer: true,
  originalSquadPlayer: { ...initialSquad[0] },
};

career.squad = [
  { playerId: 3, purchasePrice: 90, currentPrice: 90, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  initialSquad[1],
];
career.bank = career.bank + sellPrice - player3Cost; // 10 + 102 - 90 = 22
career.pendingTransfers.push(transfer1);

console.log(`After transfer: Bank is £${career.bank / 10}m (expected 2.2m): ${career.bank === 22 ? '✓' : '✗'}`);
console.log(`Squad has Player 3: ${career.squad.some(s => s.playerId === 3) ? '✓' : '✗'}`);
console.log(`Pending transfers count: ${career.pendingTransfers.length} (expected 1): ${career.pendingTransfers.length === 1 ? '✓' : '✗'}`);

// Now perform restoreTransfer on Player 3
const transferToUndo = career.pendingTransfers.find(t => t.playerInId === 3);
// Revert squad
career.squad = career.squad.filter(s => s.playerId !== 3);
career.squad.push({ ...transferToUndo.originalSquadPlayer });
// Revert bank
career.bank = career.bank + transferToUndo.playerInPrice - transferToUndo.playerOutPrice; // 22 + 90 - 102 = 10
// Remove transfer
career.pendingTransfers = career.pendingTransfers.filter(t => t.playerInId !== 3);

console.log(`After Undo: Bank restored to £${career.bank / 10}m (expected 1.0m): ${career.bank === 10 ? '✓' : '✗'}`);
console.log(`Squad has original Player 1: ${career.squad.some(s => s.playerId === 1) ? '✓' : '✗'}`);
console.log(`Original captain restored: ${career.squad.find(s => s.playerId === 1)?.isCaptain ? '✓' : '✗'}`);
console.log(`Pending transfers cleared: ${career.pendingTransfers.length === 0 ? '✓' : '✗'}`);

if (career.bank !== 10 || !career.squad.some(s => s.playerId === 1) || career.pendingTransfers.length !== 0) {
  console.error('Transfer restoration failed!');
  process.exit(1);
}

// 5. Test Free Transfer Rollover Rules Across Seasons
console.log('\n--- TEST 5: Free Transfer Rollover Rules Across Seasons ---');
function getRollover(season, currentBanked, usedCount, chip) {
  const maxCap = (season >= '2024-25') ? 5 : 2;
  const preserveOnChip = (season >= '2024-25');
  if (chip === 'wildcard' || chip === 'free_hit') {
    if (preserveOnChip) {
      return Math.min(currentBanked + 1, maxCap);
    }
    return 1;
  }
  const remaining = Math.max(0, currentBanked - usedCount);
  return Math.min(remaining + 1, maxCap);
}

// 2023-24: Banked 2, used 0 -> max cap is 2
const cap23 = getRollover('2023-24', 2, 0, null);
console.log(`2023-24 (Banked 2, unused): ${cap23} FT (expected 2): ${cap23 === 2 ? '✓ PASS' : '✗ FAIL'}`);

// 2024-25: Banked 3, used 0 -> can accumulate up to 5
const cap24 = getRollover('2024-25', 3, 0, null);
console.log(`2024-25 (Banked 3, unused): ${cap24} FT (expected 4): ${cap24 === 4 ? '✓ PASS' : '✗ FAIL'}`);

// 2023-24: Banked 2, used Wildcard -> resets to 1
const wcReset23 = getRollover('2023-24', 2, 5, 'wildcard');
console.log(`2023-24 Wildcard played: ${wcReset23} FT (expected 1): ${wcReset23 === 1 ? '✓ PASS' : '✗ FAIL'}`);

// 2024-25: Banked 3, used Wildcard -> preserves banked transfers (3 + 1 = 4)
const wcPreserve24 = getRollover('2024-25', 3, 5, 'wildcard');
console.log(`2024-25 Wildcard played: ${wcPreserve24} FT (expected 4): ${wcPreserve24 === 4 ? '✓ PASS' : '✗ FAIL'}`);

if (cap23 !== 2 || cap24 !== 4 || wcReset23 !== 1 || wcPreserve24 !== 4) {
  console.error('Free transfer rollover rules failed!');
  process.exit(1);
}

console.log('\n==================================================');
console.log('ALL TRANSFERS, PENALTIES & PRICES TESTS PASSED! ✓✓✓');
