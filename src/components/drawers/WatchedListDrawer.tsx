import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Crown, Loader2, Plus, Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  animeNodeId,
  franchiseMemberIds,
  pickTitle,
  type AnimeSummary,
  type WatchedListDrawerProps,
} from '../../types/contract';
import { MIN_WATCHED, selectCanGenerate, useGraphStore } from '../../store/useGraphStore';
import { addAnimeToWatched } from '../../lib/addAnime';
import { animeMeta, useT } from '../../i18n/ui';
import { Avatar } from '../nodes/Avatar';
import { cx } from '../nodes/nodeTheme';

const DRAWER_SPRING = { type: 'spring', stiffness: 340, damping: 32 } as const;
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

const sectionTitle = 'text-[11.5px] font-semibold tracking-[-0.01em] text-zinc-400';

export function WatchedListDrawer({ dataSource, onGenerate }: WatchedListDrawerProps) {
  const t = useT();
  const watchedAnime = useGraphStore(useShallow((s) => s.watchedAnime));
  const anchorAnimeId = useGraphStore((s) => s.anchorAnimeId);
  const locale = useGraphStore((s) => s.locale);
  const leftDrawerOpen = useGraphStore((s) => s.leftDrawerOpen);
  const canGenerate = useGraphStore(selectCanGenerate);
  const animeById = useGraphStore((s) => s.graph?.animeById);
  const addingIds = useGraphStore((s) => s.addingAnimeIds);
  const addErrors = useGraphStore((s) => s.addErrors);

  const addAnime = useGraphStore((s) => s.addAnime);
  const removeAnime = useGraphStore((s) => s.removeAnime);
  const setAnchor = useGraphStore((s) => s.setAnchor);
  const setLeftDrawerOpen = useGraphStore((s) => s.setLeftDrawerOpen);
  const focusNode = useGraphStore((s) => s.focusNode);
  const openAnimePreview = useGraphStore((s) => s.openAnimePreview);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AnimeSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  // Franchise-aware: searching any season of a watched series shows it as added.
  const watchedIds = useMemo(() => new Set(watchedAnime.flatMap(franchiseMemberIds)), [watchedAnime]);

  // Debounced (300ms) live search with AbortController.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchFailed(false);
    const timer = window.setTimeout(async () => {
      try {
        const list = await dataSource.searchAnime(trimmed, controller.signal);
        if (!controller.signal.aborted) {
          setResults(list);
          setSearching(false);
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        setSearchFailed(true);
        setSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, dataSource]);

  const hint = !canGenerate
    ? watchedAnime.length < MIN_WATCHED
      ? t.generateNeedMore
      : t.generateNeedFavorite
    : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <AnimatePresence mode="wait" initial={false}>
        {leftDrawerOpen ? (
          <motion.aside
            key="watched-drawer-open"
            initial={{ x: -380, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -380, opacity: 0 }}
            transition={DRAWER_SPRING}
            aria-label={t.watchedList}
            className="sc-glass pointer-events-auto absolute top-3 bottom-3 left-3 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3.5">
              <div className="min-w-0">
                <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-white">{t.appTitle}</h2>
                <p className="mt-0.5 text-[11.5px] text-zinc-400">{t.drawerHint}</p>
              </div>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => setLeftDrawerOpen(false)}
                aria-label={t.collapseDrawer}
                className={cx(
                  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white',
                  FOCUS_RING,
                )}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </motion.button>
            </header>

            <div className="sc-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-3.5">
              {/* Search */}
              <section aria-label={t.searchPlaceholder}>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    aria-label={t.searchPlaceholder}
                    className="w-full rounded-xl border border-white/10 bg-zinc-950/70 py-2 pr-8 pl-9 text-[12.5px] text-white placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
                  />
                  {searching ? (
                    <Loader2 size={14} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden="true" />
                  ) : (
                    query.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        aria-label={t.searchClear}
                        className={cx(
                          'absolute top-1/2 right-2.5 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-white',
                          FOCUS_RING,
                        )}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )
                  )}
                </div>

                {searchFailed && <p className="mt-2 px-1 text-[11.5px] text-red-300">{t.searchFailed}</p>}
                {query.trim().length > 0 && !searching && !searchFailed && results.length === 0 && (
                  <p className="mt-2 px-1 text-[11.5px] text-zinc-500">{t.noResults}</p>
                )}

                {results.length > 0 && (
                  <ul className="sc-scroll mt-2 flex max-h-72 flex-col overflow-y-auto rounded-xl border border-white/8 bg-zinc-950/60 p-1">
                    {results.map((item) => {
                      const title = pickTitle(item.title, locale);
                      const isAdded = watchedIds.has(item.id);
                      const isAdding = addingIds.has(item.id);
                      const rowError = addErrors.get(item.id);
                      return (
                        <li key={item.id} className="flex items-center gap-1 rounded-lg hover:bg-white/[0.04]">
                          {/* Row body → preview modal */}
                          <button
                            type="button"
                            onClick={() => openAnimePreview(item)}
                            title={title}
                            className={cx('flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left', FOCUS_RING)}
                          >
                            <div className="relative h-11 w-8 shrink-0 overflow-hidden rounded-md border border-white/10">
                              <Avatar src={item.coverImage} name={item.title.romaji} color={item.color} alt={title} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="line-clamp-2 text-[12px] leading-[15px] font-medium text-white">{title}</div>
                              <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">
                                {[item.seasonYear, item.format === 'MOVIE' ? t.movie : item.format].filter(Boolean).join(' · ')}
                              </div>
                              {rowError && <div className="mt-0.5 text-[10.5px] text-red-300">{t.loadFailed}</div>}
                            </div>
                          </button>
                          {/* Quick add */}
                          <motion.button
                            type="button"
                            whileTap={{ scale: 0.95 }}
                            disabled={isAdded || isAdding}
                            onClick={() => void addAnimeToWatched(dataSource, item)}
                            aria-label={isAdded ? `${title} · ${t.added}` : `${title} · ${t.add}`}
                            title={isAdded ? t.added : t.add}
                            className={cx(
                              'mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
                              FOCUS_RING,
                              isAdded
                                ? 'cursor-default border-transparent text-zinc-500'
                                : 'cursor-pointer border-white/10 text-zinc-200 hover:border-white/30 hover:bg-white/10 disabled:cursor-wait',
                            )}
                          >
                            {isAdding ? (
                              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                            ) : isAdded ? (
                              <Check size={14} aria-hidden="true" />
                            ) : (
                              <Plus size={14} aria-hidden="true" />
                            )}
                          </motion.button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Popular presets — one neutral surface; series colour only as a 2px accent bar */}
              <section aria-label={t.popular}>
                <h3 className={cx(sectionTitle, 'mb-2')}>{t.popular}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {dataSource.presets.map((preset) => {
                    const active = watchedIds.has(preset.id);
                    const title = pickTitle(preset.title, locale);
                    return (
                      <motion.button
                        key={preset.id}
                        type="button"
                        whileTap={{ scale: 0.97 }}
                        aria-pressed={active}
                        onClick={() => (active ? removeAnime(preset.id) : addAnime(preset))}
                        className={cx(
                          'relative inline-flex max-w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg border py-1 pr-2.5 pl-3.5 text-[11.5px] transition-colors',
                          FOCUS_RING,
                          active
                            ? 'border-white/30 bg-zinc-800/90 text-white'
                            : 'border-white/10 bg-zinc-900/80 text-zinc-300 hover:border-white/25',
                        )}
                      >
                        <span className="absolute inset-y-1 left-1 w-[2px] rounded-full" style={{ background: preset.color }} aria-hidden="true" />
                        {active ? <Check size={11} className="shrink-0" aria-hidden="true" /> : <Plus size={11} className="shrink-0 text-zinc-500" aria-hidden="true" />}
                        <span className="truncate">{title}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </section>

              {/* Watched list */}
              <section aria-label={t.watchedList} className="flex flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className={sectionTitle}>{t.watchedList}</h3>
                  <span className="font-mono text-[11px] text-zinc-400">{watchedAnime.length}</span>
                </div>

                {watchedAnime.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-[11.5px] text-zinc-500">
                    {t.emptyWatched}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <AnimatePresence initial={false}>
                      {watchedAnime.map((anime) => {
                        const isAnchor = anchorAnimeId === anime.id;
                        const inGraph = animeById?.has(anime.id) ?? false;
                        const title = pickTitle(anime.title, locale);
                        return (
                          <motion.div
                            key={anime.id}
                            layout
                            initial={{ opacity: 0, y: -8, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -16, scale: 0.96 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className={cx(
                              'group relative flex items-center gap-2 overflow-hidden rounded-xl border bg-white/[0.03] p-1.5 pl-3',
                              isAnchor ? 'border-amber-200/35' : 'border-white/8',
                            )}
                          >
                            <span className="absolute top-2 bottom-2 left-1.5 w-[2px] rounded-full" style={{ background: anime.color }} aria-hidden="true" />

                            <button
                              type="button"
                              onClick={() => inGraph && focusNode(animeNodeId(anime.id))}
                              disabled={!inGraph}
                              title={inGraph ? `${title} · ${t.focusCluster}` : title}
                              className={cx(
                                'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 text-left',
                                FOCUS_RING,
                                inGraph ? 'cursor-pointer' : 'cursor-default',
                              )}
                            >
                              <div className="relative h-10 w-8 shrink-0 overflow-hidden rounded-md border border-white/12">
                                <Avatar src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] font-medium text-white">{title}</div>
                                <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">{animeMeta(t, anime)}</div>
                              </div>
                            </button>

                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.97 }}
                              onClick={() => setAnchor(anime.id)}
                              aria-pressed={isAnchor}
                              aria-label={isAnchor ? `${title} · ${t.favorite}` : `${title} · ${t.setFavorite}`}
                              title={isAnchor ? t.favorite : t.setFavorite}
                              className={cx(
                                'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-colors',
                                FOCUS_RING,
                                isAnchor
                                  ? 'border-amber-200/40 text-amber-100'
                                  : 'border-white/8 text-zinc-500 hover:border-white/25 hover:text-zinc-200',
                              )}
                            >
                              <Crown size={12} strokeWidth={2.2} className={isAnchor ? 'fill-amber-200/90 text-amber-200' : ''} aria-hidden="true" />
                              {isAnchor && <span>{t.favorite}</span>}
                            </motion.button>

                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.97 }}
                              onClick={() => removeAnime(anime.id)}
                              aria-label={`${title} · ${t.remove}`}
                              title={t.remove}
                              className={cx(
                                'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-white',
                                FOCUS_RING,
                              )}
                            >
                              <X size={13} aria-hidden="true" />
                            </motion.button>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </section>
            </div>

            <footer className="shrink-0 border-t border-white/8 px-4 py-3.5">
              <motion.button
                type="button"
                whileTap={canGenerate ? { scale: 0.98 } : undefined}
                disabled={!canGenerate}
                onClick={onGenerate}
                title={hint ?? undefined}
                className={cx(
                  'flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors',
                  FOCUS_RING,
                  canGenerate
                    ? 'cursor-pointer bg-zinc-100 text-zinc-950 hover:bg-white'
                    : 'cursor-not-allowed border border-white/8 bg-white/[0.04] text-zinc-500',
                )}
              >
                {t.generate}
              </motion.button>
              {hint && <p className="mt-2 text-center text-[11px] text-zinc-500">{hint}</p>}
            </footer>
          </motion.aside>
        ) : (
          <motion.button
            key="watched-drawer-collapsed"
            type="button"
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={DRAWER_SPRING}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLeftDrawerOpen(true)}
            aria-label={t.expandDrawer}
            title={t.expandDrawer}
            className={cx(
              'sc-glass pointer-events-auto absolute top-3 left-3 flex cursor-pointer flex-col items-center gap-2 rounded-2xl px-2.5 py-3 text-zinc-300 transition-colors hover:border-white/20 hover:text-white',
              FOCUS_RING,
            )}
          >
            <ChevronRight size={15} aria-hidden="true" />
            <span className="font-mono text-[11px] font-semibold tabular-nums text-white">{watchedAnime.length}</span>
            {anchorAnimeId !== null && <Crown size={12} className="fill-amber-200/90 text-amber-200" aria-hidden="true" />}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
