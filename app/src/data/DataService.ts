import type { HistoricalPlayer, HistoricalTeam, HistoricalFixture } from '../models/types';

export interface SeasonInfo {
  id: string;
  label: string;
  totalGameweeks: number;
  playerCount: number;
  teamCount: number;
}

export interface SeasonData {
  season: string;
  teams: HistoricalTeam[];
  players: HistoricalPlayer[];
  fixtures: HistoricalFixture[];
  totalGameweeks: number;
}

export interface GameweekPlayerData {
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

export class DataService {
  private static instance: DataService;

  private seasonsCache: SeasonInfo[] | null = null;
  private seasonDataCache: Map<string, SeasonData> = new Map();
  private gameweekDataCache: Map<string, GameweekPlayerData[]> = new Map();

  private constructor() {}

  public static getInstance(): DataService {
    if (!DataService.instance) {
      DataService.instance = new DataService();
    }
    return DataService.instance;
  }

  private getBaseUrl(): string {
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';
    return base.endsWith('/') ? base : `${base}/`;
  }

  public async loadSeasons(): Promise<SeasonInfo[]> {
    if (this.seasonsCache) {
      return this.seasonsCache;
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}data/seasons.json`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: SeasonInfo[] = await response.json();
      this.seasonsCache = data;
      return data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Failed to load seasons data:', msg);
      throw new Error(`Failed to load seasons data: ${msg}`);
    }
  }

  public async loadSeasonData(season: string): Promise<SeasonData> {
    if (this.seasonDataCache.has(season)) {
      return this.seasonDataCache.get(season)!;
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}data/${season}/season.json`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: SeasonData = await response.json();
      this.seasonDataCache.set(season, data);
      return data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load season data for ${season}:`, msg);
      throw new Error(`Failed to load season data for ${season}: ${msg}`);
    }
  }

  public async loadGameweekData(season: string, gameweek: number): Promise<GameweekPlayerData[]> {
    const cacheKey = `${season}_gw${gameweek}`;

    if (this.gameweekDataCache.has(cacheKey)) {
      return this.gameweekDataCache.get(cacheKey)!;
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}data/${season}/gw${gameweek}.json`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: GameweekPlayerData[] = await response.json();
      this.gameweekDataCache.set(cacheKey, data);
      return data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load gameweek data for season ${season}, GW ${gameweek}:`, msg);
      throw new Error(`Failed to load gameweek data for season ${season}, GW ${gameweek}: ${msg}`);
    }
  }

  public async loadGameweeksUpTo(season: string, maxGameweek: number): Promise<Map<number, GameweekPlayerData[]>> {
    const result = new Map<number, GameweekPlayerData[]>();

    const fetchPromises: Promise<{ gw: number; data: GameweekPlayerData[] }>[] = [];

    for (let gw = 1; gw <= maxGameweek; gw++) {
      fetchPromises.push(
        this.loadGameweekData(season, gw).then((data) => ({ gw, data }))
      );
    }

    try {
      const allGwData = await Promise.all(fetchPromises);
      for (const item of allGwData) {
        result.set(item.gw, item.data);
      }
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load gameweeks up to ${maxGameweek} for season ${season}:`, msg);
      throw error;
    }
  }

  public clearCache(): void {
    this.seasonsCache = null;
    this.seasonDataCache.clear();
    this.gameweekDataCache.clear();
  }
}
