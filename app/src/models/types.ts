// ============================================================
// CORE TYPES - Historical FPL Simulator
// ============================================================

// Player positions
export enum Position {
  GKP = 1,
  DEF = 2,
  MID = 3,
  FWD = 4,
}

export const PositionLabels: Record<Position, string> = {
  [Position.GKP]: 'GKP',
  [Position.DEF]: 'DEF',
  [Position.MID]: 'MID',
  [Position.FWD]: 'FWD',
};

export const PositionFullLabels: Record<Position, string> = {
  [Position.GKP]: 'Goalkeeper',
  [Position.DEF]: 'Defender',
  [Position.MID]: 'Midfielder',
  [Position.FWD]: 'Forward',
};

// Player availability status
export enum PlayerStatus {
  AVAILABLE = 'a',
  DOUBTFUL = 'd',
  INJURED = 'i',
  SUSPENDED = 's',
  UNAVAILABLE = 'u',
  UNKNOWN = 'n',
}

// Data provenance - tracks where information came from
export enum DataProvenance {
  VERIFIED_HISTORICAL = 'verified',
  HISTORICAL_STATUS = 'status',
  RECONSTRUCTED = 'reconstructed',
  UNAVAILABLE = 'unavailable',
}

// ============================================================
// HISTORICAL PLAYER DATA (NOT the user's team)
// ============================================================

export interface HistoricalPlayer {
  id: number;
  code: number;
  firstName: string;
  lastName: string;
  webName: string;
  position: Position;
  teamId: number;
  teamName: string;
  teamShortName: string;
  // Price in tenths (e.g., 100 = £10.0m)
  startPrice: number;
  // Status info (may be unavailable)
  status: PlayerStatus;
  news: string | null;
  newsAdded: string | null;
  chanceOfPlayingThisRound: number | null;
  chanceOfPlayingNextRound: number | null;
  reason?: string | null;
  expectedReturn?: string | null;
  weeksOut?: number | null;
  // Dynamic gameweek-by-gameweek availability timeline
  statusByGameweek?: Record<number, {
    status: PlayerStatus;
    chance: number | null;
    news: string | null;
    reason?: string | null;
    expectedReturn?: string | null;
    weeksOut?: number | null;
  }>;
  // Historical prices across gameweeks
  pricesByGameweek?: Record<number, number>;
  // Historical team across gameweeks (handles mid-season transfers)
  teamByGameweek?: Record<number, number>;
  // Season-level aggregates (only for data available up to current GW)
  provenance: DataProvenance;
}

export function getPlayerTeamId(player: HistoricalPlayer, gameweek?: number): number {
  if (gameweek && player.teamByGameweek && player.teamByGameweek[gameweek]) {
    return player.teamByGameweek[gameweek];
  }
  return player.teamId;
}

export function getPlayerTeam(
  player: HistoricalPlayer,
  teams: HistoricalTeam[] | Map<number, HistoricalTeam>,
  gameweek?: number
): HistoricalTeam | undefined {
  const tId = getPlayerTeamId(player, gameweek);
  if (teams instanceof Map) return teams.get(tId);
  return teams.find(t => t.id === tId);
}

export interface HistoricalGameweekPlayerData {
  playerId: number;
  gameweek: number;
  teamId?: number;
  totalPoints: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  bonus: number;
  bps: number;
  influence: number | null;
  creativity: number | null;
  threat: number | null;
  ictIndex: number | null;
  // Value at this GW in tenths
  value: number;
  wasHome: boolean;
  opponentTeamId: number;
  kickoffTime: string | null;
  round: number;
  selected: number | null;
  transfersIn: number | null;
  transfersOut: number | null;
  name: string | null;
}

export interface HistoricalTeam {
  id: number;
  code: number;
  name: string;
  shortName: string;
  strength: number;
  strengthOverallHome: number;
  strengthOverallAway: number;
  strengthAttackHome: number;
  strengthAttackAway: number;
  strengthDefenceHome: number;
  strengthDefenceAway: number;
}

export interface HistoricalFixture {
  id: number;
  gameweek: number | null;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamShortName: string;
  awayTeamShortName: string;
  homeScore: number | null;
  awayScore: number | null;
  finished: boolean;
  kickoffTime: string | null;
}

// Price change record
export interface PriceChange {
  playerId: number;
  gameweek: number;
  oldPrice: number;
  newPrice: number;
}

// ============================================================
// USER FANTASY TEAM (completely separate from historical data)
// ============================================================

export interface UserSquadPlayer {
  playerId: number;
  purchasePrice: number; // in tenths
  currentPrice: number; // in tenths  
  isStarting: boolean;
  benchOrder: number; // 0 = starting, 1-4 = bench position
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface UserTransfer {
  gameweek: number;
  playerOutId: number;
  playerInId: number;
  playerOutPrice: number; // selling price in tenths
  playerInPrice: number; // buying price in tenths
  isFreeTransfer: boolean;
  originalSquadPlayer?: UserSquadPlayer; // Stored snapshot for exact restoration
}

export interface UserGameweekPlayerStats {
  goals: number;
  assists: number;
  minutes: number;
  cleanSheets: number;
  bonus: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  conceded: number;
}

export interface UserGameweekResult {
  gameweek: number;
  startingXI: number[]; // player IDs
  bench: number[]; // player IDs in bench order
  captainId: number;
  viceCaptainId: number;
  playerPoints: Record<number, number>; // playerId -> points earned
  playerStats?: Record<number, UserGameweekPlayerStats>; // playerId -> performance breakdown
  captainPoints: number; // extra points from captaincy
  benchPoints: number; // points from bench (for display)
  substitutions: Array<{ playerOut: number; playerIn: number }>;
  rawScore: number; // before transfer penalties
  transferPenalty: number;
  finalScore: number;
  chipUsed: ChipType | null;
  transfers: UserTransfer[];
  // Gameweek and Season Rank metrics
  gameweekRank?: number;
  gameweekPercentile?: number; // e.g. 96.5%
  overallRank?: number;
  overallPercentile?: number;
  averageScore?: number;
  highestScore?: number;
  totalManagers?: number;
  topPerformer?: {
    playerId: number;
    name: string;
    points: number;
    goals: number;
    assists: number;
  };
  isBlankGameweek?: boolean;
}

export enum ChipType {
  WILDCARD = 'wildcard',
  FREE_HIT = 'free_hit',
  BENCH_BOOST = 'bench_boost',
  TRIPLE_CAPTAIN = 'triple_captain',
}

export interface ChipState {
  type: ChipType;
  available: boolean;
  usedInGameweek: number | null;
  usedInGameweeks?: number[];
}

// ============================================================
// SIMULATION STATE
// ============================================================

export enum SimPhase {
  NEW_SEASON = 'NEW_SEASON',
  PRE_SEASON_TEAM_BUILD = 'PRE_SEASON_TEAM_BUILD',
  PRE_DEADLINE = 'PRE_DEADLINE',
  TEAM_LOCKED = 'TEAM_LOCKED',
  GAMEWEEK_RESULTS = 'GAMEWEEK_RESULTS',
  POST_GAMEWEEK = 'POST_GAMEWEEK',
  SEASON_COMPLETE = 'SEASON_COMPLETE',
}

export interface SimulationClock {
  season: string;
  currentGameweek: number;
  phase: SimPhase;
  totalGameweeks: number;
}

// ============================================================
// USER CAREER (complete state of a user's game)
// ============================================================

export interface UserCareer {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  season: string;
  clock: SimulationClock;
  // Squad
  squad: UserSquadPlayer[];
  // Finances
  bank: number; // in tenths
  // Points
  totalPoints: number;
  gameweekResults: UserGameweekResult[];
  // Transfers
  freeTransfers: number;
  pendingTransfers: UserTransfer[];
  allTransfers: UserTransfer[];
  // Chips
  chips: ChipState[];
  activeChip: ChipType | null;
  // Free Hit State (preserved for reversion when advancing to next gameweek)
  preFreeHitSquad?: UserSquadPlayer[];
  preFreeHitBank?: number;
  // Starting snapshot of squad & bank at beginning of current Gameweek
  startOfGameweekSquad?: UserSquadPlayer[];
  startOfGameweekBank?: number;
  // Removed players awaiting replacement or restoration
  removedPlayers?: Array<{ player: UserSquadPlayer; refundedPrice: number }>;
  // Meta
  squadValue: number; // calculated: sum of current prices
}

// ============================================================
// SEASON RULES (data-driven, per-season)
// ============================================================

export interface PositionRequirement {
  position: Position;
  squadMin: number;
  squadMax: number;
  startingMin: number;
  startingMax: number;
}

export interface ScoringRule {
  position: Position;
  goalPoints: number;
  assistPoints: number;
  cleanSheetPoints: number;
  goalsConcededPenalty: number; // per N goals conceded
  goalsConcededThreshold: number;
  savesPoints: number;
  savesThreshold: number;
  penaltySavePoints: number;
  penaltyMissPoints: number;
  yellowCardPoints: number;
  redCardPoints: number;
  ownGoalPoints: number;
  minutesPlayed1: number; // points for playing 1-59 mins
  minutesPlayed60: number; // points for playing 60+ mins
}

export interface SeasonRules {
  season: string;
  startingBudget: number; // in tenths (1000 = £100.0m)
  squadSize: number;
  startingXISize: number;
  benchSize: number;
  maxPlayersPerClub: number;
  positionRequirements: PositionRequirement[];
  freeTransfersAtStart: number;
  freeTransfersPerGameweek: number;
  maxFreeTransfers: number;
  transferPenaltyPoints: number; // per extra transfer
  captainMultiplier: number;
  tripleCaptainMultiplier: number;
  scoring: ScoringRule[];
  availableChips: ChipType[];
  wildcardRules: {
    firstHalfDeadlineGW: number; // last GW to use first wildcard
    secondHalfStartGW: number; // first GW for second wildcard
  };
  validFormations: string[]; // e.g., '3-4-3', '3-5-2', etc.
  preserveTransfersOnChips?: boolean; // In 2024-25+, Wildcard & Free Hit preserve accumulated free transfers
  unlimitedTransfersGameweeks?: number[]; // E.g. [17] in 2022-23 World Cup break
}

// ============================================================
// NORMALIZED SEASON DATA
// ============================================================

export interface NormalizedSeasonData {
  season: string;
  players: HistoricalPlayer[];
  teams: HistoricalTeam[];
  fixtures: HistoricalFixture[];
  gameweekData: Map<number, HistoricalGameweekPlayerData[]>;
  priceChanges: PriceChange[];
  totalGameweeks: number;
  rules: SeasonRules;
}

// ============================================================
// UI TYPES
// ============================================================

export type SortField = 'price' | 'totalPoints' | 'pointsPerGame' | 'form' | 
  'goals' | 'assists' | 'bonus' | 'minutes' | 'name' | 'cleanSheets';
export type SortDirection = 'asc' | 'desc';

export interface PlayerFilters {
  search: string;
  position: Position | null;
  teamId: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  sortBy: SortField;
  sortDir: SortDirection;
}

export interface PlayerViewStats {
  player: HistoricalPlayer;
  currentPrice: number;
  totalPoints: number;
  pointsPerGame: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  form: number;
  gameweekHistory: HistoricalGameweekPlayerData[];
  upcomingFixtures: HistoricalFixture[];
}

// Navigation
export enum AppPage {
  HOME = 'home',
  MY_TEAM = 'myTeam',
  TRANSFERS = 'transfers',
  PLAYERS = 'players',
  FIXTURES = 'fixtures',
  GAMEWEEKS = 'gameweeks',
  STATISTICS = 'statistics',
  HISTORY = 'history',
  SETTINGS = 'settings',
}

// Drag and Drop
export interface DragItem {
  type: 'player-list' | 'squad-starting' | 'squad-bench';
  playerId: number;
  sourceIndex?: number;
}
