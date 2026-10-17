/**
 * Formation and Goalkeeper Constraint Tests
 * Run: node scripts/test-formation.mjs
 */

const Position = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

const PositionFullLabels = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
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

// Replicate the exact logic from GameEngine.ts for validation
function addPlayerToSquad(career, player, price, preferStarting, playerMap) {
  const rules = getSeasonRules(career.season);

  const totalStarting = career.squad.filter(s => s.isStarting).length;
  const totalBench = career.squad.filter(s => !s.isStarting).length;

  let startingGkpCount = 0;
  let startingDefCount = 0;
  let startingMidCount = 0;
  let startingFwdCount = 0;

  if (playerMap) {
    for (const sp of career.squad) {
      if (sp.isStarting) {
        const p = playerMap.get(sp.playerId);
        if (p) {
          if (p.position === Position.GKP) startingGkpCount++;
          else if (p.position === Position.DEF) startingDefCount++;
          else if (p.position === Position.MID) startingMidCount++;
          else if (p.position === Position.FWD) startingFwdCount++;
        }
      }
    }
  }

  let canStart = totalStarting < rules.startingXISize;
  if (player.position === Position.GKP) {
    if (startingGkpCount >= 1) canStart = false;
  } else if (player.position === Position.DEF) {
    if (startingDefCount >= 5) canStart = false;
  } else if (player.position === Position.MID) {
    if (startingMidCount >= 5) canStart = false;
  } else if (player.position === Position.FWD) {
    if (startingFwdCount >= 3) canStart = false;
  }

  let isStarting = false;
  let benchOrder = 0;

  if (preferStarting === true) {
    if (canStart) {
      isStarting = true;
    } else {
      isStarting = false;
      benchOrder = totalBench + 1;
    }
  } else if (preferStarting === false) {
    if (totalBench < rules.benchSize) {
      isStarting = false;
      benchOrder = totalBench + 1;
    } else if (canStart) {
      isStarting = true;
    } else {
      isStarting = false;
      benchOrder = totalBench + 1;
    }
  } else {
    if (canStart) {
      isStarting = true;
    } else {
      isStarting = false;
      benchOrder = totalBench + 1;
    }
  }

  if (!isStarting && player.position === Position.GKP) {
    benchOrder = 1;
  }

  const newSquadPlayer = {
    playerId: player.id,
    purchasePrice: price,
    currentPrice: price,
    isStarting,
    benchOrder,
    isCaptain: false,
    isViceCaptain: false,
  };

  return {
    ...career,
    squad: [...career.squad, newSquadPlayer],
    bank: career.bank - price,
  };
}

function sanitizeSquadFormation(career, playerMap) {
  if (!career.squad || career.squad.length === 0) return career;
  const rules = getSeasonRules(career.season);

  let squad = career.squad.map(s => ({ ...s }));
  let changed = false;

  // 1. Enforce strictly 1 Goalkeeper in starting XI
  const startingGkps = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
  if (startingGkps.length > 1) {
    changed = true;
    let keptFirstGkp = false;
    squad = squad.map(s => {
      const p = playerMap.get(s.playerId);
      if (s.isStarting && p?.position === Position.GKP) {
        if (!keptFirstGkp) {
          keptFirstGkp = true;
          return s;
        } else {
          return { ...s, isStarting: false, isCaptain: false, isViceCaptain: false, benchOrder: 1 };
        }
      }
      return s;
    });
  }

  // 2. Enforce starting position caps (max 5 DEF, max 5 MID, max 3 FWD)
  const posCaps = {
    [Position.DEF]: 5,
    [Position.MID]: 5,
    [Position.FWD]: 3,
  };

  for (const pos of [Position.DEF, Position.MID, Position.FWD]) {
    const maxAllowed = posCaps[pos];
    const startersInPos = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === pos);
    if (startersInPos.length > maxAllowed) {
      changed = true;
      let count = 0;
      squad = squad.map(s => {
        const p = playerMap.get(s.playerId);
        if (s.isStarting && p?.position === pos) {
          count++;
          if (count > maxAllowed) {
            return { ...s, isStarting: false, isCaptain: false, isViceCaptain: false };
          }
        }
        return s;
      });
    }
  }

  // 3. Enforce exactly 11 total starters if squad has >= 11 players
  let starters = squad.filter(s => s.isStarting);
  if (starters.length > rules.startingXISize) {
    changed = true;
    let count = 0;
    squad = squad.map(s => {
      if (s.isStarting) {
        count++;
        if (count > rules.startingXISize) {
          return { ...s, isStarting: false, isCaptain: false, isViceCaptain: false };
        }
      }
      return s;
    });
  } else if (starters.length < rules.startingXISize && squad.length >= rules.startingXISize) {
    // Fill up to 11 starters from bench, prioritizing deficits (DEF < 3, MID < 2, FWD < 1)
    changed = true;
    while (starters.length < rules.startingXISize) {
      const curDefs = starters.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).length;
      const curMids = starters.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
      const curFwds = starters.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).length;

      let candidate = null;
      if (curDefs < 3) {
        candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.DEF);
      } else if (curMids < 2) {
        candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.MID);
      } else if (curFwds < 1) {
        candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.FWD);
      } else {
        // Find any bench outfielder that won't violate caps
        candidate = squad.find(s => {
          if (s.isStarting) return false;
          const pos = playerMap.get(s.playerId)?.position;
          if (pos === Position.DEF && curDefs < 5) return true;
          if (pos === Position.MID && curMids < 5) return true;
          if (pos === Position.FWD && curFwds < 3) return true;
          return false;
        });
      }

      if (candidate) {
        candidate.isStarting = true;
        candidate.benchOrder = 0;
        starters = squad.filter(s => s.isStarting);
      } else {
        break;
      }
    }
  }

  // 4. If squad has 11 starters, enforce minimum position requirements: DEF >= 3, MID >= 2, FWD >= 1
  starters = squad.filter(s => s.isStarting);
  if (starters.length === rules.startingXISize) {
    const defCount = starters.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).length;
    const midCount = starters.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
    const fwdCount = starters.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).length;

    if (defCount < 3) {
      const benchDef = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.DEF);
      const excessMid = midCount > 2 ? starters.find(s => playerMap.get(s.playerId)?.position === Position.MID) : null;
      const excessFwd = fwdCount > 1 ? starters.find(s => playerMap.get(s.playerId)?.position === Position.FWD) : null;
      const demotee = excessMid || excessFwd;
      if (benchDef && demotee) {
        changed = true;
        benchDef.isStarting = true;
        benchDef.benchOrder = 0;
        demotee.isStarting = false;
        demotee.isCaptain = false;
        demotee.isViceCaptain = false;
      }
    }
  }

  // 5. Renumber bench
  const bench = squad.filter(s => !s.isStarting);
  const benchGkp = bench.find(s => playerMap.get(s.playerId)?.position === Position.GKP);
  let outfieldOrder = benchGkp ? 2 : 1;
  const renumberedBench = bench.map(s => {
    if (benchGkp && s.playerId === benchGkp.playerId) {
      return { ...s, benchOrder: 1 };
    }
    return { ...s, benchOrder: outfieldOrder++ };
  });

  const benchOrderMap = new Map(renumberedBench.map(b => [b.playerId, b.benchOrder]));
  squad = squad.map(s => {
    if (!s.isStarting) {
      const order = benchOrderMap.get(s.playerId) || 1;
      if (s.benchOrder !== order) changed = true;
      return { ...s, benchOrder: order };
    }
    if (s.benchOrder !== 0) {
      changed = true;
      return { ...s, benchOrder: 0 };
    }
    return s;
  });

  return {
    ...career,
    squad,
    updatedAt: new Date().toISOString(),
  };
}

console.log('=== RUNNING FORMATION VALIDATION TESTS ===\n');

const mockPlayers = [
  { id: 1, webName: 'Cech', position: Position.GKP, teamId: 1, startPrice: 55 },
  { id: 2, webName: 'Martinez', position: Position.GKP, teamId: 1, startPrice: 45 },
  { id: 3, webName: 'Koscielny', position: Position.DEF, teamId: 1, startPrice: 60 },
  { id: 4, webName: 'Bellerin', position: Position.DEF, teamId: 1, startPrice: 55 },
  { id: 5, webName: 'Monreal', position: Position.DEF, teamId: 1, startPrice: 55 },
  { id: 6, webName: 'Mustafi', position: Position.DEF, teamId: 1, startPrice: 55 },
  { id: 7, webName: 'Gibbs', position: Position.DEF, teamId: 1, startPrice: 50 },
  { id: 8, webName: 'Sanchez', position: Position.MID, teamId: 1, startPrice: 110 },
  { id: 9, webName: 'Ozil', position: Position.MID, teamId: 1, startPrice: 95 },
  { id: 10, webName: 'Ramsey', position: Position.MID, teamId: 1, startPrice: 75 },
  { id: 11, webName: 'Cazorla', position: Position.MID, teamId: 1, startPrice: 75 },
  { id: 12, webName: 'Walcott', position: Position.MID, teamId: 1, startPrice: 75 },
  { id: 13, webName: 'Giroud', position: Position.FWD, teamId: 1, startPrice: 85 },
  { id: 14, webName: 'Perez', position: Position.FWD, teamId: 1, startPrice: 75 },
  { id: 15, webName: 'Welbeck', position: Position.FWD, teamId: 1, startPrice: 75 },
];

const playerMap = new Map(mockPlayers.map(p => [p.id, p]));

let career = {
  season: '2016-17',
  bank: 1000,
  squad: [],
};

// TEST 1: addPlayerToSquad prevents 2nd GKP starting
career = addPlayerToSquad(career, mockPlayers[0], 55, true, playerMap);
if (career.squad[0].isStarting !== true) throw new Error('1st GKP must start');
console.log('  ✓ 1st GKP placed into starting XI');

career = addPlayerToSquad(career, mockPlayers[1], 45, true, playerMap);
if (career.squad[1].isStarting !== false) throw new Error('2nd GKP must NOT start');
if (career.squad[1].benchOrder !== 1) throw new Error('2nd GKP benchOrder must be 1');
console.log('  ✓ 2nd GKP automatically routed to bench with benchOrder 1');

// TEST 2: sanitizeSquadFormation repairs broken 2-GKP and 2-DEF state from user screenshot
const brokenCareer = {
  season: '2016-17',
  bank: 0,
  squad: [
    { playerId: 1, isStarting: true, benchOrder: 0 },
    { playerId: 2, isStarting: true, benchOrder: 0 }, // 2nd GKP starting!
    { playerId: 3, isStarting: true, benchOrder: 0 }, // DEF 1
    { playerId: 4, isStarting: true, benchOrder: 0 }, // DEF 2 (only 2 DEF!)
    { playerId: 5, isStarting: false, benchOrder: 1 }, // DEF 3 (bench)
    { playerId: 6, isStarting: false, benchOrder: 2 }, // DEF 4 (bench)
    { playerId: 7, isStarting: false, benchOrder: 3 }, // DEF 5 (bench)
    { playerId: 8, isStarting: true, benchOrder: 0 },  // MID 1
    { playerId: 9, isStarting: true, benchOrder: 0 },  // MID 2
    { playerId: 10, isStarting: true, benchOrder: 0 }, // MID 3
    { playerId: 11, isStarting: true, benchOrder: 0 }, // MID 4
    { playerId: 12, isStarting: true, benchOrder: 0 }, // MID 5
    { playerId: 13, isStarting: true, benchOrder: 0 }, // FWD 1
    { playerId: 14, isStarting: true, benchOrder: 0 }, // FWD 2
    { playerId: 15, isStarting: false, benchOrder: 4 }, // FWD 3
  ],
};

const repaired = sanitizeSquadFormation(brokenCareer, playerMap);
const starters = repaired.squad.filter(s => s.isStarting);
const gkpStarters = starters.filter(s => playerMap.get(s.playerId).position === Position.GKP);
const defStarters = starters.filter(s => playerMap.get(s.playerId).position === Position.DEF);
const midStarters = starters.filter(s => playerMap.get(s.playerId).position === Position.MID);
const fwdStarters = starters.filter(s => playerMap.get(s.playerId).position === Position.FWD);

if (starters.length !== 11) throw new Error(`Expected 11 starters, got ${starters.length}`);
if (gkpStarters.length !== 1) throw new Error(`Expected 1 GKP starter, got ${gkpStarters.length}`);
if (defStarters.length < 3) throw new Error(`Expected >= 3 DEF starters, got ${defStarters.length}`);
console.log(`  ✓ Repaired squad formation: ${gkpStarters.length} GKP - ${defStarters.length} DEF - ${midStarters.length} MID - ${fwdStarters.length} FWD (Total: ${starters.length})`);

const bench = repaired.squad.filter(s => !s.isStarting);
const benchGkp = bench.find(s => playerMap.get(s.playerId).position === Position.GKP);
if (!benchGkp || benchGkp.benchOrder !== 1) throw new Error('Bench GKP must have benchOrder 1');
console.log('  ✓ Bench GKP correctly designated as bench order 1');

console.log('\nAll formation tests passed with 100% success!');
