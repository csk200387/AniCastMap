import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  LayoutGrid,
  Maximize2,
  Mic,
  MoreHorizontal,
  RotateCcw,
  Search,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import { animeNodeId, pickName, pickTitle, type AnimeDataSource } from '../../types/contract';
import { selectHasPendingGraphChanges, useGraphStore } from '../../store/useGraphStore';
import { animeMeta, useT } from '../../i18n/ui';
import { InspectorPanel } from '../drawers/InspectorDrawer';
import { WatchedListPanel } from '../drawers/WatchedListDrawer';
import { OPEN_WATCHED_LIST_EVENT } from '../hud/EmptyState';
import { Avatar } from '../nodes/Avatar';
import { animeColor, cx, distinctAnimeIds } from '../nodes/nodeTheme';
import {
  MOBILE_FOCUS_RING,
  MobileFilterPanel,
  MobileModePills,
  MobileOverflowMenu,
  useActiveFilterCount,
} from './MobileControls';

export function FloatShell({
  dataSource,
  onGenerate,
  sharedTop,
}: {
  dataSource: AnimeDataSource;
  onGenerate: () => void;
  sharedTop: number;
}) {
  const t = useT();
  const graph = useGraphStore((s) => s.graph);
  const hasGraph = graph !== null;
  const hasPendingChanges = useGraphStore(selectHasPendingGraphChanges);
  const liveUpdate = useGraphStore((s) => s.liveUpdate);
  const watchedCount = useGraphStore((s) => s.watchedAnime.length);
  const locale = useGraphStore((s) => s.locale);
  const viewMode = useGraphStore((s) => s.viewMode);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const replayGenesis = useGraphStore((s) => s.replayGenesis);
  const fitView = useGraphStore((s) => s.fitView);
  const setStageInsets = useGraphStore((s) => s.setStageInsets);
  const genesisPlaying = useGraphStore((s) => s.genesis.status === 'playing');
  const activeFilters = useActiveFilterCount();

  const [listOpen, setListOpen] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [dockPopover, setDockPopover] = useState<'mode' | 'filters' | 'more' | null>(null);

  const selectedNode = useMemo(
    () => (selectedNodeId && graph ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, graph],
  );

  // Collapse full inspector if selection clears
  useEffect(() => {
    if (!selectedNodeId) setInspectorExpanded(false);
  }, [selectedNodeId]);

  // Listen to EmptyState's "시청 목록 열기"
  useEffect(() => {
    const onOpen = () => setListOpen(true);
    window.addEventListener(OPEN_WATCHED_LIST_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WATCHED_LIST_EVENT, onOpen);
  }, []);

  // Report map insets
  useEffect(() => {
    const top = 64 + sharedTop;
    const bottom = selectedNode ? 168 : 92;
    setStageInsets({ left: 0, top, right: 0, bottom });
  }, [sharedTop, selectedNode, setStageInsets]);

  const ModeIcon = viewMode === 'MODE_VA' ? Mic : viewMode === 'MODE_DETAIL' ? LayoutGrid : User;

  const handleGenerate = () => {
    onGenerate();
    setListOpen(false);
  };

  return (
    <div data-phone-shell="float" className="pointer-events-none fixed inset-0 z-30">
      {/* Top Floating Search Pill */}
      <div
        className="pointer-events-none fixed inset-x-3 z-30 flex justify-center"
        style={{ top: 10 + sharedTop }}
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            setDockPopover(null);
            setListOpen(true);
          }}
          className={cx(
            'sc-glass pointer-events-auto flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full px-4 text-[13px] font-medium whitespace-nowrap break-keep text-white transition-colors hover:border-white/25',
            MOBILE_FOCUS_RING,
          )}
        >
          <Search size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
          <span>{t.searchModeAnime}</span>
          <span className="text-zinc-500" aria-hidden="true">·</span>
          <span className="font-mono text-[12px] text-zinc-300">{t.titleCount(watchedCount)}</span>
          {!liveUpdate && hasPendingChanges && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300" aria-label={t.pendingGraphChanges} />
          )}
        </motion.button>
      </div>

      {/* Tap-away backdrop for dock popovers */}
      {dockPopover && (
        <div
          className="pointer-events-auto fixed inset-0 z-20"
          aria-hidden="true"
          onClick={() => setDockPopover(null)}
        />
      )}

      {/* Floating popovers above bottom dock */}
      <AnimatePresence>
        {dockPopover && !selectedNode && (
          <motion.div
            key={dockPopover}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="sc-glass pointer-events-auto fixed inset-x-3 z-30 rounded-2xl p-3.5"
            style={{ bottom: 'calc(92px + env(safe-area-inset-bottom, 0px))' }}
          >
            {dockPopover === 'mode' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[12px] font-semibold text-zinc-300">{t.modeGroup}</span>
                  <button
                    type="button"
                    onClick={() => setDockPopover(null)}
                    aria-label={t.close}
                    className={cx('flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white', MOBILE_FOCUS_RING)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                <MobileModePills layoutId="sc-float-mode" />
              </div>
            ) : dockPopover === 'filters' ? (
              <MobileFilterPanel onClose={() => setDockPopover(null)} />
            ) : (
              <MobileOverflowMenu onClose={() => setDockPopover(null)} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom area: either compact selected-node card OR single row of round icon buttons */}
      <div
        className="pointer-events-none fixed inset-x-3 z-30 flex justify-center"
        style={{ bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))' }}
      >
        <AnimatePresence mode="wait">
          {selectedNode && graph ? (
            <motion.div
              key={`card-${selectedNode.id}`}
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 360, damping: 32 }}
              className="sc-glass pointer-events-auto flex w-full flex-col gap-2.5 rounded-2xl p-3"
            >
              {selectedNode.kind === 'VOICE_ACTOR' ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/20">
                      <Avatar
                        src={selectedNode.voiceActor.image}
                        name={selectedNode.voiceActor.name.full}
                        color={animeColor(graph.animeById, selectedNode.roles[0]?.animeId)}
                        alt={pickName(selectedNode.voiceActor.name, locale)}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-white">
                        {pickName(selectedNode.voiceActor.name, locale)}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-zinc-400">
                        {selectedNode.degree >= 2
                          ? t.cardOverlap(selectedNode.degree)
                          : t.metaWatched(selectedNode.degree)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectorExpanded(true)}
                      className={cx(
                        'flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center rounded-xl bg-zinc-100 px-3.5 text-[12.5px] font-semibold whitespace-nowrap break-keep text-zinc-950 hover:bg-white',
                        MOBILE_FOCUS_RING,
                      )}
                    >
                      {t.viewDetails}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectNode(null)}
                      aria-label={t.close}
                      className={cx(
                        'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-zinc-400 hover:border-white/25 hover:text-white',
                        MOBILE_FOCUS_RING,
                      )}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>

                  {/* Anime chips */}
                  <div className="sc-scroll flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    {distinctAnimeIds(selectedNode.roles).map((animeId) => {
                      const anime = graph.animeById.get(animeId);
                      if (!anime) return null;
                      return (
                        <button
                          key={animeId}
                          type="button"
                          onClick={() => focusNode(animeNodeId(animeId))}
                          className={cx(
                            'inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-[11.5px] whitespace-nowrap break-keep text-zinc-200 hover:border-white/25',
                            MOBILE_FOCUS_RING,
                          )}
                        >
                          <span className="h-3 w-0.5 shrink-0 rounded-full" style={{ background: anime.color }} aria-hidden="true" />
                          <span className="max-w-[140px] truncate">{pickTitle(anime.title, locale)}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-white/15">
                    <Avatar
                      src={selectedNode.anime.coverImage}
                      name={selectedNode.anime.title.romaji}
                      color={selectedNode.anime.color}
                      alt={pickTitle(selectedNode.anime.title, locale)}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-white">
                      {pickTitle(selectedNode.anime.title, locale)}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-zinc-400">
                      {animeMeta(t, selectedNode.anime) || t.castInGraph}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectorExpanded(true)}
                    className={cx(
                      'flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center rounded-xl bg-zinc-100 px-3.5 text-[12.5px] font-semibold whitespace-nowrap break-keep text-zinc-950 hover:bg-white',
                      MOBILE_FOCUS_RING,
                    )}
                  >
                    {t.viewDetails}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectNode(null)}
                    aria-label={t.close}
                    className={cx(
                      'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-zinc-400 hover:border-white/25 hover:text-white',
                      MOBILE_FOCUS_RING,
                    )}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="float-round-dock"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.16 }}
              className="pointer-events-auto flex items-start justify-center gap-3"
              role="toolbar"
              aria-label={t.modeGroup}
            >
              <RoundDockButton
                label={t.modeGroup}
                active={dockPopover === 'mode'}
                onClick={() => setDockPopover((p) => (p === 'mode' ? null : 'mode'))}
                icon={<ModeIcon size={18} strokeWidth={2.1} aria-hidden="true" />}
              />
              <RoundDockButton
                label={t.filterGroup}
                active={dockPopover === 'filters'}
                badge={activeFilters > 0 ? activeFilters : undefined}
                onClick={() => setDockPopover((p) => (p === 'filters' ? null : 'filters'))}
                icon={<SlidersHorizontal size={18} strokeWidth={2.1} aria-hidden="true" />}
              />
              {hasGraph && (
                <>
                  <RoundDockButton
                    label={t.replay}
                    onClick={() => {
                      setDockPopover(null);
                      replayGenesis();
                    }}
                    icon={
                      <RotateCcw
                        size={18}
                        strokeWidth={2.1}
                        className={genesisPlaying ? 'animate-spin' : undefined}
                        aria-hidden="true"
                      />
                    }
                  />
                  <RoundDockButton
                    label={t.fit}
                    onClick={() => {
                      setDockPopover(null);
                      fitView();
                    }}
                    icon={<Maximize2 size={18} strokeWidth={2.1} aria-hidden="true" />}
                  />
                </>
              )}
              <RoundDockButton
                label={t.more}
                active={dockPopover === 'more'}
                onClick={() => setDockPopover((p) => (p === 'more' ? null : 'more'))}
                icon={<MoreHorizontal size={18} strokeWidth={2.1} aria-hidden="true" />}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Full-screen Watched List / Search Overlay */}
      <AnimatePresence>
        {listOpen && (
          <motion.div
            key="float-list-overlay"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={t.watchedList}
            className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-[#090a0f]/96 backdrop-blur-xl"
            style={{ paddingTop: sharedTop, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-white">{t.appTitle}</h2>
                <p className="mt-0.5 text-[11.5px] text-zinc-400">{t.drawerHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setListOpen(false)}
                aria-label={t.close}
                className={cx(
                  'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:border-white/25 hover:text-white',
                  MOBILE_FOCUS_RING,
                )}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <WatchedListPanel
              dataSource={dataSource}
              onGenerate={handleGenerate}
              variant="phone"
              showHeader={false}
              onFocusAnimeNode={(nodeId) => {
                setListOpen(false);
                window.requestAnimationFrame(() => focusNode(nodeId));
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Inspector Overlay (expanded from "자세히") */}
      <AnimatePresence>
        {inspectorExpanded && selectedNode && graph && (
          <motion.div
            key="float-inspector-overlay"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={selectedNode.kind === 'VOICE_ACTOR' ? t.seiyuu : t.castInGraph}
            className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-[#090a0f]/96 backdrop-blur-xl"
            style={{ paddingTop: sharedTop, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <InspectorPanel
              node={selectedNode}
              graph={graph}
              dataSource={dataSource}
              variant="phone"
              extraHeaderAction={
                <button
                  type="button"
                  onClick={() => setInspectorExpanded(false)}
                  aria-label={t.close}
                  title={t.close}
                  className={cx(
                    'flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:border-white/25 hover:text-white',
                    MOBILE_FOCUS_RING,
                  )}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              }
              onClose={() => {
                setInspectorExpanded(false);
                selectNode(null);
              }}
              onFocusAnime={(animeId) => {
                setInspectorExpanded(false);
                window.requestAnimationFrame(() => focusNode(animeNodeId(animeId)));
              }}
              onFocusCluster={() => {
                setInspectorExpanded(false);
                window.requestAnimationFrame(() => focusNode(selectedNode.id));
              }}
              onSelectVA={(id) => selectNode(id)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RoundDockButton({
  label,
  icon,
  onClick,
  active = false,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  badge?: number;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-label={label}
      className={cx(
        'group flex min-h-[58px] min-w-[54px] cursor-pointer flex-col items-center justify-start gap-1 rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
      )}
    >
      <span
        className={cx(
          'sc-glass relative flex h-12 w-12 items-center justify-center rounded-full transition-colors',
          active ? 'border-white/35 bg-white/15 text-white' : 'text-zinc-200 group-hover:border-white/25 group-hover:text-white',
        )}
      >
        {icon}
        {badge !== undefined && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-zinc-100 px-1 font-mono text-[10px] font-bold text-zinc-950">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[10.5px] font-medium whitespace-nowrap break-keep text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
        {label}
      </span>
    </motion.button>
  );
}
