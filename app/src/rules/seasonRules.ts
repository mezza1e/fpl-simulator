// ============================================================
// SEASON RULES ENGINE
// Historical FPL rules, data-driven per season
// ============================================================

import {
  Position,
  ChipType,
} from '../models/types';
import type {
  SeasonRules,
  ScoringRule,
  PositionRequirement,
} from '../models/types';

const VALID_FORMATIONS = [
  '3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1',
  '5-3-2', '5-4-1', '5-2-3',
];

const DEFAULT_POSITION_REQUIREMENTS: PositionRequirement[] = [
  { position: Position.GKP, squadMin: 2, squadMax: 2, startingMin: 1, startingMax: 1 },
  { position: Position.DEF, squadMin: 5, squadMax: 5, startingMin: 3, startingMax: 5 },
  { position: Position.MID, squadMin: 5, squadMax: 5, startingMin: 2, startingMax: 5 },
  { position: Position.FWD, squadMin: 3, squadMax: 3, startingMin: 1, startingMax: 3 },
];

function makeScoring(position: Position): ScoringRule {
  const base: ScoringRule = {
    position,
    goalPoints: 0,
    assistPoints: 3,
    cleanSheetPoints: 0,
    goalsConcededPenalty: -1,
    goalsConcededThreshold: 2,
    savesPoints: 1,
    savesThreshold: 3,
    penaltySavePoints: 5,
    penaltyMissPoints: -2,
    yellowCardPoints: -1,
    redCardPoints: -3,
    ownGoalPoints: -2,
    minutesPlayed1: 1,
    minutesPlayed60: 2,
  };

  switch (position) {
    case Position.GKP:
      base.goalPoints = 6;
      base.cleanSheetPoints = 4;
      break;
    case Position.DEF:
      base.goalPoints = 6;
      base.cleanSheetPoints = 4;
      base.savesPoints = 0;
      base.savesThreshold = 0;
      break;
    case Position.MID:
      base.goalPoints = 5;
      base.cleanSheetPoints = 1;
      base.goalsConcededPenalty = 0;
      base.goalsConcededThreshold = 0;
      base.savesPoints = 0;
      base.savesThreshold = 0;
      break;
    case Position.FWD:
      base.goalPoints = 4;
      base.cleanSheetPoints = 0;
      base.goalsConcededPenalty = 0;
      base.goalsConcededThreshold = 0;
      base.savesPoints = 0;
      base.savesThreshold = 0;
      break;
  }
  return base;
}

const DEFAULT_SCORING: ScoringRule[] = [
  makeScoring(Position.GKP),
  makeScoring(Position.DEF),
  makeScoring(Position.MID),
  makeScoring(Position.FWD),
];

// Historical season configurations
// Sources: Official FPL rules history and community documentation
const SEASON_RULES: Record<string, Partial<SeasonRules>> = {
  '2016-17': {
    startingBudget: 1000, // £100.0m
    availableChips: [ChipType.WILDCARD, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    // Free Hit was not available in 2016-17
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
  },
  '2017-18': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
  },
  '2018-19': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
  },
  '2019-20': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
  },
  '2020-21': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 16, secondHalfStartGW: 17 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
  },
  '2021-22': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
  },
  '2022-23': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 16, secondHalfStartGW: 17 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
    unlimitedTransfersGameweeks: [17], // Qatar World Cup break unlimited free transfers
  },
  '2023-24': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 2,
    preserveTransfersOnChips: false,
  },
  '2024-25': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 5, // Rollover cap raised to 5 starting in 2024-25
    preserveTransfersOnChips: true, // Wildcard / Free Hit no longer wipes accumulated transfers
  },
  '2025-26': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 5,
    preserveTransfersOnChips: true,
  },
  '2026-27': {
    startingBudget: 1000,
    availableChips: [ChipType.WILDCARD, ChipType.FREE_HIT, ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN],
    wildcardRules: { firstHalfDeadlineGW: 19, secondHalfStartGW: 20 },
    maxFreeTransfers: 5,
    preserveTransfersOnChips: true,
  },
};

export function getSeasonRules(season: string): SeasonRules {
  const overrides = SEASON_RULES[season] || {};

  const rules: SeasonRules = {
    season,
    startingBudget: overrides.startingBudget ?? 1000,
    squadSize: 15,
    startingXISize: 11,
    benchSize: 4,
    maxPlayersPerClub: 3,
    positionRequirements: overrides.positionRequirements ?? DEFAULT_POSITION_REQUIREMENTS,
    freeTransfersAtStart: 1,
    freeTransfersPerGameweek: 1,
    maxFreeTransfers: overrides.maxFreeTransfers ?? 2,
    transferPenaltyPoints: 4,
    captainMultiplier: 2,
    tripleCaptainMultiplier: 3,
    scoring: overrides.scoring ?? DEFAULT_SCORING,
    availableChips: overrides.availableChips ?? [
      ChipType.WILDCARD, ChipType.FREE_HIT,
      ChipType.BENCH_BOOST, ChipType.TRIPLE_CAPTAIN,
    ],
    validFormations: overrides.validFormations ?? VALID_FORMATIONS,
    wildcardRules: overrides.wildcardRules ?? {
      firstHalfDeadlineGW: 19,
      secondHalfStartGW: 20,
    },
    preserveTransfersOnChips: overrides.preserveTransfersOnChips ?? false,
    unlimitedTransfersGameweeks: overrides.unlimitedTransfersGameweeks,
  };

  return rules;
}

export function getScoringForPosition(rules: SeasonRules, position: Position): ScoringRule {
  return rules.scoring.find(s => s.position === position) || makeScoring(position);
}

export function isFormationValid(
  rules: SeasonRules,
  defCount: number,
  midCount: number,
  fwdCount: number,
): boolean {
  const formation = `${defCount}-${midCount}-${fwdCount}`;
  return rules.validFormations.includes(formation);
}

export function getPositionRequirement(
  rules: SeasonRules,
  position: Position,
): PositionRequirement {
  return rules.positionRequirements.find(p => p.position === position)!;
}

export function getAvailableSeasons(): string[] {
  return Object.keys(SEASON_RULES).sort();
}
