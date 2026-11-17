import { anilistDataSource, localPresetSearch, localSeiyuuSearch } from '../../services/anilistClient';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Crown, Loader2, Plus, RotateCcw, Search, Share2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  animeNodeId,
  franchiseMemberIds,
  pickName,
  pickTitle,
  type AnimeSummary,
  type VoiceActorRecord,
  type WatchedListDrawerProps,
} from '../../types/contract';
import { MIN_WATCHED, selectCanGenerate, useGraphStore } from '../../store/useGraphStore';
import { addAnimeToWatched } from '../../lib/addAnime';
import { hoverIntent, prefetchAnime, prefetchFilmography } from '../../lib/prefetch';
import { resetWatchedList } from '../../lib/session';
import { animeMeta, useT } from '../../i18n/ui';
import { Avatar } from '../nodes/Avatar';
import { cx } from '../nodes/nodeTheme';

const DRAWER_SPRING = { type: 'spring', stiffness: 340, damping: 32 } as const;
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

const sectionTitle = 'text-[11.5px] font-semibold tracking-[-0.01em] text-zinc-400';

export interface WatchedListPanelProps extends WatchedListDrawerProps {
  variant?: 'desktop' | 'phone';
  showHeader?: boolean;
  showFooter?: boolean;
  /** Compact sheet peek: only search input + "N편 · 성우 지도 만들기" bar. */
  peekMode?: boolean;
  onCollapse?: () => void;
  onSearchFocus?: () => void;
  onFocusAnimeNode?: (nodeId: string) => void;
  headerActions?: ReactNode;
}

export function WatchedListPanel({
  dataSource,
  onGenerate,
  variant = 'desktop',
  showHeader = true,
  showFooter = true,
  peekMode = false,
  onCollapse,
  onSearchFocus,
  onFocusAnimeNode,
  headerActions,
}: WatchedListPanelProps) {
  const t = useT();
  const isPhone = variant === 'phone';
  const watchedAnime = useGraphStore(useShallow((s) => s.watchedAnime));
  const anchorAnimeId = useGraphStore((s) => s.anchorAnimeId);
  const locale = useGraphStore((s) => s.locale);
  const canGenerate = useGraphStore(selectCanGenerate);
  const animeById = useGraphStore((s) => s.graph?.animeById);
  const addingIds = useGraphStore((s) => s.addingAnimeIds);
  const addErrors = useGraphStore((s) => s.addErrors);

  const addAnime = useGraphStore((s) => s.addAnime);
  const removeAnime = useGraphStore((s) => s.removeAnime);
  const setAnchor = useGraphStore((s) => s.setAnchor);
  const focusNode = useGraphStore((s) => s.focusNode);
  const openAnimePreview = useGraphStore((s) => s.openAnimePreview);
  const openSeiyuuPicker = useGraphStore((s) => s.openSeiyuuPicker);

  const [mode, setMode] = useState<'anime' | 'va'>('anime');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AnimeSummary[]>([]);
  const [vaResults, setVaResults] = useState<VoiceActorRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  // Franchise-aware: searching any season of a watched series shows it as added.
  const watchedIds = useMemo(() => new Set(watchedAnime.flatMap(franchiseMemberIds)), [watchedAnime]);

  // Debounced (120ms) live search; a newer keystroke aborts the stale request (and frees its pacing slot).
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setVaResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    // Local layer renders this frame (presets / Korean aliases, or the seiyuu dictionary); live results follow.
    if (dataSource === anilistDataSource) {
      if (mode === 'anime') setResults(localPresetSearch(trimmed));
      else setVaResults(localSeiyuuSearch(trimmed));
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchFailed(false);
    const timer = window.setTimeout(async () => {
      try {
        if (mode === 'va') {
          const list = (await dataSource.searchVoiceActors?.(trimmed, controller.signal)) ?? [];
          if (!controller.signal.aborted) {
            setVaResults(list);
            setSearching(false);
          }
          return;
        }
        const list = await dataSource.searchAnime(trimmed, controller.signal, (rows) => {
          if (!controller.signal.aborted) setResults(rows);
        });
        if (!controller.signal.aborted) {
          setResults(list);
          setSearching(false);
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        setSearchFailed(true);
        setSearching(false);
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, dataSource, mode]);
  const shown = mode === 'anime' ? results.length : vaResults.length;

  const restoring = useGraphStore((s) => s.restoring);
  const hint = restoring
    ? t.restoring
    : !canGenerate
      ? watchedAnime.length < MIN_WATCHED
        ? t.generateNeedMore
        : t.generateNeedFavorite
      : null;

  const handleFocusAnime = (id: number) => {
    const nodeId = animeNodeId(id);
    if (onFocusAnimeNode) onFocusAnimeNode(nodeId);
    else focusNode(nodeId);
  };

  return (
    <>
      {showHeader && (
        <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-white">{t.appTitle}</h2>
            <p className="mt-0.5 text-[11.5px] text-zinc-400">{t.drawerHint}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerActions}
            {onCollapse && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={onCollapse}
                aria-label={t.collapseDrawer}
                className={cx(
                  'flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white',
                  isPhone ? 'h-11 w-11' : 'h-7 w-7',
                  FOCUS_RING,
                )}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </motion.button>
            )}
          </div>
        </header>
      )}

      <div
        className={cx(
          'sc-scroll flex min-h-0 flex-1 flex-col px-4',
          peekMode ? 'gap-2.5 overflow-hidden py-1.5' : 'gap-5 overflow-y-auto py-3.5',
        )}
      >
        {/* Search */}
        <section aria-label={t.searchPlaceholder}>
          {!peekMode && (
            <div className="mb-2 flex rounded-lg bg-black/30 p-0.5" role="group" aria-label={t.searchModeGroup}>
              {(['anime', 'va'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={cx(
                    'flex-1 cursor-pointer rounded-md font-medium whitespace-nowrap break-keep transition-colors',
                    isPhone ? 'min-h-[44px] py-2 text-[12.5px]' : 'py-1 text-[11.5px]',
                    FOCUS_RING,
                    mode === m ? 'bg-white/90 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100',
                  )}
                >
                  {m === 'anime' ? t.searchModeAnime : t.searchModeVa}
                </button>
              ))}
            </div>
          )}
          <div key="search-box" className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onFocus={onSearchFocus}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'anime' ? t.searchPlaceholder : t.searchVaPlaceholder}
              aria-label={mode === 'anime' ? t.searchPlaceholder : t.searchVaPlaceholder}
              className={cx(
                'w-full rounded-xl border border-white/10 bg-zinc-950/70 pl-9 text-white placeholder:text-zinc-500 focus:border-white/30 focus:outline-none',
                isPhone ? 'min-h-[44px] py-2.5 pr-11 text-[14px]' : 'py-2 pr-8 text-[12.5px]',
              )}
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
                    'absolute top-1/2 -translate-y-1/2 flex cursor-pointer items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-white',
                    isPhone ? 'right-0 h-11 w-11' : 'right-2.5 h-5 w-5',
                    FOCUS_RING,
                  )}
                >
                  <X size={isPhone ? 15 : 12} aria-hidden="true" />
                </button>
              )
            )}
          </div>

          {!peekMode && searchFailed && <p className="mt-2 px-1 text-[11.5px] text-red-300">{t.searchFailed}</p>}
          {!peekMode && query.trim().length > 0 && !searching && !searchFailed && shown === 0 && (
            <p className="mt-2 px-1 text-[11.5px] text-zinc-500">{t.noResults}</p>
          )}

          {!peekMode && mode === 'va' && vaResults.length > 0 && (
            <ul className="sc-scroll mt-2 flex max-h-72 flex-col overflow-y-auto rounded-xl border border-white/8 bg-zinc-950/60 p-1">
              {vaResults.map((va) => {
                const name = pickName(va.name, locale);
                const secondary = locale === 'ja' ? va.name.full : va.name.native;
                return (
                  <li key={va.id}>
                    <button
                      type="button"
                      onClick={() => openSeiyuuPicker(va)}
                      {...hoverIntent(() => prefetchFilmography(dataSource, va.id), 60)}
                      className={cx(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-white/[0.04]',
                        isPhone && 'min-h-[48px]',
                        FOCUS_RING,
                      )}
                    >
                      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/12">
                        <Avatar loading="lazy" src={va.image} name={va.name.full} color="#8b9cff" alt={name} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-white">{name}</div>
                        {secondary && secondary !== name && <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">{secondary}</div>}
                      </div>
                      <ChevronRight size={14} className="shrink-0 text-zinc-500" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!peekMode && mode === 'anime' && results.length > 0 && (
            <ul className="sc-scroll mt-2 flex max-h-72 flex-col overflow-y-auto rounded-xl border border-white/8 bg-zinc-950/60 p-1">
              {results.map((item) => {
                const title = pickTitle(item.title, locale);
                const isAdded = watchedIds.has(item.id);
                const isAdding = addingIds.has(item.id);
                const rowError = addErrors.get(item.id);
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-1 rounded-lg hover:bg-white/[0.04]"
                    {...hoverIntent(() => prefetchAnime(dataSource, item.id))}
                  >
                    {/* Row body → preview modal */}
                    <button
                      type="button"
                      onClick={() => openAnimePreview(item)}
                      title={title}
                      className={cx(
                        'flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left',
                        isPhone && 'min-h-[48px]',
                        FOCUS_RING,
                      )}
                    >
                      <div className="relative h-11 w-8 shrink-0 overflow-hidden rounded-md border border-white/10">
                        <Avatar loading="lazy" src={item.coverImage} name={item.title.romaji} color={item.color} alt={title} />
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
                        'mr-1 flex shrink-0 items-center justify-center rounded-lg border transition-colors',
                        isPhone ? 'h-11 w-11' : 'h-8 w-8',
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

        {peekMode ? (
          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              whileTap={canGenerate ? { scale: 0.98 } : undefined}
              disabled={!canGenerate}
              onClick={onGenerate}
              title={hint ?? undefined}
              className={cx(
                'flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium whitespace-nowrap break-keep transition-colors',
                FOCUS_RING,
                canGenerate
                  ? 'cursor-pointer bg-zinc-100 text-zinc-950 hover:bg-white'
                  : 'cursor-not-allowed border border-white/8 bg-white/[0.04] text-zinc-500',
              )}
            >
              <span className="font-mono font-semibold tabular-nums">{watchedAnime.length}편</span>
              <span aria-hidden="true">·</span>
              <span>{t.generate}</span>
            </motion.button>
          </div>
        ) : (
          <>
            {/* Popular presets — one neutral surface; series colour only as a 2px accent bar */}
            <section aria-label={t.popular}>
              <h3 className={cx(sectionTitle, 'mb-2')}>{t.popular}</h3>
              <div className={cx('flex flex-wrap', isPhone ? 'gap-2' : 'gap-1.5')}>
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
                        'relative inline-flex max-w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg border transition-colors',
                        isPhone ? 'min-h-[44px] py-2 pr-3 pl-4 text-[12.5px]' : 'py-1 pr-2.5 pl-3.5 text-[11.5px]',
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => resetWatchedList(dataSource)}
                    title={watchedAnime.length === 0 ? t.restoreDefaultsTip : t.resetListTip}
                    className={cx(
                      'inline-flex cursor-pointer items-center gap-1 rounded text-xs whitespace-nowrap break-keep text-zinc-400 transition-colors hover:text-zinc-200',
                      isPhone && 'min-h-[44px] px-2.5',
                      FOCUS_RING,
                    )}
                  >
                    <RotateCcw size={11} aria-hidden="true" />
                    {watchedAnime.length === 0 ? t.restoreDefaults : t.resetList}
                  </button>
                  <span className="font-mono text-[11px] text-zinc-400">{watchedAnime.length}</span>
                </div>
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
                            'group relative flex items-center overflow-hidden rounded-xl border bg-white/[0.03] pl-3',
                            isPhone ? 'min-h-[56px] gap-1.5 p-1.5' : 'gap-2 p-1.5',
                            isAnchor ? 'border-amber-200/35' : 'border-white/8',
                          )}
                        >
                          <span className="absolute top-2 bottom-2 left-1.5 w-[2px] rounded-full" style={{ background: anime.color }} aria-hidden="true" />

                          <button
                            type="button"
                            onClick={() => inGraph && handleFocusAnime(anime.id)}
                            disabled={!inGraph}
                            title={inGraph ? `${title} · ${t.focusCluster}` : title}
                            className={cx(
                              'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left',
                              isPhone ? 'min-h-[44px] py-1' : 'py-0.5',
                              FOCUS_RING,
                              inGraph ? 'cursor-pointer' : 'cursor-default',
                            )}
                          >
                            <div className="relative h-10 w-8 shrink-0 overflow-hidden rounded-md border border-white/12">
                              <Avatar loading="lazy" src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
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
                              'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg border text-[11px] font-medium whitespace-nowrap break-keep transition-colors',
                              isPhone ? 'h-11 min-w-[44px] px-2.5' : 'h-7 px-2',
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
                              'flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-white',
                              isPhone ? 'h-11 w-11' : 'h-7 w-7',
                              FOCUS_RING,
                            )}
                          >
                            <X size={isPhone ? 15 : 13} aria-hidden="true" />
                          </motion.button>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {showFooter && !peekMode && (
        <footer className="shrink-0 border-t border-white/8 px-4 py-3.5">
          <div className="flex gap-2">
            <motion.button
              type="button"
              whileTap={canGenerate ? { scale: 0.98 } : undefined}
              disabled={!canGenerate}
              onClick={onGenerate}
              title={hint ?? undefined}
              className={cx(
                'flex w-full items-center justify-center rounded-xl px-4 text-[13px] font-medium whitespace-nowrap break-keep transition-colors',
                isPhone ? 'min-h-[44px] py-2.5' : 'py-2.5',
                FOCUS_RING,
                canGenerate
                  ? 'cursor-pointer bg-zinc-100 text-zinc-950 hover:bg-white'
                  : 'cursor-not-allowed border border-white/8 bg-white/[0.04] text-zinc-500',
              )}
            >
              {t.generate}
            </motion.button>
            {animeById && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => useGraphStore.getState().setShareOpen(true)}
                aria-label={t.share}
                title={t.share}
                className={cx(
                  'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-white/12 px-3 text-[12.5px] font-medium whitespace-nowrap break-keep text-zinc-100 transition-colors hover:border-white/30',
                  isPhone && 'min-h-[44px]',
                  FOCUS_RING,
                )}
              >
                <Share2 size={14} aria-hidden="true" />
                {t.share}
              </motion.button>
            )}
          </div>
          {hint && <p className="mt-2 text-center text-[11px] text-zinc-500">{hint}</p>}
        </footer>
      )}
    </>
  );
}

export function WatchedListDrawer({ dataSource, onGenerate }: WatchedListDrawerProps) {
  const t = useT();
  const watchedAnime = useGraphStore(useShallow((s) => s.watchedAnime));
  const anchorAnimeId = useGraphStore((s) => s.anchorAnimeId);
  const leftDrawerOpen = useGraphStore((s) => s.leftDrawerOpen);
  const setLeftDrawerOpen = useGraphStore((s) => s.setLeftDrawerOpen);

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
            <WatchedListPanel
              dataSource={dataSource}
              onGenerate={onGenerate}
              onCollapse={() => setLeftDrawerOpen(false)}
            />
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
