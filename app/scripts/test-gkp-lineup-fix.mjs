/**
 * Verification script for GKP lineup and 10-outfielder cap fixes
 * Run: node scripts/test-gkp-lineup-fix.mjs
 */

const Position = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

const validFormations = [
  '3-5-2', '3-4-3', '4-4-2', '4-3-3', '4-5-1', '5-3-2', '5-4-1', '5-2-3'
];

function isFormationValid(rules, def, mid, fwd) {
  return validFormations.includes(`${def}-${mid}-${fwd}`);
}

function getSeasonRules(season) {
  return {
    squadSize: 15,
    startingXISize: 11,
    benchSize: 4,
    validFormations,
  };
}

// Replicate GameEngine.ts logic:
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

  const startingOutfieldCount = startingDefCount + startingMidCount + startingFwdCount;

  let canStart = totalStarting < rules.startingXISize;
  if (player.position === Position.GKP) {
    if (startingGkpCount >= 1) {
      canStart = false;
    }
  } else {
    if (startingOutfieldCount >= 10) {
      canStart = false;
    } else if (player.position === Position.DEF) {
      if (startingDefCount >= 5) canStart = false;
    } else if (player.position === Position.MID) {
      if (startingMidCount >= 5) canStart = false;
    } else if (player.position === Position.FWD) {
      if (startingFwdCount >= 3) canStart = false;
    }
  }

  let isStarting = false;
  let benchOrder = 0;

  if (preferStarting === true) {
    if (canStart) {
      isStarting = true;
    } else {
      isStarting = false;
    }
  } else if (preferStarting === false) {
    if (totalBench < rules.benchSize) {
      isStarting = false;
    } else if (canStart) {
      isStarting = true;
    } else {
      isStarting = false;
    }
  } else {
    if (canStart) {
      isStarting = true;
    } else {
      isStarting = false;
    }
  }

  if (!isStarting) {
    if (player.position === Position.GKP) {
      benchOrder = 1;
    } else {
      const outfieldBench = career.squad.filter(s => !s.isStarting && playerMap?.get(s.playerId)?.position !== Position.GKP);
      benchOrder = 2 + outfieldBench.length;
    }
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
  };
}

function swapPlayers(career, playerAId, playerBId, playerMap) {
  if (playerAId === playerBId) return { career, success: true };
  const rules = getSeasonRules(career.season);
  const pA = career.squad.find(s => s.playerId === playerAId);
  const pB = career.squad.find(s => s.playerId === playerBId);
  if (!pA || !pB) return { career, success: false, reason: 'Player not found in squad' };

  const histA = playerMap.get(playerAId);
  const histB = playerMap.get(playerBId);
  if (!histA || !histB) return { career, success: false, reason: 'Player details unavailable' };

  const isOneGkp = (histA.position === Position.GKP) !== (histB.position === Position.GKP);
  if (isOneGkp) {
    const startingGkps = career.squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
    const benchGkpPlayer = (histA.position === Position.GKP && !pA.isStarting) ? pA : ((histB.position === Position.GKP && !pB.isStarting) ? pB : null);
    const outfieldStarter = benchGkpPlayer ? (benchGkpPlayer.playerId === pA.playerId ? pB : pA) : null;

    if (startingGkps.length === 0 && benchGkpPlayer && outfieldStarter && outfieldStarter.isStarting) {
      // Allowed!
    } else {
      return { career, success: false, reason: 'Goalkeepers can only swap with other goalkeepers' };
    }
  }

  if (pA.isStarting !== pB.isStarting) {
    const starterHist = pA.isStarting ? histA : histB;
    const bencherHist = pA.isStarting ? histB : histA;

    const currentStarters = career.squad.filter(s => s.isStarting);
    if (currentStarters.length === rules.startingXISize && starterHist.position !== bencherHist.position) {
      const defs = currentStarters.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).length 
        - (starterHist.position === Position.DEF ? 1 : 0) + (bencherHist.position === Position.DEF ? 1 : 0);
      const mids = currentStarters.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length 
        - (starterHist.position === Position.MID ? 1 : 0) + (bencherHist.position === Position.MID ? 1 : 0);
      const fwds = currentStarters.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).length 
        - (starterHist.position === Position.FWD ? 1 : 0) + (bencherHist.position === Position.FWD ? 1 : 0);

      if (!isFormationValid(rules, defs, mids, fwds)) {
        return { career, success: false, reason: `Invalid formation (${defs}-${mids}-${fwds}) after swap` };
      }
    }
  }

  const newSquad = career.squad.map(s => {
    if (s.playerId === playerAId) {
      return {
        ...s,
        isStarting: pB.isStarting,
        benchOrder: pB.benchOrder,
      };
    }
    if (s.playerId === playerBId) {
      return {
        ...s,
        isStarting: pA.isStarting,
        benchOrder: pA.benchOrder,
      };
    }
    return s;
  });

  return { career: { ...career, squad: newSquad }, success: true };
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
  } else if (startingGkps.length === 0) {
    const benchGkp = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
    if (benchGkp) {
      changed = true;
      benchGkp.isStarting = true;
      benchGkp.benchOrder = 0;
    }
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

  // 3. Outfield starters cap: NEVER exceed 10 starting outfielders in FPL
  let startingOutfield = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position !== Position.GKP);
  if (startingOutfield.length > 10) {
    changed = true;
    while (startingOutfield.length > 10) {
      const curDefs = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.DEF).length;
      const curMids = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.MID).length;
      const curFwds = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.FWD).length;

      const defExcess = curDefs - 3;
      const midExcess = curMids - 2;
      const fwdExcess = curFwds - 1;

      let demoteCandidate = undefined;
      if (fwdExcess >= defExcess && fwdExcess >= midExcess && fwdExcess > 0) {
        const starters = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.FWD);
        demoteCandidate = starters[starters.length - 1];
      } else if (defExcess >= midExcess && defExcess > 0) {
        const starters = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.DEF);
        demoteCandidate = starters[starters.length - 1];
      } else if (midExcess > 0) {
        const starters = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.MID);
        demoteCandidate = starters[starters.length - 1];
      } else {
        demoteCandidate = startingOutfield[startingOutfield.length - 1];
      }

      if (demoteCandidate) {
        demoteCandidate.isStarting = false;
        demoteCandidate.isCaptain = false;
        demoteCandidate.isViceCaptain = false;
      }
      startingOutfield = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position !== Position.GKP);
    }
  }

  // 4. Enforce exactly 11 total starters if squad has >= 11 players
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
    changed = true;
    while (starters.length < rules.startingXISize) {
      const curGkps = starters.filter(s => playerMap.get(s.playerId)?.position === Position.GKP).length;
      const curDefs = starters.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).length;
      const curMids = starters.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
      const curFwds = starters.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).length;
      const curOutfield = curDefs + curMids + curFwds;

      let candidate = undefined;
      if (curGkps < 1) {
        candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
      }

      if (!candidate && curOutfield < 10) {
        if (curDefs < 3) {
          candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.DEF);
        } else if (curMids < 2) {
          candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.MID);
        } else if (curFwds < 1) {
          candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.FWD);
        } else {
          candidate = squad.find(s => {
            if (s.isStarting) return false;
            const pos = playerMap.get(s.playerId)?.position;
            if (pos === Position.DEF && curDefs < 5) return true;
            if (pos === Position.MID && curMids < 5) return true;
            if (pos === Position.FWD && curFwds < 3) return true;
            return false;
          });
        }
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

  // 5. Enforce minimum position requirements
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
      }
    }
    if (midCount < 2) {
      const benchMid = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.MID);
      const excessDef = defCount > 3 ? starters.find(s => playerMap.get(s.playerId)?.position === Position.DEF) : null;
      const excessFwd = fwdCount > 1 ? starters.find(s => playerMap.get(s.playerId)?.position === Position.FWD) : null;
      const demotee = excessDef || excessFwd;
      if (benchMid && demotee) {
        changed = true;
        benchMid.isStarting = true;
        benchMid.benchOrder = 0;
        demotee.isStarting = false;
      }
    }
    if (fwdCount < 1) {
      const benchFwd = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.FWD);
      const excessDef = defCount > 3 ? starters.find(s => playerMap.get(s.playerId)?.position === Position.DEF) : null;
      const excessMid = midCount > 2 ? starters.find(s => playerMap.get(s.playerId)?.position === Position.MID) : null;
      const demotee = excessDef || excessMid;
      if (benchFwd && demotee) {
        changed = true;
        benchFwd.isStarting = true;
        benchFwd.benchOrder = 0;
        demotee.isStarting = false;
      }
    }
  }

  // 6. Renumber bench consistently:
  // Bench GKP gets benchOrder: 1
  // Outfield subs preserve their relative benchOrder and get benchOrder: 2, 3, 4!
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
  let outfieldOrder = 2;
  benchOutfield.forEach((s) => {
    benchOrderMap.set(s.playerId, outfieldOrder++);
  });

  squad = squad.map(s => {
    if (!s.isStarting) {
      const order = benchOrderMap.get(s.playerId) || 2;
      if (s.benchOrder !== order) changed = true;
      return { ...s, benchOrder: order };
    }
    if (s.benchOrder !== 0) {
      changed = true;
      return { ...s, benchOrder: 0 };
    }
    return s;
  });

  return { ...career, squad };
}

// ==========================================
// TEST SUITE
// ==========================================

console.log('--- RUNNING LINEUP & GOALKEEPER TESTS ---');

const playerMap = new Map();
function makePlayer(id, name, position) {
  const p = { id, webName: name, position, teamId: 1, startPrice: 50 };
  playerMap.set(id, p);
  return p;
}

// Setup players matching user's scenario
const gkp1 = makePlayer(1, 'Ramsdale', Position.GKP);
const def1 = makePlayer(2, 'Alexander-Arnold', Position.DEF);
const def2 = makePlayer(3, 'Thiago Silva', Position.DEF);
const def3 = makePlayer(4, 'Gabriel', Position.DEF);
const def4 = makePlayer(5, 'Saliba', Position.DEF);
const def5 = makePlayer(6, 'Lamptey', Position.DEF);
const mid1 = makePlayer(7, 'Salah', Position.MID);
const mid2 = makePlayer(8, 'Fernandes', Position.MID);
const mid3 = makePlayer(9, 'Sterling', Position.MID);
const fwd1 = makePlayer(10, 'Haaland', Position.FWD);
const fwd2 = makePlayer(11, 'Kane', Position.FWD);
const fwd3 = makePlayer(12, 'Fraser', Position.FWD);

// Test 1: User's exact scenario: 11 outfielders starting + 1 bench GKP
console.log('\nTest 1: Repairing 11 outfielders starting + 1 bench GKP...');
let corruptSquad = {
  season: '2022-23',
  squad: [
    { playerId: def1.id, isStarting: true, benchOrder: 0 },
    { playerId: def2.id, isStarting: true, benchOrder: 0 },
    { playerId: def3.id, isStarting: true, benchOrder: 0 },
    { playerId: def4.id, isStarting: true, benchOrder: 0 },
    { playerId: def5.id, isStarting: true, benchOrder: 0 },
    { playerId: mid1.id, isStarting: true, benchOrder: 0 },
    { playerId: mid2.id, isStarting: true, benchOrder: 0 },
    { playerId: mid3.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd1.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd2.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd3.id, isStarting: true, benchOrder: 0 }, // 11 outfielders starting!
    { playerId: gkp1.id, isStarting: false, benchOrder: 1 }, // Ramsdale stuck on bench
  ]
};

let sanitized = sanitizeSquadFormation(corruptSquad, playerMap);
let starters = sanitized.squad.filter(s => s.isStarting);
let bench = sanitized.squad.filter(s => !s.isStarting);
let startingGkps = starters.filter(s => playerMap.get(s.playerId)?.position === Position.GKP);
let startingOutfield = starters.filter(s => playerMap.get(s.playerId)?.position !== Position.GKP);

console.log(`Starters count: ${starters.length} (expected 11)`);
console.log(`Starting GKPs: ${startingGkps.length} (expected 1, Ramsdale)`);
console.log(`Starting Outfield: ${startingOutfield.length} (expected 10)`);
console.log(`Bench count: ${bench.length} (expected 1)`);
console.log(`Bench player: ${playerMap.get(bench[0].playerId)?.webName}, benchOrder: ${bench[0].benchOrder}`);

if (starters.length === 11 && startingGkps.length === 1 && startingOutfield.length === 10 && bench.length === 1) {
  console.log('✓ PASS: Corrupt 11-outfielder squad healed to exactly 1 GKP + 10 Outfielders!');
} else {
  console.error('✗ FAIL: Squad not healed properly');
  process.exit(1);
}

// Test 2: Adding 11th outfielder when 0 GKPs are starting
console.log('\nTest 2: Adding 11th outfielder when 0 GKPs in squad...');
let buildCareer = { season: '2022-23', squad: [] };
// Add 10 outfielders (5 DEF, 3 MID, 2 FWD)
[def1, def2, def3, def4, def5, mid1, mid2, mid3, fwd1, fwd2].forEach(p => {
  buildCareer = addPlayerToSquad(buildCareer, p, 50, true, playerMap);
});
console.log(`Starters before 11th outfielder: ${buildCareer.squad.filter(s => s.isStarting).length}`);
// Now add 11th outfielder (fwd3 - Fraser)
buildCareer = addPlayerToSquad(buildCareer, fwd3, 50, true, playerMap);
let startersAfter11th = buildCareer.squad.filter(s => s.isStarting);
let benchAfter11th = buildCareer.squad.filter(s => !s.isStarting);
console.log(`Starters after adding 11th outfielder: ${startersAfter11th.length} (must be 10)`);
console.log(`Bench after adding 11th outfielder: ${benchAfter11th.length} (must be 1)`);

if (startersAfter11th.length === 10 && benchAfter11th.length === 1 && benchAfter11th[0].playerId === fwd3.id) {
  console.log('✓ PASS: 11th outfielder capped at 10 and forced to bench, leaving slot for GKP!');
} else {
  console.error('✗ FAIL: 11th outfielder allowed to start!');
  process.exit(1);
}

// Now add GKP (Ramsdale)
buildCareer = addPlayerToSquad(buildCareer, gkp1, 50, true, playerMap);
let startersAfterGkp = buildCareer.squad.filter(s => s.isStarting);
console.log(`Starters after adding GKP: ${startersAfterGkp.length} (must be 11)`);
let gkpInStarters = startersAfterGkp.some(s => s.playerId === gkp1.id);
console.log(`GKP in starters: ${gkpInStarters}`);

if (startersAfterGkp.length === 11 && gkpInStarters) {
  console.log('✓ PASS: GKP successfully added to starting XI making 11 total starters (1 GKP + 10 Outfielders)!');
} else {
  console.error('✗ FAIL: GKP could not start!');
  process.exit(1);
}

// Test 3: Swapping bench GKP with outfield starter when 0 GKPs are starting
console.log('\nTest 3: Swapping bench GKP with starting outfielder when 0 GKPs are starting...');
let swapSquad = {
  season: '2022-23',
  squad: [
    { playerId: def1.id, isStarting: true, benchOrder: 0 },
    { playerId: def2.id, isStarting: true, benchOrder: 0 },
    { playerId: def3.id, isStarting: true, benchOrder: 0 },
    { playerId: def4.id, isStarting: true, benchOrder: 0 },
    { playerId: def5.id, isStarting: true, benchOrder: 0 },
    { playerId: mid1.id, isStarting: true, benchOrder: 0 },
    { playerId: mid2.id, isStarting: true, benchOrder: 0 },
    { playerId: mid3.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd1.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd2.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd3.id, isStarting: true, benchOrder: 0 }, // 11 outfielders
    { playerId: gkp1.id, isStarting: false, benchOrder: 1 }, // Ramsdale on bench
  ]
};

// User drags Ramsdale onto Lamptey (def5)
let res = swapPlayers(swapSquad, gkp1.id, def5.id, playerMap);
console.log(`Swap success: ${res.success}`);
if (res.success) {
  let sStarters = res.career.squad.filter(s => s.isStarting);
  let gkpStarting = sStarters.some(s => s.playerId === gkp1.id);
  let def5OnBench = res.career.squad.find(s => s.playerId === def5.id)?.isStarting === false;
  console.log(`GKP is now starting: ${gkpStarting}`);
  console.log(`Lamptey is now on bench: ${def5OnBench}`);
  if (gkpStarting && def5OnBench) {
    console.log('✓ PASS: Bench GKP successfully swapped with starting outfielder!');
  } else {
    console.error('✗ FAIL: Swap did not update positions correctly');
    process.exit(1);
  }
} else {
  console.error(`✗ FAIL: Swap rejected: ${res.reason}`);
  process.exit(1);
}

// Test 4: When 1 GKP is already starting, swapping bench GKP with outfield starter is rejected
console.log('\nTest 4: When 1 GKP is already starting, swapping bench GKP with outfield starter is rejected...');
const gkp2 = makePlayer(13, 'Pickford', Position.GKP);
let twoGkpSquad = {
  season: '2022-23',
  squad: [
    { playerId: gkp1.id, isStarting: true, benchOrder: 0 }, // Ramsdale starting
    { playerId: def1.id, isStarting: true, benchOrder: 0 },
    { playerId: def2.id, isStarting: true, benchOrder: 0 },
    { playerId: def3.id, isStarting: true, benchOrder: 0 },
    { playerId: def4.id, isStarting: true, benchOrder: 0 },
    { playerId: mid1.id, isStarting: true, benchOrder: 0 },
    { playerId: mid2.id, isStarting: true, benchOrder: 0 },
    { playerId: mid3.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd1.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd2.id, isStarting: true, benchOrder: 0 },
    { playerId: fwd3.id, isStarting: true, benchOrder: 0 },
    { playerId: gkp2.id, isStarting: false, benchOrder: 1 }, // Pickford on bench
  ]
};

let res2 = swapPlayers(twoGkpSquad, gkp2.id, fwd3.id, playerMap);
console.log(`Swap with outfielder rejected: ${!res2.success} (reason: ${res2.reason})`);
if (!res2.success && res2.reason === 'Goalkeepers can only swap with other goalkeepers') {
  console.log('✓ PASS: Goalkeeper swap constraint enforced when GKP is already starting!');
} else {
  console.error('✗ FAIL: Invalid swap allowed');
  process.exit(1);
}

console.log('\nALL TESTS PASSED SUCCESSFULLY! ✓✓✓');
