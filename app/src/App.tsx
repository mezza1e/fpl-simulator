// ============================================================
// MAIN APPLICATION - Historical FPL Simulator
// Complete single-file application with all pages and state
// ============================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './styles/global.css';
import {
  SimPhase,
  Position,
  PositionLabels,
  PositionFullLabels,
  PlayerStatus,
  ChipType,
  AppPage,
  getPlayerTeamId,
  getPlayerTeam,
} from './models/types';
import type {
  UserCareer,
  UserSquadPlayer,
  UserTransfer,
  HistoricalPlayer,
  HistoricalFixture,
  PlayerFilters,
  SortField,
} from './models/types';
import { DataService } from './data/DataService';
import type { SeasonInfo, SeasonData, GameweekPlayerData } from './data/DataService';
import { getSeasonRules, getPositionRequirement } from './rules/seasonRules';
import {
  createNewCareer,
  validateSquad,
  canAddPlayer,
  addPlayerToSquad,
  swapPlayers,
  removePlayerFromSquad,
  setCaptain,
  setViceCaptain,
  autoArrangeSquad,
  sanitizeSquadFormation,
  calculatePitchEmptySlots,
  executeTransfer,
  previewTransfer,
  restoreTransfer,
  restoreRemovedPlayer,
  resetAllTransfers,
  calculateSellingPrice,
  getPlayerFinancials,
  calculateGameweekScore,
  lockTeam,
  processGameweekResults,
  advanceToNextGameweek,
  advanceToPreDeadline,
  getPlayerStatsUpToGW,
  getPlayerPriceAtGW,
  updateSquadPrices,
} from './engine/GameEngine';
import { SaveService } from './services/SaveService';
import type { SaveInfo } from './services/SaveService';
import {
  SearchIcon, FilterIcon, CloseIcon, ChevronDownIcon, ConfirmIcon,
  LockIcon, SaveIcon, LoadIcon, TrashIcon, NewIcon, PointsIcon,
  BankIcon, TeamIcon, CaptainIcon, ViceCaptainIcon, GameweekIcon,
  ChipIcon, ResetIcon, ArrowRightIcon, InfoIcon, EditIcon,
  PlusIcon, MinusIcon, SortAscIcon, SortDescIcon, WarningIcon,
  GoalIcon, AssistIcon, CleanSheetIcon, BonusIcon, CardIcon, StatsIcon, TransferIcon,
  InjuryIcon, CalendarIcon,
} from './components/icons/SvgIcons';

const dataService = DataService.getInstance();
const saveService = SaveService.getInstance();

// ============================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================

interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

let toastId = 0;

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => onRemove(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MAIN APP COMPONENT
// ============================================================

export default function App() {
  // ---- Application State ----
  const [page, setPage] = useState<AppPage>(AppPage.HOME);
  const [career, setCareer] = useState<UserCareer | null>(null);
  const [seasonData, setSeasonData] = useState<SeasonData | null>(null);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const isInitialMountRef = useRef(true);

  // ---- Gameweek Data Cache ----
  const [gwDataCache, setGwDataCache] = useState<Map<number, GameweekPlayerData[]>>(new Map());

  // ---- Player Map (for quick lookup with dynamic gameweek availability) ----
  const playerMap = useMemo(() => {
    if (!seasonData) return new Map<number, HistoricalPlayer>();
    const m = new Map<number, HistoricalPlayer>();
    const currentGW = career ? career.clock.currentGameweek : 1;
    seasonData.players.forEach(p => {
      const gwStatus = p.statusByGameweek?.[currentGW];
      if (gwStatus) {
        m.set(p.id, {
          ...p,
          status: gwStatus.status,
          chanceOfPlayingThisRound: gwStatus.chance,
          news: gwStatus.news,
          reason: gwStatus.reason,
          expectedReturn: gwStatus.expectedReturn,
          weeksOut: gwStatus.weeksOut,
        });
      } else {
        m.set(p.id, {
          ...p,
          status: p.statusByGameweek ? PlayerStatus.AVAILABLE : p.status,
          chanceOfPlayingThisRound: p.statusByGameweek ? 100 : p.chanceOfPlayingThisRound,
          news: p.statusByGameweek ? null : p.news,
          reason: null,
          expectedReturn: null,
          weeksOut: null,
        });
      }
    });
    return m;
  }, [seasonData, career?.clock.currentGameweek]);

  // ---- Price and Format Helpers ----
  const getCurrentPrice = useCallback((playerId: number) => {
    const p = playerMap.get(playerId);
    if (!p) return 0;
    if (!career) return p.startPrice;
    return career.clock.currentGameweek <= 1
      ? p.startPrice
      : getPlayerPriceAtGW(playerId, career.clock.currentGameweek, gwDataCache, p.startPrice, p);
  }, [career, playerMap, gwDataCache]);

  const formatPrice = useCallback((tenths: number) => `£${(tenths / 10).toFixed(1)}m`, []);

  // ---- Player Filters ----
  const [filters, setFilters] = useState<PlayerFilters>({
    search: '',
    position: null,
    teamId: null,
    minPrice: null,
    maxPrice: null,
    sortBy: 'price',
    sortDir: 'desc',
  });

  // ---- Player Detail Modal ----
  const [detailPlayerId, setDetailPlayerId] = useState<number | null>(null);

  // ---- Transfer Mode ----
  const [transferOutId, setTransferOutId] = useState<number | null>(null);

  // ---- Context Menu ----
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; playerId: number;
  } | null>(null);

  // ---- GW Results for display ----
  const [currentGWResults, setCurrentGWResults] = useState<ReturnType<typeof calculateGameweekScore> | null>(null);

  // ---- Drag and Drop State ----
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverPlayerId, setDragOverPlayerId] = useState<number | null>(null);
  const [dragOverSlotKey, setDragOverSlotKey] = useState<string | null>(null);
  const activeDragPlayerRef = useRef<{ id: number; source: 'player-list' | 'squad' } | null>(null);
  const justDraggedRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const hasActuallyDraggedRef = useRef<boolean>(false);

  const createDragGhost = useCallback((player: HistoricalPlayer, priceStr: string, e: React.DragEvent) => {
    if (!e.dataTransfer || !e.dataTransfer.setDragImage) return;
    const existing = document.getElementById('fpl-custom-drag-ghost');
    if (existing) existing.remove();

    const ghost = document.createElement('div');
    ghost.id = 'fpl-custom-drag-ghost';
    ghost.style.position = 'fixed';
    ghost.style.left = '-9999px';
    ghost.style.top = '-9999px';
    ghost.style.zIndex = '999999';
    ghost.style.pointerEvents = 'none';
    ghost.style.display = 'flex';
    ghost.style.alignItems = 'center';
    ghost.style.gap = '8px';
    ghost.style.padding = '8px 14px';
    ghost.style.background = '#0f172a';
    ghost.style.border = '2px solid #38bdf8';
    ghost.style.borderRadius = '8px';
    ghost.style.boxShadow = '0 10px 25px rgba(0,0,0,0.8), 0 0 15px rgba(56,189,248,0.5)';
    ghost.style.color = '#ffffff';
    ghost.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    ghost.style.fontSize = '12px';
    ghost.style.fontWeight = 'bold';
    ghost.style.whiteSpace = 'nowrap';

    const posColors: Record<number, string> = {
      1: '#eab308',
      2: '#10b981',
      3: '#06b6d4',
      4: '#ef4444',
    };
    const posColor = posColors[player.position] || '#38bdf8';

    ghost.innerHTML = `
      <span style="background:${posColor};color:#000000;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:900;text-transform:uppercase;">
        ${PositionLabels[player.position]}
      </span>
      <span style="color:#ffffff;font-size:13px;font-weight:800;letter-spacing:0.3px;">
        ${player.webName}
      </span>
      <span style="color:#94a3b8;font-size:11px;font-weight:600;">
        ${player.teamShortName || ''}
      </span>
      <span style="color:#38bdf8;font-size:12px;font-weight:800;">
        ${priceStr}
      </span>
    `;

    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 40, 20);
    setTimeout(() => {
      ghost.remove();
    }, 100);
  }, []);

  useEffect(() => {
    const handleWindowDragEnd = () => {
      setIsDragging(false);
      setDragOverPlayerId(null);
      setDragOverSlotKey(null);
      const existing = document.getElementById('fpl-custom-drag-ghost');
      if (existing) existing.remove();
    };
    window.addEventListener('dragend', handleWindowDragEnd);
    window.addEventListener('drop', handleWindowDragEnd);
    return () => {
      window.removeEventListener('dragend', handleWindowDragEnd);
      window.removeEventListener('drop', handleWindowDragEnd);
    };
  }, []);

  // Toast helper
  const addToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ---- Load seasons on mount and auto-resume active career ----
  useEffect(() => {
    (async () => {
      try {
        const s = await dataService.loadSeasons();
        setSeasons(s);
        const saveList = saveService.getSaveList();
        setSaves(saveList);

        // Auto-resume active career if present
        const activeId = saveService.getActiveCareerId();
        if (activeId) {
          const loaded = saveService.loadCareer(activeId);
          if (loaded) {
            const data = await dataService.loadSeasonData(loaded.season);
            setSeasonData(data);
            const pMap = new Map(data.players.map(p => [p.id, p]));
            const sanitized = sanitizeSquadFormation(loaded, pMap);
            setCareer(sanitized);
            const isCompleted = loaded.clock.phase === SimPhase.POST_GAMEWEEK || loaded.clock.phase === SimPhase.SEASON_COMPLETE;
            const maxGW = isCompleted ? loaded.clock.currentGameweek : loaded.clock.currentGameweek - 1;
            if (maxGW > 0) {
              const gwCache = await dataService.loadGameweeksUpTo(loaded.season, maxGW);
              setGwDataCache(gwCache);
            }
            if (loaded.clock.phase === SimPhase.POST_GAMEWEEK && loaded.gameweekResults.length > 0) {
              setCurrentGWResults(loaded.gameweekResults[loaded.gameweekResults.length - 1]);
              setPage(AppPage.GAMEWEEKS);
            } else {
              setPage(AppPage.MY_TEAM);
            }
            setLastSavedTime(new Date(loaded.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          }
        }
      } catch (e) {
        addToast('Failed to load seasons data', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [addToast]);

  // Debounced autosave whenever career mutations occur
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (!career) return;

    setIsAutosaving(true);
    const timer = setTimeout(() => {
      try {
        saveService.saveCareer(career);
        setSaves(saveService.getSaveList());
        setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (err) {
        console.error('Autosave error:', err);
      } finally {
        setIsAutosaving(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [career]);

  // Self-heal squad formation if bench overflows (> 4) or starters < 11 with full squad (15)
  useEffect(() => {
    if (!career || !playerMap || playerMap.size === 0) return;
    const bench = career.squad.filter(s => !s.isStarting);
    const starters = career.squad.filter(s => s.isStarting);
    const hasExcessBench = bench.length > 4;
    const hasDeficitStarters = career.squad.length === 15 && starters.length < 11;
    if (hasExcessBench || hasDeficitStarters) {
      const sanitized = sanitizeSquadFormation(career, playerMap);
      if (sanitized !== career) {
        setCareer(sanitized);
      }
    }
  }, [career, playerMap]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // ---- Load season data when career changes ----
  const loadSeasonData = useCallback(async (season: string) => {
    setLoading(true);
    try {
      const data = await dataService.loadSeasonData(season);
      setSeasonData(data);
    } catch (e) {
      addToast('Failed to load season data', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Ensure seasonData and fixtures are loaded if missing or season mismatches
  useEffect(() => {
    if (career && (!seasonData || seasonData.season !== career.season || seasonData.fixtures.length === 0)) {
      dataService.clearCache();
      dataService.loadSeasonData(career.season).then(data => {
        setSeasonData(data);
      }).catch(err => {
        console.error('Failed to ensure season data fixtures:', err);
      });
    }
  }, [career, seasonData]);

  // ---- Load gameweek data up to current GW ----
  const loadGameweekDataUpTo = useCallback(async (season: string, maxGW: number) => {
    try {
      const data = await dataService.loadGameweeksUpTo(season, maxGW);
      setGwDataCache(data);
    } catch {
      // Some GWs may not exist - that's OK
    }
  }, []);

  // ---- START NEW CAREER ----
  const startNewCareer = useCallback(async (season: string) => {
    setLoading(true);
    try {
      const data = await dataService.loadSeasonData(season);
      setSeasonData(data);

      const newCareer = createNewCareer(season, `Career ${season.replace('-', '/')}`, data.totalGameweeks);
      setCareer(newCareer);
      saveService.saveCareer(newCareer);
      saveService.setActiveCareerId(newCareer.id);
      setSaves(saveService.getSaveList());
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setGwDataCache(new Map());
      setPage(AppPage.MY_TEAM);
      setCurrentGWResults(null);
      setTransferOutId(null);
      addToast(`Started new career: ${season.replace('-', '/')}`, 'success');
    } catch (e) {
      addToast('Failed to start career', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // ---- LOAD CAREER ----
  const loadCareer = useCallback(async (saveId: string) => {
    const loaded = saveService.loadCareer(saveId);
    if (!loaded) {
      addToast('Failed to load career', 'error');
      return;
    }
    setLoading(true);
    try {
      const data = await dataService.loadSeasonData(loaded.season);
      setSeasonData(data);
      const pMap = new Map(data.players.map(p => [p.id, p]));
      const sanitized = sanitizeSquadFormation(loaded, pMap);
      setCareer(sanitized);
      saveService.setActiveCareerId(loaded.id);

      // Load GW data up to current GW (including current GW if completed)
      const isCompleted = loaded.clock.phase === SimPhase.POST_GAMEWEEK || loaded.clock.phase === SimPhase.SEASON_COMPLETE;
      const maxGW = isCompleted ? loaded.clock.currentGameweek : loaded.clock.currentGameweek - 1;
      if (maxGW > 0) {
        await loadGameweekDataUpTo(loaded.season, maxGW);
      }

      if (loaded.clock.phase === SimPhase.POST_GAMEWEEK && loaded.gameweekResults.length > 0) {
        setCurrentGWResults(loaded.gameweekResults[loaded.gameweekResults.length - 1]);
        setPage(AppPage.GAMEWEEKS);
      } else {
        setPage(AppPage.MY_TEAM);
        setCurrentGWResults(null);
      }
      setLastSavedTime(new Date(loaded.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      addToast(`Loaded: ${loaded.name}`, 'success');
    } catch (e) {
      addToast('Failed to load career data', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, loadGameweekDataUpTo]);

  // ---- SAVE CAREER ----
  const saveCareer = useCallback(() => {
    if (!career) return;
    try {
      saveService.saveCareer(career);
      saveService.setActiveCareerId(career.id);
      setSaves(saveService.getSaveList());
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      addToast('Career saved', 'success');
    } catch {
      addToast('Failed to save career', 'error');
    }
  }, [career, addToast]);

  // ---- DELETE CAREER ----
  const deleteCareerSave = useCallback((saveId: string) => {
    saveService.deleteCareer(saveId);
    setSaves(saveService.getSaveList());
    addToast('Career deleted', 'info');
  }, [addToast]);

  // ---- EXIT TO MENU ----
  const handleExitToMenu = useCallback(() => {
    saveService.setActiveCareerId(null);
    setCareer(null);
    setSeasonData(null);
    setGwDataCache(new Map());
    setPage(AppPage.MY_TEAM);
    setCurrentGWResults(null);
    setSaves(saveService.getSaveList());
  }, []);

  // ---- PLAYER OPERATIONS ----
  const handleAddPlayer = useCallback((playerId: number, preferStarting?: boolean) => {
    if (!career || !seasonData) return;

    const player = playerMap.get(playerId);
    if (!player) return;

    const rules = getSeasonRules(career.season);
    const req = getPositionRequirement(rules, player.position);

    // Check squad position cap: cannot exceed max players for position
    const hasRemovedForPos = (career.removedPlayers || []).some(
      rp => playerMap.get(rp.player.playerId)?.position === player.position
    );
    const currentInPos = career.squad.filter(s => playerMap.get(s.playerId)?.position === player.position).length;
    if (!hasRemovedForPos && currentInPos >= req.squadMax) {
      addToast(`Cannot add ${player.webName}: already have maximum ${req.squadMax} ${PositionLabels[player.position]}s in squad.`, 'error');
      return;
    }

    // Get price at current time
    const currentGW = career.clock.currentGameweek;
    const price = currentGW <= 1
      ? player.startPrice
      : getPlayerPriceAtGW(playerId, currentGW, gwDataCache, player.startPrice, player);

    // If in pre-season and a player was removed awaiting replacement:
    let currentCareer = career;
    if (currentCareer.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD && currentCareer.removedPlayers && currentCareer.removedPlayers.length > 0) {
      const removedIdx = currentCareer.removedPlayers.findIndex(
        rp => playerMap.get(rp.player.playerId)?.position === player.position
      );
      if (removedIdx !== -1) {
        const newRemoved = currentCareer.removedPlayers.filter((_, idx) => idx !== removedIdx);
        currentCareer = { ...currentCareer, removedPlayers: newRemoved };
      }
    }

    // If in-season (GW > 1) and a player was removed awaiting replacement:
    if (career.clock.phase !== SimPhase.PRE_SEASON_TEAM_BUILD && career.removedPlayers && career.removedPlayers.length > 0) {
      // Find matching position removed player
      const removedIdx = career.removedPlayers.findIndex(
        rp => playerMap.get(rp.player.playerId)?.position === player.position
      );
      if (removedIdx === -1) {
        // If squad is full (15 players), user cannot add without a removed player to replace
        if (career.squad.length >= rules.squadSize) {
          addToast(`Cannot add ${player.webName}: squad is full (${rules.squadSize}/${rules.squadSize}) and no removed ${PositionLabels[player.position]} is awaiting replacement.`, 'error');
          return;
        }
        // If squad has open vacancies (career.squad.length < rules.squadSize), fall through to normal addition!
      } else {
        const removedEntry = career.removedPlayers[removedIdx];
        const useIdx = removedIdx;
        const outPlayer = playerMap.get(removedEntry.player.playerId);

      // Check club limit
      const currentGW = career.clock.currentGameweek;
      const targetTeamId = getPlayerTeamId(player, currentGW);
      const clubSquadPlayers = career.squad
        .map(s => playerMap.get(s.playerId))
        .filter((sp): sp is HistoricalPlayer => sp !== undefined && getPlayerTeamId(sp, currentGW) === targetTeamId);
      if (clubSquadPlayers.length >= rules.maxPlayersPerClub) {
        const teamObj = getPlayerTeam(player, seasonData?.teams || [], currentGW);
        const teamName = teamObj?.shortName || teamObj?.name || player.teamShortName || player.teamName;
        const names = clubSquadPlayers.map(p => p.webName).join(', ');
        addToast(`Cannot add ${player.webName}: Club limit reached (${rules.maxPlayersPerClub}/${rules.maxPlayersPerClub}) for ${teamName}. Squad already has: ${names}. Drag directly onto one to replace them.`, 'error');
        return;
      }

      // Budget check (career.bank already received refundedPrice from removePlayerFromSquad)
      if (career.bank - price < 0) {
        addToast(`Insufficient budget. Need £${(price / 10).toFixed(1)}m, have £${(career.bank / 10).toFixed(1)}m remaining.`, 'error');
        return;
      }

      const isChipActive = career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT;
      const isFreeUnlimitedGW = rules.unlimitedTransfersGameweeks?.includes(currentGW);

      // Check if removedEntry was itself brought in via a pending transfer this gameweek
      const existingTransferIndex = career.pendingTransfers.findIndex(
        t => t.playerInId === removedEntry.player.playerId
      );

      let updatedPendingTransfers: UserTransfer[];

      if (existingTransferIndex !== -1) {
        const existingTransfer = career.pendingTransfers[existingTransferIndex];

        // CASE A: User is picking the original player they sold this gameweek (reverting/undoing transfer)
        if (player.id === existingTransfer.playerOutId) {
          const restoredPlayerObj: UserSquadPlayer = existingTransfer.originalSquadPlayer
            ? { ...existingTransfer.originalSquadPlayer }
            : {
                playerId: existingTransfer.playerOutId,
                purchasePrice: existingTransfer.playerOutPrice,
                currentPrice: existingTransfer.playerOutPrice,
                isStarting: preferStarting !== undefined ? preferStarting : removedEntry.player.isStarting,
                benchOrder: removedEntry.player.benchOrder,
                isCaptain: false,
                isViceCaptain: false,
              };

          const newSquad = [...career.squad, restoredPlayerObj];
          const newBank = career.bank - existingTransfer.playerOutPrice;
          const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);
          const newRemoved = career.removedPlayers.filter((_, idx) => idx !== useIdx);
          const remainingTransfers = career.pendingTransfers.filter((_, i) => i !== existingTransferIndex);
          const recomputedTransfers = remainingTransfers.map((t, idx) => ({
            ...t,
            isFreeTransfer: isChipActive || isFreeUnlimitedGW || idx < career.freeTransfers,
          }));

          const updatedCareer: UserCareer = {
            ...career,
            squad: newSquad,
            bank: newBank,
            squadValue: newSquadValue,
            pendingTransfers: recomputedTransfers,
            removedPlayers: newRemoved,
            updatedAt: new Date().toISOString(),
          };

          setCareer(sanitizeSquadFormation(updatedCareer, playerMap));
          addToast(`Reverted transfer: restored ${outPlayer?.webName || 'Player'}`, 'success');
          return;
        }

        // CASE B: User is replacing removedEntry with a new playerIn (collapse into single transfer A -> C)
        const updatedTransfer: UserTransfer = {
          ...existingTransfer,
          playerInId: player.id,
          playerInPrice: price,
        };
        updatedPendingTransfers = career.pendingTransfers.map((t, i) =>
          i === existingTransferIndex ? updatedTransfer : t
        );
      } else {
        // Normal transfer (removedEntry was in squad at start of GW)
        const transfer: UserTransfer = {
          gameweek: currentGW,
          playerOutId: removedEntry.player.playerId,
          playerInId: player.id,
          playerOutPrice: removedEntry.refundedPrice,
          playerInPrice: price,
          isFreeTransfer: isChipActive || isFreeUnlimitedGW || career.pendingTransfers.length < career.freeTransfers,
          originalSquadPlayer: { ...removedEntry.player },
        };
        updatedPendingTransfers = [...career.pendingTransfers, transfer];
      }

      const newSquadPlayer: UserSquadPlayer = {
        playerId: player.id,
        purchasePrice: price,
        currentPrice: price,
        isStarting: preferStarting !== undefined ? preferStarting : removedEntry.player.isStarting,
        benchOrder: removedEntry.player.benchOrder,
        isCaptain: false,
        isViceCaptain: false,
      };

      const newSquad = [...career.squad, newSquadPlayer];
      const newBank = career.bank - price;
      const newSquadValue = newSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);
      const newRemoved = career.removedPlayers.filter((_, idx) => idx !== useIdx);

      const updatedCareer: UserCareer = {
        ...career,
        squad: newSquad,
        bank: newBank,
        squadValue: newSquadValue,
        pendingTransfers: updatedPendingTransfers,
        removedPlayers: newRemoved,
        updatedAt: new Date().toISOString(),
      };

      setCareer(sanitizeSquadFormation(updatedCareer, playerMap));
      addToast(`Transferred: ${outPlayer?.webName || 'Player'} → ${player.webName}`, 'success');
      return;
      }
    }

    const check = canAddPlayer(currentCareer.squad, player, playerMap, rules, currentCareer.bank, price, currentGW, seasonData?.teams);
    if (!check.allowed) {
      addToast(check.reason, 'error');
      return;
    }

    let updated = addPlayerToSquad(currentCareer, player, price, preferStarting, playerMap);
    updated = sanitizeSquadFormation(updated, playerMap);

    // If squad is now full, auto-arrange into default formation
    const rules2 = getSeasonRules(currentCareer.season);
    if (updated.squad.length === rules2.squadSize) {
      updated = autoArrangeSquad(updated, playerMap, rules2);
      addToast('Squad complete! Auto-arranged into 4-4-2. Adjust as needed.', 'success');
    } else {
      addToast(`Added ${player.webName} to squad`, 'success');
    }

    setCareer(updated);
  }, [career, seasonData, playerMap, gwDataCache, addToast]);

  const handleRemovePlayer = useCallback((playerId: number) => {
    if (!career) return;
    const p = playerMap.get(playerId);
    const sp = career.squad.find(s => s.playerId === playerId);
    const fin = sp ? getPlayerFinancials(sp, sp.currentPrice) : null;
    const updated = removePlayerFromSquad(career, playerId, playerMap);
    setCareer(sanitizeSquadFormation(updated, playerMap));
    if (fin && p) {
      if (fin.profit > 0) {
        addToast(`Sold ${p.webName} for ${formatPrice(fin.sellingPrice)} (Bought: ${formatPrice(fin.purchasePrice)}, Value: ${formatPrice(fin.currentPrice)}, Profit: +${formatPrice(fin.profit)} via FPL 50% rule)`, 'info');
      } else {
        addToast(`Sold ${p.webName} for ${formatPrice(fin.sellingPrice)}`, 'info');
      }
    }
  }, [career, playerMap, addToast]);

  const handleRestoreTransfer = useCallback((playerInId: number) => {
    if (!career) return;
    const res = restoreTransfer(career, playerInId, playerMap);
    if (res.success) {
      setCareer(res.career);
      addToast(`Restored ${res.restoredPlayer?.webName || 'player'} to squad`, 'success');
    }
  }, [career, playerMap, addToast]);

  const handleRestoreRemovedPlayer = useCallback((playerId: number, preferStarting?: boolean) => {
    if (!career) return;
    const rules = getSeasonRules(career.season);
    if (career.squad.length >= rules.squadSize) {
      addToast('Cannot restore player: squad is already full (15 players).', 'error');
      return;
    }
    const item = career.removedPlayers?.find(rp => rp.player.playerId === playerId);
    if (item && career.bank < item.refundedPrice) {
      addToast(`Cannot restore player: insufficient budget (£${(career.bank / 10).toFixed(1)}m available, need £${(item.refundedPrice / 10).toFixed(1)}m).`, 'error');
      return;
    }
    const p = playerMap.get(playerId);
    if (p) {
      const currentInPos = career.squad.filter(s => playerMap.get(s.playerId)?.position === p.position).length;
      const req = getPositionRequirement(rules, p.position);
      if (currentInPos >= req.squadMax) {
        addToast(`Cannot restore ${p.webName}: already have maximum ${req.squadMax} ${PositionLabels[p.position]}s in squad.`, 'error');
        return;
      }
    }
    const updated = restoreRemovedPlayer(career, playerId, playerMap, preferStarting);
    setCareer(sanitizeSquadFormation(updated, playerMap));
    addToast(`Restored ${p?.webName || 'player'} to squad`, 'success');
  }, [career, playerMap, addToast]);

  const handleResetAllTransfers = useCallback(() => {
    if (!career) return;
    const updated = resetAllTransfers(career, playerMap);
    setCareer(updated);
    addToast('All pending transfers reset to start of gameweek', 'info');
  }, [career, playerMap, addToast]);

  const handleSetCaptain = useCallback((playerId: number) => {
    if (!career) return;
    setCareer(setCaptain(career, playerId));
  }, [career]);

  const handleSetViceCaptain = useCallback((playerId: number) => {
    if (!career) return;
    setCareer(setViceCaptain(career, playerId));
  }, [career]);

  const handleSwapPlayers = useCallback((playerAId: number, playerBId: number) => {
    if (!career) return;
    const res = swapPlayers(career, playerAId, playerBId, playerMap);
    if (!res.success) {
      addToast(res.reason || 'Cannot swap players', 'error');
      return;
    }
    const sanitized = sanitizeSquadFormation(res.career, playerMap);
    setCareer(sanitized);
    const pA = playerMap.get(playerAId);
    const pB = playerMap.get(playerBId);
    if (pA && pB) {
      addToast(`Swapped ${pA.webName} ↔ ${pB.webName}`, 'success');
    }
  }, [career, playerMap, addToast]);

  const handleToggleStarting = useCallback((playerId: number) => {
    if (!career) return;
    const sp = career.squad.find(s => s.playerId === playerId);
    if (!sp) return;

    const player = playerMap.get(playerId);
    if (!player) return;

    const rules = getSeasonRules(career.season);
    const starting = career.squad.filter(s => s.isStarting);
    const bench = career.squad.filter(s => !s.isStarting);

    if (sp.isStarting) {
      // Moving from Starting -> Bench
      // If Goalkeeper:
      if (player.position === Position.GKP) {
        const benchGkp = bench.find(b => playerMap.get(b.playerId)?.position === Position.GKP);
        if (benchGkp) {
          handleSwapPlayers(playerId, benchGkp.playerId);
          return;
        }
      }

      if (bench.length >= rules.benchSize) {
        addToast(`Bench is full (${rules.benchSize} players). Move someone to starting XI first.`, 'error');
        return;
      }
      const maxBenchOrder = bench.reduce((max, s) => Math.max(max, s.benchOrder), 0);
      const newSquad = career.squad.map(s =>
        s.playerId === playerId
          ? { ...s, isStarting: false, benchOrder: maxBenchOrder + 1, isCaptain: false, isViceCaptain: false }
          : s
      );
      setCareer(sanitizeSquadFormation({ ...career, squad: newSquad }, playerMap));
    } else {
      // Moving from Bench -> Starting
      // If Goalkeeper:
      if (player.position === Position.GKP) {
        const startingGkp = starting.find(s => playerMap.get(s.playerId)?.position === Position.GKP);
        if (startingGkp) {
          // Exactly 1 goalkeeper can start! Auto swap with the starting GKP
          handleSwapPlayers(playerId, startingGkp.playerId);
          return;
        }

        // No goalkeeper is currently starting!
        // If starting XI is full (11 players) or starting outfielders >= 10, auto-swap with an excess outfielder
        const startingOutfield = starting.filter(s => playerMap.get(s.playerId)?.position !== Position.GKP);
        if (starting.length >= rules.startingXISize || startingOutfield.length >= 10) {
          const curDefs = starting.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).length;
          const curMids = starting.filter(s => playerMap.get(s.playerId)?.position === Position.MID).length;
          const curFwds = starting.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).length;

          let excessStarter: UserSquadPlayer | undefined;
          if (curFwds > 1) {
            excessStarter = starting.filter(s => playerMap.get(s.playerId)?.position === Position.FWD).pop();
          } else if (curMids > 2) {
            excessStarter = starting.filter(s => playerMap.get(s.playerId)?.position === Position.MID).pop();
          } else if (curDefs > 3) {
            excessStarter = starting.filter(s => playerMap.get(s.playerId)?.position === Position.DEF).pop();
          } else {
            excessStarter = startingOutfield[startingOutfield.length - 1];
          }

          if (excessStarter) {
            handleSwapPlayers(playerId, excessStarter.playerId);
            return;
          }
        }

        // Otherwise promote GKP directly
        let newSquad = career.squad.map(s =>
          s.playerId === playerId ? { ...s, isStarting: true, benchOrder: 0 } : s
        );
        setCareer(sanitizeSquadFormation({ ...career, squad: newSquad }, playerMap));
        return;
      }

      // Outfield player moving to starting
      // Outfielders can NEVER exceed 10 starting outfielders in FPL
      const startingOutfieldCount = starting.filter(s => playerMap.get(s.playerId)?.position !== Position.GKP).length;
      if (startingOutfieldCount >= 10) {
        const samePosStarter = starting.find(s => playerMap.get(s.playerId)?.position === player.position);
        if (samePosStarter) {
          handleSwapPlayers(playerId, samePosStarter.playerId);
          return;
        }
        addToast(`Maximum 10 outfield players can start. Drag directly onto a starter to swap.`, 'error');
        return;
      }

      // Outfield starting caps (max 5 DEF, 5 MID, 3 FWD)
      const startingCountInPos = starting.filter(s => playerMap.get(s.playerId)?.position === player.position).length;
      const maxInPos = player.position === Position.DEF ? 5 : player.position === Position.MID ? 5 : 3;
      if (startingCountInPos >= maxInPos) {
        // Try to swap with someone of the same position if starting XI is full
        const samePosStarter = starting.find(s => playerMap.get(s.playerId)?.position === player.position);
        if (samePosStarter) {
          handleSwapPlayers(playerId, samePosStarter.playerId);
          return;
        }
        addToast(`Maximum ${maxInPos} ${PositionFullLabels[player.position]}s can start. Swap with a starting ${PositionFullLabels[player.position]} instead.`, 'error');
        return;
      }

      if (starting.length >= rules.startingXISize) {
        const samePosStarter = starting.find(s => playerMap.get(s.playerId)?.position === player.position);
        if (samePosStarter) {
          handleSwapPlayers(playerId, samePosStarter.playerId);
          return;
        }
        addToast(`Starting XI is full (${rules.startingXISize} players). Move someone to bench first or drag to swap.`, 'error');
        return;
      }

      // Move player to starting, then renumber remaining bench
      let newSquad = career.squad.map(s =>
        s.playerId === playerId ? { ...s, isStarting: true, benchOrder: 0 } : s
      );
      setCareer(sanitizeSquadFormation({ ...career, squad: newSquad }, playerMap));
    }
  }, [career, playerMap, handleSwapPlayers, addToast]);

  const handleMoveToStarting = useCallback((playerId: number) => {
    if (!career) return;
    const sp = career.squad.find(s => s.playerId === playerId);
    if (!sp || sp.isStarting) return;

    const pHist = playerMap.get(playerId);
    if (!pHist) return;

    // Goalkeeper: use handleToggleStarting which handles swap with starting GKP or excess outfielder
    if (pHist.position === Position.GKP) {
      handleToggleStarting(playerId);
      return;
    }

    const rules = getSeasonRules(career.season);
    const starting = career.squad.filter(s => s.isStarting);
    const startingOutfieldCount = starting.filter(s => playerMap.get(s.playerId)?.position !== Position.GKP).length;

    if (starting.length >= rules.startingXISize || startingOutfieldCount >= 10) {
      const samePosStarter = starting.find(s => playerMap.get(s.playerId)?.position === pHist.position);
      if (samePosStarter) {
        handleSwapPlayers(playerId, samePosStarter.playerId);
      } else {
        addToast(`Starting XI is full (${rules.startingXISize} players). Drag directly onto a starter to swap.`, 'info');
      }
      return;
    }

    handleToggleStarting(playerId);
  }, [career, playerMap, handleSwapPlayers, handleToggleStarting, addToast]);

  const handleMoveToBench = useCallback((playerId: number) => {
    if (!career) return;
    const sp = career.squad.find(s => s.playerId === playerId);
    if (!sp || !sp.isStarting) return;

    const pHist = playerMap.get(playerId);
    if (!pHist) return;

    const rules = getSeasonRules(career.season);
    const bench = career.squad.filter(s => !s.isStarting);

    // If GKP, swap with bench GKP if exists
    if (pHist.position === Position.GKP) {
      const benchGkp = bench.find(s => playerMap.get(s.playerId)?.position === Position.GKP);
      if (benchGkp) {
        handleSwapPlayers(playerId, benchGkp.playerId);
        return;
      }
    }

    if (bench.length >= rules.benchSize) {
      const samePosBencher = bench.find(s => playerMap.get(s.playerId)?.position === pHist.position);
      if (samePosBencher) {
        handleSwapPlayers(playerId, samePosBencher.playerId);
      } else {
        addToast(`Bench is full (${rules.benchSize} players). Drag directly onto a bench player to swap.`, 'info');
      }
      return;
    }

    handleToggleStarting(playerId);
  }, [career, playerMap, handleSwapPlayers, handleToggleStarting, addToast]);

  // Replace a player in the squad with a new player from the player list
  const handleReplacePlayer = useCallback((targetPlayerId: number, newPlayerId: number) => {
    if (!career || !seasonData) return;
    const targetSp = career.squad.find(s => s.playerId === targetPlayerId);
    if (!targetSp) return;

    const targetPlayer = playerMap.get(targetPlayerId);
    const newPlayer = playerMap.get(newPlayerId);
    if (!targetPlayer || !newPlayer) return;

    // Position check
    if (targetPlayer.position !== newPlayer.position) {
      addToast(`Cannot replace ${PositionLabels[targetPlayer.position]} with ${PositionLabels[newPlayer.position]}. Positions must match.`, 'error');
      return;
    }

    const rules = getSeasonRules(career.season);
    const newPrice = getCurrentPrice(newPlayerId);

    // Club limit check
    const currentGW = career.clock.currentGameweek;
    const newTeamId = getPlayerTeamId(newPlayer, currentGW);
    const targetTeamId = getPlayerTeamId(targetPlayer, currentGW);
    if (newTeamId !== targetTeamId) {
      const sameClubCount = career.squad
        .filter(s => s.playerId !== targetPlayerId)
        .filter(s => {
          const sp = playerMap.get(s.playerId);
          return sp && getPlayerTeamId(sp, currentGW) === newTeamId;
        }).length;
      if (sameClubCount >= rules.maxPlayersPerClub) {
        const teamObj = getPlayerTeam(newPlayer, seasonData?.teams || [], currentGW);
        addToast(`Maximum ${rules.maxPlayersPerClub} players from ${teamObj?.shortName || teamObj?.name || newPlayer.teamShortName || newPlayer.teamName} allowed.`, 'error');
        return;
      }
    }

    // Budget check
    const sellingPrice = career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD
      ? targetSp.currentPrice
      : calculateSellingPrice(targetSp.purchasePrice, targetSp.currentPrice);
    const bankDiff = sellingPrice - newPrice;
    if (career.bank + bankDiff < 0) {
      addToast(`Insufficient budget. Need £${(newPrice / 10).toFixed(1)}m, have £${((career.bank + sellingPrice) / 10).toFixed(1)}m after sale.`, 'error');
      return;
    }

    // If pre-season team build: direct replacement
    if (career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD) {
      const newSquadPlayer: UserSquadPlayer = {
        playerId: newPlayer.id,
        purchasePrice: newPrice,
        currentPrice: newPrice,
        isStarting: targetSp.isStarting,
        benchOrder: targetSp.benchOrder,
        isCaptain: targetSp.isCaptain,
        isViceCaptain: targetSp.isViceCaptain,
      };
      const newSquad = career.squad.map(s => s.playerId === targetPlayerId ? newSquadPlayer : s);
      const newBank = career.bank + bankDiff;
      const newSquadValue = newSquad.reduce((sum, s) => sum + s.currentPrice, 0);

      setCareer(sanitizeSquadFormation({
        ...career,
        squad: newSquad,
        bank: newBank,
        squadValue: newSquadValue,
        updatedAt: new Date().toISOString(),
      }, playerMap));
      addToast(`Replaced ${targetPlayer.webName} with ${newPlayer.webName}`, 'success');
      return;
    }

    // In-season: execute as a transfer
    const fin = getPlayerFinancials(targetSp, targetSp.currentPrice);
    const updated = executeTransfer(career, targetPlayerId, newPlayer, newPrice, playerMap);
    setCareer(updated);
    if (fin.profit > 0) {
      addToast(`Transferred: ${targetPlayer.webName} (${formatPrice(fin.sellingPrice)} sold, +${formatPrice(fin.profit)} profit) → ${newPlayer.webName}`, 'success');
    } else {
      addToast(`Transferred: ${targetPlayer.webName} → ${newPlayer.webName}`, 'success');
    }
  }, [career, seasonData, playerMap, getCurrentPrice, addToast]);

  const handleDropOnPlayer = useCallback((targetPlayerId: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPlayerId(null);
    setIsDragging(false);
    const existingGhost = document.getElementById('fpl-custom-drag-ghost');
    if (existingGhost) existingGhost.remove();
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 250);

    const dragged = activeDragPlayerRef.current;
    if (!dragged || dragged.id === targetPlayerId || !career) return;

    const isSourceInSquad = career.squad.some(s => s.playerId === dragged.id);
    if (isSourceInSquad) {
      // Dragging a player from the squad onto another squad player -> SWAP THEM
      handleSwapPlayers(dragged.id, targetPlayerId);
    } else {
      // Dragging a player from the player list onto an existing player -> REPLACE THEM
      handleReplacePlayer(targetPlayerId, dragged.id);
    }
  }, [career, handleSwapPlayers, handleReplacePlayer]);

  const handleDropOnEmptySlot = useCallback((position: Position | null, isBench: boolean, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverSlotKey(null);
    setIsDragging(false);
    const existingGhost = document.getElementById('fpl-custom-drag-ghost');
    if (existingGhost) existingGhost.remove();
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 250);

    const dragged = activeDragPlayerRef.current;
    if (!dragged || !career) return;

    const sp = career.squad.find(s => s.playerId === dragged.id);
    const p = playerMap.get(dragged.id);
    if (!p) return;

    const starting = career.squad.filter(s => s.isStarting);
    const bench = career.squad.filter(s => !s.isStarting);

    if (sp) {
      // Squad player moving to empty slot
      if (isBench) {
        if (position === Position.GKP && p.position !== Position.GKP) {
          addToast('This slot is for Goalkeepers only.', 'error');
          return;
        }
        if (position === null && p.position === Position.GKP) {
          addToast('Goalkeepers can only be placed in the GKP slot.', 'error');
          return;
        }
        if (sp.isStarting) {
          handleMoveToBench(dragged.id);
        }
      } else if (!isBench && !sp.isStarting) {
        handleMoveToStarting(dragged.id);
      }
    } else {
      // Adding new player from list
      const rules = getSeasonRules(career.season);
      const targetTeamId = getPlayerTeamId(p, career.clock.currentGameweek);
      const clubSquadPlayers = career.squad
        .map(s => playerMap.get(s.playerId))
        .filter((sp): sp is HistoricalPlayer => sp !== undefined && getPlayerTeamId(sp, career.clock.currentGameweek) === targetTeamId);
      if (clubSquadPlayers.length >= rules.maxPlayersPerClub) {
        const teamObj = getPlayerTeam(p, seasonData?.teams || [], career.clock.currentGameweek);
        const teamName = teamObj?.shortName || teamObj?.name || p.teamShortName || p.teamName;
        const names = clubSquadPlayers.map(x => x.webName).join(', ');
        addToast(`Cannot add ${p.webName}: Club limit reached (${rules.maxPlayersPerClub}/${rules.maxPlayersPerClub}) for ${teamName}. Squad already has: ${names}. Drag directly onto one to replace them.`, 'error');
        return;
      }

      if (isBench) {
        if (position === Position.GKP && p.position !== Position.GKP) {
          addToast('This slot is for Goalkeepers only.', 'error');
          return;
        }
        if (position === null && p.position === Position.GKP) {
          addToast('Goalkeepers can only be placed in the GKP slot.', 'error');
          return;
        }

        // Bench drop rules:
        const rules = getSeasonRules(career.season);
        const req = getPositionRequirement(rules, p.position);
        const currentPosCount = career.squad.filter(s => playerMap.get(s.playerId)?.position === p.position).length;
        const hasRemovedForPos = (career.removedPlayers || []).some(
          rp => playerMap.get(rp.player.playerId)?.position === p.position
        );
        if (!hasRemovedForPos && currentPosCount >= req.squadMax) {
          addToast(`Squad already has maximum ${req.squadMax} ${PositionLabels[p.position]}s.`, 'error');
          return;
        }

        // Bench has at most 1 GKP and at most 3 outfielders
        const benchGkps = bench.filter(b => playerMap.get(b.playerId)?.position === Position.GKP).length;
        const benchOutfield = bench.filter(b => playerMap.get(b.playerId)?.position !== Position.GKP).length;

        if (p.position === Position.GKP) {
          if (benchGkps >= 1) {
            addToast('Bench already has a goalkeeper substitute. Swap or replace instead.', 'error');
            return;
          }
        } else {
          if (benchOutfield >= 3) {
            addToast('Bench already has maximum 3 outfield substitutes.', 'error');
            return;
          }
        }
        handleAddPlayer(dragged.id, false);
      } else {
        // Pitch drop rules:
        if (position !== null && p.position !== position) {
          addToast(`This slot is for ${PositionFullLabels[position]}s.`, 'error');
          return;
        }

        const rules = getSeasonRules(career.season);
        const req = getPositionRequirement(rules, p.position);
        const currentPosCount = career.squad.filter(s => playerMap.get(s.playerId)?.position === p.position).length;
        const hasRemovedForPos = (career.removedPlayers || []).some(
          rp => playerMap.get(rp.player.playerId)?.position === p.position
        );
        if (!hasRemovedForPos && currentPosCount >= req.squadMax) {
          addToast(`Squad already has maximum ${req.squadMax} ${PositionLabels[p.position]}s.`, 'error');
          return;
        }

        const startingInPos = starting.filter(s => playerMap.get(s.playerId)?.position === p.position).length;
        if (startingInPos >= req.startingMax) {
          addToast(`Starting XI already has maximum ${req.startingMax} ${PositionLabels[p.position]}s. Drop onto bench instead.`, 'error');
          return;
        }
        if (starting.length >= rules.startingXISize) {
          addToast('Starting XI is already full (11 players). Drop onto bench instead.', 'error');
          return;
        }

        if (p.position === Position.GKP) {
          const startingGkps = starting.filter(s => playerMap.get(s.playerId)?.position === Position.GKP).length;
          if (startingGkps >= 1) {
            addToast('Starting XI already has a goalkeeper. Drop onto bench instead.', 'error');
            return;
          }
        }
        handleAddPlayer(dragged.id, true);
      }
    }
  }, [career, playerMap, handleMoveToBench, handleMoveToStarting, handleAddPlayer, addToast]);

  const handleAutoArrange = useCallback(() => {
    if (!career) return;
    const rules = getSeasonRules(career.season);
    const updated = autoArrangeSquad(career, playerMap, rules);
    setCareer(updated);
    addToast('Squad auto-arranged (4-4-2)', 'info');
  }, [career, playerMap, addToast]);

  // ---- TRANSFER OPERATIONS ----
  const handleConfirmTransfer = useCallback((playerInId: number) => {
    if (!career || !transferOutId || !seasonData) return;

    const playerIn = playerMap.get(playerInId);
    if (!playerIn) return;

    const currentGW = career.clock.currentGameweek;
    const playerInPrice = currentGW <= 1 ? playerIn.startPrice : getPlayerPriceAtGW(playerInId, currentGW - 1, gwDataCache, playerIn.startPrice);

    const preview = previewTransfer(career, transferOutId, playerIn, playerInPrice, playerMap);
    if (!preview.valid) {
      addToast(preview.reason, 'error');
      return;
    }

    const spOut = career.squad.find(s => s.playerId === transferOutId);
    const finOut = spOut ? getPlayerFinancials(spOut, spOut.currentPrice) : null;
    const updated = executeTransfer(career, transferOutId, playerIn, playerInPrice, playerMap);
    setCareer(updated);
    setTransferOutId(null);
    if (finOut && finOut.profit > 0) {
      addToast(`Transfer complete: ${playerMap.get(transferOutId)?.webName} (${formatPrice(finOut.sellingPrice)} sold, +${formatPrice(finOut.profit)} profit) → ${playerIn.webName}`, 'success');
    } else {
      addToast(`Transfer complete: ${playerMap.get(transferOutId)?.webName} → ${playerIn.webName}`, 'success');
    }
  }, [career, transferOutId, seasonData, playerMap, gwDataCache, addToast]);

  // ---- CHIP OPERATIONS ----
  const handleActivateChip = useCallback((chipType: ChipType) => {
    if (!career) return;
    const chip = career.chips.find(c => c.type === chipType);
    if (!chip || !chip.available) {
      addToast('Chip not available', 'error');
      return;
    }

    if (career.activeChip === chipType) {
      // Deactivating chip
      if (chipType === ChipType.FREE_HIT) {
        // Revert squad and bank to preFreeHit state
        const revertedSquad = career.preFreeHitSquad
          ? career.preFreeHitSquad.map(sp => ({ ...sp }))
          : career.squad;
        const revertedBank = career.preFreeHitBank ?? career.bank;
        const revertedValue = revertedSquad.reduce((sum, sp) => sum + sp.currentPrice, 0);

        setCareer({
          ...career,
          activeChip: null,
          squad: revertedSquad,
          bank: revertedBank,
          squadValue: revertedValue,
          preFreeHitSquad: undefined,
          preFreeHitBank: undefined,
          pendingTransfers: [],
        });
        addToast('Free Hit cancelled — Squad and transfers restored to pre-Free Hit state', 'info');
        return;
      }

      setCareer({ ...career, activeChip: null });
      addToast(`${chipType.replace('_', ' ')} deactivated`, 'info');
      return;
    }

    // Activating a new chip
    let baseSquad = career.squad;
    let baseBank = career.bank;
    let preFHSquad = career.preFreeHitSquad;
    let preFHBank = career.preFreeHitBank;

    if (career.activeChip === ChipType.FREE_HIT) {
      // Switching away from Free Hit: restore original squad before activating another chip
      baseSquad = career.preFreeHitSquad
        ? career.preFreeHitSquad.map(sp => ({ ...sp }))
        : career.squad;
      baseBank = career.preFreeHitBank ?? career.bank;
      preFHSquad = undefined;
      preFHBank = undefined;
    }

    if (chipType === ChipType.FREE_HIT) {
      // Snapshot the squad from before any Gameweek transfers
      const squadSnapshot = (career.startOfGameweekSquad && career.startOfGameweekSquad.length > 0)
        ? career.startOfGameweekSquad.map(sp => ({ ...sp }))
        : career.squad.map(sp => ({ ...sp }));
      const bankSnapshot = career.startOfGameweekBank ?? career.bank;

      setCareer({
        ...career,
        squad: baseSquad,
        bank: baseBank,
        activeChip: chipType,
        preFreeHitSquad: squadSnapshot,
        preFreeHitBank: bankSnapshot,
      });
      addToast('Free Hit activated! Unlimited free transfers for this Gameweek only.', 'success');
      return;
    }

    setCareer({
      ...career,
      squad: baseSquad,
      bank: baseBank,
      activeChip: chipType,
      preFreeHitSquad: preFHSquad,
      preFreeHitBank: preFHBank,
    });
    addToast(`${chipType.replace('_', ' ')} activated!`, 'success');
  }, [career, addToast]);

  // ---- GAMEWEEK OPERATIONS ----
  const handleConfirmTeam = useCallback(() => {
    if (!career) return;
    const rules = getSeasonRules(career.season);
    const validation = validateSquad(career.squad, playerMap, rules);
    if (!validation.valid) {
      validation.errors.forEach(e => addToast(e, 'error'));
      return;
    }

    // Transition to PRE_DEADLINE if still in team build
    let updated = career;
    if (career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD) {
      updated = advanceToPreDeadline(career);
    }

    // Lock the team
    updated = lockTeam(updated);
    setCareer(updated);
    try {
      saveService.saveCareer(updated);
      saveService.setActiveCareerId(updated.id);
      setSaves(saveService.getSaveList());
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (saveErr) {
      console.error('Autosave error:', saveErr);
    }
    addToast('Team locked for Gameweek ' + updated.clock.currentGameweek, 'success');
  }, [career, playerMap, addToast]);

  const handlePlayGameweek = useCallback(async () => {
    if (!career || career.clock.phase !== SimPhase.TEAM_LOCKED) return;

    const gw = career.clock.currentGameweek;
    setLoading(true);

    try {
      // Load this gameweek's data
      const gwData = await dataService.loadGameweekData(career.season, gw);
      if (gwData === null || gwData === undefined) {
        addToast(`Failed to load data for Gameweek ${gw}`, 'error');
        setLoading(false);
        return;
      }

      const isBlank = gwData.length === 0;

      // Add to cache
      const newCache = new Map(gwDataCache);
      newCache.set(gw, gwData);
      setGwDataCache(newCache);

      // Calculate the user's score
      const result = calculateGameweekScore(career, gwData, playerMap);
      setCurrentGWResults(result);

      // Process results and update career
      const updated = processGameweekResults(career, result);

      // Update player prices
      const withPrices = seasonData
        ? updateSquadPrices(updated, newCache, seasonData.players)
        : updated;

      setCareer(withPrices);

      // Autosave career immediately after gameweek completion
      try {
        saveService.saveCareer(withPrices);
        saveService.setActiveCareerId(withPrices.id);
        setSaves(saveService.getSaveList());
        setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (saveErr) {
        console.error('Autosave error:', saveErr);
      }

      setPage(AppPage.GAMEWEEKS);
      if (isBlank) {
        addToast(`Gameweek ${gw} complete (Blank Gameweek — 0 fixtures) — Autosaved`, 'info');
      } else {
        addToast(`Gameweek ${gw} complete — Autosaved`, 'success');
      }
    } catch (e) {
      addToast('Failed to load gameweek data', 'error');
    } finally {
      setLoading(false);
    }
  }, [career, gwDataCache, playerMap, seasonData, addToast]);

  const handleNextGameweek = useCallback(() => {
    if (!career) return;
    if (career.clock.phase === SimPhase.SEASON_COMPLETE) {
      addToast('Season complete!', 'info');
      return;
    }
    const hadFreeHit = !!(career.preFreeHitSquad && career.preFreeHitSquad.length > 0);
    const updated = advanceToNextGameweek(career);

    // Update player prices on the new (or reverted) squad
    const withPrices = seasonData
      ? updateSquadPrices(updated, gwDataCache, seasonData.players)
      : updated;

    setCareer(withPrices);
    try {
      saveService.saveCareer(withPrices);
      saveService.setActiveCareerId(withPrices.id);
      setSaves(saveService.getSaveList());
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (saveErr) {
      console.error('Autosave error:', saveErr);
    }
    setCurrentGWResults(null);
    setPage(AppPage.MY_TEAM);
    if (hadFreeHit) {
      addToast(`Gameweek ${withPrices.clock.currentGameweek} — Squad reverted to pre-Free Hit team`, 'info');
    } else {
      addToast(`Gameweek ${withPrices.clock.currentGameweek} — Make your decisions`, 'info');
    }
  }, [career, seasonData, gwDataCache, addToast]);

  // ---- COMPUTED VALUES ----
  const rules = career ? getSeasonRules(career.season) : null;
  const squadValidation = career && rules ? validateSquad(career.squad, playerMap, rules) : null;

  const positionCounts = useMemo(() => {
    if (!career) return { 1: 0, 2: 0, 3: 0, 4: 0 };
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    career.squad.forEach(sp => {
      const p = playerMap.get(sp.playerId);
      if (p) counts[p.position]++;
    });
    return counts;
  }, [career, playerMap]);

  const clubPlayerCounts = useMemo(() => {
    if (!career || !seasonData) return new Map<number, { count: number; playerNames: string[]; teamName: string; teamShort: string }>();
    const currentGW = career.clock.currentGameweek;
    const map = new Map<number, { count: number; playerNames: string[]; teamName: string; teamShort: string }>();

    for (const sp of career.squad) {
      const p = playerMap.get(sp.playerId);
      if (!p) continue;
      const tid = getPlayerTeamId(p, currentGW);
      const teamObj = getPlayerTeam(p, seasonData.teams, currentGW);
      const existing = map.get(tid) || {
        count: 0,
        playerNames: [],
        teamName: teamObj?.name || p.teamName,
        teamShort: teamObj?.shortName || p.teamShortName,
      };
      existing.count++;
      existing.playerNames.push(p.webName);
      map.set(tid, existing);
    }
    return map;
  }, [career, seasonData, playerMap]);

  // ---- TIME-AWARE PLAYER STATS ----
  const getPlayerStats = useCallback((playerId: number) => {
    if (!career) return null;
    const maxGW = career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD
      ? 0
      : career.clock.currentGameweek - 1;
    return getPlayerStatsUpToGW(playerId, maxGW, gwDataCache);
  }, [career, gwDataCache]);

  // ---- FILTERED & SORTED PLAYERS ----
  const filteredPlayers = useMemo(() => {
    if (!seasonData) return [];

    let list = seasonData.players.map(p => playerMap.get(p.id) || p);

    // Filter out element_type 5 (managers in 2024-25)
    list = list.filter(p => p.position >= 1 && p.position <= 4);

    // Search
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase();
      const currentGW = career?.clock.currentGameweek ?? 1;
      list = list.filter(p => {
        const curTeam = getPlayerTeam(p, seasonData?.teams || [], currentGW);
        return (
          p.webName.toLowerCase().includes(q) ||
          p.firstName.toLowerCase().includes(q) ||
          p.lastName.toLowerCase().includes(q) ||
          p.teamName.toLowerCase().includes(q) ||
          p.teamShortName.toLowerCase().includes(q) ||
          (curTeam && curTeam.name.toLowerCase().includes(q)) ||
          (curTeam && curTeam.shortName.toLowerCase().includes(q))
        );
      });
    }

    // Position filter
    if (filters.position !== null) {
      list = list.filter(p => p.position === filters.position);
    }

    // Team filter
    if (filters.teamId !== null) {
      const currentGW = career?.clock.currentGameweek ?? 1;
      list = list.filter(p => getPlayerTeamId(p, currentGW) === filters.teamId);
    }

    // Price filter - use current GW price
    if (filters.minPrice !== null || filters.maxPrice !== null) {
      list = list.filter(p => {
        const price = career && career.clock.currentGameweek > 1
          ? getPlayerPriceAtGW(p.id, career.clock.currentGameweek - 1, gwDataCache, p.startPrice)
          : p.startPrice;
        if (filters.minPrice !== null && price < filters.minPrice) return false;
        if (filters.maxPrice !== null && price > filters.maxPrice) return false;
        return true;
      });
    }

    // Sorting
    list.sort((a, b) => {
      const dir = filters.sortDir === 'asc' ? 1 : -1;
      switch (filters.sortBy) {
        case 'name':
          return dir * a.webName.localeCompare(b.webName);
        case 'price': {
          const pa = career && career.clock.currentGameweek > 1 ? getPlayerPriceAtGW(a.id, career.clock.currentGameweek - 1, gwDataCache, a.startPrice) : a.startPrice;
          const pb = career && career.clock.currentGameweek > 1 ? getPlayerPriceAtGW(b.id, career.clock.currentGameweek - 1, gwDataCache, b.startPrice) : b.startPrice;
          return dir * (pa - pb);
        }
        case 'totalPoints': {
          const sa = getPlayerStatsUpToGW(a.id, (career?.clock.currentGameweek || 1) - 1, gwDataCache);
          const sb = getPlayerStatsUpToGW(b.id, (career?.clock.currentGameweek || 1) - 1, gwDataCache);
          return dir * (sa.totalPoints - sb.totalPoints);
        }
        case 'goals': {
          const sa = getPlayerStatsUpToGW(a.id, (career?.clock.currentGameweek || 1) - 1, gwDataCache);
          const sb = getPlayerStatsUpToGW(b.id, (career?.clock.currentGameweek || 1) - 1, gwDataCache);
          return dir * (sa.goals - sb.goals);
        }
        case 'assists': {
          const sa = getPlayerStatsUpToGW(a.id, (career?.clock.currentGameweek || 1) - 1, gwDataCache);
          const sb = getPlayerStatsUpToGW(b.id, (career?.clock.currentGameweek || 1) - 1, gwDataCache);
          return dir * (sa.assists - sb.assists);
        }
        default:
          return 0;
      }
    });

    return list;
  }, [seasonData, playerMap, filters, career, gwDataCache]);

  // ============================================================
  // RENDER
  // ============================================================

  if (loading && !career) {
    return (
      <div className="app-container">
        <div className="loading-container" style={{ minHeight: '100vh' }}>
          <div className="loading-spinner" />
          <span>Loading Historical FPL...</span>
        </div>
      </div>
    );
  }

  // ---- HOME PAGE (no career active) ----
  if (!career) {
    return (
      <div className="app-container">
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <div className="home-page">
          <div style={{ marginBottom: '48px', marginTop: '48px' }}>
            <h1 className="home-title">
              Historical <span style={{ color: 'var(--accent-primary)' }}>FPL</span>
            </h1>
            <p className="home-subtitle">
              Play Fantasy Premier League seasons from the past. Build your squad, make transfers,
              and compete against actual historical results.
            </p>
          </div>

          {saves.length > 0 && (
            <div className="continue-career-banner" onClick={() => loadCareer(saves[0].id)}>
              <div className="continue-career-info">
                <div className="continue-badge">CONTINUE CAREER</div>
                <div className="continue-title">{saves[0].name}</div>
                <div className="continue-meta">
                  Season {saves[0].season.replace('-', '/')} · Gameweek {saves[0].gameweek} · {saves[0].totalPoints} pts
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  loadCareer(saves[0].id);
                }}
              >
                Resume GW{saves[0].gameweek} →
              </button>
            </div>
          )}

          <h3 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '12px' }}>
            Select Season
          </h3>
          <div className="season-grid">
            {seasons.map(s => (
              <div
                key={s.id}
                className={`season-card ${selectedSeason === s.id ? 'selected' : ''}`}
                onClick={() => setSelectedSeason(s.id)}
              >
                <div className="season-card-year">{s.label}</div>
                <div className="season-card-info">
                  {s.playerCount} players · {s.totalGameweeks} GWs
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn btn-primary"
            disabled={!selectedSeason}
            onClick={() => selectedSeason && startNewCareer(selectedSeason)}
            style={{ width: '100%', height: '42px', fontSize: '13px', marginBottom: '32px' }}
          >
            <NewIcon size={16} /> Start New Career
          </button>

          {saves.length > 0 && (
            <div className="saves-section">
              <h3 className="saves-title">Saved Careers</h3>
              {saves.map(s => (
                <div key={s.id} className="save-item">
                  <div className="save-info" onClick={() => loadCareer(s.id)} style={{ cursor: 'pointer', flex: 1 }}>
                    <div className="save-name">{s.name}</div>
                    <div className="save-meta">
                      {s.season.replace('-', '/')} · GW{s.gameweek} · {s.totalPoints} pts
                    </div>
                  </div>
                  <div className="save-actions">
                    <button className="btn btn-sm" onClick={() => loadCareer(s.id)}>
                      <LoadIcon size={14} /> Load
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteCareerSave(s.id)}>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="attribution">
            Historical FPL data provided by{' '}
            <a href="https://github.com/vaastav/Fantasy-Premier-League" target="_blank" rel="noopener noreferrer">
              Vaastav's Fantasy Premier League dataset
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ---- MAIN APPLICATION (career active) ----
  const startingXI = career.squad.filter(s => s.isStarting);
  const benchPlayers = career.squad.filter(s => !s.isStarting).sort((a, b) => a.benchOrder - b.benchOrder);
  const isPreDeadline = career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD || career.clock.phase === SimPhase.PRE_DEADLINE;
  const isLocked = career.clock.phase === SimPhase.TEAM_LOCKED;
  const isPostGW = career.clock.phase === SimPhase.POST_GAMEWEEK || career.clock.phase === SimPhase.SEASON_COMPLETE;

  // Position color helper
  const getPosClass = (pos: Position) => {
    switch (pos) {
      case Position.GKP: return 'pos-gkp';
      case Position.DEF: return 'pos-def';
      case Position.MID: return 'pos-mid';
      case Position.FWD: return 'pos-fwd';
    }
  };

  // Get next fixture string for a player, e.g. "ARS (H)" or "LIV (A)"
  const getPlayerNextFixture = (playerId: number): string => {
    if (!seasonData || !seasonData.fixtures) return '';
    const player = playerMap.get(playerId);
    if (!player) return '';
    const gw = career.clock.currentGameweek;
    const fixtures = seasonData.fixtures.filter(f => f.gameweek === gw);
    if (fixtures.length === 0) return 'BLANK';
    const matches: string[] = [];
    const pTeamId = getPlayerTeamId(player, gw);
    for (const f of fixtures) {
      if (f.homeTeamId === pTeamId) {
        matches.push(`${f.awayTeamShortName || f.awayTeamName} (H)`);
      } else if (f.awayTeamId === pTeamId) {
        matches.push(`${f.homeTeamShortName || f.homeTeamName} (A)`);
      }
    }
    return matches.length > 0 ? matches.join(', ') : 'BLANK';
  };

  // Status dot class
  const getStatusClass = (status: PlayerStatus) => {
    switch (status) {
      case PlayerStatus.AVAILABLE: return 'available';
      case PlayerStatus.DOUBTFUL: return 'doubtful';
      case PlayerStatus.INJURED: return 'injured';
      case PlayerStatus.SUSPENDED: return 'suspended';
      case PlayerStatus.UNAVAILABLE: return 'unavailable';
      default: return '';
    }
  };

  // Build pitch rows from starting XI
  const buildPitchRows = () => {
    const gkps: UserSquadPlayer[] = [];
    const defs: UserSquadPlayer[] = [];
    const mids: UserSquadPlayer[] = [];
    const fwds: UserSquadPlayer[] = [];

    startingXI.forEach(sp => {
      const p = playerMap.get(sp.playerId);
      if (!p) return;
      switch (p.position) {
        case Position.GKP: gkps.push(sp); break;
        case Position.DEF: defs.push(sp); break;
        case Position.MID: mids.push(sp); break;
        case Position.FWD: fwds.push(sp); break;
      }
    });

    return [
      { label: 'GKP', players: gkps, position: Position.GKP },
      { label: 'DEF', players: defs, position: Position.DEF },
      { label: 'MID', players: mids, position: Position.MID },
      { label: 'FWD', players: fwds, position: Position.FWD },
    ];
  };

  // Render a player on the pitch
  const renderPitchPlayer = (sp: UserSquadPlayer, isBench = false) => {
    const player = playerMap.get(sp.playerId);
    if (!player) return null;

    const posClass = getPosClass(player.position);

    const isThisDragging = isDragging && activeDragPlayerRef.current?.id === sp.playerId;
    const isDragTarget = dragOverPlayerId === sp.playerId;

    const transferIn = career?.pendingTransfers.find(t => t.playerInId === sp.playerId);
    const fin = getPlayerFinancials(sp, sp.currentPrice);

    return (
      <div
        key={sp.playerId}
        className={`pitch-player ${isThisDragging ? 'dragging' : ''} ${isDragTarget ? 'drag-target' : ''}`}
        title={`Selling Price: ${formatPrice(fin.sellingPrice)} | Bought: ${formatPrice(fin.purchasePrice)} | Current Value: ${formatPrice(fin.currentPrice)}${fin.profit > 0 ? ` (+${formatPrice(fin.profit)} profit after FPL 50% sell-on fee)` : ''}${fin.isLoss ? ` (${formatPrice(fin.sellingPrice - fin.purchasePrice)} loss)` : ''}`}
        draggable={isPreDeadline}
        onDragStart={(e) => {
          if (!isPreDeadline) return;
          dragStartPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          hasActuallyDraggedRef.current = false;
          activeDragPlayerRef.current = { id: sp.playerId, source: 'squad' };
          e.dataTransfer.setData('text/plain', sp.playerId.toString());
          e.dataTransfer.effectAllowed = 'move';
          createDragGhost(player, formatPrice(sp.currentPrice), e);
          setTimeout(() => setIsDragging(true), 0);
        }}
        onDrag={(e) => {
          if (!dragStartPosRef.current || (e.clientX === 0 && e.clientY === 0)) return;
          const dist = Math.hypot(e.clientX - dragStartPosRef.current.x, e.clientY - dragStartPosRef.current.y);
          if (dist > 8) {
            hasActuallyDraggedRef.current = true;
          }
        }}
        onDragEnd={(e) => {
          const existingGhost = document.getElementById('fpl-custom-drag-ghost');
          if (existingGhost) existingGhost.remove();

          const startPos = dragStartPosRef.current;
          const dist = (startPos && e.clientX !== 0 && e.clientY !== 0)
            ? Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y)
            : 0;
          const duration = startPos ? Date.now() - startPos.time : 999;
          const wasRealDrag = hasActuallyDraggedRef.current || dist > 8;

          if (wasRealDrag) {
            justDraggedRef.current = true;
            setTimeout(() => { justDraggedRef.current = false; }, 200);
          } else {
            justDraggedRef.current = false;
            if (duration < 350) {
              setDetailPlayerId(sp.playerId);
            }
          }

          activeDragPlayerRef.current = null;
          setIsDragging(false);
          setDragOverPlayerId(null);
          setDragOverSlotKey(null);
          dragStartPosRef.current = null;
          hasActuallyDraggedRef.current = false;
        }}
        onDragEnter={(e) => {
          if (!isPreDeadline || !activeDragPlayerRef.current) return;
          e.preventDefault();
          if (activeDragPlayerRef.current.id !== sp.playerId) {
            setDragOverPlayerId(sp.playerId);
          }
        }}
        onDragOver={(e) => {
          if (!isPreDeadline || !activeDragPlayerRef.current) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target && dragOverPlayerId === sp.playerId) {
            setDragOverPlayerId(null);
          }
        }}
        onDrop={(e) => handleDropOnPlayer(sp.playerId, e)}
        onClick={(e) => {
          if (justDraggedRef.current) return;
          if ((e.target as HTMLElement).closest('.pitch-player-actions')) return;
          setDetailPlayerId(sp.playerId);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (isPreDeadline) {
            setContextMenu({ x: e.clientX, y: e.clientY, playerId: sp.playerId });
          }
        }}
      >
        <div className={`pitch-player-jersey ${posClass}`}>
          {PositionLabels[player.position]}
          {transferIn && (
            <span className="transfer-in-badge" title="Transferred in this Gameweek">IN</span>
          )}
          {sp.isCaptain && (
            <span className={`captain-badge ${career?.activeChip === ChipType.TRIPLE_CAPTAIN ? 'tc' : ''}`}>
              {career?.activeChip === ChipType.TRIPLE_CAPTAIN ? 'TC' : 'C'}
            </span>
          )}
          {sp.isViceCaptain && <span className="vice-captain-badge">V</span>}
          {isBench && (
            <span
              className="bench-order-badge"
              title={player.position === Position.GKP ? 'Goalkeeper Substitute' : `Substitute Priority ${sp.benchOrder > 1 ? sp.benchOrder - 1 : 1}`}
            >
              {player.position === Position.GKP ? 'G' : `${sp.benchOrder > 1 ? sp.benchOrder - 1 : 1}`}
            </span>
          )}
          {player.status !== PlayerStatus.AVAILABLE && (
            <span
              className={`pitch-status-badge ${getStatusClass(player.status)}`}
              title={player.news || (player.status === PlayerStatus.INJURED ? 'Injured' : player.status === PlayerStatus.DOUBTFUL ? 'Doubtful' : player.status === PlayerStatus.SUSPENDED ? 'Suspended' : 'Unavailable')}
            >
              {player.chanceOfPlayingThisRound !== null ? `${player.chanceOfPlayingThisRound}%` : (
                player.status === PlayerStatus.INJURED ? 'INJ' :
                player.status === PlayerStatus.DOUBTFUL ? '!' :
                player.status === PlayerStatus.SUSPENDED ? 'SUS' : 'X'
              )}
            </span>
          )}
        </div>
        <div className="pitch-player-name">{player.webName}</div>
        <div className="pitch-player-points">
          {formatPrice(fin.sellingPrice)}
          {fin.profit > 0 && (
            <span className="pitch-price-diff" style={{ color: 'var(--accent-success)' }}>
              +{(fin.profit / 10).toFixed(1)}
            </span>
          )}
          {fin.isLoss && (
            <span className="pitch-price-diff" style={{ color: 'var(--accent-danger)' }}>
              {((fin.sellingPrice - fin.purchasePrice) / 10).toFixed(1)}
            </span>
          )}
        </div>
        <div className="pitch-player-fixture">
          {getPlayerNextFixture(sp.playerId)}
        </div>
        {player.status !== PlayerStatus.AVAILABLE && (
          <div
            className={`pitch-player-status-tag ${getStatusClass(player.status)}`}
            title={player.news || 'Player availability concern'}
          >
            {player.status === PlayerStatus.INJURED && (player.weeksOut !== undefined && player.weeksOut !== null ? (player.weeksOut === 0 ? 'Back this GW' : `${player.weeksOut}w out`) : 'Injured')}
            {player.status === PlayerStatus.DOUBTFUL && (player.chanceOfPlayingThisRound !== null ? `${player.chanceOfPlayingThisRound}% chance` : 'Doubtful')}
            {player.status === PlayerStatus.SUSPENDED && 'Suspended'}
            {player.status === PlayerStatus.UNAVAILABLE && 'Unavailable'}
          </div>
        )}
        {/* Action buttons — only shown when editable */}
        {isPreDeadline && (
          <div className="pitch-player-actions">
            {isBench ? (
              <button
                className="pitch-action-btn"
                title="Move to Starting XI"
                onClick={(e) => { e.stopPropagation(); handleToggleStarting(sp.playerId); }}
              >▲</button>
            ) : (
              <button
                className="pitch-action-btn"
                title="Move to Bench"
                onClick={(e) => { e.stopPropagation(); handleToggleStarting(sp.playerId); }}
              >▼</button>
            )}
            {sp.isStarting && !sp.isCaptain && (
              <button
                className="pitch-action-btn captain"
                title="Set Captain"
                onClick={(e) => { e.stopPropagation(); handleSetCaptain(sp.playerId); }}
              >C</button>
            )}
            {sp.isStarting && !sp.isViceCaptain && !sp.isCaptain && (
              <button
                className="pitch-action-btn vice"
                title="Set Vice-Captain"
                onClick={(e) => { e.stopPropagation(); handleSetViceCaptain(sp.playerId); }}
              >V</button>
            )}
            {transferIn && (
              <button
                className="pitch-action-btn restore"
                title={`Undo Transfer (Restore ${playerMap.get(transferIn.playerOutId)?.webName || 'original player'})`}
                onClick={(e) => { e.stopPropagation(); handleRestoreTransfer(sp.playerId); }}
              >↺</button>
            )}
            {career && career.clock.currentGameweek > 1 && (
              <button
                className="pitch-action-btn transfer"
                title="Transfer Out"
                onClick={(e) => {
                  e.stopPropagation();
                  setTransferOutId(sp.playerId);
                  addToast(`Select a replacement for ${player.webName}`, 'info');
                }}
              >⇄</button>
            )}
            <button
              className="pitch-action-btn remove"
              title="Remove from Squad"
              onClick={(e) => { e.stopPropagation(); handleRemovePlayer(sp.playerId); }}
            >✕</button>
          </div>
        )}
      </div>
    );
  };

  // ---- RENDER PAGES ----

  const renderPlayerList = () => (
    <div className="player-panel">
      <div className="player-panel-header">
        <div className="player-search">
          <SearchIcon size={16} color="var(--text-tertiary)" />
          <input
            type="text"
            placeholder="Search players..."
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
          />
          {filters.search && (
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }} onClick={() => setFilters({ ...filters, search: '' })}>
              <CloseIcon size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="player-filters">
        <button
          className={`filter-btn ${filters.position === null ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, position: null })}
        >All</button>
        <button
          className={`filter-btn pos-gkp ${filters.position === Position.GKP ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, position: filters.position === Position.GKP ? null : Position.GKP })}
        >GKP</button>
        <button
          className={`filter-btn pos-def ${filters.position === Position.DEF ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, position: filters.position === Position.DEF ? null : Position.DEF })}
        >DEF</button>
        <button
          className={`filter-btn pos-mid ${filters.position === Position.MID ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, position: filters.position === Position.MID ? null : Position.MID })}
        >MID</button>
        <button
          className={`filter-btn pos-fwd ${filters.position === Position.FWD ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, position: filters.position === Position.FWD ? null : Position.FWD })}
        >FWD</button>
        {seasonData && (
          <select
            className="filter-select"
            value={filters.teamId ?? ''}
            onChange={e => setFilters({ ...filters, teamId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All teams</option>
            {seasonData.teams.sort((a, b) => a.name.localeCompare(b.name)).map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <select
          className="filter-select"
          value={filters.sortBy}
          onChange={e => setFilters({ ...filters, sortBy: e.target.value as SortField })}
        >
          <option value="totalPoints">Points</option>
          <option value="price">Price</option>
          <option value="goals">Goals</option>
          <option value="assists">Assists</option>
          <option value="name">Name</option>
        </select>
        <button
          className="filter-btn"
          onClick={() => setFilters({ ...filters, sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
          title={filters.sortDir === 'asc' ? 'Ascending' : 'Descending'}
        >
          {filters.sortDir === 'asc' ? <SortAscIcon size={14} /> : <SortDescIcon size={14} />}
        </button>
      </div>
      <div className="player-list-header">
        <span>Pos</span>
        <span>Player</span>
        <span style={{ textAlign: 'right' }} title="Current Price">£</span>
        <span style={{ textAlign: 'center' }} title="Goals">
          <GoalIcon size={14} color="var(--text-tertiary)" />
        </span>
        <span style={{ textAlign: 'center' }} title="Assists">
          <AssistIcon size={14} color="var(--text-tertiary)" />
        </span>
        <span style={{ textAlign: 'right' }} title="Total Points">Pts</span>
        <span style={{ textAlign: 'right' }}></span>
      </div>
      <div className="player-list">
        {filteredPlayers.slice(0, 200).map(player => {
          const inSquad = career.squad.some(s => s.playerId === player.id);
          const price = getCurrentPrice(player.id);
          const stats = getPlayerStats(player.id);
          const teamId = getPlayerTeamId(player, career?.clock.currentGameweek ?? 1);
          const clubInfo = clubPlayerCounts.get(teamId);
          const isClubMaxed = (clubInfo?.count ?? 0) >= (rules?.maxPlayersPerClub ?? 3);
          return (
            <div
              key={player.id}
              className={`player-row ${inSquad ? 'in-squad' : ''} ${isDragging && activeDragPlayerRef.current?.id === player.id ? 'dragging' : ''}`}
              draggable={isPreDeadline && !inSquad}
              onDragStart={(e) => {
                dragStartPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
                hasActuallyDraggedRef.current = false;
                activeDragPlayerRef.current = { id: player.id, source: 'player-list' };
                e.dataTransfer.setData('text/plain', player.id.toString());
                e.dataTransfer.effectAllowed = 'copy';
                createDragGhost(player, formatPrice(price), e);
                setTimeout(() => setIsDragging(true), 0);
              }}
              onDrag={(e) => {
                if (!dragStartPosRef.current || (e.clientX === 0 && e.clientY === 0)) return;
                const dist = Math.hypot(e.clientX - dragStartPosRef.current.x, e.clientY - dragStartPosRef.current.y);
                if (dist > 8) {
                  hasActuallyDraggedRef.current = true;
                }
              }}
              onDragEnd={(e) => {
                const existingGhost = document.getElementById('fpl-custom-drag-ghost');
                if (existingGhost) existingGhost.remove();

                const startPos = dragStartPosRef.current;
                const dist = (startPos && e.clientX !== 0 && e.clientY !== 0)
                  ? Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y)
                  : 0;
                const duration = startPos ? Date.now() - startPos.time : 999;
                const wasRealDrag = hasActuallyDraggedRef.current || dist > 8;

                if (wasRealDrag) {
                  justDraggedRef.current = true;
                  setTimeout(() => { justDraggedRef.current = false; }, 200);
                } else {
                  justDraggedRef.current = false;
                  if (duration < 350) {
                    setDetailPlayerId(player.id);
                  }
                }

                activeDragPlayerRef.current = null;
                setIsDragging(false);
                setDragOverPlayerId(null);
                setDragOverSlotKey(null);
                dragStartPosRef.current = null;
                hasActuallyDraggedRef.current = false;
              }}
              onClick={() => {
                if (justDraggedRef.current) return;
                setDetailPlayerId(player.id);
              }}
            >
              <span className={`player-pos-badge ${getPosClass(player.position)}`}>
                {PositionLabels[player.position]}
              </span>
              <div className="player-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
                  <span className="player-name">{player.webName}</span>
                  {player.status !== PlayerStatus.AVAILABLE && (
                    <span
                      className={`status-pill ${getStatusClass(player.status)}`}
                      title={player.news || (player.status === PlayerStatus.INJURED ? 'Injured' : 'Doubtful')}
                    >
                      {player.chanceOfPlayingThisRound !== null
                        ? `${player.chanceOfPlayingThisRound}%`
                        : player.status === PlayerStatus.INJURED
                        ? 'INJ'
                        : player.status === PlayerStatus.DOUBTFUL
                        ? '!'
                        : player.status === PlayerStatus.SUSPENDED
                        ? 'SUS'
                        : 'UNAV'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="player-team">{getPlayerTeam(player, seasonData?.teams || [], career?.clock.currentGameweek ?? 1)?.shortName || player.teamShortName}</span>
                  {!inSquad && isClubMaxed && (
                    <span
                      className="club-limit-badge"
                      style={{
                        fontSize: '9px',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: 'var(--accent-danger, #ef4444)',
                        fontWeight: 700,
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        cursor: 'help',
                      }}
                      title={`Club limit reached (${rules?.maxPlayersPerClub}/${rules?.maxPlayersPerClub}) for ${clubInfo?.teamName || 'club'}: ${clubInfo?.playerNames.join(', ')}. Drag directly onto a player to replace them.`}
                    >
                      3/3 MAX
                    </span>
                  )}
                  {player.news && (
                    <span className="player-news-preview" title={player.news}>
                      {player.news}
                    </span>
                  )}
                </div>
              </div>
              <span className="player-stat price">{(price / 10).toFixed(1)}</span>
              <span className="player-stat" style={{ textAlign: 'center', color: (stats?.goals ?? 0) > 0 ? 'var(--accent-success)' : 'var(--text-tertiary)' }}>
                {stats?.goals ?? 0}
              </span>
              <span className="player-stat" style={{ textAlign: 'center', color: (stats?.assists ?? 0) > 0 ? '#3b82f6' : 'var(--text-tertiary)' }}>
                {stats?.assists ?? 0}
              </span>
              <span className="player-stat" style={{ textAlign: 'right', fontWeight: 600 }}>{stats?.totalPoints ?? '-'}</span>
              <span className="player-stat">
                {transferOutId && !inSquad ? (
                  <button className="btn btn-sm btn-icon" style={{ color: 'var(--accent-success)' }} title="Confirm Transfer" onClick={(e) => { e.stopPropagation(); handleConfirmTransfer(player.id); }}>
                    <TransferIcon size={14} />
                  </button>
                ) : isPreDeadline && !inSquad ? (
                  <button
                    className={`btn btn-sm btn-icon ${isClubMaxed ? 'btn-disabled-club-limit' : ''}`}
                    title={isClubMaxed ? `Club limit reached (${rules?.maxPlayersPerClub}/${rules?.maxPlayersPerClub}) for ${clubInfo?.teamName || 'club'}: ${clubInfo?.playerNames.join(', ')}. Drag directly onto a player to replace them.` : "Add to squad"}
                    onClick={(e) => { e.stopPropagation(); handleAddPlayer(player.id); }}
                    style={isClubMaxed ? { opacity: 0.45 } : undefined}
                  >
                    <PlusIcon size={14} />
                  </button>
                ) : inSquad ? (
                  <span style={{ color: 'var(--accent-primary)', fontSize: '10px', fontWeight: 600 }}>IN</span>
                ) : null}
              </span>
            </div>
          );
        })}
        {filteredPlayers.length === 0 && (
          <div className="empty-state">
            <SearchIcon size={32} color="var(--text-muted)" />
            <span className="empty-state-text">No players found</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderSquadInfo = () => {
    if (!rules) return null;

    const startingCount = startingXI.length;
    const totalSquad = career.squad.length;
    const flaggedSquadPlayers = career.squad
      .map(sp => playerMap.get(sp.playerId))
      .filter((p): p is HistoricalPlayer => !!p && p.status !== PlayerStatus.AVAILABLE);

    return (
      <div className="squad-info-panel">
        {flaggedSquadPlayers.length > 0 && (
          <div className="info-section injury-alerts-section">
            <div className="info-section-title" style={{ color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <WarningIcon size={14} color="var(--accent-warning)" />
              Availability Warnings ({flaggedSquadPlayers.length})
            </div>
            <div className="injury-alerts-list">
              {flaggedSquadPlayers.map(p => (
                <div
                  key={p.id}
                  className="injury-alert-row"
                  onClick={() => setDetailPlayerId(p.id)}
                  title={p.news || 'Click to view player details'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '12px' }}>{p.webName}</span>
                    <span className={`status-pill ${getStatusClass(p.status)}`}>
                      {p.chanceOfPlayingThisRound !== null ? `${p.chanceOfPlayingThisRound}%` : (p.status === PlayerStatus.INJURED ? 'INJ' : p.status.toUpperCase())}
                    </span>
                  </div>
                  {p.news && <div className="injury-alert-news">{p.news}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="info-section">
          <div className="info-section-title">Budget</div>
          <div className="info-row">
            <span className="info-row-label">Bank</span>
            <span className="info-row-value money">{formatPrice(career.bank)}</span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Squad Value</span>
            <span className="info-row-value">{formatPrice(career.squadValue)}</span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Team Value</span>
            <span className="info-row-value">{formatPrice(career.bank + career.squadValue)}</span>
          </div>
        </div>

        <div className="info-section">
          <div className="info-section-title">Squad ({totalSquad}/{rules.squadSize})</div>
          {rules.positionRequirements.map(req => (
            <div className="info-row" key={req.position}>
              <span className="info-row-label">{PositionFullLabels[req.position]}</span>
              <span className={`info-row-value ${positionCounts[req.position] < req.squadMin ? 'error' : ''}`}>
                {positionCounts[req.position]}/{req.squadMax}
              </span>
            </div>
          ))}
          <div className="info-row" style={{ marginTop: '8px' }}>
            <span className="info-row-label">Starting XI</span>
            <span className={`info-row-value ${startingCount !== rules.startingXISize ? 'error' : ''}`}>
              {startingCount}/{rules.startingXISize}
            </span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Bench</span>
            <span className="info-row-value">{benchPlayers.length}/{rules.benchSize}</span>
          </div>
        </div>

        {isPreDeadline && career.clock.currentGameweek > 1 && (
          <div className="info-section">
            <div className="info-section-title">Transfers</div>
            <div className="info-row">
              <span className="info-row-label">Free Transfers</span>
              <span className="info-row-value">{career.freeTransfers}</span>
            </div>
            <div className="info-row">
              <span className="info-row-label">Pending</span>
              <span className="info-row-value">{career.pendingTransfers.length}</span>
            </div>
            <div className="info-row">
              <span className="info-row-label">Transfer Cost</span>
              <span className={`info-row-value ${(career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT || rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek)) ? '' : (career.pendingTransfers.length > career.freeTransfers ? 'error' : '')}`}>
                {(career.activeChip === ChipType.WILDCARD || career.activeChip === ChipType.FREE_HIT)
                  ? '0 pts (Free)'
                  : rules.unlimitedTransfersGameweeks?.includes(career.clock.currentGameweek)
                  ? '0 pts (Unlimited)'
                  : `${Math.max(0, career.pendingTransfers.length - career.freeTransfers) * rules.transferPenaltyPoints} pts`}
              </span>
            </div>

            {/* Pending Transfers List with Individual Undo */}
            {career.pendingTransfers.length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Pending Moves ({career.pendingTransfers.length}):
                </div>
                {career.pendingTransfers.map((t) => {
                  const pOut = playerMap.get(t.playerOutId);
                  const pIn = playerMap.get(t.playerInId);
                  const finOut = t.originalSquadPlayer ? getPlayerFinancials(t.originalSquadPlayer) : null;
                  return (
                    <div key={`${t.playerOutId}-${t.playerInId}`} style={{
                      padding: '6px 8px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>
                          <span style={{ color: 'var(--accent-danger)' }}>{pOut?.webName}</span>
                          {' → '}
                          <span style={{ color: 'var(--accent-success)' }}>{pIn?.webName}</span>
                        </span>
                        <button
                          className="btn btn-xs btn-outline"
                          style={{ padding: '1px 6px', fontSize: '10px' }}
                          title={`Undo transfer and restore ${pOut?.webName || 'player'}`}
                          onClick={() => handleRestoreTransfer(t.playerInId)}
                        >
                          ↺ Undo
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-tertiary)', fontSize: '10px' }}>
                        <span>
                          Sold: {formatPrice(t.playerOutPrice)}
                          {t.originalSquadPlayer && t.playerOutPrice > t.originalSquadPlayer.purchasePrice && (
                            <span style={{ color: 'var(--accent-success)', fontWeight: 600, marginLeft: '3px' }}>
                              (+{formatPrice(t.playerOutPrice - t.originalSquadPlayer.purchasePrice)} profit)
                            </span>
                          )}
                          {t.originalSquadPlayer && t.playerOutPrice < t.originalSquadPlayer.purchasePrice && (
                            <span style={{ color: 'var(--accent-danger)', fontWeight: 600, marginLeft: '3px' }}>
                              (-{formatPrice(t.originalSquadPlayer.purchasePrice - t.playerOutPrice)} loss)
                            </span>
                          )}
                        </span>
                        <span className={t.isFreeTransfer ? 'success' : 'error'}>
                          {t.isFreeTransfer ? 'Free' : `-${rules.transferPenaltyPoints} pts`}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <button
                  className="btn btn-sm btn-outline danger"
                  style={{ marginTop: '4px', width: '100%', fontSize: '11px' }}
                  onClick={handleResetAllTransfers}
                >
                  ↺ Reset All Transfers
                </button>
              </div>
            )}

            {/* Pending Removals (Players removed awaiting replacement) */}
            {career.removedPlayers && career.removedPlayers.length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-warning)' }}>
                  Awaiting Replacement ({career.removedPlayers.length}):
                </div>
                {career.removedPlayers.map((rp) => {
                  const p = playerMap.get(rp.player.playerId);
                  const profit = rp.refundedPrice - rp.player.purchasePrice;
                  return (
                    <div key={rp.player.playerId} style={{
                      padding: '6px 8px',
                      background: 'rgba(234, 179, 8, 0.08)',
                      border: '1px solid rgba(234, 179, 8, 0.25)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{p?.webName}</span>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <span>Sold: {formatPrice(rp.refundedPrice)}</span>
                          {profit > 0 && (
                            <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}>
                              (+{formatPrice(profit)} profit)
                            </span>
                          )}
                          {profit < 0 && (
                            <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>
                              (-{formatPrice(-profit)} loss)
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="btn btn-xs btn-outline"
                        style={{ padding: '2px 6px', fontSize: '10px' }}
                        onClick={() => handleRestoreRemovedPlayer(rp.player.playerId, rp.player.isStarting)}
                      >
                        ↺ Restore
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {transferOutId && (
              <div style={{ marginTop: '8px', padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--accent-warning)', fontWeight: 600, marginBottom: '4px' }}>
                  Selecting replacement for:
                </div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                  {playerMap.get(transferOutId)?.webName}
                </div>
                <button className="btn btn-sm" style={{ marginTop: '8px' }} onClick={() => setTransferOutId(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        <div className="info-section">
          <div className="info-section-title">Chips</div>
          <div className="chip-grid">
            {career.chips.map(chip => (
              <div
                key={chip.type}
                className={`chip-card ${chip.available ? 'available' : 'used'} ${career.activeChip === chip.type ? 'active' : ''}`}
                onClick={() => isPreDeadline && chip.available && handleActivateChip(chip.type)}
              >
                <div className="chip-name">{chip.type.replace('_', ' ')}</div>
                <div className="chip-status">
                  {chip.type === ChipType.WILDCARD && rules?.wildcardRules ? (
                    career.clock.currentGameweek < rules.wildcardRules.secondHalfStartGW ? (
                      career.activeChip === chip.type ? 'ACTIVE (1st)' :
                      chip.available ? `Available (Exp GW${rules.wildcardRules.firstHalfDeadlineGW})` :
                      `Used GW${chip.usedInGameweek}`
                    ) : (
                      career.activeChip === chip.type ? 'ACTIVE (2nd)' :
                      chip.available ? 'Available (2nd)' :
                      `Used GW${chip.usedInGameweek}`
                    )
                  ) : (
                    !chip.available ? `Used GW${chip.usedInGameweek}` : career.activeChip === chip.type ? 'ACTIVE' : 'Available'
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {squadValidation && !squadValidation.valid && isPreDeadline && (
          <div className="info-section">
            <div className="info-section-title">Issues</div>
            <ul className="validation-list">
              {squadValidation.errors.map((err, i) => (
                <li key={i} className="validation-error">{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isPreDeadline && totalSquad === rules.squadSize && (
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleConfirmTeam}>
              <LockIcon size={14} /> Confirm Team
            </button>
          )}
          {isPreDeadline && totalSquad > 0 && (
            <button className="btn" style={{ width: '100%' }} onClick={handleAutoArrange}>
              Auto Arrange
            </button>
          )}
          {isLocked && (
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handlePlayGameweek}>
              <GameweekIcon size={14} /> Play GW{career.clock.currentGameweek}
            </button>
          )}
          {isPostGW && career.clock.phase !== SimPhase.SEASON_COMPLETE && (
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleNextGameweek}>
              <ArrowRightIcon size={14} /> Next Gameweek
            </button>
          )}
          <button className="btn" style={{ width: '100%' }} onClick={saveCareer}>
            <SaveIcon size={14} /> Save Career
          </button>
        </div>
      </div>
    );
  };

  const renderMyTeam = () => {
    const pitchRows = buildPitchRows();
    const rules = getSeasonRules(career.season);

    const pitchEmptySlots = isPreDeadline
      ? calculatePitchEmptySlots(startingXI, career.removedPlayers, playerMap)
      : { [Position.GKP]: 0, [Position.DEF]: 0, [Position.MID]: 0, [Position.FWD]: 0 };

    // Track which removed players have been assigned to restore buttons to avoid duplicate restore buttons
    const assignedRemovedPlayerIds = new Set<number>();
    // Never allow restoring a player who is already in career.squad
    career.squad.forEach(sp => assignedRemovedPlayerIds.add(sp.playerId));

    return (
      <div className="app-main">
        {renderPlayerList()}
        <div className={`squad-area ${isDragging ? 'is-dragging-active' : ''}`}>
          {career.activeChip && (
            <div className={`active-chip-banner chip-${career.activeChip}`}>
              <div className="active-chip-icon">
                {career.activeChip === ChipType.FREE_HIT && '⚡'}
                {career.activeChip === ChipType.WILDCARD && '🃏'}
                {career.activeChip === ChipType.TRIPLE_CAPTAIN && '👑'}
                {career.activeChip === ChipType.BENCH_BOOST && '🚀'}
              </div>
              <div className="active-chip-text">
                <span className="active-chip-title">
                  {career.activeChip.replace('_', ' ').toUpperCase()} CHIP ACTIVE
                </span>
                <span className="active-chip-desc">
                  {career.activeChip === ChipType.FREE_HIT && `Make unlimited free transfers for Gameweek ${career.clock.currentGameweek}. Your squad will automatically revert back to your previous team next Gameweek.`}
                  {career.activeChip === ChipType.WILDCARD && 'Make unlimited free transfers. All squad changes are permanent.'}
                  {career.activeChip === ChipType.TRIPLE_CAPTAIN && 'Your captain will score 3× points this Gameweek instead of the usual 2×.'}
                  {career.activeChip === ChipType.BENCH_BOOST && 'Points scored by all 4 bench substitutes will be included in your Gameweek total score.'}
                </span>
              </div>
              {isPreDeadline && (
                <button
                  className="active-chip-cancel-btn"
                  onClick={() => handleActivateChip(career.activeChip!)}
                  title="Cancel chip before deadline"
                >
                  Cancel Chip
                </button>
              )}
            </div>
          )}
          <div className="pitch-container">
            {pitchRows.map((row) => {
              const emptySlots = pitchEmptySlots[row.position] || 0;

              // Filter removed players for this position, prioritizing those that were starters and not yet assigned
              const matchingRemovedForPos = (career.removedPlayers || []).filter(
                rp => !assignedRemovedPlayerIds.has(rp.player.playerId) &&
                      playerMap.get(rp.player.playerId)?.position === row.position
              );
              const sortedRemovedForPos = [...matchingRemovedForPos].sort(
                (a, b) => (b.player.isStarting ? 1 : 0) - (a.player.isStarting ? 1 : 0)
              );

              return (
                <div className="pitch-row" key={row.label}>
                  {row.players.map(sp => renderPitchPlayer(sp))}
                  {emptySlots > 0 && Array.from({ length: emptySlots }).map((_, j) => {
                    const slotKey = `pitch-${row.position}-${j}`;
                    const isSlotTarget = dragOverSlotKey === slotKey;
                    const matchingRemoved = sortedRemovedForPos[j];
                    if (matchingRemoved) {
                      assignedRemovedPlayerIds.add(matchingRemoved.player.playerId);
                    }
                    const removedPlayerObj = matchingRemoved ? playerMap.get(matchingRemoved.player.playerId) : null;

                    return (
                      <div
                        key={`empty-${j}`}
                        className={`pitch-empty-slot ${matchingRemoved ? 'restore-card' : ''} ${isSlotTarget ? 'drag-target' : ''}`}
                        onClick={(e) => {
                          if (matchingRemoved) {
                            e.stopPropagation();
                            handleRestoreRemovedPlayer(matchingRemoved.player.playerId, true);
                          } else {
                            setFilters({ ...filters, position: row.position });
                          }
                        }}
                        onDragEnter={(e) => {
                          if (!isPreDeadline || !activeDragPlayerRef.current) return;
                          e.preventDefault();
                          setDragOverSlotKey(slotKey);
                        }}
                        onDragOver={(e) => {
                          if (!isPreDeadline || !activeDragPlayerRef.current) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                        }}
                        onDragLeave={(e) => {
                          if (e.currentTarget === e.target && dragOverSlotKey === slotKey) {
                            setDragOverSlotKey(null);
                          }
                        }}
                        onDrop={(e) => handleDropOnEmptySlot(row.position, false, e)}
                        title={matchingRemoved ? `Click to restore ${removedPlayerObj?.webName || 'player'}` : `Click to search ${row.label}s`}
                      >
                        {matchingRemoved ? (
                          <>
                            <div className="restore-slot-icon">↺</div>
                            <div className="restore-slot-name" title={removedPlayerObj?.webName}>
                              {removedPlayerObj?.webName}
                            </div>
                            <div className="restore-slot-action">RESTORE</div>
                          </>
                        ) : (
                          <>
                            <div className="empty-slot-plus-icon">
                              <PlusIcon size={14} />
                            </div>
                            <span className="empty-slot-pos-label">
                              {row.label}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="bench-container">
            <div className="bench-title">
              Bench ({benchPlayers.length}/4)
              {career.activeChip === ChipType.BENCH_BOOST && (
                <span style={{ color: 'var(--accent-success)', marginLeft: '10px', fontSize: '11px', fontWeight: 700 }}>
                  🚀 BENCH BOOST ACTIVE — ALL 4 SUBSTITUTES SCORE POINTS
                </span>
              )}
            </div>
            <div className="bench-row">
              {(() => {
                const benchGkp = benchPlayers.find(sp => playerMap.get(sp.playerId)?.position === Position.GKP);
                const benchOutfield = benchPlayers.filter(sp => playerMap.get(sp.playerId)?.position !== Position.GKP);

                // Slot 0: Goalkeeper Substitute (GKP) - ALWAYS fixed at slot 0
                const renderGkpSlot = () => {
                  if (benchGkp) {
                    return (
                      <div key={benchGkp.playerId} className="bench-player-wrapper">
                        <div className="bench-slot-indicator">GKP</div>
                        {renderPitchPlayer(benchGkp, true)}
                      </div>
                    );
                  }
                  if (!isPreDeadline) {
                    return (
                      <div key="bench-gkp-empty" className="bench-player-wrapper">
                        <div className="bench-slot-indicator">GKP</div>
                        <div className="pitch-empty-slot" style={{ opacity: 0.35 }}>—</div>
                      </div>
                    );
                  }
                  const slotKey = 'bench-empty-gkp';
                  const isSlotTarget = dragOverSlotKey === slotKey;
                  const matchingRemovedGkp = (career.removedPlayers || []).find(
                    rp => !assignedRemovedPlayerIds.has(rp.player.playerId) &&
                          playerMap.get(rp.player.playerId)?.position === Position.GKP
                  );
                  if (matchingRemovedGkp) {
                    assignedRemovedPlayerIds.add(matchingRemovedGkp.player.playerId);
                  }
                  const removedGkpObj = matchingRemovedGkp ? playerMap.get(matchingRemovedGkp.player.playerId) : null;

                  return (
                    <div key="bench-gkp-empty" className="bench-player-wrapper">
                      <div className="bench-slot-indicator">GKP</div>
                      <div
                        className={`pitch-empty-slot ${matchingRemovedGkp ? 'restore-card' : ''} ${isSlotTarget ? 'drag-target' : ''}`}
                        onClick={(e) => {
                          if (matchingRemovedGkp) {
                            e.stopPropagation();
                            handleRestoreRemovedPlayer(matchingRemovedGkp.player.playerId, false);
                          } else {
                            setFilters({ ...filters, position: Position.GKP });
                          }
                        }}
                        onDragEnter={(e) => {
                          if (!isPreDeadline || !activeDragPlayerRef.current) return;
                          e.preventDefault();
                          setDragOverSlotKey(slotKey);
                        }}
                        onDragOver={(e) => {
                          if (!isPreDeadline || !activeDragPlayerRef.current) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                        }}
                        onDragLeave={(e) => {
                          if (e.currentTarget === e.target && dragOverSlotKey === slotKey) {
                            setDragOverSlotKey(null);
                          }
                        }}
                        onDrop={(e) => handleDropOnEmptySlot(Position.GKP, true, e)}
                        title={matchingRemovedGkp ? `Click to restore ${removedGkpObj?.webName || 'player'}` : 'Click to search GKPs'}
                      >
                        {matchingRemovedGkp ? (
                          <>
                            <div className="restore-slot-icon">↺</div>
                            <div className="restore-slot-name" title={removedGkpObj?.webName}>
                              {removedGkpObj?.webName}
                            </div>
                            <div className="restore-slot-action">RESTORE</div>
                          </>
                        ) : (
                          <>
                            <div className="empty-slot-plus-icon">
                              <PlusIcon size={14} />
                            </div>
                            <span className="empty-slot-pos-label">GKP</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                };

                // Slots 1, 2, 3: Outfield Substitutes (SUB 1, SUB 2, SUB 3) - ALWAYS fixed at slots 1, 2, 3
                const renderOutfieldSlot = (subIndex: number) => {
                  const subLabel = `SUB ${subIndex + 1}`;
                  const outfieldPlayer = benchOutfield[subIndex];

                  if (outfieldPlayer) {
                    return (
                      <div key={outfieldPlayer.playerId} className="bench-player-wrapper">
                        <div className="bench-slot-indicator">{subLabel}</div>
                        {renderPitchPlayer(outfieldPlayer, true)}
                      </div>
                    );
                  }
                  if (!isPreDeadline) {
                    return (
                      <div key={`bench-empty-sub-${subIndex}`} className="bench-player-wrapper">
                        <div className="bench-slot-indicator">{subLabel}</div>
                        <div className="pitch-empty-slot" style={{ opacity: 0.35 }}>—</div>
                      </div>
                    );
                  }
                  const slotKey = `bench-empty-sub-${subIndex}`;
                  const isSlotTarget = dragOverSlotKey === slotKey;

                  // Find available unassigned removed outfielder whose position would not exceed squadMax
                  const candidateOutfield = (career.removedPlayers || []).filter(rp => {
                    if (assignedRemovedPlayerIds.has(rp.player.playerId)) return false;
                    const p = playerMap.get(rp.player.playerId);
                    if (!p || p.position === Position.GKP) return false;
                    const countInSquad = career.squad.filter(s => playerMap.get(s.playerId)?.position === p.position).length;
                    const req = getPositionRequirement(rules, p.position);
                    return countInSquad < req.squadMax;
                  }).sort((a, b) => {
                    if (!a.player.isStarting && b.player.isStarting) return -1;
                    if (a.player.isStarting && !b.player.isStarting) return 1;
                    return (a.player.benchOrder || 99) - (b.player.benchOrder || 99);
                  });

                  const matchingRemovedOutfield = candidateOutfield[0];
                  if (matchingRemovedOutfield) {
                    assignedRemovedPlayerIds.add(matchingRemovedOutfield.player.playerId);
                  }
                  const removedOutfieldObj = matchingRemovedOutfield ? playerMap.get(matchingRemovedOutfield.player.playerId) : null;

                  return (
                    <div key={`bench-empty-sub-${subIndex}`} className="bench-player-wrapper">
                      <div className="bench-slot-indicator">{subLabel}</div>
                      <div
                        className={`pitch-empty-slot ${matchingRemovedOutfield ? 'restore-card' : ''} ${isSlotTarget ? 'drag-target' : ''}`}
                        onClick={(e) => {
                          if (matchingRemovedOutfield) {
                            e.stopPropagation();
                            handleRestoreRemovedPlayer(matchingRemovedOutfield.player.playerId, false);
                          } else {
                            setFilters({ ...filters, position: null });
                          }
                        }}
                        onDragEnter={(e) => {
                          if (!isPreDeadline || !activeDragPlayerRef.current) return;
                          e.preventDefault();
                          setDragOverSlotKey(slotKey);
                        }}
                        onDragOver={(e) => {
                          if (!isPreDeadline || !activeDragPlayerRef.current) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                        }}
                        onDragLeave={(e) => {
                          if (e.currentTarget === e.target && dragOverSlotKey === slotKey) {
                            setDragOverSlotKey(null);
                          }
                        }}
                        onDrop={(e) => handleDropOnEmptySlot(null, true, e)}
                        title={matchingRemovedOutfield ? `Click to restore ${removedOutfieldObj?.webName || 'player'}` : `Click to search players`}
                      >
                        {matchingRemovedOutfield ? (
                          <>
                            <div className="restore-slot-icon">↺</div>
                            <div className="restore-slot-name" title={removedOutfieldObj?.webName}>
                              {removedOutfieldObj?.webName}
                            </div>
                            <div className="restore-slot-action">RESTORE</div>
                          </>
                        ) : (
                          <>
                            <div className="empty-slot-plus-icon">
                              <PlusIcon size={14} />
                            </div>
                            <span className="empty-slot-pos-label">{subLabel}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                };

                return [
                  renderGkpSlot(),
                  renderOutfieldSlot(0),
                  renderOutfieldSlot(1),
                  renderOutfieldSlot(2),
                ];
              })()}
            </div>
          </div>
        </div>
        {renderSquadInfo()}
      </div>
    );
  };

  const renderGameweekResults = () => {
    if (!currentGWResults) {
      // Show history of all played GWs
      return (
        <div className="main-content">
          <div className="results-page">
            <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Gameweek History</h2>
            {career.gameweekResults.length === 0 ? (
              <div className="empty-state">
                <GameweekIcon size={32} color="var(--text-muted)" />
                <span className="empty-state-text">No gameweeks played yet</span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>GW</th>
                      <th>Raw</th>
                      <th>Captain</th>
                      <th>Hits</th>
                      <th>Final</th>
                      <th>GW Avg</th>
                      <th>GW Rank</th>
                      <th>Overall Rank</th>
                      <th>Total</th>
                      <th>Chip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {career.gameweekResults.map((result, idx) => {
                      const cumulative = career.gameweekResults.slice(0, idx + 1).reduce((sum, r) => sum + r.finalScore, 0);
                      const isAboveAvg = result.averageScore !== undefined && result.finalScore >= result.averageScore;
                      return (
                        <tr key={result.gameweek} onClick={() => setCurrentGWResults(result)} style={{ cursor: 'pointer' }}>
                          <td style={{ fontWeight: 600 }}>GW{result.gameweek}</td>
                          <td>{result.rawScore}</td>
                          <td>+{result.captainPoints}</td>
                          <td style={{ color: result.transferPenalty > 0 ? 'var(--accent-danger)' : undefined }}>
                            {result.transferPenalty > 0 ? `-${result.transferPenalty}` : '0'}
                          </td>
                          <td style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{result.finalScore}</td>
                          <td>
                            {result.averageScore !== undefined ? (
                              <span style={{ color: isAboveAvg ? 'var(--accent-success)' : 'var(--text-tertiary)' }}>
                                {result.averageScore}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            {result.gameweekRank ? (
                              <span>
                                #{result.gameweekRank.toLocaleString()}
                                {result.gameweekPercentile && (
                                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                                    (Top {(100 - result.gameweekPercentile).toFixed(1)}%)
                                  </span>
                                )}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            {result.overallRank ? (
                              <span style={{ fontWeight: 600 }}>
                                #{result.overallRank.toLocaleString()}
                              </span>
                            ) : '-'}
                          </td>
                          <td style={{ fontWeight: 700 }}>{cumulative}</td>
                          <td style={{ fontSize: '10px', textTransform: 'uppercase' }}>{result.chipUsed || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Helper to render player match stats pills
    const renderPlayerStatsPills = (pid: number, player?: HistoricalPlayer) => {
      const stats = currentGWResults.playerStats?.[pid];
      if (!stats) return null;

      return (
        <div className="results-player-stats-badges">
          {stats.goals > 0 && (
            <span className="stat-pill stat-pill-goal" title={`${stats.goals} Goal${stats.goals > 1 ? 's' : ''}`}>
              <GoalIcon size={14} />
              <span>{stats.goals > 1 ? `${stats.goals}G` : '1G'}</span>
            </span>
          )}
          {stats.assists > 0 && (
            <span className="stat-pill stat-pill-assist" title={`${stats.assists} Assist${stats.assists > 1 ? 's' : ''}`}>
              <AssistIcon size={14} />
              <span>{stats.assists > 1 ? `${stats.assists}A` : '1A'}</span>
            </span>
          )}
          {stats.cleanSheets > 0 && (player?.position === Position.GKP || player?.position === Position.DEF) && (
            <span className="stat-pill stat-pill-cs" title="Clean Sheet">
              <CleanSheetIcon size={14} />
              <span>CS</span>
            </span>
          )}
          {stats.bonus > 0 && (
            <span className="stat-pill stat-pill-bonus" title={`${stats.bonus} Bonus Point${stats.bonus > 1 ? 's' : ''}`}>
              <BonusIcon size={14} />
              <span>+{stats.bonus}</span>
            </span>
          )}
          {stats.saves >= 3 && player?.position === Position.GKP && (
            <span className="stat-pill stat-pill-saves" title={`${stats.saves} Saves`}>
              <span>{stats.saves} Sv</span>
            </span>
          )}
          {stats.yellowCards > 0 && (
            <span className="stat-pill stat-pill-yc" title="Yellow Card">
              <CardIcon size={14} color="#eab308" />
            </span>
          )}
          {stats.redCards > 0 && (
            <span className="stat-pill stat-pill-rc" title="Red Card">
              <CardIcon size={14} color="#ef4444" />
            </span>
          )}
          <span className="stat-pill stat-pill-mins" title={`${stats.minutes} minutes played`}>
            {stats.minutes > 0 ? `${stats.minutes}'` : 'DNP'}
          </span>
        </div>
      );
    };

    // Show specific GW result
    return (
      <div className="main-content">
        <div className="results-page">
          <div className="results-header">
            <div className="results-gw">Gameweek {currentGWResults.gameweek}</div>
            <div className="results-score">{currentGWResults.finalScore} <span style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-secondary)' }}>pts</span></div>
            <div className="results-total">
              Season Total: <strong>{career.totalPoints}</strong> pts
            </div>
          </div>

          {currentGWResults.isBlankGameweek && (
            <div style={{
              background: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: '#eab308',
              fontSize: '13px',
              lineHeight: '1.4'
            }}>
              <WarningIcon size={18} color="#eab308" />
              <span>
                <strong>Blank Gameweek:</strong> No Premier League fixtures took place during Gameweek {currentGWResults.gameweek} (Queen Elizabeth II national mourning postponement). All players scored 0 points. Postponed fixtures were rescheduled into later double gameweeks.
              </span>
            </div>
          )}

          {/* Gameweek Rank and Relative Seasonal Context */}
          <div className="results-rank-grid">
            <div className="rank-card">
              <div className="rank-card-header">
                <span className="rank-card-title">Gameweek Rank</span>
                {currentGWResults.gameweekPercentile !== undefined && (
                  <span className={`rank-card-badge ${currentGWResults.gameweekPercentile >= 80 ? 'top-tier' : ''}`}>
                    Top {(100 - currentGWResults.gameweekPercentile).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="rank-card-value">
                {currentGWResults.gameweekRank ? `#${currentGWResults.gameweekRank.toLocaleString()}` : '-'}
              </div>
              <div className="rank-card-sub">
                of {(currentGWResults.totalManagers || 0).toLocaleString()} managers
              </div>
            </div>

            <div className="rank-card">
              <div className="rank-card-header">
                <span className="rank-card-title">Overall Rank</span>
                {currentGWResults.overallPercentile !== undefined && (
                  <span className={`rank-card-badge ${currentGWResults.overallPercentile >= 80 ? 'top-tier' : ''}`}>
                    Top {(100 - currentGWResults.overallPercentile).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="rank-card-value">
                {currentGWResults.overallRank ? `#${currentGWResults.overallRank.toLocaleString()}` : '-'}
              </div>
              <div className="rank-card-sub">
                Season cumulative
              </div>
            </div>

            <div className="rank-card">
              <div className="rank-card-header">
                <span className="rank-card-title">GW Average</span>
                {currentGWResults.averageScore !== undefined && (
                  <span className={`rank-card-badge ${(currentGWResults.finalScore - currentGWResults.averageScore) >= 0 ? 'positive' : 'negative'}`}>
                    {(currentGWResults.finalScore - currentGWResults.averageScore) >= 0 ? '+' : ''}
                    {currentGWResults.finalScore - currentGWResults.averageScore} pts
                  </span>
                )}
              </div>
              <div className="rank-card-value">
                {currentGWResults.averageScore ?? 48} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>pts</span>
              </div>
              <div className="rank-card-sub">
                Highest: {currentGWResults.highestScore ?? '-'} pts
              </div>
            </div>

            <div className="rank-card">
              <div className="rank-card-header">
                <span className="rank-card-title">King of the GW</span>
                {currentGWResults.topPerformer && (
                  <span className="rank-card-badge highlight">
                    {currentGWResults.topPerformer.points} pts
                  </span>
                )}
              </div>
              <div className="rank-card-value" style={{ fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentGWResults.isBlankGameweek ? 'None (Blank GW)' : (currentGWResults.topPerformer?.name || '-')}
              </div>
              <div className="rank-card-sub">
                {currentGWResults.topPerformer ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--accent-success)' }}>
                      <GoalIcon size={14} color="var(--accent-success)" /> {currentGWResults.topPerformer.goals}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#3b82f6' }}>
                      <AssistIcon size={14} color="#3b82f6" /> {currentGWResults.topPerformer.assists}
                    </span>
                  </span>
                ) : 'Top performer'}
              </div>
            </div>
          </div>

          {currentGWResults.chipUsed && (
            <div className={`active-chip-banner chip-${currentGWResults.chipUsed}`} style={{ marginBottom: '16px' }}>
              <div className="active-chip-icon">
                {currentGWResults.chipUsed === ChipType.FREE_HIT && '⚡'}
                {currentGWResults.chipUsed === ChipType.WILDCARD && '🃏'}
                {currentGWResults.chipUsed === ChipType.TRIPLE_CAPTAIN && '👑'}
                {currentGWResults.chipUsed === ChipType.BENCH_BOOST && '🚀'}
              </div>
              <div className="active-chip-text">
                <span className="active-chip-title">
                  {currentGWResults.chipUsed.replace('_', ' ').toUpperCase()} CHIP PLAYED
                </span>
                <span className="active-chip-desc">
                  {currentGWResults.chipUsed === ChipType.FREE_HIT && 'Free Hit was active this Gameweek. Your squad will revert to your pre-Free Hit team upon advancing to the next Gameweek.'}
                  {currentGWResults.chipUsed === ChipType.WILDCARD && 'Wildcard was active this Gameweek. All transfers made have been permanently retained.'}
                  {currentGWResults.chipUsed === ChipType.TRIPLE_CAPTAIN && 'Triple Captain was active this Gameweek. Your captain scored 3× points.'}
                  {currentGWResults.chipUsed === ChipType.BENCH_BOOST && `Bench Boost was active this Gameweek. All 4 bench players scored +${currentGWResults.benchPoints} additional points towards your Gameweek total.`}
                </span>
              </div>
            </div>
          )}

          <div className="results-breakdown">
            <div className="stat-card">
              <div className="stat-card-value">{currentGWResults.rawScore}</div>
              <div className="stat-card-label">Raw Score</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value" style={{ color: 'var(--accent-captain)' }}>+{currentGWResults.captainPoints}</div>
              <div className="stat-card-label">Captain Bonus {currentGWResults.chipUsed === ChipType.TRIPLE_CAPTAIN ? '(TC ×3)' : ''}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value" style={{ color: currentGWResults.transferPenalty > 0 ? 'var(--accent-danger)' : undefined }}>
                {currentGWResults.transferPenalty > 0 ? `-${currentGWResults.transferPenalty}` : '0'}
              </div>
              <div className="stat-card-label">Transfer Cost</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value" style={{ color: currentGWResults.chipUsed === ChipType.BENCH_BOOST ? 'var(--accent-success)' : undefined }}>
                {currentGWResults.chipUsed === ChipType.BENCH_BOOST ? `+${currentGWResults.benchPoints}` : currentGWResults.benchPoints}
              </div>
              <div className="stat-card-label">{currentGWResults.chipUsed === ChipType.BENCH_BOOST ? 'Bench Points (Boosted)' : 'Bench Points'}</div>
            </div>
          </div>

          <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>Starting XI</h3>
          <div className="results-player-list" style={{ marginBottom: '16px' }}>
            {currentGWResults.startingXI.map(pid => {
              const player = playerMap.get(pid);
              const points = currentGWResults.playerPoints[pid] || 0;
              const isCaptain = pid === currentGWResults.captainId;
              const isVC = pid === currentGWResults.viceCaptainId;
              const subbedOut = currentGWResults.substitutions.some(s => s.playerOut === pid);

              return (
                <div key={pid} className={`results-player-row ${isCaptain ? 'captain' : ''} ${subbedOut ? 'subbed-out' : ''}`}>
                  <span className={`player-pos-badge ${getPosClass(player?.position || Position.MID)}`} style={{ fontSize: '9px', width: '26px', height: '18px' }}>
                    {player ? PositionLabels[player.position] : '?'}
                  </span>
                  <div className="player-info">
                    <span className="player-name">
                      {player?.webName || `Player ${pid}`}
                      {isCaptain && (currentGWResults.chipUsed === ChipType.TRIPLE_CAPTAIN ? ' (TC)' : ' (C)')}
                      {isVC && ' (VC)'}
                      {subbedOut && ' ↔'}
                    </span>
                    <span className="player-team">{player ? (getPlayerTeam(player, seasonData?.teams || [], currentGWResults.gameweek)?.shortName || player.teamShortName) : ''}</span>
                  </div>

                  {renderPlayerStatsPills(pid, player)}

                  <span className="results-player-points" style={{ color: points > 0 ? 'var(--accent-primary)' : points < 0 ? 'var(--accent-danger)' : 'var(--text-secondary)' }}>
                    {isCaptain ? `${points} (${currentGWResults.chipUsed === ChipType.TRIPLE_CAPTAIN ? '×3' : '×2'})` : points}
                  </span>
                </div>
              );
            })}
          </div>

          {currentGWResults.substitutions.length > 0 && (
            <>
              <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>Auto-Substitutions</h3>
              <div className="results-player-list" style={{ marginBottom: '16px' }}>
                {currentGWResults.substitutions.map((sub, i) => (
                  <div key={i} className="results-player-row">
                    <span style={{ color: 'var(--accent-danger)', fontSize: '11px', fontWeight: 700 }}>OUT</span>
                    <span className="player-name">{playerMap.get(sub.playerOut)?.webName}</span>
                    <span style={{ color: 'var(--accent-success)', fontSize: '11px', fontWeight: 700 }}>→ {playerMap.get(sub.playerIn)?.webName}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
            Bench {currentGWResults.chipUsed === ChipType.BENCH_BOOST && <span style={{ color: 'var(--accent-success)', marginLeft: '6px', fontSize: '11px', fontWeight: 700 }}>(ALL BOOSTED & SCORED)</span>}
          </h3>
          <div className="results-player-list" style={{ marginBottom: '24px' }}>
            {currentGWResults.bench.map(pid => {
              const player = playerMap.get(pid);
              const points = currentGWResults.playerPoints[pid] || 0;
              const subbedIn = currentGWResults.substitutions.some(s => s.playerIn === pid);
              const isBoosted = currentGWResults.chipUsed === ChipType.BENCH_BOOST;

              return (
                <div key={pid} className="results-player-row" style={{ opacity: (subbedIn || isBoosted) ? 1 : 0.65 }}>
                  <span className={`player-pos-badge ${getPosClass(player?.position || Position.MID)}`} style={{ fontSize: '9px', width: '26px', height: '18px' }}>
                    {player ? PositionLabels[player.position] : '?'}
                  </span>
                  <div className="player-info">
                    <span className="player-name">
                      {player?.webName}
                      {subbedIn && ' ↗'}
                      {isBoosted && <span style={{ color: 'var(--accent-success)', fontSize: '10px', marginLeft: '6px', fontWeight: 700 }}>BOOSTED</span>}
                    </span>
                    <span className="player-team">{player ? (getPlayerTeam(player, seasonData?.teams || [], currentGWResults.gameweek)?.shortName || player.teamShortName) : ''}</span>
                  </div>

                  {renderPlayerStatsPills(pid, player)}

                  <span className="results-player-points" style={{ color: isBoosted && points > 0 ? 'var(--accent-success)' : undefined }}>{points}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={() => setCurrentGWResults(null)}>
              View All Gameweeks
            </button>
            {isPostGW && career.clock.phase !== SimPhase.SEASON_COMPLETE && (
              <button className="btn btn-primary" onClick={handleNextGameweek}>
                <ArrowRightIcon size={14} /> Next Gameweek
              </button>
            )}
            {career.clock.phase === SimPhase.SEASON_COMPLETE && (
              <div style={{ padding: '8px', color: 'var(--accent-captain)', fontWeight: 600 }}>
                Season Complete — Final Score: {career.totalPoints} pts
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderFixtures = () => {
    if (!seasonData) return null;

    // Group fixtures by gameweek
    const fixturesByGW = new Map<number, HistoricalFixture[]>();
    seasonData.fixtures.forEach(f => {
      if (f.gameweek === null) return;
      const existing = fixturesByGW.get(f.gameweek) || [];
      existing.push(f);
      fixturesByGW.set(f.gameweek, existing);
    });

    // Show only fixtures up to current GW + next few
    const currentGW = career.clock.currentGameweek;
    const maxVisible = Math.min(currentGW + 5, seasonData.totalGameweeks);

    return (
      <div className="main-content">
        <div className="fixtures-page">
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Fixtures</h2>
          {seasonData.fixtures.length === 0 ? (
            <div className="empty-state">
              <GameweekIcon size={32} color="var(--text-muted)" />
              <span className="empty-state-text">Fixture data not available for {career.season.replace('-', '/')} season</span>
            </div>
          ) : (
            Array.from({ length: maxVisible }, (_, i) => i + 1).map(gw => {
              const fixtures = fixturesByGW.get(gw) || [];
              if (fixtures.length === 0) {
                return (
                  <div key={gw}>
                    <div className="fixtures-gw-header">
                      Gameweek {gw}
                      {gw === currentGW && <span style={{ color: 'var(--accent-primary)', marginLeft: '8px', fontSize: '11px' }}>CURRENT</span>}
                    </div>
                    <div className="fixture-row" style={{ justifyContent: 'center', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '13px', padding: '12px' }}>
                      Blank Gameweek — All fixtures postponed to later gameweeks
                    </div>
                  </div>
                );
              }

              const isCompleted = gw < currentGW || (gw === currentGW && career.clock.phase !== SimPhase.PRE_DEADLINE && career.clock.phase !== SimPhase.PRE_SEASON_TEAM_BUILD);

              return (
                <div key={gw}>
                  <div className="fixtures-gw-header">
                    Gameweek {gw}
                    {gw === currentGW && <span style={{ color: 'var(--accent-primary)', marginLeft: '8px', fontSize: '11px' }}>CURRENT</span>}
                  </div>
                  {fixtures.map(f => (
                    <div key={f.id} className="fixture-row">
                      <span className="fixture-home">{f.homeTeamShortName || f.homeTeamName}</span>
                      <span className={`fixture-score ${isCompleted ? 'played' : ''}`}>
                        {isCompleted && f.homeScore !== null ? `${f.homeScore} - ${f.awayScore}` : 'vs'}
                      </span>
                      <span className="fixture-away">{f.awayTeamShortName || f.awayTeamName}</span>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderPlayers = () => {
    return (
      <div className="app-main">
        {renderPlayerList()}
        <div className="main-content">
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Player Database</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
            Use the player panel to search, filter, and sort players. Click a player for detailed stats.
            {career.clock.currentGameweek > 1 &&
              ` Statistics shown up to Gameweek ${career.clock.currentGameweek - 1}.`
            }
            {career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD &&
              ' Pre-season — no gameweek statistics available yet.'
            }
          </p>
        </div>
      </div>
    );
  };

  const renderStatistics = () => {
    const gwResults = career.gameweekResults;
    const avgPoints = gwResults.length > 0 ? Math.round(career.totalPoints / gwResults.length) : 0;
    const highestGW = gwResults.length > 0 ? Math.max(...gwResults.map(r => r.finalScore)) : 0;
    const lowestGW = gwResults.length > 0 ? Math.min(...gwResults.map(r => r.finalScore)) : 0;
    const totalCaptainPoints = gwResults.reduce((sum, r) => sum + r.captainPoints, 0);
    const totalTransferCosts = gwResults.reduce((sum, r) => sum + r.transferPenalty, 0);
    const totalBenchPoints = gwResults.reduce((sum, r) => sum + r.benchPoints, 0);

    return (
      <div className="main-content">
        <div className="stats-page">
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '24px' }}>Your Statistics</h2>

          <div className="stats-overview-grid">
            <div className="stats-big-card">
              <div className="stats-big-value" style={{ color: 'var(--accent-primary)' }}>{career.totalPoints}</div>
              <div className="stats-big-label">Total Points</div>
            </div>
            <div className="stats-big-card">
              <div className="stats-big-value">{gwResults.length}</div>
              <div className="stats-big-label">GWs Played</div>
            </div>
            <div className="stats-big-card">
              <div className="stats-big-value">{avgPoints}</div>
              <div className="stats-big-label">Avg Points</div>
            </div>
            <div className="stats-big-card">
              <div className="stats-big-value">{highestGW}</div>
              <div className="stats-big-label">Highest GW</div>
            </div>
          </div>

          <div className="info-section" style={{ marginBottom: '16px' }}>
            <div className="info-section-title">Season Breakdown</div>
            <div className="info-row"><span className="info-row-label">Lowest Gameweek</span><span className="info-row-value">{lowestGW || '-'}</span></div>
            <div className="info-row"><span className="info-row-label">Captain Bonus (Total)</span><span className="info-row-value points">{totalCaptainPoints}</span></div>
            <div className="info-row"><span className="info-row-label">Transfer Costs (Total)</span><span className="info-row-value error">{totalTransferCosts}</span></div>
            <div className="info-row"><span className="info-row-label">Bench Points (Total)</span><span className="info-row-value">{totalBenchPoints}</span></div>
            <div className="info-row"><span className="info-row-label">Transfers Made</span><span className="info-row-value">{career.allTransfers.length}</span></div>
            <div className="info-row"><span className="info-row-label">Squad Value</span><span className="info-row-value money">{formatPrice(career.squadValue)}</span></div>
            <div className="info-row"><span className="info-row-label">Bank</span><span className="info-row-value money">{formatPrice(career.bank)}</span></div>
            <div className="info-row"><span className="info-row-label">Team Value</span><span className="info-row-value money">{formatPrice(career.bank + career.squadValue)}</span></div>
          </div>

          <div className="info-section">
            <div className="info-section-title">Chips Used</div>
            {career.chips.map(c => (
              <div className="info-row" key={c.type}>
                <span className="info-row-label" style={{ textTransform: 'capitalize' }}>{c.type.replace('_', ' ')}</span>
                <span className="info-row-value">{c.usedInGameweek ? `GW${c.usedInGameweek}` : 'Available'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderSettings = () => {
    return (
      <div className="main-content">
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '24px' }}>Settings</h2>

          <div className="info-section" style={{ marginBottom: '16px' }}>
            <div className="info-section-title">Current Career</div>
            <div className="info-row"><span className="info-row-label">Season</span><span className="info-row-value">{career.season.replace('-', '/')}</span></div>
            <div className="info-row"><span className="info-row-label">Gameweek</span><span className="info-row-value">{career.clock.currentGameweek}</span></div>
            <div className="info-row"><span className="info-row-label">Phase</span><span className="info-row-value">{career.clock.phase}</span></div>
            <div className="info-row"><span className="info-row-label">Points</span><span className="info-row-value points">{career.totalPoints}</span></div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button className="btn" style={{ width: '100%' }} onClick={saveCareer}>
              <SaveIcon size={14} /> Save Career
            </button>
            <button className="btn btn-danger" style={{ width: '100%' }} onClick={handleExitToMenu}>
              <CloseIcon size={14} /> Exit to Menu
            </button>
          </div>

          <div className="attribution" style={{ marginTop: '48px' }}>
            Historical FPL data provided by{' '}
            <a href="https://github.com/vaastav/Fantasy-Premier-League" target="_blank" rel="noopener noreferrer">
              Vaastav's Fantasy Premier League dataset
            </a>
          </div>
        </div>
      </div>
    );
  };

  // ---- PLAYER DETAIL MODAL ----
  const renderPlayerDetailModal = () => {
    if (detailPlayerId === null) return null;

    const player = playerMap.get(detailPlayerId);
    if (!player) return null;

    const price = getCurrentPrice(detailPlayerId);
    const stats = getPlayerStats(detailPlayerId);
    const maxGW = career.clock.phase === SimPhase.PRE_SEASON_TEAM_BUILD ? 0 : career.clock.currentGameweek - 1;

    return (
      <div className="modal-overlay" onClick={() => setDetailPlayerId(null)}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <div className="modal-title">{player.firstName} {player.lastName}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {getPlayerTeam(player, seasonData?.teams || [], career?.clock.currentGameweek ?? 1)?.name || player.teamName} · {PositionFullLabels[player.position]}
              </div>
            </div>
            <button className="modal-close" onClick={() => setDetailPlayerId(null)}>
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span className={`player-pos-badge ${getPosClass(player.position)}`} style={{ width: '40px', height: '28px', fontSize: '12px' }}>
                {PositionLabels[player.position]}
              </span>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                {formatPrice(price)}
              </span>
            </div>

            {/* Purchase, Current & Selling Price for Squad Players */}
            {(() => {
              const sp = career.squad.find(s => s.playerId === player.id);
              if (sp) {
                const fin = getPlayerFinancials(sp, price);
                const priceDiff = fin.currentPrice - fin.purchasePrice;
                return (
                  <div style={{
                    marginBottom: '16px',
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px',
                      textAlign: 'center',
                    }}>
                      <div style={{ padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px', fontWeight: 600 }}>PURCHASE PRICE</div>
                        <div style={{ fontSize: '14px', fontWeight: 700 }}>{formatPrice(fin.purchasePrice)}</div>
                      </div>
                      <div style={{ padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px', fontWeight: 600 }}>CURRENT VALUE</div>
                        <div style={{ fontSize: '14px', fontWeight: 700 }}>
                          {formatPrice(fin.currentPrice)}
                          {priceDiff > 0 && <span style={{ fontSize: '10px', color: 'var(--accent-success)', marginLeft: '3px' }}>+{(priceDiff / 10).toFixed(1)}</span>}
                          {priceDiff < 0 && <span style={{ fontSize: '10px', color: 'var(--accent-danger)', marginLeft: '3px' }}>{(priceDiff / 10).toFixed(1)}</span>}
                        </div>
                      </div>
                      <div style={{ padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px', fontWeight: 600 }}>SELLING PRICE</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                          {formatPrice(fin.sellingPrice)}
                          {fin.profit > 0 && <span style={{ fontSize: '10px', color: 'var(--accent-success)', marginLeft: '3px' }}>+{(fin.profit / 10).toFixed(1)}</span>}
                          {fin.isLoss && <span style={{ fontSize: '10px', color: 'var(--accent-danger)', marginLeft: '3px' }}>{((fin.sellingPrice - fin.purchasePrice) / 10).toFixed(1)}</span>}
                        </div>
                      </div>
                    </div>
                    {/* Official FPL Sell-on Rule Callout */}
                    <div style={{
                      fontSize: '11px',
                      lineHeight: '1.45',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: fin.profit > 0 ? 'rgba(16, 185, 129, 0.08)' : fin.isLoss ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-secondary)',
                      border: `1px solid ${fin.profit > 0 ? 'rgba(16, 185, 129, 0.25)' : fin.isLoss ? 'rgba(239, 68, 68, 0.25)' : 'var(--border-color)'}`,
                      color: fin.profit > 0 ? 'var(--accent-success)' : fin.isLoss ? 'var(--accent-danger)' : 'var(--text-secondary)',
                    }}>
                      {fin.profit > 0 ? (
                        <span>
                          ★ <strong>Official FPL 50% Sell-on Rule</strong>: A sell-on fee of 50% (rounded down to nearest £0.1m) applies to any profit. Since this player's value increased by +{formatPrice(priceDiff)}, you retain +{formatPrice(fin.profit)} profit upon sale ({formatPrice(fin.purchasePrice)} purchase + {formatPrice(fin.profit)} profit = {formatPrice(fin.sellingPrice)} selling price).
                        </span>
                      ) : fin.isLoss ? (
                        <span>
                          ★ <strong>Official FPL Price Fall Rule</strong>: If a player's price drops below what you paid, you absorb the full loss. Selling price equals current market value ({formatPrice(fin.sellingPrice)}).
                        </span>
                      ) : (
                        <span>
                          ★ <strong>Price Unchanged</strong>: Selling price equals purchase price ({formatPrice(fin.sellingPrice)}).
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              // Check if player was removed or transferred out this GW
              const rp = career.removedPlayers?.find(r => r.player.playerId === player.id);
              if (rp) {
                const profit = rp.refundedPrice - rp.player.purchasePrice;
                return (
                  <div style={{
                    marginBottom: '16px',
                    padding: '10px 12px',
                    background: 'rgba(234, 179, 8, 0.08)',
                    borderRadius: '8px',
                    border: '1px solid rgba(234, 179, 8, 0.25)',
                    fontSize: '11px',
                    lineHeight: '1.45',
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--accent-warning)', marginBottom: '4px' }}>
                      Awaiting Replacement (Removed from Squad)
                    </div>
                    <div>
                      Bought for {formatPrice(rp.player.purchasePrice)} · Sold for {formatPrice(rp.refundedPrice)}
                      {profit > 0 && <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}> (+{formatPrice(profit)} profit via FPL 50% rule)</span>}
                      {profit < 0 && <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}> (-{formatPrice(-profit)} loss)</span>}
                    </div>
                  </div>
                );
              }

              const pt = career.pendingTransfers?.find(t => t.playerOutId === player.id);
              if (pt && pt.originalSquadPlayer) {
                const profit = pt.playerOutPrice - pt.originalSquadPlayer.purchasePrice;
                return (
                  <div style={{
                    marginBottom: '16px',
                    padding: '10px 12px',
                    background: 'rgba(234, 179, 8, 0.08)',
                    borderRadius: '8px',
                    border: '1px solid rgba(234, 179, 8, 0.25)',
                    fontSize: '11px',
                    lineHeight: '1.45',
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--accent-warning)', marginBottom: '4px' }}>
                      Transferred Out this Gameweek
                    </div>
                    <div>
                      Bought for {formatPrice(pt.originalSquadPlayer.purchasePrice)} · Sold for {formatPrice(pt.playerOutPrice)}
                      {profit > 0 && <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}> (+{formatPrice(profit)} profit via FPL 50% rule)</span>}
                      {profit < 0 && <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}> (-{formatPrice(-profit)} loss)</span>}
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Status & Injury Details */}
            <div style={{ marginBottom: '16px', padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: player.reason || player.expectedReturn || player.news ? '8px' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                  <span className={`status-dot ${getStatusClass(player.status)}`} />
                  <span style={{ textTransform: 'capitalize' }}>
                    {player.status === 'a' ? 'Available' : player.status === 'd' ? `Doubtful (${player.chanceOfPlayingThisRound || 75}%)` : player.status === 'i' ? 'Injured (0%)' : player.status === 's' ? 'Suspended' : player.status === 'u' ? 'Unavailable' : 'Unknown'}
                  </span>
                </div>
                {player.weeksOut !== undefined && player.weeksOut !== null && (
                  <span className="badge" style={{
                    background: player.weeksOut <= 1 ? 'rgba(234, 179, 8, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: player.weeksOut <= 1 ? '#eab308' : '#ef4444',
                    border: `1px solid ${player.weeksOut <= 1 ? 'rgba(234, 179, 8, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px'
                  }}>
                    {player.weeksOut === 0 ? 'Returning this GW' : player.weeksOut === 1 ? '1 week remaining' : `${player.weeksOut} weeks out`}
                  </span>
                )}
              </div>

              {player.reason && (
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <InjuryIcon size={14} color={player.status === 's' ? '#f59e0b' : '#ef4444'} />
                  <span><strong>Reason:</strong> {player.reason}</span>
                </div>
              )}

              {player.expectedReturn && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <CalendarIcon size={14} color="var(--accent-primary)" />
                  <span><strong>Return Timeline:</strong> {player.expectedReturn}</span>
                </div>
              )}

              {!player.reason && !player.expectedReturn && (
                player.news ? (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{player.news}</div>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    {player.status === 'a' ? 'Fully fit — available for selection' : 'Historical availability information unavailable.'}
                  </div>
                )
              )}
            </div>

            {/* Stats */}
            {stats && maxGW > 0 ? (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-card-value">{stats.totalPoints}</div>
                    <div className="stat-card-label">Points</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                      <GoalIcon size={16} color="var(--accent-success)" />
                      {stats.goals}
                    </div>
                    <div className="stat-card-label">Goals</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                      <AssistIcon size={16} color="#3b82f6" />
                      {stats.assists}
                    </div>
                    <div className="stat-card-label">Assists</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{stats.bonus}</div>
                    <div className="stat-card-label">Bonus</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{stats.minutes}</div>
                    <div className="stat-card-label">Minutes</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{stats.cleanSheets}</div>
                    <div className="stat-card-label">CS</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{stats.form}</div>
                    <div className="stat-card-label">Form</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{stats.pointsPerGame}</div>
                    <div className="stat-card-label">PPG</div>
                  </div>
                </div>

                {/* GW History */}
                <h4 style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                  Gameweek History (up to GW{maxGW})
                </h4>
                <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                  <table className="gw-history-table">
                    <thead>
                      <tr>
                        <th>GW</th>
                        <th>Club</th>
                        <th>Pts</th>
                        <th>Min</th>
                        <th title="Goals">
                          <GoalIcon size={14} color="var(--text-tertiary)" />
                        </th>
                        <th title="Assists">
                          <AssistIcon size={14} color="var(--text-tertiary)" />
                        </th>
                        <th>CS</th>
                        <th>Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.gameweekHistory.map((gwd, i) => (
                        <tr key={i}>
                          <td>{gwd.gameweek}</td>
                          <td style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {getPlayerTeam(player, seasonData?.teams || [], gwd.gameweek)?.shortName || player.teamShortName}
                          </td>
                          <td style={{ fontWeight: 600 }}>{gwd.totalPoints}</td>
                          <td>{gwd.minutes}</td>
                          <td>{gwd.goals}</td>
                          <td>{gwd.assists}</td>
                          <td>{gwd.cleanSheets}</td>
                          <td>{gwd.bonus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty-state" style={{ padding: '16px' }}>
                <InfoIcon size={24} color="var(--text-muted)" />
                <span className="empty-state-text">
                  {maxGW === 0 ? 'Pre-season — no gameweek statistics available yet.' : 'No statistics available.'}
                </span>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
              {(() => {
                const transferIn = career.pendingTransfers.find(t => t.playerInId === player.id);
                if (transferIn) {
                  const pOut = playerMap.get(transferIn.playerOutId);
                  return (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        handleRestoreTransfer(player.id);
                        setDetailPlayerId(null);
                      }}
                    >
                      ↺ Undo Transfer (Restore {pOut?.webName || 'player'})
                    </button>
                  );
                }
                return null;
              })()}
              {transferOutId && !career.squad.some(s => s.playerId === player.id) && (
                <button className="btn btn-primary btn-sm" onClick={() => { handleConfirmTransfer(player.id); setDetailPlayerId(null); }}>
                  <TransferIcon size={14} /> Confirm Transfer
                </button>
              )}
              {!transferOutId && isPreDeadline && !career.squad.some(s => s.playerId === player.id) && (
                <button className="btn btn-primary btn-sm" onClick={() => { handleAddPlayer(player.id); setDetailPlayerId(null); }}>
                  <PlusIcon size={14} /> Add to Squad
                </button>
              )}
              {isPreDeadline && career.squad.some(s => s.playerId === player.id) && (
                <>
                  {career.clock.currentGameweek > 1 && (
                    <button
                      className="btn btn-warning btn-sm"
                      onClick={() => {
                        setTransferOutId(player.id);
                        setDetailPlayerId(null);
                        addToast(`Select a replacement for ${player.webName}`, 'info');
                      }}
                    >
                      <TransferIcon size={14} /> Transfer Out
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => { handleRemovePlayer(player.id); setDetailPlayerId(null); }}>
                    <MinusIcon size={14} /> Remove
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---- CONTEXT MENU ----
  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const sp = career.squad.find(s => s.playerId === contextMenu.playerId);
    if (!sp) return null;
    const player = playerMap.get(contextMenu.playerId);

    const transferIn = career.pendingTransfers.find(t => t.playerInId === contextMenu.playerId);

    return (
      <div
        className="context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={e => e.stopPropagation()}
      >
        <button className="context-menu-item" onClick={() => { setDetailPlayerId(contextMenu.playerId); setContextMenu(null); }}>
          <InfoIcon size={14} /> View Details
        </button>
        {transferIn && (
          <button
            className="context-menu-item"
            onClick={() => {
              handleRestoreTransfer(contextMenu.playerId);
              setContextMenu(null);
            }}
          >
            <ResetIcon size={14} /> Undo Transfer (Restore {playerMap.get(transferIn.playerOutId)?.webName})
          </button>
        )}
        {sp.isStarting ? (
          <button className="context-menu-item" onClick={() => { handleToggleStarting(contextMenu.playerId); setContextMenu(null); }}>
            Move to Bench
          </button>
        ) : (
          <button className="context-menu-item" onClick={() => { handleToggleStarting(contextMenu.playerId); setContextMenu(null); }}>
            Move to Starting XI
          </button>
        )}
        {sp.isStarting && !sp.isCaptain && (
          <button className="context-menu-item" onClick={() => { handleSetCaptain(contextMenu.playerId); setContextMenu(null); }}>
            <CaptainIcon size={14} /> Set as Captain
          </button>
        )}
        {sp.isStarting && !sp.isViceCaptain && (
          <button className="context-menu-item" onClick={() => { handleSetViceCaptain(contextMenu.playerId); setContextMenu(null); }}>
            <ViceCaptainIcon size={14} /> Set as Vice-Captain
          </button>
        )}
        {career.clock.currentGameweek > 1 && (
          <>
            <div className="context-menu-divider" />
            <button className="context-menu-item" onClick={() => { setTransferOutId(contextMenu.playerId); setContextMenu(null); addToast(`Select a replacement for ${player?.webName}`, 'info'); }}>
              <EditIcon size={14} /> Transfer Out
            </button>
          </>
        )}
        <div className="context-menu-divider" />
        <button className="context-menu-item danger" onClick={() => { handleRemovePlayer(contextMenu.playerId); setContextMenu(null); }}>
          <TrashIcon size={14} /> Remove
        </button>
      </div>
    );
  };

  // ---- PHASE LABEL ----
  const getPhaseLabel = () => {
    switch (career.clock.phase) {
      case SimPhase.PRE_SEASON_TEAM_BUILD: return 'SQUAD BUILD';
      case SimPhase.PRE_DEADLINE: return 'PRE-DEADLINE';
      case SimPhase.TEAM_LOCKED: return 'TEAM LOCKED';
      case SimPhase.GAMEWEEK_RESULTS: return 'RESULTS';
      case SimPhase.POST_GAMEWEEK: return 'POST-GW';
      case SimPhase.SEASON_COMPLETE: return 'SEASON OVER';
      default: return career.clock.phase;
    }
  };

  // ---- MAIN RENDER ----
  const renderPage = () => {
    switch (page) {
      case AppPage.MY_TEAM:
      case AppPage.TRANSFERS:
        return renderMyTeam();
      case AppPage.PLAYERS:
        return renderPlayers();
      case AppPage.FIXTURES:
        return renderFixtures();
      case AppPage.GAMEWEEKS:
      case AppPage.HISTORY:
        return renderGameweekResults();
      case AppPage.STATISTICS:
        return renderStatistics();
      case AppPage.SETTINGS:
        return renderSettings();
      default:
        return renderMyTeam();
    }
  };

  return (
    <div className="app-container">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo">
            Historical <span>FPL</span>
          </div>
          <div className="app-header-stats">
            <div className="header-stat">
              <span className="header-stat-label">Season</span>
              <span className="header-stat-value">{career.season.replace('-', '/')}</span>
            </div>
            <div className="header-stat">
              <span className="header-stat-label">Gameweek</span>
              <span className="header-stat-value">{career.clock.currentGameweek}</span>
            </div>
            <div className="header-stat">
              <span className="header-stat-label">Status</span>
              <span className="header-stat-value" style={{ fontSize: '11px', color: isLocked ? 'var(--accent-warning)' : isPostGW ? 'var(--accent-info)' : 'var(--accent-primary)' }}>
                {getPhaseLabel()}
              </span>
            </div>
            <div className="header-stat">
              <span className="header-stat-label">Points</span>
              <span className="header-stat-value points">{career.totalPoints}</span>
            </div>
            <div className="header-stat">
              <span className="header-stat-label">Bank</span>
              <span className="header-stat-value">{formatPrice(career.bank)}</span>
            </div>
            <div className="header-stat">
              <span className="header-stat-label">Value</span>
              <span className="header-stat-value">{formatPrice(career.bank + career.squadValue)}</span>
            </div>
          </div>
        </div>

        <div className="app-header-right">
          <div className={`header-autosave ${!isAutosaving ? 'saved' : ''}`} title="Career is automatically saved after each gameweek and change">
            <span className="autosave-dot" />
            {isAutosaving ? 'Saving...' : lastSavedTime ? `Autosaved (${lastSavedTime})` : 'Autosaved'}
          </div>
          <button className="btn btn-sm" onClick={saveCareer} title="Manual save">
            <SaveIcon size={14} /> Save
          </button>
          <button className="btn btn-sm btn-danger" onClick={handleExitToMenu} title="Exit to main menu">
            <CloseIcon size={14} /> Exit
          </button>
        </div>
      </header>

      {/* Navigation */}
      <nav className="app-nav">
        <button className={`nav-item ${page === AppPage.MY_TEAM ? 'active' : ''}`} onClick={() => setPage(AppPage.MY_TEAM)}>
          <TeamIcon size={14} /> My Team
        </button>
        <button className={`nav-item ${page === AppPage.PLAYERS ? 'active' : ''}`} onClick={() => setPage(AppPage.PLAYERS)}>
          <SearchIcon size={14} /> Players
        </button>
        <button className={`nav-item ${page === AppPage.FIXTURES ? 'active' : ''}`} onClick={() => setPage(AppPage.FIXTURES)}>
          <GameweekIcon size={14} /> Fixtures
        </button>
        <button className={`nav-item ${page === AppPage.GAMEWEEKS ? 'active' : ''}`} onClick={() => setPage(AppPage.GAMEWEEKS)}>
          <PointsIcon size={14} /> Gameweeks
        </button>
        <button className={`nav-item ${page === AppPage.STATISTICS ? 'active' : ''}`} onClick={() => setPage(AppPage.STATISTICS)}>
          <ChipIcon size={14} /> Stats
        </button>
        <button className={`nav-item ${page === AppPage.SETTINGS ? 'active' : ''}`} onClick={() => setPage(AppPage.SETTINGS)}>
          Settings
        </button>
      </nav>

      {/* Loading overlay */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(14, 17, 23, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="loading-container">
            <div className="loading-spinner" />
            <span>Loading...</span>
          </div>
        </div>
      )}

      {/* Page content */}
      {renderPage()}

      {/* Modals */}
      {renderPlayerDetailModal()}
      {renderContextMenu()}
    </div>
  );
}
