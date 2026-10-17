import assert from 'node:assert';
import {
  createNewCareer,
  addPlayerToSquad,
  removePlayerFromSquad,
  restoreRemovedPlayer,
  executeTransfer,
  restoreTransfer,
  resetAllTransfers,
  sanitizeSquadFormation,
  advanceToPreDeadline,
  calculateSellingPrice,
  calculatePitchEmptySlots,
  canAddPlayer,
} from '../app/src/engine/GameEngine.ts';
import { getSeasonRules } from '../app/src/rules/seasonRules.ts';
import { Position, SimPhase } from '../app/src/models/types.ts';

console.log('--- STARTING RESTORE, BANK & TRANSFER VALIDATION TEST ---');

// Mock players map
const mockPlayers = [
  // 2 GKPs
  { id: 1, name: 'GKP 1', webName: 'GKP1', position: Position.GKP, teamId: 1, startPrice: 50 },
  { id: 2, name: 'GKP 2', webName: 'GKP2', position: Position.GKP, teamId: 2, startPrice: 40 },
  // 5 DEFs
  { id: 3, name: 'DEF 1', webName: 'DEF1', position: Position.DEF, teamId: 3, startPrice: 60 },
  { id: 4, name: 'DEF 2', webName: 'DEF2', position: Position.DEF, teamId: 4, startPrice: 55 },
  { id: 5, name: 'DEF 3', webName: 'DEF3', position: Position.DEF, teamId: 5, startPrice: 50 },
  { id: 6, name: 'DEF 4', webName: 'DEF4', position: Position.DEF, teamId: 6, startPrice: 45 },
  { id: 7, name: 'DEF 5', webName: 'DEF5', position: Position.DEF, teamId: 7, startPrice: 40 },
  // 5 MIDs
  { id: 8, name: 'MID 1', webName: 'MID1', position: Position.MID, teamId: 8, startPrice: 100 },
  { id: 9, name: 'MID 2', webName: 'MID2', position: Position.MID, teamId: 9, startPrice: 85 },
  { id: 10, name: 'MID 3', webName: 'MID3', position: Position.MID, teamId: 10, startPrice: 75 },
  { id: 11, name: 'MID 4', webName: 'MID4', position: Position.MID, teamId: 11, startPrice: 65 },
  { id: 12, name: 'MID 5', webName: 'MID5', position: Position.MID, teamId: 12, startPrice: 55 },
  // 3 FWDs
  { id: 13, name: 'FWD 1', webName: 'FWD1', position: Position.FWD, teamId: 13, startPrice: 115 },
  { id: 14, name: 'FWD 2', webName: 'FWD2', position: Position.FWD, teamId: 14, startPrice: 80 },
  { id: 15, name: 'FWD 3', webName: 'FWD3', position: Position.FWD, teamId: 14, startPrice: 60 },
  // Extra players for transfers
  { id: 16, name: 'Extra MID A', webName: 'MID_A', position: Position.MID, teamId: 15, startPrice: 70 },
  { id: 17, name: 'Extra MID B', webName: 'MID_B', position: Position.MID, teamId: 16, startPrice: 75 },
  { id: 18, name: 'Extra DEF A', webName: 'DEF_A', position: Position.DEF, teamId: 17, startPrice: 50 },
  { id: 19, name: 'Extra DEF B', webName: 'DEF_B', position: Position.DEF, teamId: 18, startPrice: 55 },
  // Man Utd mock players for club limit tests
  { id: 20, name: 'Harry Maguire', webName: 'Maguire', position: Position.DEF, teamId: 10, teamName: 'Man Utd', teamShortName: 'MUN', startPrice: 55 },
  { id: 21, name: 'Luke Shaw', webName: 'Shaw', position: Position.DEF, teamId: 10, teamName: 'Man Utd', teamShortName: 'MUN', startPrice: 55 },
  { id: 22, name: 'Bruno Fernandes', webName: 'Fernandes', position: Position.MID, teamId: 10, teamName: 'Man Utd', teamShortName: 'MUN', startPrice: 105 },
  { id: 23, name: 'Marcus Rashford', webName: 'Rashford', position: Position.MID, teamId: 10, teamName: 'Man Utd', teamShortName: 'MUN', startPrice: 95 },
];

const playerMap = new Map();
mockPlayers.forEach(p => playerMap.set(p.id, p));

function buildStandardSquad(career, phase = SimPhase.PRE_DEADLINE) {
  let c = career;
  // Starting XI: 1 GKP, 4 DEF, 4 MID, 2 FWD
  c = addPlayerToSquad(c, playerMap.get(1), 50, true, playerMap);  // GKP1
  c = addPlayerToSquad(c, playerMap.get(3), 60, true, playerMap);  // DEF1
  c = addPlayerToSquad(c, playerMap.get(4), 55, true, playerMap);  // DEF2
  c = addPlayerToSquad(c, playerMap.get(5), 50, true, playerMap);  // DEF3
  c = addPlayerToSquad(c, playerMap.get(6), 45, true, playerMap);  // DEF4
  c = addPlayerToSquad(c, playerMap.get(8), 100, true, playerMap); // MID1
  c = addPlayerToSquad(c, playerMap.get(9), 85, true, playerMap);  // MID2
  c = addPlayerToSquad(c, playerMap.get(10), 75, true, playerMap); // MID3
  c = addPlayerToSquad(c, playerMap.get(11), 65, true, playerMap); // MID4
  c = addPlayerToSquad(c, playerMap.get(13), 115, true, playerMap);// FWD1
  c = addPlayerToSquad(c, playerMap.get(14), 80, true, playerMap); // FWD2
  // Bench: GKP2 (order 1), DEF5 (order 2), MID5 (order 3), FWD3 (order 4)
  c = addPlayerToSquad(c, playerMap.get(2), 40, false, playerMap);
  c = addPlayerToSquad(c, playerMap.get(7), 40, false, playerMap);
  c = addPlayerToSquad(c, playerMap.get(12), 55, false, playerMap);
  c = addPlayerToSquad(c, playerMap.get(15), 60, false, playerMap);
  c = sanitizeSquadFormation(c, playerMap);
  c.clock.phase = phase;
  if (phase === SimPhase.PRE_DEADLINE) {
    c.startOfGameweekSquad = c.squad.map(sp => ({ ...sp }));
  }
  return c;
}

// TEST 0: Pre-season removal clears slot and refunds bank with NO restore cards
{
  console.log('Testing pre-season removal integrity (clean slot, no restore cards)...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career, SimPhase.PRE_SEASON_TEAM_BUILD);
  const initialBank = career.bank;

  // Remove DEF1 (purchasePrice 60)
  career = removePlayerFromSquad(career, 3, playerMap);
  career = sanitizeSquadFormation(career, playerMap);

  assert.strictEqual(career.squad.length, 14, 'Squad length should be 14');
  assert.strictEqual(career.bank, initialBank + 60, 'Pre-season remove must refund full purchase price');
  assert.strictEqual((career.removedPlayers || []).length, 0, 'Pre-season remove must NOT add to removedPlayers');
  console.log('✓ Pre-season removal refunds cost and leaves removedPlayers empty');
}

// TEST 1: Removing a starter should NOT promote bench player when squad < 15
{
  console.log('Testing starter removal integrity (no unwanted auto-promotion)...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);
  assert.strictEqual(career.squad.length, 15);
  const startersBefore = career.squad.filter(s => s.isStarting);
  assert.strictEqual(startersBefore.length, 11);

  // Remove starting MID (MID1 = 8)
  career = removePlayerFromSquad(career, 8);
  career = sanitizeSquadFormation(career, playerMap);

  assert.strictEqual(career.squad.length, 14, 'Squad length should be 14');
  const startersAfter = career.squad.filter(s => s.isStarting);
  assert.strictEqual(startersAfter.length, 10, 'Starters should be 10, bench should NOT be auto-promoted');
  const benchAfter = career.squad.filter(s => !s.isStarting);
  assert.strictEqual(benchAfter.length, 4, 'Bench should still have 4 players');

  // Verify removedPlayers has MID1
  assert.strictEqual(career.removedPlayers.length, 1);
  assert.strictEqual(career.removedPlayers[0].player.playerId, 8);
  assert.strictEqual(career.removedPlayers[0].player.isStarting, true);
  console.log('✓ Starter removal preserved empty starting slot without auto-promoting bench');
}

// TEST 2: Multiple removals of the same position - distinct slots and restores
{
  console.log('Testing multiple removals of same position...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);

  // Remove DEF1 (id 3) and DEF2 (id 4)
  career = removePlayerFromSquad(career, 3);
  career = removePlayerFromSquad(career, 4);
  career = sanitizeSquadFormation(career, playerMap);

  assert.strictEqual(career.squad.length, 13);
  assert.strictEqual(career.removedPlayers.length, 2);
  const ids = career.removedPlayers.map(r => r.player.playerId);
  assert.deepStrictEqual(ids, [3, 4]);

  // Restore DEF1
  career = restoreRemovedPlayer(career, 3);
  assert.strictEqual(career.squad.length, 14);
  assert.strictEqual(career.removedPlayers.length, 1);
  assert.strictEqual(career.removedPlayers[0].player.playerId, 4);

  // Restore DEF2
  career = restoreRemovedPlayer(career, 4);
  assert.strictEqual(career.squad.length, 15);
  assert.strictEqual(career.removedPlayers.length, 0);
  console.log('✓ Multiple removals handled distinctly with clean restores');
}

// TEST 3: Cannot restore into full squad or with insufficient bank
{
  console.log('Testing restore guards (squad full & insufficient budget)...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);
  assert.strictEqual(career.squad.length, 15);

  // Try to restore when squad already has 15
  career.removedPlayers = [{ player: { ...career.squad[0], playerId: 99 }, refundedPrice: 50 }];
  const guarded1 = restoreRemovedPlayer(career, 99);
  assert.strictEqual(guarded1.squad.length, 15, 'Must not exceed 15 squad size');

  // Try to restore when bank is insufficient
  career.squad = career.squad.slice(0, 14); // 14 players
  career.bank = 20; // £2.0m
  career.removedPlayers = [{ player: { ...mockPlayers[7], playerId: 8, isStarting: true, benchOrder: 0 }, refundedPrice: 100 }]; // costs 100
  const guarded2 = restoreRemovedPlayer(career, 8);
  assert.strictEqual(guarded2.squad.length, 14, 'Must not restore if bank < refundedPrice');
  console.log('✓ Restore guards protected squad size and bank');
}

// TEST 4: Chained transfer collapse (A -> B, then B -> C)
{
  console.log('Testing chained transfer collapse before deadline...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);
  career = advanceToPreDeadline(career);
  const initialBank = career.bank;

  // Transfer 1: Sell MID3 (id 10, cost 75) for Extra MID A (id 16, cost 70)
  career = executeTransfer(career, 10, playerMap.get(16), 70);
  assert.strictEqual(career.pendingTransfers.length, 1);
  assert.strictEqual(career.pendingTransfers[0].playerOutId, 10);
  assert.strictEqual(career.pendingTransfers[0].playerInId, 16);
  assert.strictEqual(career.bank, initialBank + 5);

  // Transfer 2: Now replace Extra MID A (id 16) with Extra MID B (id 17, cost 75)
  career = executeTransfer(career, 16, playerMap.get(17), 75);
  // Should collapse into 1 transfer: MID3 (10) -> Extra MID B (17)
  assert.strictEqual(career.pendingTransfers.length, 1, 'Should remain 1 collapsed transfer');
  assert.strictEqual(career.pendingTransfers[0].playerOutId, 10, 'playerOutId must be original player 10');
  assert.strictEqual(career.pendingTransfers[0].playerInId, 17, 'playerInId must be new player 17');
  assert.strictEqual(career.pendingTransfers[0].playerOutPrice, 75);
  assert.strictEqual(career.pendingTransfers[0].playerInPrice, 75);
  assert.strictEqual(career.bank, initialBank, 'Bank must reflect direct swap of 10 for 17');
  assert.strictEqual(career.squad.length, 15);

  // Undo the collapsed transfer: Extra MID B (17) -> MID3 (10) restored
  const res = restoreTransfer(career, 17, playerMap);
  assert.strictEqual(res.success, true);
  career = res.career;
  assert.strictEqual(career.pendingTransfers.length, 0, 'Pending transfers should be empty after undo');
  assert.strictEqual(career.squad.length, 15, 'Squad must remain 15 players');
  assert.strictEqual(career.bank, initialBank, 'Bank must return exactly to initial start of GW bank');
  assert.ok(career.squad.some(s => s.playerId === 10), 'Original player 10 must be back in squad');
  assert.ok(!career.squad.some(s => s.playerId === 17), 'Player 17 must be gone');
  console.log('✓ Chained transfer A -> B -> C collapsed and undid with exact bank match');
}

// TEST 5: Transfer A -> B, then transferring B -> A cleanly reverts
{
  console.log('Testing transfer revert A -> B then B -> A...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);
  career = advanceToPreDeadline(career);
  const initialBank = career.bank;

  // Sell DEF1 (3, cost 60) for DEF_A (18, cost 50)
  career = executeTransfer(career, 3, playerMap.get(18), 50);
  assert.strictEqual(career.pendingTransfers.length, 1);
  assert.strictEqual(career.bank, initialBank + 10);

  // Transfer back: sell DEF_A (18) and bring back DEF1 (3)
  career = executeTransfer(career, 18, playerMap.get(3), 60);
  assert.strictEqual(career.pendingTransfers.length, 0, 'Transfer should be cancelled/undone');
  assert.strictEqual(career.squad.length, 15);
  assert.strictEqual(career.bank, initialBank, 'Bank returned to exact initial bank');
  assert.ok(career.squad.some(s => s.playerId === 3), 'Original player 3 is back');
  console.log('✓ Transfer revert A -> B -> A cancelled transfer cleanly');
}

// TEST 6: Pre-deadline bank initialization
{
  console.log('Testing advanceToPreDeadline bank initialization...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career, SimPhase.PRE_SEASON_TEAM_BUILD);
  // Squad cost is 975, bank is 25 (£2.5m)
  assert.strictEqual(career.bank, 25);
  career = advanceToPreDeadline(career);
  assert.strictEqual(career.startOfGameweekBank, 25, 'startOfGameweekBank must be 25, not 1000');

  // Reset transfers shouldn't corrupt bank
  career = resetAllTransfers(career, playerMap);
  assert.strictEqual(career.bank, 25, 'Bank must remain 25 after reset');
  console.log('✓ advanceToPreDeadline sets startOfGameweekBank to actual remaining bank');
}

// TEST 7: 50% profit margin calculation on player sale
{
  console.log('Testing calculateSellingPrice with FPL 50% profit rule...');
  // Bought for 50, now 50 -> sells for 50
  assert.strictEqual(calculateSellingPrice(50, 50), 50);
  // Bought for 50, now 48 (loss) -> sells for 48
  assert.strictEqual(calculateSellingPrice(50, 48), 48);
  // Bought for 50, now 51 (+1) -> sells for 50 (floor(1/2) = 0)
  assert.strictEqual(calculateSellingPrice(50, 51), 50);
  // Bought for 50, now 52 (+2) -> sells for 51 (floor(2/2) = 1)
  assert.strictEqual(calculateSellingPrice(50, 52), 51);
  // Bought for 50, now 53 (+3) -> sells for 51 (floor(3/2) = 1)
  assert.strictEqual(calculateSellingPrice(50, 53), 51);
  // Bought for 50, now 54 (+4) -> sells for 52 (floor(4/2) = 2)
  assert.strictEqual(calculateSellingPrice(50, 54), 52);
  console.log('✓ FPL 50% profit margin math verified');
}

// TEST 8: calculatePitchEmptySlots NEVER exceeds 3 FWDs on pitch
{
  console.log('Testing calculatePitchEmptySlots never exceeds 3 FWDs...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);

  // In standard squad: 2 FWDs starting (FWD1=13, FWD2=14), 1 FWD on bench (FWD3=15)
  // Promote FWD3 to starting so we have 3 starting forwards (Kane, Vassilev, Davis situation)
  career.squad = career.squad.map(s => s.playerId === 15 ? { ...s, isStarting: true, benchOrder: 0 } : s);
  // Demote DEF4 (6) to bench so starting XI has 11
  career.squad = career.squad.map(s => s.playerId === 6 ? { ...s, isStarting: false, benchOrder: 2 } : s);
  career = sanitizeSquadFormation(career, playerMap);

  const startingFWDs = career.squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.FWD);
  assert.strictEqual(startingFWDs.length, 3, 'Should have exactly 3 starting forwards');

  // Now simulate a removed forward (e.g. Thompson)
  const mockRemoved = [
    { player: { playerId: 99, isStarting: true, benchOrder: 0, purchasePrice: 50, currentPrice: 50, isCaptain: false, isViceCaptain: false }, refundedPrice: 50 }
  ];
  const extendedPlayerMap = new Map(playerMap);
  extendedPlayerMap.set(99, { id: 99, name: 'Thompson', webName: 'Thompson', position: Position.FWD, teamId: 1, startPrice: 50 });

  // Remove a defender from starting XI so startingXI has 10 players and totalNeeded is 1
  career = removePlayerFromSquad(career, 3); // DEF1
  career = sanitizeSquadFormation(career, extendedPlayerMap);

  const startingXI = career.squad.filter(s => s.isStarting);
  assert.strictEqual(startingXI.length, 10, '10 starting players');

  // Compute pitch empty slots
  const emptySlots = calculatePitchEmptySlots(startingXI, mockRemoved, extendedPlayerMap);

  // FWD row already has 3 starting forwards, so empty slots for FWD MUST be 0!
  assert.strictEqual(emptySlots[Position.FWD], 0, 'FWD row with 3 starting forwards must NEVER have empty slots');
  assert.strictEqual(startingFWDs.length + emptySlots[Position.FWD], 3, 'Total FWD pitch slots must be <= 3');
  console.log('✓ calculatePitchEmptySlots strictly caps FWD row at 3 total positions (never 4 FWDs)');
}

// TEST 9: Coordinated pitch slots: total starters + total pitch empty slots never exceeds 11
{
  console.log('Testing total pitch capacity strictly <= 11...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);

  // Remove 1 DEF, 1 MID, 1 FWD
  career = removePlayerFromSquad(career, 3); // DEF1
  career = removePlayerFromSquad(career, 8); // MID1
  career = removePlayerFromSquad(career, 13); // FWD1
  career = sanitizeSquadFormation(career, playerMap);

  const startingXI = career.squad.filter(s => s.isStarting);
  assert.strictEqual(startingXI.length, 8, '8 starting players remain');

  const emptySlots = calculatePitchEmptySlots(startingXI, career.removedPlayers, playerMap);
  const totalEmpty = Object.values(emptySlots).reduce((sum, v) => sum + v, 0);

  assert.strictEqual(totalEmpty, 3, 'Should allocate exactly 3 empty slots (11 - 8 = 3)');
  assert.strictEqual(startingXI.length + totalEmpty, 11, 'Total pitch slots must be exactly 11');
  console.log('✓ Pitch empty slots coordinated across rows, strictly summing to 11 total slots');
}

// TEST 10: Squad position limit guards (max 3 FWDs in squad) & self-healing
{
  console.log('Testing squad-level position limits (max 3 FWDs in squad)...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career);

  // Squad already has 3 FWDs (FWD1, FWD2, FWD3)
  const fwdsInSquad = career.squad.filter(s => playerMap.get(s.playerId)?.position === Position.FWD);
  assert.strictEqual(fwdsInSquad.length, 3);

  // Attempt to restore a removed 4th FWD
  career.removedPlayers = [
    { player: { playerId: 99, isStarting: false, benchOrder: 3, purchasePrice: 50, currentPrice: 50, isCaptain: false, isViceCaptain: false }, refundedPrice: 50 }
  ];
  const extendedPlayerMap = new Map(playerMap);
  extendedPlayerMap.set(99, { id: 99, name: 'Thompson', webName: 'Thompson', position: Position.FWD, teamId: 1, startPrice: 50 });

  const restoredCareer = restoreRemovedPlayer(career, 99, extendedPlayerMap);
  assert.strictEqual(
    restoredCareer.squad.filter(s => extendedPlayerMap.get(s.playerId)?.position === Position.FWD).length,
    3,
    'restoreRemovedPlayer must reject restoring a 4th forward into squad'
  );

  // Test self-healing of a corrupted squad that has 4 FWDs
  const corruptedCareer = {
    ...career,
    squad: [
      ...career.squad,
      { playerId: 99, isStarting: false, benchOrder: 4, purchasePrice: 50, currentPrice: 50, isCaptain: false, isViceCaptain: false }
    ]
  };
  assert.strictEqual(corruptedCareer.squad.length, 16);
  const healedCareer = sanitizeSquadFormation(corruptedCareer, extendedPlayerMap);
  assert.strictEqual(
    healedCareer.squad.filter(s => extendedPlayerMap.get(s.playerId)?.position === Position.FWD).length,
    3,
    'sanitizeSquadFormation must self-heal squad to strictly 3 FWDs'
  );
  console.log('✓ Squad-level position limits enforced and self-healed to max 3 FWDs');
}

// TEST 11: Transfer A -> B, then remove B: refunds B, cancels transfer, and original player A is in removedPlayers (B is NEVER in removedPlayers)
{
  console.log('Testing transfer-in removal: Player B moved out cancels transfer and restores original Player A to removedPlayers...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career, SimPhase.PRE_DEADLINE);
  const initialBank = career.bank;

  // Transfer DEF1 (id 3, price 60) -> Extra DEF A (id 18, price 50)
  career = executeTransfer(career, 3, playerMap.get(18), 50, playerMap);
  assert.strictEqual(career.pendingTransfers.length, 1);
  assert.strictEqual(career.pendingTransfers[0].playerInId, 18);
  assert.strictEqual(career.pendingTransfers[0].playerOutId, 3);
  // Bank gained difference: +60 (sold DEF1) - 50 (bought DEF A) = +10
  assert.strictEqual(career.bank, initialBank + 10);
  // removedPlayers should NOT have DEF1 while DEF A is filling the slot
  assert.strictEqual((career.removedPlayers || []).some(rp => rp.player.playerId === 3), false);

  // Now the user moves/removes Player B (DEF A = 18) out of the squad
  career = removePlayerFromSquad(career, 18, playerMap);
  career = sanitizeSquadFormation(career, playerMap);

  // 1. Pending transfer must be cancelled cleanly
  assert.strictEqual(career.pendingTransfers.length, 0, 'Pending transfer should be cancelled');
  // 2. Bank should have refunded the 50 spent on Player B:
  // Initial bank was B0. After A->B it was B0 + 10. After removing B, it should be B0 + 60 (as if only A was sold)
  assert.strictEqual(career.bank, initialBank + 60, 'Bank should reflect original player A sold for 60');
  // 3. Player B (18) must NEVER be in removedPlayers
  assert.strictEqual((career.removedPlayers || []).some(rp => rp.player.playerId === 18), false, 'Player B must NOT be in removedPlayers');
  // 4. Player A (3, the original player) MUST be in removedPlayers!
  assert.strictEqual((career.removedPlayers || []).some(rp => rp.player.playerId === 3), true, 'Original player A must be in removedPlayers');
  const removedA = career.removedPlayers.find(rp => rp.player.playerId === 3);
  assert.strictEqual(removedA.refundedPrice, 60, 'Player A refundedPrice should equal 60');

  // 5. Restoring Player A restores them to squad and deduces 60
  career = restoreRemovedPlayer(career, 3, playerMap);
  assert.strictEqual(career.squad.length, 15);
  assert.strictEqual(career.squad.some(s => s.playerId === 3), true);
  assert.strictEqual(career.bank, initialBank, 'Bank restored back to original');
  assert.strictEqual(career.removedPlayers.length, 0, 'removedPlayers cleaned up completely');
  console.log('✓ Removing a transferred-in player cancels transfer and restores original player to removedPlayers');
}

// TEST 12: Chain replacement (A -> empty slot -> bought B -> removed B -> original A remains)
{
  console.log('Testing remove-then-buy-then-remove chain preserves original player integrity...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career, SimPhase.PRE_DEADLINE);
  const initialBank = career.bank;

  // User directly removes DEF1 (3)
  career = removePlayerFromSquad(career, 3, playerMap);
  career = sanitizeSquadFormation(career, playerMap);
  assert.strictEqual(career.removedPlayers.length, 1);
  assert.strictEqual(career.removedPlayers[0].player.playerId, 3);
  assert.strictEqual(career.bank, initialBank + 60);

  // User buys Extra DEF A (18, price 50) into squad to fill the slot
  career = addPlayerToSquad(career, playerMap.get(18), 50, true, playerMap);
  career = sanitizeSquadFormation(career, playerMap);
  assert.strictEqual(career.squad.length, 15);
  assert.strictEqual(career.bank, initialBank + 10);
  assert.strictEqual(career.pendingTransfers.length, 1);

  // Now user removes Extra DEF A (18) again
  career = removePlayerFromSquad(career, 18, playerMap);
  career = sanitizeSquadFormation(career, playerMap);

  assert.strictEqual(career.squad.length, 14);
  assert.strictEqual(career.bank, initialBank + 60);
  assert.strictEqual(career.pendingTransfers.length, 0);
  assert.strictEqual(career.removedPlayers.length, 1);
  assert.strictEqual(career.removedPlayers[0].player.playerId, 3, 'Original player A is still the one awaiting restoration');
  console.log('✓ Chain of replacements preserves original player as only restoration candidate');
}

// TEST 13: Restoring a player from a pitch empty slot when bench is full (4/4 bench, 10 starters)
{
  console.log('Testing pitch restore with full bench (preferStarting=true never overflows bench)...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career, SimPhase.PRE_DEADLINE);

  // Suppose player 7 (DEF5) was removed, but bench is currently full (4 bench players: GKP2, DEF4, MID5, FWD3)
  // Let's remove DEF1 (3) who was a starter
  career = removePlayerFromSquad(career, 3, playerMap);
  career = sanitizeSquadFormation(career, playerMap);

  assert.strictEqual(career.squad.length, 14);
  assert.strictEqual(career.squad.filter(s => s.isStarting).length, 10, '10 starters on pitch');
  assert.strictEqual(career.squad.filter(s => !s.isStarting).length, 4, '4 players on bench (bench full)');

  // Now suppose the removed player was originally a sub (isStarting = false) like Justin in user screenshot
  career.removedPlayers[0].player.isStarting = false;

  // Pitch restore is clicked (passes preferStarting = true)
  career = restoreRemovedPlayer(career, 3, playerMap, true);

  assert.strictEqual(career.squad.length, 15);
  const starters = career.squad.filter(s => s.isStarting);
  const bench = career.squad.filter(s => !s.isStarting);

  assert.strictEqual(starters.length, 11, 'Must have exactly 11 starters');
  assert.strictEqual(bench.length, 4, 'Bench must strictly have 4 players (never 5/4!)');
  const restored = career.squad.find(s => s.playerId === 3);
  assert.strictEqual(restored.isStarting, true, 'Restored player must be starting on the pitch');
  console.log('✓ Restoring on pitch with preferStarting=true restores into starting XI and keeps bench at 4/4');
}

// TEST 14: Restoring a bench player without preferStarting when bench outfield is full (3 outfielders)
{
  console.log('Testing restore fallback when bench outfield is already full (auto-promotes to starting vacancy)...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career, SimPhase.PRE_DEADLINE);

  // Remove a starter so squad is 14 (10 starters, 4 bench)
  career = removePlayerFromSquad(career, 3, playerMap);
  career = sanitizeSquadFormation(career, playerMap);

  // Force removed player to have isStarting: false (e.g. originally a bench player)
  career.removedPlayers[0].player.isStarting = false;

  // Restore without preferStarting (preferStarting is undefined or false)
  career = restoreRemovedPlayer(career, 3, playerMap, false);

  assert.strictEqual(career.squad.length, 15);
  const starters = career.squad.filter(s => s.isStarting);
  const bench = career.squad.filter(s => !s.isStarting);

  assert.strictEqual(starters.length, 11, 'Must have 11 starters');
  assert.strictEqual(bench.length, 4, 'Bench must NOT overflow (strictly 4/4)');
  console.log('✓ Restoring with bench full safely routes player to starting XI vacancy');
}

// TEST 15: Self-healing a corrupted career save (10 starters, 5 on bench / Bench 5/4)
{
  console.log('Testing self-healing of Bench (5/4) corrupted career...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  career = buildStandardSquad(career, SimPhase.PRE_DEADLINE);

  // Manually corrupt squad state: 10 starters, 5 on bench (like user screenshot with Justin stuck on bench)
  career.squad = career.squad.map((s, idx) => {
    if (idx === 1) { // Make DEF2 a bench player so starters = 10, bench = 5
      return { ...s, isStarting: false, benchOrder: 5 };
    }
    return s;
  });

  const corruptStarters = career.squad.filter(s => s.isStarting).length;
  const corruptBench = career.squad.filter(s => !s.isStarting).length;
  assert.strictEqual(corruptStarters, 10);
  assert.strictEqual(corruptBench, 5, 'Corrupt state has 5 bench players');

  // Run sanitizeSquadFormation
  const healed = sanitizeSquadFormation(career, playerMap);
  const healedStarters = healed.squad.filter(s => s.isStarting).length;
  const healedBench = healed.squad.filter(s => !s.isStarting).length;

  assert.strictEqual(healedStarters, 11, 'Healed squad must have 11 starters');
  assert.strictEqual(healedBench, 4, 'Healed squad must have strictly 4 bench players');
  console.log('✓ Corrupted career with Bench (5/4) immediately self-heals back to 11 starters and 4 bench');
}

// TEST 16: Club limit check in canAddPlayer
{
  console.log('Testing club limit validation and error messaging (Rashford MUN 3/3)...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  const rules = getSeasonRules('2024-25');

  // Squad has 3 Man Utd players: Maguire (20), Shaw (21), Fernandes (22)
  career.squad = [
    { playerId: 20, purchasePrice: 55, currentPrice: 55, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
    { playerId: 21, purchasePrice: 55, currentPrice: 55, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
    { playerId: 22, purchasePrice: 105, currentPrice: 105, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false },
  ];

  const rashford = playerMap.get(23); // Marcus Rashford, MUN
  const check = canAddPlayer(career.squad, rashford, playerMap, rules, career.bank, 95);

  assert.strictEqual(check.allowed, false, 'Adding 4th MUN player must be rejected');
  assert.strictEqual(check.reason.includes('Maximum 3 players from Man Utd reached'), true, 'Reason must state club limit reached');
  assert.strictEqual(check.reason.includes('Maguire, Shaw, Fernandes'), true, 'Reason must name all 3 existing players');
  console.log(`✓ canAddPlayer properly rejected 4th club player: "${check.reason}"`);
}

// TEST 17: Adding player (e.g. Midfielder) to unfilled squad (11/15) when removedPlayers contains a DIFFERENT position (e.g. Forward Odubeko)
{
  console.log('Testing adding Midfielder to unfilled squad (11/15) when removedPlayers has Forward...');
  let career = createNewCareer('2024-25', 'Test FC', 38);
  const rules = getSeasonRules('2024-25');
  career.clock.phase = SimPhase.PRE_DEADLINE;
  career.clock.currentGameweek = 18;
  career.bank = 240; // £24.0m

  // Build squad of 11 players (2 GKP, 5 DEF, 3 MID, 1 FWD) like user screenshot
  career.squad = [
    { playerId: 1, purchasePrice: 50, currentPrice: 50, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // GKP1
    { playerId: 2, purchasePrice: 40, currentPrice: 40, isStarting: false, benchOrder: 1, isCaptain: false, isViceCaptain: false }, // GKP2
    { playerId: 3, purchasePrice: 60, currentPrice: 60, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // DEF1
    { playerId: 4, purchasePrice: 55, currentPrice: 55, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // DEF2
    { playerId: 5, purchasePrice: 50, currentPrice: 50, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // DEF3
    { playerId: 6, purchasePrice: 45, currentPrice: 45, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // DEF4
    { playerId: 7, purchasePrice: 40, currentPrice: 40, isStarting: false, benchOrder: 2, isCaptain: false, isViceCaptain: false }, // DEF5
    { playerId: 8, purchasePrice: 100, currentPrice: 100, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // MID1
    { playerId: 9, purchasePrice: 85, currentPrice: 85, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // MID2
    { playerId: 10, purchasePrice: 75, currentPrice: 75, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // MID3
    { playerId: 13, purchasePrice: 115, currentPrice: 115, isStarting: true, benchOrder: 0, isCaptain: false, isViceCaptain: false }, // FWD1
  ];

  // 1 removed player: FWD3 (15, Odubeko equivalent)
  career.removedPlayers = [
    { player: { playerId: 15, purchasePrice: 60, currentPrice: 60, isStarting: false, benchOrder: 4, isCaptain: false, isViceCaptain: false }, refundedPrice: 60 },
  ];

  assert.strictEqual(career.squad.length, 11, 'Squad has 11 players');
  assert.strictEqual(career.removedPlayers.length, 1, '1 removed player (Forward)');
  const midsBefore = career.squad.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
  assert.strictEqual(midsBefore, 3, 'Currently 3/5 midfielders');

  // User adds Extra MID A (16, price 70, Aubameyang equivalent)
  const aubaMid = playerMap.get(16);
  const check = canAddPlayer(career.squad, aubaMid, playerMap, rules, career.bank, 70);
  assert.strictEqual(check.allowed, true, 'canAddPlayer must allow adding midfielder to unfilled squad');

  career = addPlayerToSquad(career, aubaMid, 70, true, playerMap);
  career = sanitizeSquadFormation(career, playerMap);

  assert.strictEqual(career.squad.length, 12, 'Squad size increased to 12');
  const midsAfter = career.squad.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
  assert.strictEqual(midsAfter, 4, 'Midfielders increased to 4/5');
  assert.strictEqual(career.bank, 240 - 70, 'Bank correctly decremented by price');
  assert.strictEqual(career.removedPlayers.length, 1, 'Removed forward remains intact in removedPlayers');
  assert.strictEqual(career.removedPlayers[0].player.playerId, 15, 'Removed forward is still FWD3');
  console.log('✓ Successfully added Midfielder to unfilled squad while removed Forward remains preserved');
}

console.log('--- ALL RESTORE, BANK & TRANSFER TESTS PASSED PERFECTLY ---');


