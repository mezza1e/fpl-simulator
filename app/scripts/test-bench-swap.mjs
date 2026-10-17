const Position = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

// Mock rules
function getSeasonRules(season) {
  return {
    squadSize: 15,
    startingXISize: 11,
    benchSize: 4,
    minStartingByPosition: { 1: 1, 2: 3, 3: 2, 4: 1 },
    maxStartingByPosition: { 1: 1, 2: 5, 3: 5, 4: 3 },
  };
}

// swapPlayers logic with improved bench swap handling
function swapPlayers(career, playerAId, playerBId, playerMap) {
  if (playerAId === playerBId) return { career, success: true };
  const pA = career.squad.find(s => s.playerId === playerAId);
  const pB = career.squad.find(s => s.playerId === playerBId);
  if (!pA || !pB) return { career, success: false };

  const histA = playerMap.get(playerAId);
  const histB = playerMap.get(playerBId);
  if (!histA || !histB) return { career, success: false };

  if ((histA.position === Position.GKP || histB.position === Position.GKP) && histA.position !== histB.position) {
    return { career, success: false, reason: 'Goalkeepers can only swap with other goalkeepers' };
  }

  // If both players are on the bench, swap their bench order!
  if (!pA.isStarting && !pB.isStarting) {
    const currentBench = career.squad
      .filter(s => !s.isStarting)
      .sort((a, b) => a.benchOrder - b.benchOrder);

    const idxA = currentBench.findIndex(s => s.playerId === playerAId);
    const idxB = currentBench.findIndex(s => s.playerId === playerBId);

    let orderA = pB.benchOrder;
    let orderB = pA.benchOrder;

    if (orderA === orderB || orderA <= 0 || orderB <= 0) {
      orderA = idxB + 1;
      orderB = idxA + 1;
    }

    const newSquad = career.squad.map(s => {
      if (s.playerId === playerAId) {
        return { ...s, benchOrder: orderA };
      }
      if (s.playerId === playerBId) {
        return { ...s, benchOrder: orderB };
      }
      return s;
    });

    return { career: { ...career, squad: newSquad }, success: true };
  }

  const newSquad = career.squad.map(s => {
    if (s.playerId === playerAId) {
      return {
        ...s,
        isStarting: pB.isStarting,
        benchOrder: pB.benchOrder,
        isCaptain: pB.isStarting ? s.isCaptain : false,
        isViceCaptain: pB.isStarting ? s.isViceCaptain : false,
      };
    }
    if (s.playerId === playerBId) {
      return {
        ...s,
        isStarting: pA.isStarting,
        benchOrder: pA.benchOrder,
        isCaptain: pA.isStarting ? s.isCaptain : false,
        isViceCaptain: pA.isStarting ? s.isViceCaptain : false,
      };
    }
    return s;
  });

  return { career: { ...career, squad: newSquad }, success: true };
}

// Fixed sanitizeSquadFormation logic
function fixedSanitizeSquadFormation(career, playerMap) {
  let squad = career.squad.map(s => ({ ...s }));

  // Step 5: FIXED IMPLEMENTATION
  const benchGkp = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
  const benchOutfield = squad
    .filter(s => !s.isStarting && playerMap.get(s.playerId)?.position !== Position.GKP)
    .sort((a, b) => {
      const orderA = a.benchOrder > 0 ? a.benchOrder : 99;
      const orderB = b.benchOrder > 0 ? b.benchOrder : 99;
      return orderA - orderB;
    });

  const benchOrderMap = new Map();
  if (benchGkp) {
    benchOrderMap.set(benchGkp.playerId, 1);
  }
  let outfieldOrder = benchGkp ? 2 : 1;
  benchOutfield.forEach((s) => {
    benchOrderMap.set(s.playerId, outfieldOrder++);
  });

  squad = squad.map(s => {
    if (!s.isStarting) {
      const order = benchOrderMap.get(s.playerId) || 1;
      return { ...s, benchOrder: order };
    }
    return s;
  });

  return { ...career, squad };
}

// Players
const mockPlayers = [
  { id: 1, webName: 'Cech', position: Position.GKP },
  { id: 2, webName: 'Martinez', position: Position.GKP },
  { id: 3, webName: 'Koscielny', position: Position.DEF },
  { id: 4, webName: 'Bellerin', position: Position.DEF },
  { id: 5, webName: 'Monreal', position: Position.DEF },
  { id: 6, webName: 'Mustafi', position: Position.DEF },
  { id: 7, webName: 'Gibbs', position: Position.DEF },
  { id: 8, webName: 'Sanchez', position: Position.MID },
  { id: 9, webName: 'Ozil', position: Position.MID },
  { id: 10, webName: 'Ramsey', position: Position.MID },
  { id: 11, webName: 'Cazorla', position: Position.MID },
  { id: 12, webName: 'Walcott', position: Position.MID },
  { id: 13, webName: 'Giroud', position: Position.FWD },
  { id: 14, webName: 'Perez', position: Position.FWD },
  { id: 15, webName: 'Welbeck', position: Position.FWD },
];

const playerMap = new Map(mockPlayers.map(p => [p.id, p]));

// Starting: 1 GKP (1), 4 DEF (3,4,5,6), 4 MID (8,9,10,11), 2 FWD (13,14)
// Bench: GKP 2 (order 1), DEF 7 (Gibbs, order 2), MID 12 (Walcott, order 3), FWD 15 (Welbeck, order 4)
const squad = [
  { playerId: 1, isStarting: true, benchOrder: 0 },
  { playerId: 2, isStarting: false, benchOrder: 1 }, // Martinez (GKP)
  { playerId: 3, isStarting: true, benchOrder: 0 },
  { playerId: 4, isStarting: true, benchOrder: 0 },
  { playerId: 5, isStarting: true, benchOrder: 0 },
  { playerId: 6, isStarting: true, benchOrder: 0 },
  { playerId: 7, isStarting: false, benchOrder: 2 }, // Gibbs (DEF) -> Bench 2
  { playerId: 8, isStarting: true, benchOrder: 0 },
  { playerId: 9, isStarting: true, benchOrder: 0 },
  { playerId: 10, isStarting: true, benchOrder: 0 },
  { playerId: 11, isStarting: true, benchOrder: 0 },
  { playerId: 12, isStarting: false, benchOrder: 3 }, // Walcott (MID) -> Bench 3
  { playerId: 13, isStarting: true, benchOrder: 0 },
  { playerId: 14, isStarting: true, benchOrder: 0 },
  { playerId: 15, isStarting: false, benchOrder: 4 }, // Welbeck (FWD) -> Bench 4
];

let career = { season: '2016-17', squad };

console.log('BEFORE SWAP:');
const benchBefore = career.squad.filter(s => !s.isStarting).sort((a,b) => a.benchOrder - b.benchOrder);
console.log(benchBefore.map(s => `${playerMap.get(s.playerId).webName} (order: ${s.benchOrder})`).join(', '));

// USER SWAPS GIBBS (7) and WALCOTT (12) ON THE BENCH
console.log('\nSwapping Gibbs and Walcott...');
const swappedRes = swapPlayers(career, 7, 12, playerMap);
const benchAfterSwap = swappedRes.career.squad.filter(s => !s.isStarting).sort((a,b) => a.benchOrder - b.benchOrder);
console.log('Immediately after swapPlayers:');
console.log(benchAfterSwap.map(s => `${playerMap.get(s.playerId).webName} (order: ${s.benchOrder})`).join(', '));

// Now call fixedSanitizeSquadFormation (as App.tsx does)
const sanitized = fixedSanitizeSquadFormation(swappedRes.career, playerMap);
const benchAfterSanitize = sanitized.squad.filter(s => !s.isStarting).sort((a,b) => a.benchOrder - b.benchOrder);
console.log('\nAfter fixedSanitizeSquadFormation:');
console.log(benchAfterSanitize.map(s => `${playerMap.get(s.playerId).webName} (order: ${s.benchOrder})`).join(', '));

if (benchAfterSanitize[1].playerId === 12 && benchAfterSanitize[2].playerId === 7) {
  console.log('\n✓ SUCCESS: Walcott is now Sub 2 and Gibbs is Sub 3! Bench swap is preserved!');
} else {
  throw new Error('Bench swap was not preserved!');
}
