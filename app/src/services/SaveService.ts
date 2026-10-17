// ============================================================
// SAVE SERVICE - Persistent local saves using localStorage
// ============================================================

import type { UserCareer } from '../models/types';

const SAVE_KEY_PREFIX = 'fpl_sim_career_';
const SAVE_INDEX_KEY = 'fpl_sim_careers';
const ACTIVE_CAREER_KEY = 'fpl_sim_active_career_id';

export interface SaveInfo {
  id: string;
  name: string;
  season: string;
  gameweek: number;
  totalPoints: number;
  updatedAt: string;
  createdAt: string;
}

export class SaveService {
  private static instance: SaveService;

  static getInstance(): SaveService {
    if (!SaveService.instance) {
      SaveService.instance = new SaveService();
    }
    return SaveService.instance;
  }

  getActiveCareerId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_CAREER_KEY);
    } catch {
      return null;
    }
  }

  setActiveCareerId(id: string | null): void {
    try {
      if (id) {
        localStorage.setItem(ACTIVE_CAREER_KEY, id);
      } else {
        localStorage.removeItem(ACTIVE_CAREER_KEY);
      }
    } catch {
      // Ignore
    }
  }

  getSaveList(): SaveInfo[] {
    try {
      const index = localStorage.getItem(SAVE_INDEX_KEY);
      if (!index) return [];
      const list = JSON.parse(index) as SaveInfo[];
      return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch {
      return [];
    }
  }

  saveCareer(career: UserCareer): void {
    try {
      // Save career data
      const key = SAVE_KEY_PREFIX + career.id;
      career.updatedAt = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(career));

      // Update index
      const saves = this.getSaveList();
      const info: SaveInfo = {
        id: career.id,
        name: career.name,
        season: career.season,
        gameweek: career.clock.currentGameweek,
        totalPoints: career.totalPoints,
        updatedAt: career.updatedAt,
        createdAt: career.createdAt,
      };

      const existingIdx = saves.findIndex(s => s.id === career.id);
      if (existingIdx >= 0) {
        saves[existingIdx] = info;
      } else {
        saves.push(info);
      }

      localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(saves));
      this.setActiveCareerId(career.id);
    } catch (e) {
      console.error('Failed to save career:', e);
      throw new Error('Failed to save career. Storage may be full.');
    }
  }

  loadCareer(id: string): UserCareer | null {
    try {
      const key = SAVE_KEY_PREFIX + id;
      const data = localStorage.getItem(key);
      if (!data) return null;

      const career = JSON.parse(data) as UserCareer;
      return career;
    } catch (e) {
      console.error('Failed to load career:', e);
      return null;
    }
  }

  deleteCareer(id: string): void {
    try {
      const key = SAVE_KEY_PREFIX + id;
      localStorage.removeItem(key);

      const saves = this.getSaveList().filter(s => s.id !== id);
      localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(saves));

      if (this.getActiveCareerId() === id) {
        this.setActiveCareerId(null);
      }
    } catch (e) {
      console.error('Failed to delete career:', e);
    }
  }

  deleteAllCareers(): void {
    try {
      const saves = this.getSaveList();
      for (const save of saves) {
        localStorage.removeItem(SAVE_KEY_PREFIX + save.id);
      }
      localStorage.removeItem(SAVE_INDEX_KEY);
      this.setActiveCareerId(null);
    } catch (e) {
      console.error('Failed to delete all careers:', e);
    }
  }

  exportCareer(id: string): string | null {
    try {
      const career = this.loadCareer(id);
      if (!career) return null;
      return JSON.stringify(career, null, 2);
    } catch {
      return null;
    }
  }

  importCareer(jsonStr: string): UserCareer | null {
    try {
      const career = JSON.parse(jsonStr) as UserCareer;
      if (!career.id || !career.season || !career.clock) {
        throw new Error('Invalid career data');
      }
      this.saveCareer(career);
      return career;
    } catch (e) {
      console.error('Failed to import career:', e);
      return null;
    }
  }
}
