/**
 * Shared state bus (owner: Opus 5.5). codex + agy: read-only.
 *
 * Rules:
 *  - UI calls ACTIONS only; actions update state and forward to the registered GraphEngineHandle.
 *  - Engine writes ONLY through the "engine reporting" actions, and only on discrete events
 *    (genesis step, replay) — NEVER from inside a requestAnimationFrame tick.
 *  - Per-frame readers (canvas loop) use `useGraphStore.getState()`, never hooks.
 */
import { create } from 'zustand';
import { franchiseMemberIds } from '../types/contract';
import type {
  AnimeRecord,
  AnimeSummary,
  GraphOptions,
  DisplayLocale,
  GenesisSpeed,
  GenesisState,
  GraphData,
  GraphEngineHandle,
  RecommendationSet,
  SpotlightState,
  ViewMode,
  VoiceActorRecord,
} from '../types/contract';

const EMPTY: ReadonlySet<string> = new Set();
/**
 * Optimistic records (filmography / recommendation "+" before the full cast arrives). Never written to the cast
 * cache: a reload mid-hydration must re-fetch, not restore a one-character pool as if it were complete.
 */
export const provisionalRecords = new WeakSet<AnimeRecord>();
const EMPTY_IDS: ReadonlySet<number> = new Set();
/** Fewer than this → Generate is disabled (helper hint only, no counters). */
export const MIN_WATCHED = 2;
const RETRACT_MS = 320;

export interface GraphStore {
  /* curation */
  watchedAnime: AnimeRecord[];
  anchorAnimeId: number | null;
  addAnime: (anime: AnimeRecord) => void;
  removeAnime: (animeId: number) => void;
  setAnchor: (animeId: number) => void;
  /** Swap a record in place (list order and anchor preserved) — used when a restored summary gets its cast pool. */
  replaceAnimeRecord: (oldId: number, record: AnimeRecord) => void;
  /**
   * The graph on stage was restored from a saved session: build it instantly (no 1× build-up). One-shot — every
   * `setGraph` clears it, and it never touches the user-facing `genesisSpeed`.
   */
  instantGenesis: boolean;
  /** True while a restored session still waits for cast pools to hydrate (graph restore pending, Generate disabled). */
  restoring: boolean;
  /** The last write to localStorage failed (quota / blocked site data). The drawer says so and points to the backup link. */
  saveFailed: boolean;
  /** "초기화" just cleared this many anime; one "되돌리기" (lib/session `undoReset`) brings them back. Null otherwise. */
  lastCleared: { count: number } | null;

  /* graph */
  graph: GraphData | null;
  /** A graph with `carry` keeps the current selection + recommendation-free state; any other graph resets. */
  setGraph: (graph: GraphData | null) => void;

  /* in-flight "add to watched list" requests (search rows, preview modal, recommendation nodes) */
  addingAnimeIds: ReadonlySet<number>;
  addErrors: ReadonlyMap<number, string>;
  markAdding: (animeId: number, adding: boolean, error?: string) => void;

  /** HUD filters. Flags only — `lib/rebuildGraph.setGraphFilter` also rebuilds the graph (carrying positions). */
  showSupportingRoles: boolean;
  includeSubVoiceActors: boolean;
  setGraphFilterFlags: (patch: Partial<GraphOptions>) => void;

  /* anime preview modal (search rows + recommendation satellites) */
  animePreview: AnimeSummary | null;
  openAnimePreview: (anime: AnimeSummary) => void;
  closeAnimePreview: () => void;

  /* 성우 검색 → filmography picker */
  seiyuuPicker: VoiceActorRecord | null;
  openSeiyuuPicker: (va: VoiceActorRecord) => void;
  closeSeiyuuPicker: () => void;

  /** Opened from a `?s=` / `?b=` link: a sandbox that never writes the visitor's own saved map until they choose to. */
  isSharedView: boolean;
  /** What the sandbox shows: someone else's map (`?s=`) or the visitor's own backup link (`?b=`). */
  sharedSource: 'share' | 'backup';
  /** While the sandbox is open: how many anime the visitor's own saved list holds (0 = nothing saved yet). */
  ownSavedCount: number;
  /** A backup link was adopted automatically on this visit (no saved list to protect): how many anime it restored. */
  restoredFromBackup: number | null;
  dismissRestoredNotice: () => void;
  /** Share & summary-card modal. */
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;

  /* main-role recommendation expansion */
  recommendEnabled: boolean;
  setRecommendEnabled: (enabled: boolean) => void;
  recommendations: RecommendationSet | null;
  /** Forwards to the engine FIRST (so node x/y exist), then commits to state. */
  setRecommendations: (set: RecommendationSet | null) => void;
  /** Flags the set `retracting`, lets nodes animate out, then removes it (~320ms). */
  retractRecommendations: () => void;

  /**
   * Graph-node portraits are drawn small at most zoom levels: false → nodes request AniList's 100×150 `medium` file,
   * true → the 230×345 `large` one. Written by the stage only when the zoom settles or the view mode changes.
   */
  hiResImages: boolean;

  /* view */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  locale: DisplayLocale;
  setLocale: (locale: DisplayLocale) => void;
  leftDrawerOpen: boolean;
  setLeftDrawerOpen: (open: boolean) => void;

  /* interaction */
  hoveredNodeId: string | null;
  setHoveredNode: (nodeId: string | null) => void;
  selectedNodeId: string | null;
  selectNode: (nodeId: string | null) => void;

  /* playback / physics */
  physicsPaused: boolean;
  togglePhysics: () => void;
  genesisSpeed: GenesisSpeed;
  setGenesisSpeed: (speed: GenesisSpeed) => void;
  replayGenesis: () => void;
  fitView: () => void;
  focusNode: (nodeId: string) => void;

  /* engine reporting (engine-only writers) */
  engine: GraphEngineHandle | null;
  registerEngine: (handle: GraphEngineHandle | null) => void;
  genesis: GenesisState;
  setGenesisState: (patch: Partial<GenesisState>) => void;
  /** Nodes currently spawned on stage. NodeLayer renders exactly these. */
  revealedNodeIds: ReadonlySet<string>;
  /** VA nodes whose 2nd+ anime has spawned (bridge discovered). */
  activeBridgeIds: ReadonlySet<string>;
  revealNodes: (nodeIds: readonly string[], bridgeIds?: readonly string[]) => void;
  resetReveal: () => void;
}

const union = (a: ReadonlySet<string>, b: readonly string[] | undefined): ReadonlySet<string> =>
  !b || b.length === 0 ? a : new Set([...a, ...b]);

export const useGraphStore = create<GraphStore>()((set, get) => ({
  watchedAnime: [],
  anchorAnimeId: null,
  addAnime: (anime) =>
    set((s) => {
      // Franchise-aware dedupe: two canonical entries may never share a member id.
      const incoming = franchiseMemberIds(anime);
      const taken = s.watchedAnime.some((a) => franchiseMemberIds(a).some((id) => incoming.includes(id)));
      return taken
        ? s
        : { watchedAnime: [...s.watchedAnime, anime], anchorAnimeId: s.anchorAnimeId ?? anime.id, lastCleared: null };
    }),
  removeAnime: (animeId) =>
    set((s) => {
      const watchedAnime = s.watchedAnime.filter((a) => a.id !== animeId);
      const anchorAnimeId = s.anchorAnimeId === animeId ? (watchedAnime[0]?.id ?? null) : s.anchorAnimeId;
      return { watchedAnime, anchorAnimeId };
    }),
  setAnchor: (animeId) => set({ anchorAnimeId: animeId }),
  replaceAnimeRecord: (oldId, record) =>
    set((s) => {
      const i = s.watchedAnime.findIndex((a) => a.id === oldId);
      if (i < 0) return s;
      const watchedAnime = s.watchedAnime.slice();
      watchedAnime[i] = record;
      return { watchedAnime, anchorAnimeId: s.anchorAnimeId === oldId ? record.id : s.anchorAnimeId };
    }),
  restoring: false,
  saveFailed: false,
  lastCleared: null,
  instantGenesis: false,

  graph: null,
  setGraph: (graph) =>
    set((s) => {
      const keep = graph?.carry && s.selectedNodeId && graph.neighbors.has(s.selectedNodeId);
      return {
        graph,
        hoveredNodeId: null,
        selectedNodeId: keep ? s.selectedNodeId : null,
        recommendations: null,
        instantGenesis: false,
        revealedNodeIds: EMPTY,
        activeBridgeIds: EMPTY,
        genesis: { status: 'idle', step: 0, totalSteps: 0 },
      };
    }),

  addingAnimeIds: EMPTY_IDS,
  addErrors: new Map(),
  markAdding: (animeId, adding, error) =>
    set((s) => {
      const addingAnimeIds = new Set(s.addingAnimeIds);
      if (adding) addingAnimeIds.add(animeId);
      else addingAnimeIds.delete(animeId);
      const addErrors = new Map(s.addErrors);
      if (error) addErrors.set(animeId, error);
      else addErrors.delete(animeId);
      return { addingAnimeIds, addErrors };
    }),

  showSupportingRoles: false,
  includeSubVoiceActors: false,
  setGraphFilterFlags: (patch) => set(patch),

  animePreview: null,
  openAnimePreview: (anime) => set({ animePreview: anime }),
  closeAnimePreview: () => set({ animePreview: null }),

  seiyuuPicker: null,
  openSeiyuuPicker: (va) => set({ seiyuuPicker: va }),
  closeSeiyuuPicker: () => set({ seiyuuPicker: null }),

  isSharedView: false,
  sharedSource: 'share',
  ownSavedCount: 0,
  restoredFromBackup: null,
  dismissRestoredNotice: () => set({ restoredFromBackup: null }),
  shareOpen: false,
  setShareOpen: (open) => set({ shareOpen: open }),

  recommendEnabled: false,
  setRecommendEnabled: (enabled) => set({ recommendEnabled: enabled }),
  recommendations: null,
  setRecommendations: (next) => {
    get().engine?.syncRecommendations(next);
    set({ recommendations: next });
  },
  retractRecommendations: () => {
    const current = get().recommendations;
    if (!current || current.retracting) return;
    const retracting: RecommendationSet = { ...current, retracting: true };
    get().engine?.syncRecommendations(retracting);
    set({ recommendations: retracting });
    window.setTimeout(() => {
      if (get().recommendations !== retracting) return;
      get().engine?.syncRecommendations(null);
      set({ recommendations: null });
    }, RETRACT_MS);
  },

  hiResImages: false,
  viewMode: 'MODE_CHARACTER',
  setViewMode: (mode) => {
    if (get().viewMode === mode) return;
    set({ viewMode: mode });
    get().engine?.setViewMode(mode);
  },
  locale: 'ko',
  setLocale: (locale) => set({ locale }),
  leftDrawerOpen: true,
  setLeftDrawerOpen: (open) => set({ leftDrawerOpen: open }),

  hoveredNodeId: null,
  setHoveredNode: (nodeId) => {
    if (get().hoveredNodeId !== nodeId) set({ hoveredNodeId: nodeId });
  },
  selectedNodeId: null,
  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  physicsPaused: false,
  togglePhysics: () => {
    const paused = !get().physicsPaused;
    set({ physicsPaused: paused });
    get().engine?.setPhysicsPaused(paused);
  },
  genesisSpeed: 1,
  setGenesisSpeed: (speed) => {
    set({ genesisSpeed: speed });
    get().engine?.setGenesisSpeed(speed);
  },
  replayGenesis: () => get().engine?.replayGenesis(),
  fitView: () => get().engine?.fitView(),
  focusNode: (nodeId) => get().engine?.focusNode(nodeId),

  engine: null,
  registerEngine: (handle) => set({ engine: handle }),
  genesis: { status: 'idle', step: 0, totalSteps: 0 },
  setGenesisState: (patch) => set((s) => ({ genesis: { ...s.genesis, ...patch } })),
  revealedNodeIds: EMPTY,
  activeBridgeIds: EMPTY,
  revealNodes: (nodeIds, bridgeIds) =>
    set((s) => ({
      revealedNodeIds: union(s.revealedNodeIds, nodeIds),
      activeBridgeIds: union(s.activeBridgeIds, bridgeIds),
    })),
  resetReveal: () => set({ revealedNodeIds: EMPTY, activeBridgeIds: EMPTY }),
}));

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** The node driving the spotlight: hover wins over selection. */
export const selectSpotlightSource = (s: GraphStore): string | null => s.hoveredNodeId ?? s.selectedNodeId;

const recommendationMembers = new WeakMap<RecommendationSet, ReadonlySet<string>>();
function members(rec: RecommendationSet): ReadonlySet<string> {
  let ids = recommendationMembers.get(rec);
  if (!ids) { ids = new Set(rec.nodes.map(n => n.id)); recommendationMembers.set(rec, ids); }
  return ids;
}
/** 1-hop link between two node ids: graph adjacency plus the recommendation overlay (VA ⇄ satellites). */
const isLinked = (s: GraphStore, a: string, b: string): boolean => {
  if (s.graph?.neighbors.get(a)?.has(b)) return true;
  const rec = s.recommendations;
  if (!rec || rec.status !== 'ready') return false;
  return (a === rec.viaNodeId && members(rec).has(b)) ||
    (b === rec.viaNodeId && members(rec).has(a));
};

/** Primitive result → a node re-renders only when ITS spotlight state changes. */
export const selectSpotlight =
  (nodeId: string) =>
  (s: GraphStore): SpotlightState => {
    const active = selectSpotlightSource(s);
    if (!active || !s.graph) return 'idle';
    if (active === nodeId) return 'focus';
    return isLinked(s, active, nodeId) ? 'linked' : 'dimmed';
  };

/** True when an edge touches the spotlight source (or nothing is spotlit). For per-frame canvas reads. */
export const isEdgeLit = (s: GraphStore, sourceId: string, targetId: string): boolean => {
  const active = selectSpotlightSource(s);
  return !active || active === sourceId || active === targetId;
};

export const selectCanGenerate = (s: GraphStore): boolean =>
  s.watchedAnime.length >= MIN_WATCHED && s.anchorAnimeId !== null && !s.restoring;

/** Every AniList id covered by the watched list (franchise members included) — recommendation exclusion set. */
export const watchedMemberIds = (watched: readonly AnimeRecord[]): Set<number> =>
  new Set(watched.flatMap(franchiseMemberIds));
