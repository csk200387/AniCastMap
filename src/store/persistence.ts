/**
 * Debounced persistence of the discrete user state.
 *
 * Isolation from the hot path: the subscriber only compares seven references/booleans per store update and does
 * nothing when none changed. d3 ticks, camera transforms, hover spotlight and genesis frames never touch the store
 * slices below (hover/selection/genesis writes change OTHER fields), so they can never cause a storage write.
 */
import {
  readCastCache,
  saveUserState,
  toSummary,
  writeCastCache,
  type CastCache,
  type PersistedState,
  type StorageLike,
} from '../services/userState';
import type { AnimeRecord } from '../types/contract';
import { provisionalRecords, useGraphStore, type GraphStore } from './useGraphStore';

export const PERSIST_DEBOUNCE_MS = 150;

/** The slice that is persisted. `restoring` counts as "graph on screen" so a pending restore is never forgotten. */
const slice = (s: GraphStore) =>
  [s.watchedAnime, s.anchorAnimeId, s.locale, s.viewMode, s.showSupportingRoles, s.includeSubVoiceActors, s.bridgesOnly, s.liveUpdate, s.graph !== null || s.restoring, s.isSharedView] as const;

const snapshot = (s: GraphStore): PersistedState => ({
  watched: s.watchedAnime.map(toSummary),
  anchorAnimeId: s.anchorAnimeId,
  locale: s.locale,
  viewMode: s.viewMode,
  showSupportingRoles: s.showSupportingRoles,
  includeSubVoiceActors: s.includeSubVoiceActors,
  bridgesOnly: s.bridgesOnly,
  liveUpdate: s.liveUpdate,
  hasGeneratedGraph: s.graph !== null || s.restoring,
});

export interface PersistenceHandle {
  /** Write now (used on pagehide, right after an add, and by tests). */
  flush: () => void;
  stop: () => void;
  /** The store was just replaced with what another tab saved: treat it as written (no write-back). */
  adopted: () => void;
}

export function startPersistence(
  storage: StorageLike | null,
  isPreset: (id: number) => boolean,
  { delay = PERSIST_DEBOUNCE_MS, castCache: initialCache }: { delay?: number; castCache?: CastCache } = {},
): PersistenceHandle {
  if (!storage) return { flush() {}, stop() {}, adopted() {} };

  // Share the cache the restore path already parsed: identical pool objects ⇒ no rewrite, and `savedAt` (the TTL clock) is kept.
  let castCache: CastCache | null = initialCache ?? null;
  let prev = slice(useGraphStore.getState());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  /** Keep the heavy pools of non-preset watched anime in the dedicated cache; drop pools of anime no longer watched. */
  function syncCastCache(watched: readonly AnimeRecord[]) {
    castCache ??= readCastCache(storage);
    let changed = false;
    const custom = watched.filter((a) => !isPreset(a.id));
    const keep = new Set(custom.map((a) => a.id));
    for (const id of [...castCache.keys()]) {
      if (!keep.has(id)) {
        castCache.delete(id);
        changed = true;
      }
    }
    for (const a of custom) {
      const pool = a.fullCastPool ?? a.cast;
      // summary-only / optimistic placeholder: keep whatever the cache already holds
      if (pool.length === 0 || provisionalRecords.has(a)) continue;
      const cur = castCache.get(a.id);
      if (!cur || cur.pool !== pool) {
        castCache.set(a.id, { savedAt: Date.now(), pool: pool as AnimeRecord['cast'] });
        changed = true;
      }
    }
    if (changed) writeCastCache(storage, castCache);
  }

  function write() {
    timer = undefined;
    // A shared-link sandbox never touches the visitor's saved map or cast cache; leaving it re-dirties the slice.
    if (useGraphStore.getState().isSharedView) return;
    if (!dirty) return;
    dirty = false;
    const state = useGraphStore.getState();
    try {
      syncCastCache(state.watchedAnime);
    } catch {
      /* the cast cache is an optimisation; user-state must still be saved */
    }
    const ok = saveUserState(storage, snapshot(state));
    // A refused write (quota, blocked site data) must be visible: the drawer warns and points to the backup link.
    if (useGraphStore.getState().saveFailed === ok) useGraphStore.setState({ saveFailed: !ok });
  }

  const idle = (fn: () => void) =>
    typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 0);

  function schedule() {
    dirty = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => idle(write), delay);
  }

  const unsubscribe = useGraphStore.subscribe((state) => {
    const next = slice(state);
    if (next.every((v, i) => v === prev[i])) return;
    prev = next;
    schedule();
  });

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    write();
  };
  const onHide = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') flush();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
  }

  return {
    flush,
    adopted() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      dirty = false;
      prev = slice(useGraphStore.getState());
    },
    stop() {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', flush);
        document.removeEventListener('visibilitychange', onHide);
      }
    },
  };
}
