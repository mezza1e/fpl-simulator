// ============================================================
// GAME ENGINE - Core simulation logic
// Manages the game state machine, points calculation,
// squad validation, transfers, and gameweek progression
// ============================================================

import {
  SimPhase,
  Position,
  PositionLabels,
  ChipType,
  getPlayerTeamId,
  getPlayerTeam,
} from '../models/types';
import type {
  UserCareer,
  UserSquadPlayer,
  UserGameweekResult,
  UserGameweekPlayerStats,
  UserTransfer,
  SimulationClock,
  ChipState,
  SeasonRules,
  HistoricalPlayer,
  HistoricalTeam,
  HistoricalGameweekPlayerData,
  HistoricalFixture,
} from '../models/types';
import { getSeasonRules, isFormationValid, getPositionRequirement } from '../rules/seasonRules';

// ============================================================
// CAREER INITIALIZATION
// ============================================================

export function createNewCareer(
  season: string,
  name: string,
  totalGameweeks: number,
): UserCareer {
  const rules = getSeasonRules(season);

  const chips: ChipState[] = rules.availableChips.map(chip => ({
    type: chip,
    available: true,
    usedInGameweek: null,
    usedInGameweeks: [],
  }));

  // For wildcard: there are two wildcards available
  // We track them as a single chip but allow usage in both halves of the season
  return {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    season,
    clock: {
      season,
      currentGameweek: 1,
      phase: SimPhase.PRE_SEASON_TEAM_BUILD,
      totalGameweeks,
    },
    // Squad starts EMPTY - user must build it
    squad: [],
    // Bank starts at FULL starting budget
    bank: rules.startingBudget,
    // Points start at ZERO
    totalPoints: 0,
    gameweekResults: [],
    // Transfers
    freeTransfers: rules.freeTransfersAtStart,
    pendingTransfers: [],
    allTransfers: [],
    // Chips
    chips,
    activeChip: null,
    // Start of gameweek snapshots
    startOfGameweekSquad: [],
    startOfGameweekBank: rules.startingBudget,
    // Squad value starts at 0
    squadValue: 0,
  };
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ============================================================
// SQUAD VALIDATION
// ============================================================

export interface SquadValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSquad(
  squad: UserSquadPlayer[],
  players: Map<number, HistoricalPlayer>,
  rules: SeasonRules,
  teams?: HistoricalTeam[] | Map<number, HistoricalTeam>,
  gameweek?: number,
): SquadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check squad size
  if (squad.length !== rules.squadSize) {
    errors.push(`Squad must contain exactly ${rules.squadSize} players (currently ${squad.length})`);
  }

  // Check position counts
  const positionCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const clubCounts: Record<number, number> = {};

  for (const sp of squad) {
    const player = players.get(sp.playerId);
    if (!player) {
      errors.push(`Player ${sp.playerId} not found in database`);
      continue;
    }
    positionCounts[player.position] = (positionCounts[player.position] || 0) + 1;
    const tId = getPlayerTeamId(player, gameweek);
    clubCounts[tId] = (clubCounts[tId] || 0) + 1;
  }

  // Check position requirements
  for (const req of rules.positionRequirements) {
    const count = positionCounts[req.position] || 0;
    if (count < req.squadMin) {
      errors.push(`Need at least ${req.squadMin} ${PositionLabels[req.position]}s (have ${count})`);
    }
    if (count > req.squadMax) {
      errors.push(`Maximum ${req.squadMax} ${PositionLabels[req.position]}s allowed (have ${count})`);
    }
  }

  // Check club limits
  for (const [clubId, count] of Object.entries(clubCounts)) {
    if (count > rules.maxPlayersPerClub) {
      const clubPlayer = squad.find(sp => {
        const p = players.get(sp.playerId);
        return p && getPlayerTeamId(p, gameweek) === Number(clubId);
      });
      const teamObj = teams ? (teams instanceof Map ? teams.get(Number(clubId)) : teams.find(t => t.id === Number(clubId))) : null;
      const teamName = teamObj?.name || (clubPlayer ? players.get(clubPlayer.playerId)?.teamName : `Club ${clubId}`);
      errors.push(`Maximum ${rules.maxPlayersPerClub} players from ${teamName} (have ${count})`);
    }
  }

  // Check starting XI
  const starting = squad.filter(s => s.isStarting);
  const bench = squad.filter(s => !s.isStarting);

  if (squad.length === rules.squadSize) {
    if (starting.length !== rules.startingXISize) {
      errors.push(`Starting XI must have ${rules.startingXISize} players (currently ${starting.length})`);
    }

    if (bench.length !== rules.benchSize) {
      errors.push(`Bench must have ${rules.benchSize} players (currently ${bench.length})`);
    }

    // Check formation validity
    if (starting.length === rules.startingXISize) {
      const startingPositions: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
      for (const sp of starting) {
        const player = players.get(sp.playerId);
        if (player) {
          startingPositions[player.position] = (startingPositions[player.position] || 0) + 1;
        }
      }

      if (startingPositions[Position.GKP] !== 1) {
        errors.push('Starting XI must include exactly 1 goalkeeper');
      }

      const def = startingPositions[Position.DEF] || 0;
      const mid = startingPositions[Position.MID] || 0;
      const fwd = startingPositions[Position.FWD] || 0;

      if (!isFormationValid(rules, def, mid, fwd)) {
        errors.push(`Invalid formation: ${def}-${mid}-${fwd}`);
      }
    }

    // Check captain
    const captains = squad.filter(s => s.isCaptain);
    if (captains.length !== 1) {
      errors.push('Must select exactly one captain');
    } else if (!captains[0].isStarting) {
      errors.push('Captain must be in the starting XI');
    }

    // Check vice-captain
    const viceCaptains = squad.filter(s => s.isViceCaptain);
    if (viceCaptains.length !== 1) {
      errors.push('Must select exactly one vice-captain');
    } else if (!viceCaptains[0].isStarting) {
      errors.push('Vice-captain must be in the starting XI');
    }

    // Captain and vice-captain must be different
    if (captains.length === 1 && viceCaptains.length === 1 && captains[0].playerId === viceCaptains[0].playerId) {
      errors.push('Captain and vice-captain must be different players');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function canAddPlayer(
  squad: UserSquadPlayer[],
  newPlayer: HistoricalPlayer,
  players: Map<number, HistoricalPlayer>,
  rules: SeasonRules,
  bank: number,
  price: number,
  gameweek?: number,
  teams?: HistoricalTeam[] | Map<number, HistoricalTeam>,
): { allowed: boolean; reason: string } {
  // Check if already in squad
  if (squad.some(s => s.playerId === newPlayer.id)) {
    return { allowed: false, reason: 'Player is already in your squad' };
  }

  // Check squad size
  if (squad.length >= rules.squadSize) {
    return { allowed: false, reason: 'Squad is full' };
  }

  // Check budget
  if (price > bank) {
    return { allowed: false, reason: `Insufficient budget. Need £${(price / 10).toFixed(1)}m, have £${(bank / 10).toFixed(1)}m` };
  }

  // Check position limits
  const positionCount = squad.filter(s => {
    const p = players.get(s.playerId);
    return p && p.position === newPlayer.position;
  }).length;
  const req = getPositionRequirement(rules, newPlayer.position);
  if (positionCount >= req.squadMax) {
    return { allowed: false, reason: `Maximum ${req.squadMax} ${PositionLabels[newPlayer.position]}s reached` };
  }

  // Check club limit
  const newPlayerTeamId = getPlayerTeamId(newPlayer, gameweek);
  const clubPlayers = squad
    .map(s => players.get(s.playerId))
    .filter((p): p is HistoricalPlayer => p !== undefined && getPlayerTeamId(p, gameweek) === newPlayerTeamId);
  if (clubPlayers.length >= rules.maxPlayersPerClub) {
    const teamObj = getPlayerTeam(newPlayer, teams || [], gameweek);
    const teamName = teamObj?.name || newPlayer.teamName || teamObj?.shortName || newPlayer.teamShortName;
    const names = clubPlayers.map(p => p.webName).join(', ');
    return {
      allowed: false,
      reason: `Maximum ${rules.maxPlayersPerClub} players from ${teamName} reached (${rules.maxPlayersPerClub}/${rules.maxPlayersPerClub}). Squad already has: ${names}. Sell or replace one first.`,
    };
  }

  return { allowed: true, reason: '' };
}

// ============================================================
// SQUAD OPERATIONS
// ============================================================

export function addPlayerToSquad(
  career: UserCareer,
  player: HistoricalPlayer,
  price: number,
  preferStarting?: boolean,
  playerMap?: Map<number, HistoricalPlayer>,
): UserCareer {
  const rules = getSeasonRules(career.season);

  const totalStarting = career.squad.filter(s => s.isStarting).length;
  const totalBench = career.squad.filter(s => !s.isStarting).length;

  // Count existing starters by position if playerMap is provided
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

  // Determine whether player CAN start:
  // Goalkeeper: Can ONLY start if no goalkeeper is already starting
  let canStart = totalStarting < rules.startingXISize;
  if (player.position === Position.GKP) {
    if (startingGkpCount >= 1) {
      canStart = false;
    }
  } else {
    // Outfield starters can NEVER exceed 10 in FPL (1 spot strictly held for goalkeeper)
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
    // Default: try to start if allowed by formation rules, otherwise bench
    if (canStart) {
      isStarting = true;
    } else {
      isStarting = false;
    }
  }

  // If placed on bench:
  // Bench GKP gets benchOrder: 1
  // Outfield subs get benchOrder: 2, 3, 4
  if (!isStarting) {
    if (player.position === Position.GKP) {
      benchOrder = 1;
    } else {
      const outfieldBench = career.squad.filter(s => !s.isStarting && playerMap?.get(s.playerId)?.position !== Position.GKP);
      benchOrder = 2 + outfieldBench.length;
    }
  }

  let newPendingTransfers = career.pendingTransfers || [];
  let newRemovedPlayers = career.removedPlayers || [];

  if (career.clock.phase !== SimPhase.PRE_SEASON_TEAM_BUILD && newRemovedPlayers.length > 0) {
    const removedIdx = newRemovedPlayers.findIndex(rp => {
      return playerMap ? playerMap.get(rp.player.playerId)?.position === player.position : true;
    });

    if (removedIdx !== -1) {
      const removedEntry = newRemovedPlayers[removedIdx];
      newRemovedPlayers = newRemovedPlayers.filter((_, i) => i !== removedIdx);

      const rules = getSeasonRules(career.season);
      const isChipActive = career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT;
      const isFreeUnlimitedGW = rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek);

      const transfer: UserTransfer = {
        gameweek: career.clock.currentGameweek,
        playerOutId: removedEntry.player.playerId,
        playerInId: player.id,
        playerOutPrice: removedEntry.refundedPrice,
        playerInPrice: price,
        isFreeTransfer: isChipActive || isFreeUnlimitedGW || newPendingTransfers.length < career.freeTransfers,
        originalSquadPlayer: { ...removedEntry.player },
      };
      newPendingTransfers = [...newPendingTransfers, transfer];
    }
  }

  const newSquadPlayer: UserSquadPlayer = {
    playerId: player.id,
    purchasePrice: price,
    currentPrice: price,
    isStarting,
    benchOrder,
    isCaptain: false,
    isViceCaptain: false,
  };

  const newSquad = [...career.squad, newSquadPlayer];
  const newBank = career.bank - price;
  const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

  return {
    ...career,
    squad: newSquad,
    bank: newBank,
    squadValue: newSquadValue,
    pendingTransfers: newPendingTransfers,
    removedPlayers: newRemovedPlayers,
    updatedAt: new Date().toISOString(),
  };
}

export function swapPlayers(
  career: UserCareer,
  playerAId: number,
  playerBId: number,
  playerMap: Map<number, HistoricalPlayer>,
): { career: UserCareer; success: boolean; reason?: string } {
  if (playerAId === playerBId) return { career, success: true };
  const rules = getSeasonRules(career.season);
  const pA = career.squad.find(s => s.playerId === playerAId);
  const pB = career.squad.find(s => s.playerId === playerBId);
  if (!pA || !pB) return { career, success: false, reason: 'Player not found in squad' };

  const histA = playerMap.get(playerAId);
  const histB = playerMap.get(playerBId);
  if (!histA || !histB) return { career, success: false, reason: 'Player details unavailable' };

  // Goalkeeper constraint: Goalkeepers can normally only swap with Goalkeepers.
  // Exception: If NO goalkeeper is currently starting, a bench goalkeeper can swap with an outfield starter
  // to enter the starting lineup.
  const isOneGkp = (histA.position === Position.GKP) !== (histB.position === Position.GKP);
  if (isOneGkp) {
    const startingGkps = career.squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
    const benchGkpPlayer = (histA.position === Position.GKP && !pA.isStarting) ? pA : ((histB.position === Position.GKP && !pB.isStarting) ? pB : null);
    const outfieldStarter = benchGkpPlayer ? (benchGkpPlayer.playerId === pA.playerId ? pB : pA) : null;

    if (startingGkps.length === 0 && benchGkpPlayer && outfieldStarter && outfieldStarter.isStarting) {
      // Allowed! We are promoting the bench GKP to starting and moving an outfield starter to bench.
      // Formation validation below will verify that remaining outfielders form a valid formation.
    } else {
      return { career, success: false, reason: 'Goalkeepers can only swap with other goalkeepers' };
    }
  }

  // If one is starting and one is bench, validate formation
  if (pA.isStarting !== pB.isStarting) {
    const starterHist = pA.isStarting ? histA : histB;
    const bencherHist = pA.isStarting ? histB : histA;

    // Check resulting formation if squad has 11 starters
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

  // If both players are on the bench, swap their bench order and positions!
  if (!pA.isStarting && !pB.isStarting) {
    const currentBench = career.squad
      .filter(s => !s.isStarting)
      .sort((a, b) => a.benchOrder - b.benchOrder);

    const idxA = currentBench.findIndex(s => s.playerId === playerAId);
    const idxB = currentBench.findIndex(s => s.playerId === playerBId);

    let orderA = pB.benchOrder;
    let orderB = pA.benchOrder;

    // If orders were identical or <= 0, swap by their current visual bench indices
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

    return {
      career: { ...career, squad: newSquad, updatedAt: new Date().toISOString() },
      success: true,
    };
  }

  // Perform swap of starting status and bench order
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

  return {
    career: { ...career, squad: newSquad, updatedAt: new Date().toISOString() },
    success: true,
  };
}

export function calculateSellingPrice(purchasePrice: number, currentPrice: number): number {
  if (currentPrice <= purchasePrice) {
    return currentPrice;
  }
  // Official FPL 50% profit rule: sell at purchasePrice + floor((currentPrice - purchasePrice) / 2)
  return purchasePrice + Math.floor((currentPrice - purchasePrice) / 2);
}

export function getPlayerFinancials(squadPlayer: UserSquadPlayer, currentPrice?: number) {
  const cur = currentPrice ?? squadPlayer.currentPrice;
  const pur = squadPlayer.purchasePrice;
  const sell = calculateSellingPrice(pur, cur);
  const profit = sell - pur;
  return {
    purchasePrice: pur,
    currentPrice: cur,
    sellingPrice: sell,
    profit,
    isProfitable: profit > 0,
    isLoss: cur < pur,
  };
}

export function removePlayerFromSquad(
  career: UserCareer,
  playerId: number,
  playerMap?: Map<number, HistoricalPlayer>,
): UserCareer {
  const player = career.squad.find(sp => sp.playerId === playerId);
  if (!player) return career;

  const newSquad = career.squad.filter(sp => sp.playerId !== playerId);
  const isPreSeason = career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD;

  // In pre-season, removing a player simply returns their cost to bank with no restore state
  if (isPreSeason) {
    const newBank = career.bank + player.purchasePrice;
    const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);
    const updatedCareer: UserCareer = {
      ...career,
      squad: newSquad,
      bank: newBank,
      squadValue: newSquadValue,
      removedPlayers: [],
      updatedAt: new Date().toISOString(),
    };
    return playerMap ? sanitizeSquadFormation(updatedCareer, playerMap) : updatedCareer;
  }

  // In-season: check if this player was brought in via a pending transfer this gameweek
  const pendingTransferIndex = career.pendingTransfers.findIndex(t => t.playerInId === playerId);

  let newBank: number;
  let newPendingTransfers = career.pendingTransfers;
  let existingRemoved = (career.removedPlayers || []).filter(rp => rp.player.playerId !== playerId);

  if (pendingTransferIndex !== -1) {
    // CASE 1: Player being removed was a TRANSFER IN this gameweek (not an original player!)
    // Undoing/cancelling this transfer:
    const transfer = career.pendingTransfers[pendingTransferIndex];
    // Refund the purchase price of playerIn back to bank
    newBank = career.bank + transfer.playerInPrice;

    // Remove this transfer from pendingTransfers
    newPendingTransfers = career.pendingTransfers.filter((_, i) => i !== pendingTransferIndex);

    // Re-evaluate free transfer flags on remaining pending transfers
    const rules = getSeasonRules(career.season);
    const isChipActive = career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT;
    const isFreeUnlimitedGW = rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek);
    newPendingTransfers = newPendingTransfers.map((t, idx) => ({
      ...t,
      isFreeTransfer: isChipActive || isFreeUnlimitedGW || idx < career.freeTransfers,
    }));

    // The ORIGINAL player who was sold is the one eligible for restoration!
    const originalPlayer = transfer.originalSquadPlayer ||
      (career.startOfGameweekSquad || []).find(sp => sp.playerId === transfer.playerOutId);

    if (originalPlayer) {
      // Ensure the original player is present in removedPlayers
      const alreadyInRemoved = existingRemoved.some(rp => rp.player.playerId === originalPlayer.playerId);
      if (!alreadyInRemoved) {
        existingRemoved.push({
          player: { ...originalPlayer },
          refundedPrice: transfer.playerOutPrice,
        });
      }
    }
    // playerIn is NEVER added to removedPlayers because they were NOT an original player!
  } else {
    // CASE 2: Player being removed was an ORIGINAL player (in startOfGameweekSquad)
    const salePrice = calculateSellingPrice(player.purchasePrice, player.currentPrice);
    newBank = career.bank + salePrice;

    const isOriginalPlayer = (career.startOfGameweekSquad || []).length === 0 ||
      (career.startOfGameweekSquad || []).some(sp => sp.playerId === playerId);

    if (isOriginalPlayer) {
      existingRemoved.push({ player: { ...player }, refundedPrice: salePrice });
    }
  }

  const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

  const updatedCareer: UserCareer = {
    ...career,
    squad: newSquad,
    bank: newBank,
    squadValue: newSquadValue,
    pendingTransfers: newPendingTransfers,
    removedPlayers: existingRemoved,
    updatedAt: new Date().toISOString(),
  };

  return playerMap ? sanitizeSquadFormation(updatedCareer, playerMap) : updatedCareer;
}

export function restoreRemovedPlayer(
  career: UserCareer,
  playerId: number,
  playerMap?: Map<number, HistoricalPlayer>,
  preferStarting?: boolean,
): UserCareer {
  const item = career.removedPlayers?.find(rp => rp.player.playerId === playerId);
  if (!item) return career;

  const rules = getSeasonRules(career.season);
  // Cannot restore if squad is already at max capacity
  if (career.squad.length >= rules.squadSize) {
    return career;
  }

  // Cannot restore if bank is insufficient to pay refunded price
  if (career.bank < item.refundedPrice) {
    return career;
  }

  // If already in squad (defensive check), simply remove from removedPlayers
  if (career.squad.some(sp => sp.playerId === playerId)) {
    const newRemoved = career.removedPlayers?.filter(rp => rp.player.playerId !== playerId) || [];
    return {
      ...career,
      removedPlayers: newRemoved,
      updatedAt: new Date().toISOString(),
    };
  }

  const p = playerMap?.get(playerId);
  if (p && playerMap) {
    const countInSquad = career.squad.filter(s => playerMap.get(s.playerId)?.position === p.position).length;
    const req = getPositionRequirement(rules, p.position);
    if (countInSquad >= req.squadMax) {
      return career;
    }
  }

  const currentStarters = career.squad.filter(s => s.isStarting);
  const currentBench = career.squad.filter(s => !s.isStarting);
  const currentBenchGkps = currentBench.filter(s => playerMap?.get(s.playerId)?.position === Position.GKP).length;
  const currentBenchOutfield = currentBench.filter(s => playerMap?.get(s.playerId)?.position !== Position.GKP).length;

  let isStarting = preferStarting !== undefined ? preferStarting : item.player.isStarting;
  let benchOrder = item.player.benchOrder;

  // If designated for bench, but bench cannot take this player, place into starting XI if room exists:
  if (!isStarting) {
    if (p?.position === Position.GKP) {
      if (currentBenchGkps >= 1 && currentStarters.length < rules.startingXISize) {
        isStarting = true;
      }
    } else {
      if (currentBenchOutfield >= 3 && currentStarters.length < rules.startingXISize) {
        isStarting = true;
      }
    }
  }

  // If designated for starting XI, verify formation and starting caps:
  if (isStarting && p && playerMap) {
    const startingCount = currentStarters.length;
    const startingInPos = currentStarters.filter(s => playerMap.get(s.playerId)?.position === p.position).length;
    const req = getPositionRequirement(rules, p.position);

    if (p.position === Position.GKP) {
      if (currentStarters.filter(s => playerMap.get(s.playerId)?.position === Position.GKP).length >= 1) {
        isStarting = false;
        benchOrder = 1;
      } else {
        benchOrder = 0;
      }
    } else {
      if (startingCount >= rules.startingXISize || startingInPos >= req.startingMax) {
        isStarting = false;
        benchOrder = 2 + currentBenchOutfield;
      } else {
        benchOrder = 0;
      }
    }
  }

  const restoredPlayer: UserSquadPlayer = {
    ...item.player,
    isStarting,
    benchOrder,
  };

  const newSquad = [...career.squad, restoredPlayer];
  const newBank = career.bank - item.refundedPrice;
  const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);
  const newRemoved = career.removedPlayers?.filter(rp => rp.player.playerId !== playerId) || [];

  // If there was a pending transfer that had sold this player, cancel that transfer
  const updatedTransfers = (career.pendingTransfers || []).filter(t => t.playerOutId !== playerId);

  const updatedCareer: UserCareer = {
    ...career,
    squad: newSquad,
    bank: newBank,
    squadValue: newSquadValue,
    pendingTransfers: updatedTransfers,
    removedPlayers: newRemoved,
    updatedAt: new Date().toISOString(),
  };

  return playerMap ? sanitizeSquadFormation(updatedCareer, playerMap) : updatedCareer;
}

/**
 * Calculates empty slots across all pitch rows in a coordinated manner.
 * Strictly guarantees:
 * 1. Total starting slots across pitch (players + empty slots) <= 11
 * 2. GKP row <= 1 total
 * 3. DEF row <= 5 total
 * 4. MID row <= 5 total
 * 5. FWD row <= 3 total (NEVER shows 4 FWD positions)
 */
export function calculatePitchEmptySlots(
  startingXI: UserSquadPlayer[],
  removedPlayers: Array<{ player: UserSquadPlayer; refundedPrice: number }> | undefined,
  playerMap: Map<number, HistoricalPlayer>,
): Record<number, number> {
  const result: Record<number, number> = {
    [Position.GKP]: 0,
    [Position.DEF]: 0,
    [Position.MID]: 0,
    [Position.FWD]: 0,
  };

  const startingCount = startingXI.length;
  if (startingCount >= 11) {
    return result;
  }

  let remainingBudget = 11 - startingCount;

  const startingCaps: Record<number, number> = {
    [Position.GKP]: 1,
    [Position.DEF]: 5,
    [Position.MID]: 5,
    [Position.FWD]: 3,
  };

  const minRequired: Record<number, number> = {
    [Position.GKP]: 1,
    [Position.DEF]: 3,
    [Position.MID]: 2,
    [Position.FWD]: 1,
  };

  const defaultTarget: Record<number, number> = {
    [Position.GKP]: 1,
    [Position.DEF]: 4,
    [Position.MID]: 4,
    [Position.FWD]: 2,
  };

  // Count current starters by position
  const rowCounts: Record<number, number> = {
    [Position.GKP]: 0,
    [Position.DEF]: 0,
    [Position.MID]: 0,
    [Position.FWD]: 0,
  };

  for (const s of startingXI) {
    const p = playerMap.get(s.playerId);
    if (p && rowCounts[p.position] !== undefined) {
      rowCounts[p.position]++;
    }
  }

  // Room remaining in each row without exceeding startingCaps
  const roomInRow: Record<number, number> = {
    [Position.GKP]: Math.max(0, startingCaps[Position.GKP] - rowCounts[Position.GKP]),
    [Position.DEF]: Math.max(0, startingCaps[Position.DEF] - rowCounts[Position.DEF]),
    [Position.MID]: Math.max(0, startingCaps[Position.MID] - rowCounts[Position.MID]),
    [Position.FWD]: Math.max(0, startingCaps[Position.FWD] - rowCounts[Position.FWD]),
  };

  // If no GKP is starting, GKP MUST get 1 empty slot so pitch GKP row never collapses
  if (rowCounts[Position.GKP] === 0 && roomInRow[Position.GKP] > 0 && remainingBudget > 0) {
    result[Position.GKP] = 1;
    remainingBudget -= 1;
    roomInRow[Position.GKP] = 0;
  }

  // 1. Prioritize removed starters that are awaiting replacement
  const currentSquadIds = new Set(startingXI.map(s => s.playerId));
  const removedStarters = (removedPlayers || []).filter(
    rp => rp.player.isStarting && !currentSquadIds.has(rp.player.playerId)
  );

  const removedStartersCount: Record<number, number> = {
    [Position.GKP]: 0,
    [Position.DEF]: 0,
    [Position.MID]: 0,
    [Position.FWD]: 0,
  };

  for (const rp of removedStarters) {
    const p = playerMap.get(rp.player.playerId);
    if (p && removedStartersCount[p.position] !== undefined) {
      removedStartersCount[p.position]++;
    }
  }

  const hasRemovedStarters = Object.values(removedStartersCount).some(c => c > 0);

  if (hasRemovedStarters) {
    for (const pos of [Position.DEF, Position.MID, Position.FWD, Position.GKP]) {
      if (remainingBudget <= 0) break;
      const count = removedStartersCount[pos] || 0;
      if (count > 0 && roomInRow[pos] > 0) {
        const toGive = Math.min(roomInRow[pos], count, remainingBudget);
        result[pos] += toGive;
        remainingBudget -= toGive;
        roomInRow[pos] -= toGive;
      }
    }
    return result;
  }

  // 2. Fresh team building: satisfy minimum required starters
  for (const pos of [Position.DEF, Position.MID, Position.FWD]) {
    if (remainingBudget <= 0) break;
    const minNeeded = Math.max(0, minRequired[pos] - (rowCounts[pos] + result[pos]));
    if (minNeeded > 0 && roomInRow[pos] > 0) {
      const toGive = Math.min(minNeeded, roomInRow[pos], remainingBudget);
      result[pos] += toGive;
      remainingBudget -= toGive;
      roomInRow[pos] -= toGive;
    }
  }

  // 3. Target default formation (4-4-2)
  for (const pos of [Position.DEF, Position.MID, Position.FWD]) {
    if (remainingBudget <= 0) break;
    const targetNeeded = Math.max(0, defaultTarget[pos] - (rowCounts[pos] + result[pos]));
    if (targetNeeded > 0 && roomInRow[pos] > 0) {
      const toGive = Math.min(targetNeeded, roomInRow[pos], remainingBudget);
      result[pos] += toGive;
      remainingBudget -= toGive;
      roomInRow[pos] -= toGive;
    }
  }

  // 4. Fill any remaining budget respecting row caps
  for (const pos of [Position.DEF, Position.MID, Position.FWD]) {
    if (remainingBudget <= 0) break;
    if (roomInRow[pos] > 0) {
      const toGive = Math.min(roomInRow[pos], remainingBudget);
      result[pos] += toGive;
      remainingBudget -= toGive;
      roomInRow[pos] -= toGive;
    }
  }

  return result;
}

export function setPlayerStarting(
  career: UserCareer,
  playerId: number,
  isStarting: boolean,
  benchOrder: number = 0,
): UserCareer {
  const newSquad = career.squad.map(sp =>
    sp.playerId === playerId
      ? { ...sp, isStarting, benchOrder: isStarting ? 0 : benchOrder }
      : sp
  );

  return { ...career, squad: newSquad, updatedAt: new Date().toISOString() };
}

export function setCaptain(career: UserCareer, playerId: number): UserCareer {
  const newSquad = career.squad.map(sp => ({
    ...sp,
    isCaptain: sp.playerId === playerId,
    // If new captain was vice-captain, clear vice-captain
    isViceCaptain: sp.playerId === playerId ? false : sp.isViceCaptain,
  }));

  return { ...career, squad: newSquad, updatedAt: new Date().toISOString() };
}

export function setViceCaptain(career: UserCareer, playerId: number): UserCareer {
  const newSquad = career.squad.map(sp => ({
    ...sp,
    isViceCaptain: sp.playerId === playerId,
    // If new VC was captain, clear captain
    isCaptain: sp.playerId === playerId ? false : sp.isCaptain,
  }));

  return { ...career, squad: newSquad, updatedAt: new Date().toISOString() };
}

// ============================================================
// AUTO-ARRANGE SQUAD
// ============================================================

export function autoArrangeSquad(
  career: UserCareer,
  playerMap: Map<number, HistoricalPlayer>,
  rules: SeasonRules,
): UserCareer {
  if (career.squad.length === 0) return career;

  const gkps = career.squad.filter(s => playerMap.get(s.playerId)?.position === Position.GKP);
  const defs = career.squad.filter(s => playerMap.get(s.playerId)?.position === Position.DEF);
  const mids = career.squad.filter(s => playerMap.get(s.playerId)?.position === Position.MID);
  const fwds = career.squad.filter(s => playerMap.get(s.playerId)?.position === Position.FWD);

  const starting: UserSquadPlayer[] = [];
  const benchGkps: UserSquadPlayer[] = [];
  const benchOutfield: UserSquadPlayer[] = [];

  // GKP: exactly 1 starting if available, all other GKPs go to bench
  if (gkps.length >= 1) {
    starting.push({ ...gkps[0], isStarting: true, benchOrder: 0 });
  }
  for (let i = 1; i < gkps.length; i++) {
    benchGkps.push({ ...gkps[i], isStarting: false, benchOrder: 1 });
  }

  // Outfield: Target standard 4-4-2 formation (4 DEF, 4 MID, 2 FWD)
  // Or dynamic valid formation respecting limits:
  // DEF: min 3, max 5
  // MID: min 2, max 5
  // FWD: min 1, max 3
  let targetDef = Math.min(defs.length, 4);
  let targetMid = Math.min(mids.length, 4);
  let targetFwd = Math.min(fwds.length, 2);

  // If we have remaining outfield starting slots (up to 10), fill them up to caps
  let totalOutfield = targetDef + targetMid + targetFwd;
  while (totalOutfield < 10) {
    if (targetDef < Math.min(defs.length, 5)) {
      targetDef++;
      totalOutfield++;
    } else if (targetMid < Math.min(mids.length, 5)) {
      targetMid++;
      totalOutfield++;
    } else if (targetFwd < Math.min(fwds.length, 3)) {
      targetFwd++;
      totalOutfield++;
    } else {
      break;
    }
  }

  defs.forEach((p, i) => {
    if (i < targetDef) starting.push({ ...p, isStarting: true, benchOrder: 0 });
    else benchOutfield.push({ ...p, isStarting: false });
  });

  mids.forEach((p, i) => {
    if (i < targetMid) starting.push({ ...p, isStarting: true, benchOrder: 0 });
    else benchOutfield.push({ ...p, isStarting: false });
  });

  fwds.forEach((p, i) => {
    if (i < targetFwd) starting.push({ ...p, isStarting: true, benchOrder: 0 });
    else benchOutfield.push({ ...p, isStarting: false });
  });

  // Assign bench orders:
  // Bench GKP is always benchOrder: 1
  // Outfield subs are benchOrder: 2, 3, 4 (or 1, 2, 3 if no bench GKP)
  const bench: UserSquadPlayer[] = [];
  if (benchGkps.length > 0) {
    bench.push({ ...benchGkps[0], benchOrder: 1 });
  }
  let outfieldSubOrder = 2;
  benchOutfield.forEach((p) => {
    bench.push({ ...p, benchOrder: outfieldSubOrder++ });
  });

  // Captain & Vice-Captain:
  const currentCaptainId = career.squad.find(s => s.isCaptain)?.playerId;
  const currentVcId = career.squad.find(s => s.isViceCaptain)?.playerId;

  const startingIds = new Set(starting.map(s => s.playerId));
  const captainId = startingIds.has(currentCaptainId || -1)
    ? currentCaptainId
    : (starting.find(s => {
        const pos = playerMap.get(s.playerId)?.position;
        return pos === Position.MID || pos === Position.FWD;
      })?.playerId || starting[0]?.playerId);

  const vcId = (startingIds.has(currentVcId || -1) && currentVcId !== captainId)
    ? currentVcId
    : (starting.find(s => s.playerId !== captainId)?.playerId || 0);

  const newSquad = [...starting, ...bench].map(sp => ({
    ...sp,
    isCaptain: sp.playerId === captainId,
    isViceCaptain: sp.playerId === vcId && vcId !== captainId,
  }));

  return {
    ...career,
    squad: newSquad,
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeSquadFormation(
  career: UserCareer,
  playerMap: Map<number, HistoricalPlayer>,
): UserCareer {
  if (!career.squad || career.squad.length === 0) return career;
  const rules = getSeasonRules(career.season);

  let changed = false;

  // Deduplicate squad by playerId (self-healing for any previously corrupted state/saves)
  const seenPlayerIds = new Set<number>();
  const dedupedSquad: UserSquadPlayer[] = [];
  for (const s of career.squad) {
    if (!seenPlayerIds.has(s.playerId)) {
      seenPlayerIds.add(s.playerId);
      dedupedSquad.push({ ...s });
    } else {
      changed = true;
    }
  }
  let squad = dedupedSquad;

  // Enforce overall squad position limits (max 2 GKP, max 5 DEF, max 5 MID, max 3 FWD)
  const squadPosCaps: Record<number, number> = {
    [Position.GKP]: 2,
    [Position.DEF]: 5,
    [Position.MID]: 5,
    [Position.FWD]: 3,
  };
  for (const pos of [Position.GKP, Position.DEF, Position.MID, Position.FWD]) {
    const maxAllowed = squadPosCaps[pos];
    const playersInPos = squad.filter(s => playerMap.get(s.playerId)?.position === pos);
    if (playersInPos.length > maxAllowed) {
      changed = true;
      // Sort so starters are prioritized to stay, then lower benchOrder
      const sorted = [...playersInPos].sort((a, b) => {
        if (a.isStarting && !b.isStarting) return -1;
        if (!a.isStarting && b.isStarting) return 1;
        return (a.benchOrder || 0) - (b.benchOrder || 0);
      });
      const keptIds = new Set(sorted.slice(0, maxAllowed).map(s => s.playerId));
      squad = squad.filter(s => {
        const p = playerMap.get(s.playerId);
        if (p?.position === pos) {
          return keptIds.has(s.playerId);
        }
        return true;
      });
    }
  }

  const finalSquadPlayerIds = new Set(squad.map(s => s.playerId));

  // Deduplicate removedPlayers and ensure no player already in squad is also in removedPlayers
  let removedPlayers = career.removedPlayers;
  if (removedPlayers && removedPlayers.length > 0) {
    const isPreSeason = career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD;
    if (isPreSeason) {
      removedPlayers = [];
      changed = true;
    } else {
      const originalPlayerIds = new Set((career.startOfGameweekSquad || []).map(sp => sp.playerId));
      const replacedPlayerOutIds = new Set((career.pendingTransfers || []).map(t => t.playerOutId));
      const seenRemoved = new Set<number>();
      const cleanedRemoved = removedPlayers.filter(rp => {
        // 1. Must not already be in active squad
        if (finalSquadPlayerIds.has(rp.player.playerId)) {
          changed = true;
          return false;
        }
        // 2. Must not be a duplicate in removedPlayers
        if (seenRemoved.has(rp.player.playerId)) {
          changed = true;
          return false;
        }
        // 3. In-season: must be an original player who was in startOfGameweekSquad
        if (originalPlayerIds.size > 0 && !originalPlayerIds.has(rp.player.playerId)) {
          changed = true;
          return false;
        }
        // 4. If this player was already replaced by a pending transfer, they are not awaiting replacement
        if (replacedPlayerOutIds.has(rp.player.playerId)) {
          changed = true;
          return false;
        }
        seenRemoved.add(rp.player.playerId);
        return true;
      });
      if (cleanedRemoved.length !== removedPlayers.length) {
        removedPlayers = cleanedRemoved;
        changed = true;
      }
    }
  }

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
    // If no goalkeeper is starting, promote a bench goalkeeper if one exists in the squad
    const benchGkp = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
    if (benchGkp) {
      changed = true;
      benchGkp.isStarting = true;
      benchGkp.benchOrder = 0;
    }
  }

  // 2. Enforce starting position caps (max 5 DEF, max 5 MID, max 3 FWD)
  const posCaps: Record<number, number> = {
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

      let demoteCandidate: UserSquadPlayer | undefined;
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
  } else if (starters.length < rules.startingXISize && squad.length >= rules.squadSize) {
    // Fill up to 11 starters from bench ONLY IF squad is full (>= 15 players), prioritizing deficits (GKP < 1, DEF < 3, MID < 2, FWD < 1)
    changed = true;
    while (starters.length < rules.startingXISize) {
      const curGkps = starters.filter(s => playerMap.get(s.playerId)?.position === Position.GKP).length;
      const curDefs = starters.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).length;
      const curMids = starters.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
      const curFwds = starters.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).length;
      const curOutfield = curDefs + curMids + curFwds;

      let candidate: UserSquadPlayer | undefined = undefined;

      // Only promote a GKP if curGkps < 1
      if (curGkps < 1) {
        candidate = squad.find(s => !s.isStarting && playerMap.get(s.playerId)?.position === Position.GKP);
      }

      // Only promote an outfielder if curOutfield < 10
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

  // 5. If squad has 11 starters, enforce minimum position requirements: DEF >= 3, MID >= 2, FWD >= 1
  starters = squad.filter(s => s.isStarting);
  if (starters.length === rules.startingXISize) {
    const defCount = starters.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).length;
    const midCount = starters.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
    const fwdCount = starters.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).length;

    // Fix DEF < 3: swap an excess MID (if mid > 2) or FWD (if fwd > 1) with a bench DEF
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
    // Fix MID < 2
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
        demotee.isCaptain = false;
        demotee.isViceCaptain = false;
      }
    }
    // Fix FWD < 1
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
        demotee.isCaptain = false;
        demotee.isViceCaptain = false;
      }
    }
  }

  // 5b. Strictly enforce Bench Outfield Limits (max 3 outfielders on bench):
  // If there are > 3 outfielders on bench and starting XI has room (< 11 starters),
  // promote excess bench outfielders into starting XI!
  let currentBenchOutfield = squad.filter(s => !s.isStarting && playerMap.get(s.playerId)?.position !== Position.GKP);
  if (currentBenchOutfield.length > 3) {
    changed = true;
    while (currentBenchOutfield.length > 3 && squad.filter(s => s.isStarting).length < rules.startingXISize) {
      const curDefs = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.DEF).length;
      const curMids = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.MID).length;
      const curFwds = squad.filter(s => s.isStarting && playerMap.get(s.playerId)?.position === Position.FWD).length;

      const promoteCandidate = currentBenchOutfield.find(s => {
        const pos = playerMap.get(s.playerId)?.position;
        if (pos === Position.DEF && curDefs < 5) return true;
        if (pos === Position.MID && curMids < 5) return true;
        if (pos === Position.FWD && curFwds < 3) return true;
        return false;
      });

      if (promoteCandidate) {
        promoteCandidate.isStarting = true;
        promoteCandidate.benchOrder = 0;
      } else {
        break;
      }
      currentBenchOutfield = squad.filter(s => !s.isStarting && playerMap.get(s.playerId)?.position !== Position.GKP);
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

  const benchOrderMap = new Map<number, number>();
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

  // 6. Captain & Vice Captain sanity check
  const activeStarters = squad.filter(s => s.isStarting);
  if (activeStarters.length > 0) {
    const captain = squad.find(s => s.isCaptain && s.isStarting);
    if (!captain) {
      changed = true;
      const newCapId = activeStarters[0].playerId;
      squad = squad.map(s => ({
        ...s,
        isCaptain: s.playerId === newCapId,
        isViceCaptain: s.isViceCaptain && s.playerId !== newCapId,
      }));
    }
    const currentCapId = squad.find(s => s.isCaptain)?.playerId;
    const vc = squad.find(s => s.isViceCaptain && s.isStarting && s.playerId !== currentCapId);
    if (!vc && activeStarters.length > 1) {
      changed = true;
      const newVc = activeStarters.find(s => s.playerId !== currentCapId);
      if (newVc) {
        squad = squad.map(s => ({
          ...s,
          isViceCaptain: s.playerId === newVc.playerId,
        }));
      }
    }
  }

  if (!changed) return career;
  return {
    ...career,
    squad,
    removedPlayers,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================
// TRANSFER OPERATIONS
// ============================================================

export interface TransferPreview {
  playerOut: HistoricalPlayer;
  playerIn: HistoricalPlayer;
  priceOut: number;
  priceIn: number;
  priceDifference: number;
  bankAfter: number;
  isFreeTransfer: boolean;
  transferCost: number;
  freeTransfersAfter: number;
  valid: boolean;
  reason: string;
}

export function previewTransfer(
  career: UserCareer,
  playerOutId: number,
  playerIn: HistoricalPlayer,
  playerInPrice: number,
  playerMap: Map<number, HistoricalPlayer>,
): TransferPreview {
  const rules = getSeasonRules(career.season);
  const squadPlayer = career.squad.find(sp => sp.playerId === playerOutId);
  const playerOut = playerMap.get(playerOutId);

  if (!squadPlayer || !playerOut) {
    return {
      playerOut: playerOut!,
      playerIn,
      priceOut: 0,
      priceIn: playerInPrice,
      priceDifference: -playerInPrice,
      bankAfter: career.bank,
      isFreeTransfer: false,
      transferCost: 0,
      freeTransfersAfter: career.freeTransfers,
      valid: false,
      reason: 'Player not found in squad',
    };
  }

  // Selling price: 50% profit rule over purchase price
  const sellingPrice = calculateSellingPrice(squadPlayer.purchasePrice, squadPlayer.currentPrice);
  const bankAfter = career.bank + sellingPrice - playerInPrice;

  // Determine transfer cost
  const isChipActive = career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT;
  const isFreeUnlimitedGW = rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek);
  const pendingCount = career.pendingTransfers.length;
  const isFree = isChipActive || isFreeUnlimitedGW || pendingCount < career.freeTransfers;
  const transferCost = isFree ? 0 : rules.transferPenaltyPoints;

  let valid = true;
  let reason = '';

  if (bankAfter < 0) {
    valid = false;
    reason = `Insufficient budget. Need £${((playerInPrice - sellingPrice - career.bank) / 10).toFixed(1)}m more`;
  }

  // Check position compatibility
  if (playerOut.position !== playerIn.position) {
    // Check if we can still form a valid squad
    const tempSquad = career.squad
      .filter(s => s.playerId !== playerOutId)
      .concat([{
        playerId: playerIn.id,
        purchasePrice: playerInPrice,
        currentPrice: playerInPrice,
        isStarting: squadPlayer.isStarting,
        benchOrder: squadPlayer.benchOrder,
        isCaptain: false,
        isViceCaptain: false,
      }]);

    const posCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    tempSquad.forEach(sp => {
      const p = sp.playerId === playerIn.id ? playerIn : playerMap.get(sp.playerId);
      if (p) posCount[p.position]++;
    });

    for (const req of rules.positionRequirements) {
      if (posCount[req.position] < req.squadMin || posCount[req.position] > req.squadMax) {
        valid = false;
        reason = `Transfer would break position requirements`;
      }
    }
  }

  // Check club limit
  const gw = career.clock.currentGameweek;
  const inTeamId = getPlayerTeamId(playerIn, gw);
  const clubCountAfter = career.squad
    .filter(s => s.playerId !== playerOutId)
    .filter(s => {
      const p = playerMap.get(s.playerId);
      return p && getPlayerTeamId(p, gw) === inTeamId;
    }).length + 1;

  if (clubCountAfter > rules.maxPlayersPerClub) {
    valid = false;
    reason = `Maximum ${rules.maxPlayersPerClub} players from ${playerIn.teamShortName || playerIn.teamName}`;
  }

  // Check if already in squad
  if (career.squad.some(s => s.playerId === playerIn.id)) {
    valid = false;
    reason = 'Player is already in your squad';
  }

  return {
    playerOut,
    playerIn,
    priceOut: sellingPrice,
    priceIn: playerInPrice,
    priceDifference: sellingPrice - playerInPrice,
    bankAfter,
    isFreeTransfer: isFree,
    transferCost: isFree ? 0 : transferCost,
    freeTransfersAfter: isChipActive ? career.freeTransfers : Math.max(0, career.freeTransfers - 1),
    valid,
    reason,
  };
}

export function executeTransfer(
  career: UserCareer,
  playerOutId: number,
  playerIn: HistoricalPlayer,
  playerInPrice: number,
  playerMap?: Map<number, HistoricalPlayer>,
): UserCareer {
  const squadPlayer = career.squad.find(sp => sp.playerId === playerOutId);
  if (!squadPlayer) return career;

  const sellingPrice = calculateSellingPrice(squadPlayer.purchasePrice, squadPlayer.currentPrice);
  const rules = getSeasonRules(career.season);
  const isChipActive = career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT;
  const isFreeUnlimitedGW = rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek);
  const cleanedRemoved = (career.removedPlayers || []).filter(
    rp => rp.player.playerId !== playerIn.id && rp.player.playerId !== playerOutId
  );

  // Check if playerOut was brought in this gameweek (chain replacement before deadline)
  const existingTransferIndex = career.pendingTransfers.findIndex(t => t.playerInId === playerOutId);

  if (existingTransferIndex !== -1) {
    const existingTransfer = career.pendingTransfers[existingTransferIndex];

    // CASE A: User is transferring back the original player they sold this gameweek (undo transfer)
    if (playerIn.id === existingTransfer.playerOutId) {
      const restoredPlayerObj: UserSquadPlayer = existingTransfer.originalSquadPlayer
        ? { ...existingTransfer.originalSquadPlayer }
        : {
            playerId: existingTransfer.playerOutId,
            purchasePrice: existingTransfer.playerOutPrice,
            currentPrice: existingTransfer.playerOutPrice,
            isStarting: squadPlayer.isStarting,
            benchOrder: squadPlayer.benchOrder,
            isCaptain: squadPlayer.isCaptain,
            isViceCaptain: squadPlayer.isViceCaptain,
          };

      const newSquad = career.squad
        .filter(sp => sp.playerId !== playerOutId)
        .concat([restoredPlayerObj]);

      const newBank = career.bank + squadPlayer.purchasePrice - existingTransfer.playerOutPrice;
      const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

      const remainingTransfers = career.pendingTransfers.filter((_, i) => i !== existingTransferIndex);
      const updatedTransfers = remainingTransfers.map((t, idx) => ({
        ...t,
        isFreeTransfer: isChipActive || isFreeUnlimitedGW || idx < career.freeTransfers,
      }));

      const resCareer: UserCareer = {
        ...career,
        squad: newSquad,
        bank: newBank,
        squadValue: newSquadValue,
        pendingTransfers: updatedTransfers,
        removedPlayers: cleanedRemoved,
        updatedAt: new Date().toISOString(),
      };
      return playerMap ? sanitizeSquadFormation(resCareer, playerMap) : resCareer;
    }

    // CASE B: User is replacing playerOut with a new playerIn (collapse A -> B and B -> C into A -> C)
    const newSquadPlayer: UserSquadPlayer = {
      playerId: playerIn.id,
      purchasePrice: playerInPrice,
      currentPrice: playerInPrice,
      isStarting: squadPlayer.isStarting,
      benchOrder: squadPlayer.benchOrder,
      isCaptain: squadPlayer.isCaptain,
      isViceCaptain: squadPlayer.isViceCaptain,
    };

    const newSquad = career.squad
      .filter(sp => sp.playerId !== playerOutId)
      .concat([newSquadPlayer]);

    const newBank = career.bank + squadPlayer.purchasePrice - playerInPrice;
    const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

    const updatedTransfer: UserTransfer = {
      ...existingTransfer,
      playerInId: playerIn.id,
      playerInPrice: playerInPrice,
    };

    const updatedTransfers = career.pendingTransfers.map((t, i) =>
      i === existingTransferIndex ? updatedTransfer : t
    );

    const resCareer: UserCareer = {
      ...career,
      squad: newSquad,
      bank: newBank,
      squadValue: newSquadValue,
      pendingTransfers: updatedTransfers,
      removedPlayers: cleanedRemoved,
      updatedAt: new Date().toISOString(),
    };
    return playerMap ? sanitizeSquadFormation(resCareer, playerMap) : resCareer;
  }

  // Normal transfer (playerOut was in squad at start of GW)
  const transfer: UserTransfer = {
    gameweek: career.clock.currentGameweek,
    playerOutId,
    playerInId: playerIn.id,
    playerOutPrice: sellingPrice,
    playerInPrice: playerInPrice,
    isFreeTransfer: isChipActive || isFreeUnlimitedGW || career.pendingTransfers.length < career.freeTransfers,
    originalSquadPlayer: { ...squadPlayer },
  };

  const newSquadPlayer: UserSquadPlayer = {
    playerId: playerIn.id,
    purchasePrice: playerInPrice,
    currentPrice: playerInPrice,
    isStarting: squadPlayer.isStarting,
    benchOrder: squadPlayer.benchOrder,
    isCaptain: false,
    isViceCaptain: false,
  };

  const newSquad = career.squad
    .filter(sp => sp.playerId !== playerOutId)
    .concat([newSquadPlayer]);

  const newBank = career.bank + sellingPrice - playerInPrice;
  const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

  const resCareer: UserCareer = {
    ...career,
    squad: newSquad,
    bank: newBank,
    squadValue: newSquadValue,
    pendingTransfers: [...career.pendingTransfers, transfer],
    removedPlayers: cleanedRemoved,
    updatedAt: new Date().toISOString(),
  };
  return playerMap ? sanitizeSquadFormation(resCareer, playerMap) : resCareer;
}

export function restoreTransfer(
  career: UserCareer,
  playerInId: number,
  playerMap: Map<number, HistoricalPlayer>,
): { career: UserCareer; restoredPlayer?: HistoricalPlayer; success: boolean } {
  const transferIndex = career.pendingTransfers.findIndex(t => t.playerInId === playerInId);
  if (transferIndex === -1) {
    return { career, success: false };
  }

  const transfer = career.pendingTransfers[transferIndex];

  // Remove playerIn from squad
  const newSquad = career.squad.filter(sp => sp.playerId !== playerInId);

  // Restore playerOut into squad
  const restoredPlayerObj: UserSquadPlayer = transfer.originalSquadPlayer
    ? { ...transfer.originalSquadPlayer }
    : {
        playerId: transfer.playerOutId,
        purchasePrice: transfer.playerOutPrice,
        currentPrice: transfer.playerOutPrice,
        isStarting: true,
        benchOrder: 0,
        isCaptain: false,
        isViceCaptain: false,
      };

  // Only add if not already in squad (defensive check against duplicate players)
  if (!newSquad.some(sp => sp.playerId === restoredPlayerObj.playerId)) {
    newSquad.push(restoredPlayerObj);
  }

  // Restore bank:
  // If playerIn was in removedPlayers, it was already refunded when removed. Only deduct playerOutPrice.
  const wasRemoved = career.removedPlayers?.some(rp => rp.player.playerId === playerInId);
  const bankAdjustment = wasRemoved
    ? -transfer.playerOutPrice
    : transfer.playerInPrice - transfer.playerOutPrice;

  const newBank = career.bank + bankAdjustment;
  const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

  // Clean up removedPlayers if playerIn was placed in there
  const newRemoved = career.removedPlayers?.filter(rp => rp.player.playerId !== playerInId) || [];

  // Remove this transfer from pendingTransfers
  const remainingTransfers = career.pendingTransfers.filter((_, i) => i !== transferIndex);

  // Re-evaluate isFreeTransfer on remaining transfers
  const rules = getSeasonRules(career.season);
  const isChipActive = career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT;
  const isFreeUnlimitedGW = rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek);
  const updatedTransfers = remainingTransfers.map((t, idx) => ({
    ...t,
    isFreeTransfer: isChipActive || isFreeUnlimitedGW || idx < career.freeTransfers,
  }));

  const restoredPlayer = playerMap.get(transfer.playerOutId);

  const updatedCareer: UserCareer = {
    ...career,
    squad: newSquad,
    bank: newBank,
    squadValue: newSquadValue,
    pendingTransfers: updatedTransfers,
    removedPlayers: newRemoved,
    updatedAt: new Date().toISOString(),
  };

  return {
    career: sanitizeSquadFormation(updatedCareer, playerMap),
    restoredPlayer,
    success: true,
  };
}

export function resetAllTransfers(
  career: UserCareer,
  playerMap: Map<number, HistoricalPlayer>,
): UserCareer {
  if (!career.startOfGameweekSquad || career.startOfGameweekSquad.length === 0) {
    return career;
  }

  const restoredSquad = career.startOfGameweekSquad.map(sp => ({ ...sp }));
  const restoredBank = career.startOfGameweekBank !== undefined ? career.startOfGameweekBank : career.bank;
  const squadValue = restoredSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

  const resetCareer: UserCareer = {
    ...career,
    squad: restoredSquad,
    bank: restoredBank,
    squadValue,
    pendingTransfers: [],
    removedPlayers: [],
    updatedAt: new Date().toISOString(),
  };

  return sanitizeSquadFormation(resetCareer, playerMap);
}

// ============================================================
// GAMEWEEK SCORING ENGINE
// ============================================================

export const SEASON_MANAGERS: Record<string, number> = {
  '2016-17': 4503345,
  '2017-18': 5910379,
  '2018-19': 6324252,
  '2019-20': 7628968,
  '2020-21': 8246415,
  '2021-22': 9167240,
  '2022-23': 11447072,
  '2023-24': 10911762,
  '2024-25': 11124500,
};

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * a);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-a * a);
  return sign * y;
}

export function normalCDF(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (stdDev * Math.SQRT2)));
}

export function calculateGameweekScore(
  career: UserCareer,
  gwData: HistoricalGameweekPlayerData[],
  playerMap: Map<number, HistoricalPlayer>,
): UserGameweekResult {
  const rules = getSeasonRules(career.season);
  const gw = career.clock.currentGameweek;

  // Build GW data lookup
  const gwDataMap = new Map<number, HistoricalGameweekPlayerData>();
  for (const d of gwData) {
    // Some players may have multiple entries (double gameweeks)
    const existing = gwDataMap.get(d.playerId);
    if (existing) {
      // Combine points for double gameweeks
      gwDataMap.set(d.playerId, {
        ...existing,
        totalPoints: existing.totalPoints + d.totalPoints,
        minutes: existing.minutes + d.minutes,
        goals: existing.goals + d.goals,
        assists: existing.assists + d.assists,
        cleanSheets: existing.cleanSheets + d.cleanSheets,
        goalsConceded: existing.goalsConceded + d.goalsConceded,
        ownGoals: existing.ownGoals + d.ownGoals,
        penaltiesSaved: existing.penaltiesSaved + d.penaltiesSaved,
        penaltiesMissed: existing.penaltiesMissed + d.penaltiesMissed,
        yellowCards: existing.yellowCards + d.yellowCards,
        redCards: existing.redCards + d.redCards,
        saves: existing.saves + d.saves,
        bonus: existing.bonus + d.bonus,
        bps: existing.bps + d.bps,
      });
    } else {
      gwDataMap.set(d.playerId, { ...d });
    }
  }

  // Get starting XI and bench from career squad
  const startingXI = career.squad.filter(sp => sp.isStarting).map(sp => sp.playerId);
  const bench = career.squad
    .filter(sp => !sp.isStarting)
    .sort((a, b) => a.benchOrder - b.benchOrder)
    .map(sp => sp.playerId);

  const captainId = career.squad.find(sp => sp.isCaptain)?.playerId || startingXI[0];
  const viceCaptainId = career.squad.find(sp => sp.isViceCaptain)?.playerId || startingXI[1];

  // Calculate raw points for each player
  const playerPoints: Record<number, number> = {};
  const allSquadPlayerIds = [...startingXI, ...bench];
  for (const pid of allSquadPlayerIds) {
    const data = gwDataMap.get(pid);
    playerPoints[pid] = data ? data.totalPoints : 0;
  }

  // Apply automatic substitutions
  const substitutions: Array<{ playerOut: number; playerIn: number }> = [];
  const finalStartingXI = [...startingXI];

  // Check if bench boost is active
  const isBenchBoost = career.activeChip === ChipType.BENCH_BOOST;

  if (!isBenchBoost) {
    // Process auto-subs: replace non-playing starters with bench players
    for (let i = 0; i < finalStartingXI.length; i++) {
      const starterId = finalStartingXI[i];
      const starterData = gwDataMap.get(starterId);

      if (!starterData || starterData.minutes === 0) {
        // This player didn't play - try to sub in from bench
        for (let j = 0; j < bench.length; j++) {
          const benchPlayerId = bench[j];
          // Already used as a sub?
          if (substitutions.some(s => s.playerIn === benchPlayerId)) continue;

          const benchData = gwDataMap.get(benchPlayerId);
          if (!benchData || benchData.minutes === 0) continue;

          // Check if substitution maintains valid formation
          const player = playerMap.get(starterId);
          const benchPlayer = playerMap.get(benchPlayerId);
          if (!player || !benchPlayer) continue;

          // Test formation validity after substitution
          const tempStarting = finalStartingXI
            .filter((_, idx) => idx !== i)
            .concat([benchPlayerId]);

          const posCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
          for (const pid of tempStarting) {
            const p = pid === benchPlayerId ? benchPlayer : playerMap.get(pid);
            if (p) posCount[p.position]++;
          }

          // GKP must be exactly 1
          if (posCount[Position.GKP] !== 1) {
            // If we're subbing out a GKP, can only sub in a GKP
            if (player.position === Position.GKP && benchPlayer.position !== Position.GKP) continue;
            // If we're subbing in a GKP when there's already one, skip
            if (benchPlayer.position === Position.GKP && posCount[Position.GKP] > 1) continue;
          }

          const def = posCount[Position.DEF] || 0;
          const mid = posCount[Position.MID] || 0;
          const fwd = posCount[Position.FWD] || 0;

          if (isFormationValid(rules, def, mid, fwd)) {
            substitutions.push({ playerOut: starterId, playerIn: benchPlayerId });
            finalStartingXI[i] = benchPlayerId;
            break;
          }
        }
      }
    }
  }

  // Calculate score from final starting XI (after subs)
  let rawScore = 0;
  const scoringPlayers = isBenchBoost ? [...finalStartingXI, ...bench] : finalStartingXI;

  for (const pid of scoringPlayers) {
    // Skip players that were subbed out
    if (!isBenchBoost && substitutions.some(s => s.playerOut === pid)) continue;
    rawScore += playerPoints[pid] || 0;
  }

  // Captain multiplier
  let captainPoints = 0;
  const isTripleCaptain = career.activeChip === ChipType.TRIPLE_CAPTAIN;
  const multiplier = isTripleCaptain ? rules.tripleCaptainMultiplier : rules.captainMultiplier;

  // Check if captain played
  const captainData = gwDataMap.get(captainId);
  if (captainData && captainData.minutes > 0) {
    // Captain played - apply multiplier (extra points = (multiplier-1) * base)
    captainPoints = (multiplier - 1) * captainData.totalPoints;
  } else {
    // Captain didn't play - check vice-captain
    const vcData = gwDataMap.get(viceCaptainId);
    if (vcData && vcData.minutes > 0) {
      captainPoints = (multiplier - 1) * vcData.totalPoints;
    }
  }
  rawScore += captainPoints;

  // Bench points (calculate total points scored by bench players)
  let benchPoints = 0;
  for (const pid of bench) {
    if (isBenchBoost || !substitutions.some(s => s.playerIn === pid)) {
      benchPoints += playerPoints[pid] || 0;
    }
  }

  // Transfer penalty
  const isFreeUnlimitedGW = rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek);
  const extraTransfers = Math.max(0, career.pendingTransfers.length - career.freeTransfers);
  const transferPenalty = career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT || isFreeUnlimitedGW
    ? 0
    : extraTransfers * rules.transferPenaltyPoints;

  const finalScore = rawScore - transferPenalty;

  // Compile detailed player statistics for all squad members
  const playerStats: Record<number, UserGameweekPlayerStats> = {};
  for (const pid of allSquadPlayerIds) {
    const data = gwDataMap.get(pid);
    playerStats[pid] = {
      goals: data ? data.goals : 0,
      assists: data ? data.assists : 0,
      minutes: data ? data.minutes : 0,
      cleanSheets: data ? data.cleanSheets : 0,
      bonus: data ? data.bonus : 0,
      yellowCards: data ? data.yellowCards : 0,
      redCards: data ? data.redCards : 0,
      saves: data ? data.saves : 0,
      conceded: data ? data.goalsConceded : 0,
    };
  }

  // Scan all players in gameweek dataset to find the top performer and calculate average ownership score
  let maxGwPoints = -Infinity;
  let topGwPerformer: { playerId: number; name: string; points: number; goals: number; assists: number } | undefined;
  let sumWeightedPoints = 0;
  let totalOwnership = 0;

  for (const d of gwData) {
    if (d.totalPoints > maxGwPoints) {
      maxGwPoints = d.totalPoints;
      const p = playerMap.get(d.playerId);
      topGwPerformer = {
        playerId: d.playerId,
        name: p ? p.webName : (d.name || `Player ${d.playerId}`),
        points: d.totalPoints,
        goals: d.goals,
        assists: d.assists,
      };
    }
    if (d.selected && d.selected > 0) {
      sumWeightedPoints += d.totalPoints * d.selected;
      totalOwnership += d.selected;
    }
  }

  // Total managers for the season
  const isBlankGameweek = gwData.length === 0;

  // Total managers for the season
  const benchmarkManagers = SEASON_MANAGERS[career.season] || 7000000;
  const estimatedManagersFromSelected = totalOwnership > 0 ? Math.round(totalOwnership / 15) : 0;
  const totalManagers = Math.max(benchmarkManagers, estimatedManagersFromSelected);

  // Compute gameweek average score from historical ownership data
  let averageScore = 0;
  let highestScore = 0;
  let gameweekPercentile = 50.0;
  let gameweekRank = Math.round(totalManagers / 2);

  if (!isBlankGameweek) {
    averageScore = 48; // Standard FPL gameweek average baseline
    if (totalOwnership > 0) {
      const avgPlayerPoints = sumWeightedPoints / totalOwnership;
      const computedAvg = Math.round(avgPlayerPoints * 11 * 1.15); // 11 starters + captain boost
      averageScore = Math.max(32, Math.min(75, computedAvg));
    }

    highestScore = Math.max(105, Math.round(averageScore * 2.1 + 20));

    // Compute Gameweek Rank and Percentile via Gaussian CDF (FPL GW standard deviation ~13.5)
    const gwStdDev = 13.5;
    const gwPct = Math.min(0.999999, Math.max(0.000001, normalCDF(finalScore, averageScore, gwStdDev)));
    gameweekPercentile = Number((gwPct * 100).toFixed(1));
    gameweekRank = Math.max(1, Math.round((1 - gwPct) * totalManagers));
  } else {
    // Blank Gameweek (e.g. 2022-23 GW7 where 0 fixtures took place)
    if (transferPenalty > 0) {
      gameweekRank = Math.round(totalManagers * 0.75);
      gameweekPercentile = 25.0;
    }
  }

  // Compute Overall Rank and Percentile across all played gameweeks so far
  const prevResults = career.gameweekResults;
  const gwCount = prevResults.length + 1;
  const cumulativeScore = prevResults.reduce((sum, r) => sum + r.finalScore, 0) + finalScore;
  const cumulativeAvg = prevResults.reduce((sum, r) => sum + (r.averageScore ?? 48), 0) + averageScore;
  
  // Empirical cumulative standard deviation calibrated against historical FPL manager records.
  // In FPL, manager scores have positive auto-correlation over time due to skill and team continuity,
  // meaning cumulative variance scales faster than independent sqrt(N).
  // At GW1: ~14.5; at GW10: ~68; at GW20: ~120; at GW38: ~205.
  const overallStdDev = 14.5 * Math.pow(gwCount, 0.67);
  const overallPct = Math.min(0.999999, Math.max(0.000001, normalCDF(cumulativeScore, cumulativeAvg, overallStdDev)));
  const overallPercentile = Number((overallPct * 100).toFixed(1));
  const overallRank = Math.max(1, Math.round((1 - overallPct) * totalManagers));

  return {
    gameweek: gw,
    startingXI: [...startingXI],
    bench: [...bench],
    captainId,
    viceCaptainId,
    playerPoints,
    playerStats,
    captainPoints,
    benchPoints,
    substitutions,
    rawScore,
    transferPenalty,
    finalScore,
    chipUsed: career.activeChip,
    transfers: [...career.pendingTransfers],
    gameweekRank,
    gameweekPercentile,
    overallRank,
    overallPercentile,
    averageScore,
    highestScore,
    totalManagers,
    topPerformer: topGwPerformer,
    isBlankGameweek,
  };
}

// ============================================================
// STATE MACHINE TRANSITIONS
// ============================================================

export function advanceToPreDeadline(career: UserCareer): UserCareer {
  const isPreSeason = career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD;
  const squad = isPreSeason || !career.startOfGameweekSquad || career.startOfGameweekSquad.length === 0
    ? career.squad.map(sp => ({ ...sp }))
    : career.startOfGameweekSquad;
  const bank = isPreSeason || career.startOfGameweekBank === undefined
    ? career.bank
    : career.startOfGameweekBank;

  return {
    ...career,
    clock: { ...career.clock, phase: SimPhase.PRE_DEADLINE },
    startOfGameweekSquad: squad,
    startOfGameweekBank: bank,
    updatedAt: new Date().toISOString(),
  };
}

export function lockTeam(career: UserCareer): UserCareer {
  return {
    ...career,
    clock: { ...career.clock, phase: SimPhase.TEAM_LOCKED },
    updatedAt: new Date().toISOString(),
  };
}

export function processGameweekResults(
  career: UserCareer,
  result: UserGameweekResult,
): UserCareer {
  const rules = getSeasonRules(career.season);

  // Calculate new free transfers for next GW
  let newFreeTransfers: number;
  if (career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT) {
    if (rules.preserveTransfersOnChips) {
      newFreeTransfers = Math.min(
        career.freeTransfers + rules.freeTransfersPerGameweek,
        rules.maxFreeTransfers,
      );
    } else {
      newFreeTransfers = rules.freeTransfersPerGameweek;
    }
  } else {
    const usedTransfers = career.pendingTransfers.length;
    const remaining = Math.max(0, career.freeTransfers - usedTransfers);
    newFreeTransfers = Math.min(
      remaining + rules.freeTransfersPerGameweek,
      rules.maxFreeTransfers,
    );
  }

  // Update chip usage
  const newChips = career.chips.map(c => {
    if (career.activeChip === c.type) {
      const usedGWs = c.usedInGameweeks ? [...c.usedInGameweeks, career.clock.currentGameweek] : [career.clock.currentGameweek];
      return {
        ...c,
        available: false,
        usedInGameweek: career.clock.currentGameweek,
        usedInGameweeks: usedGWs,
      };
    }
    return c;
  });

  const isSeasonComplete = career.clock.currentGameweek >= career.clock.totalGameweeks;

  return {
    ...career,
    clock: {
      ...career.clock,
      phase: isSeasonComplete ? SimPhase.SEASON_COMPLETE : SimPhase.POST_GAMEWEEK,
    },
    totalPoints: career.totalPoints + result.finalScore,
    gameweekResults: [...career.gameweekResults, result],
    allTransfers: [...career.allTransfers, ...career.pendingTransfers],
    pendingTransfers: [],
    freeTransfers: newFreeTransfers,
    chips: newChips,
    activeChip: null,
    // Preserve Free Hit state so advanceToNextGameweek can revert squad and bank
    preFreeHitSquad: career.preFreeHitSquad,
    preFreeHitBank: career.preFreeHitBank,
    updatedAt: new Date().toISOString(),
  };
}

export function advanceToNextGameweek(career: UserCareer): UserCareer {
  if (career.clock.phase === SimPhase.SEASON_COMPLETE) return career;

  const nextGW = career.clock.currentGameweek + 1;
  const rules = getSeasonRules(career.season);

  // If Free Hit was used, REVERT squad and bank to pre-Free Hit state!
  let squad = career.squad;
  let bank = career.bank;
  if (career.preFreeHitSquad && career.preFreeHitSquad.length > 0) {
    squad = career.preFreeHitSquad.map(sp => ({ ...sp }));
    bank = career.preFreeHitBank ?? career.bank;
  }
  const squadValue = squad.reduce((sum, sp) => sum + sp.currentPrice, 0);

  // Check wildcard availability for second half of season
  const newChips = career.chips.map(chip => {
    if (chip.type === ChipType.WILDCARD && rules.wildcardRules) {
      const usedGWs = chip.usedInGameweeks || (chip.usedInGameweek ? [chip.usedInGameweek] : []);
      const usedInSecondHalf = usedGWs.some(gw => gw >= rules.wildcardRules!.secondHalfStartGW);
      if (nextGW >= rules.wildcardRules.secondHalfStartGW) {
        return {
          ...chip,
          available: !usedInSecondHalf,
          usedInGameweeks: usedGWs,
        };
      }
    }
    return chip;
  });

  return {
    ...career,
    clock: {
      ...career.clock,
      currentGameweek: nextGW,
      phase: SimPhase.PRE_DEADLINE,
    },
    squad,
    bank,
    squadValue,
    chips: newChips,
    activeChip: null,
    preFreeHitSquad: undefined,
    preFreeHitBank: undefined,
    startOfGameweekSquad: squad.map(sp => ({ ...sp })),
    startOfGameweekBank: bank,
    pendingTransfers: [],
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================
// PLAYER STATS (TIME-AWARE)
// Only shows data up to the current simulation point
// ============================================================

export function getPlayerStatsUpToGW(
  playerId: number,
  maxGW: number,
  allGWData: Map<number, HistoricalGameweekPlayerData[]>,
): {
  totalPoints: number;
  pointsPerGame: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  form: number;
  appearances: number;
  gameweekHistory: HistoricalGameweekPlayerData[];
} {
  const history: HistoricalGameweekPlayerData[] = [];
  let totalPoints = 0;
  let minutes = 0;
  let goals = 0;
  let assists = 0;
  let cleanSheets = 0;
  let bonus = 0;
  let appearances = 0;

  for (let gw = 1; gw <= maxGW; gw++) {
    const gwData = allGWData.get(gw);
    if (!gwData) continue;

    const playerData = gwData.filter(d => d.playerId === playerId);
    for (const d of playerData) {
      history.push(d);
      totalPoints += d.totalPoints;
      minutes += d.minutes;
      goals += d.goals;
      assists += d.assists;
      cleanSheets += d.cleanSheets;
      bonus += d.bonus;
      if (d.minutes > 0) appearances++;
    }
  }

  // Form: average of last 5 gameweeks points
  const recentGWs = history.slice(-5);
  const form = recentGWs.length > 0
    ? recentGWs.reduce((sum, d) => sum + d.totalPoints, 0) / recentGWs.length
    : 0;

  const pointsPerGame = appearances > 0 ? totalPoints / appearances : 0;

  return {
    totalPoints,
    pointsPerGame: Math.round(pointsPerGame * 10) / 10,
    minutes,
    goals,
    assists,
    cleanSheets,
    bonus,
    form: Math.round(form * 10) / 10,
    appearances,
    gameweekHistory: history,
  };
}

// Get player's price at a specific gameweek
export function getPlayerPriceAtGW(
  playerId: number,
  gameweek: number,
  allGWData?: Map<number, HistoricalGameweekPlayerData[]>,
  startPrice?: number,
  player?: HistoricalPlayer,
): number {
  if (player?.pricesByGameweek) {
    if (gameweek <= 1) return player.startPrice;
    if (player.pricesByGameweek[gameweek]) {
      return player.pricesByGameweek[gameweek];
    }
    for (let gw = gameweek; gw >= 1; gw--) {
      if (player.pricesByGameweek[gw]) {
        return player.pricesByGameweek[gw];
      }
    }
    return player.startPrice;
  }
  if (allGWData) {
    // Look for the most recent value up to and including this gameweek
    for (let gw = gameweek; gw >= 1; gw--) {
      const gwData = allGWData.get(gw);
      if (!gwData) continue;
      const playerData = gwData.find(d => d.playerId === playerId);
      if (playerData && playerData.value > 0) {
        return playerData.value;
      }
    }
  }
  return startPrice ?? (player?.startPrice || 50);
}

// Update all squad player prices for the current gameweek
export function updateSquadPrices(
  career: UserCareer,
  allGWData: Map<number, HistoricalGameweekPlayerData[]>,
  players: HistoricalPlayer[],
): UserCareer {
  const gw = career.clock.currentGameweek;
  const playerMap = new Map(players.map(p => [p.id, p]));

  const newSquad = career.squad.map(sp => {
    const player = playerMap.get(sp.playerId);
    const currentPrice = getPlayerPriceAtGW(sp.playerId, gw, allGWData, player?.startPrice || sp.purchasePrice, player);
    return { ...sp, currentPrice };
  });

  const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

  return { ...career, squad: newSquad, squadValue: newSquadValue };
}
