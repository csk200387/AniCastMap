import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Library, Mic, MoreHorizontal, Network, SlidersHorizontal } from 'lucide-react';
import { animeNodeId, pickName, pickTitle, type AnimeDataSource, type VoiceActorNode } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
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
  MobilePlaybackStrip,
  useActiveFilterCount,
} from './MobileControls';

type TabKey = 'list' | 'map' | 'va';

const TAB_BAR_HEIGHT = 64;

export function TabsShell({
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
  const watchedCount = useGraphStore((s) => s.watchedAnime.length);
  const locale = useGraphStore((s) => s.locale);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const setStageInsets = useGraphStore((s) => s.setStageInsets);
  const activeFilters = useActiveFilterCount();

  const [activeTab, setActiveTab] = useState<TabKey>(() => (hasGraph ? 'map' : 'list'));
  const [popover, setPopover] = useState<'filters' | 'more' | null>(null);

  const selectedNode = useMemo(
    () => (selectedNodeId && graph ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, graph],
  );

  // Tapping a voice actor on the map switches to the 성우 tab automatically.
  const prevSelectedRef = useRef<string | null>(selectedNodeId);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedNodeId;
    if (activeTab === 'map' && selectedNodeId && selectedNodeId !== prev && selectedNodeId.startsWith('va:')) {
      setPopover(null);
      setActiveTab('va');
    }
  }, [selectedNodeId, activeTab]);

  // Listen to EmptyState's "시청 목록 열기"
  useEffect(() => {
    const onOpen = () => setActiveTab('list');
    window.addEventListener(OPEN_WATCHED_LIST_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WATCHED_LIST_EVENT, onOpen);
  }, []);

  // Keep stageInsets synced to the map tab's visible area
  useEffect(() => {
    const top = 68 + sharedTop;
    const bottom = TAB_BAR_HEIGHT + (hasGraph ? 76 : 12);
    setStageInsets({ left: 0, top, right: 0, bottom });
  }, [sharedTop, hasGraph, setStageInsets]);

  const bridgeVAs = useMemo<VoiceActorNode[]>(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n): n is VoiceActorNode => n.kind === 'VOICE_ACTOR' && n.degree >= 2)
      .sort((a, b) => b.degree - a.degree || b.roles.length - a.roles.length);
  }, [graph]);

  const handleGenerate = () => {
    onGenerate();
    setActiveTab('map');
  };

  const tabs: ReadonlyArray<{ id: TabKey; label: string; Icon: typeof Library; badge?: number | boolean }> = [
    { id: 'list', label: '목록', Icon: Library, badge: watchedCount > 0 ? watchedCount : undefined },
    { id: 'map', label: '지도', Icon: Network },
    { id: 'va', label: '성우', Icon: Mic, badge: Boolean(selectedNodeId?.startsWith('va:')) },
  ];

  return (
    <div data-phone-shell="tabs" className="pointer-events-none fixed inset-0 z-30">
      {/* Tab 1: 목록 (Full screen) */}
      {activeTab === 'list' && (
        <section
          aria-label={t.watchedList}
          className="pointer-events-auto fixed inset-x-0 z-30 flex flex-col bg-[#090a0f]/95 backdrop-blur-xl"
          style={{ top: sharedTop, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))` }}
        >
          <WatchedListPanel
            dataSource={dataSource}
            onGenerate={handleGenerate}
            variant="phone"
            showHeader
            headerActions={
              <button
                type="button"
                onClick={() => setPopover((p) => (p === 'more' ? null : 'more'))}
                aria-label="더보기"
                className={cx(
                  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:border-white/25 hover:text-white',
                  MOBILE_FOCUS_RING,
                )}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            }
            onFocusAnimeNode={(nodeId) => {
              setActiveTab('map');
              window.requestAnimationFrame(() => focusNode(nodeId));
            }}
          />
        </section>
      )}

      {/* Tab 2: 지도 (Map + Compact Top Bar + Playback) */}
      {activeTab === 'map' && (
        <>
          <div
            className="pointer-events-none fixed inset-x-2.5 z-30 flex flex-col gap-2"
            style={{ top: 10 + sharedTop }}
          >
            <div className="sc-glass pointer-events-auto flex items-center justify-between gap-1 rounded-2xl p-1">
              <div className="min-w-0 flex-1">
                <MobileModePills layoutId="sc-tabs-mode" />
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setPopover((p) => (p === 'filters' ? null : 'filters'))}
                  aria-expanded={popover === 'filters'}
                  aria-label={t.filterGroup}
                  className={cx(
                    'relative flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-1 rounded-xl px-2.5 text-[12px] font-medium whitespace-nowrap break-keep transition-colors',
                    MOBILE_FOCUS_RING,
                    popover === 'filters' ? 'bg-white/15 text-white' : 'text-zinc-300 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  <span>필터</span>
                  {activeFilters > 0 && (
                    <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-zinc-100 px-1 font-mono text-[10px] font-bold text-zinc-950">
                      {activeFilters}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setPopover((p) => (p === 'more' ? null : 'more'))}
                  aria-expanded={popover === 'more'}
                  aria-label="더보기"
                  className={cx(
                    'flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl transition-colors',
                    MOBILE_FOCUS_RING,
                    popover === 'more' ? 'bg-white/15 text-white' : 'text-zinc-300 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* If an anime node is tapped on the map, offer a one-tap pill to inspect its cast */}
          <AnimatePresence>
            {selectedNode && selectedNode.kind === 'ANIME' && (
              <motion.div
                key="anime-inspect-pill"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="pointer-events-none fixed inset-x-3 z-20 flex justify-center"
                style={{ bottom: `calc(${TAB_BAR_HEIGHT + (hasGraph ? 76 : 12)}px + env(safe-area-inset-bottom, 0px))` }}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('va')}
                  className={cx(
                    'sc-glass pointer-events-auto flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full px-4 text-[12.5px] font-medium whitespace-nowrap break-keep text-white',
                    MOBILE_FOCUS_RING,
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: selectedNode.anime.color }} aria-hidden="true" />
                  <span className="max-w-[180px] truncate">{pickTitle(selectedNode.anime.title, locale)}</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-sky-300">작품 정보</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className="pointer-events-none fixed inset-x-2.5 z-20"
            style={{ bottom: `calc(${TAB_BAR_HEIGHT + 10}px + env(safe-area-inset-bottom, 0px))` }}
          >
            <MobilePlaybackStrip />
          </div>
        </>
      )}

      {/* Tab 3: 성우 (Inspector or Bridge VA directory) */}
      {activeTab === 'va' && (
        <section
          aria-label={t.seiyuu}
          className="pointer-events-auto fixed inset-x-0 z-30 flex flex-col bg-[#090a0f]/95 backdrop-blur-xl"
          style={{ top: sharedTop, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))` }}
        >
          {selectedNode && graph ? (
            <InspectorPanel
              node={selectedNode}
              graph={graph}
              dataSource={dataSource}
              variant="phone"
              onClose={() => selectNode(null)}
              onFocusOnMap={() => {
                const targetId = selectedNode.id;
                setActiveTab('map');
                window.requestAnimationFrame(() => focusNode(targetId));
              }}
              onFocusAnime={(animeId) => {
                setActiveTab('map');
                window.requestAnimationFrame(() => focusNode(animeNodeId(animeId)));
              }}
              onSelectVA={(id) => selectNode(id)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3.5">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">브릿지 성우 목록</h2>
                  <p className="mt-0.5 text-[12px] text-zinc-400">작품 사이를 이어주는 성우를 선택하세요</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPopover((p) => (p === 'more' ? null : 'more'))}
                  aria-label="더보기"
                  className={cx(
                    'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:border-white/25 hover:text-white',
                    MOBILE_FOCUS_RING,
                  )}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </header>

              <div className="sc-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
                {!graph || bridgeVAs.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center">
                    <p className="text-[13px] break-keep text-zinc-400">
                      연결된 작품이 2개 이상인 브릿지 성우가 아직 없습니다.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('list')}
                      className={cx(
                        'inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl bg-zinc-100 px-4 text-[13px] font-medium whitespace-nowrap break-keep text-zinc-950 hover:bg-white',
                        MOBILE_FOCUS_RING,
                      )}
                    >
                      목록으로 이동
                    </button>
                  </div>
                ) : (
                  bridgeVAs.map((va) => {
                    const name = pickName(va.voiceActor.name, locale);
                    const secondary = locale === 'ja' ? va.voiceActor.name.full : va.voiceActor.name.native;
                    const primaryColor = animeColor(graph.animeById, va.roles[0]?.animeId);
                    const animeIds = distinctAnimeIds(va.roles);

                    return (
                      <button
                        key={va.id}
                        type="button"
                        onClick={() => selectNode(va.id)}
                        className={cx(
                          'flex min-h-[68px] w-full cursor-pointer flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-white/25 hover:bg-white/[0.06]',
                          MOBILE_FOCUS_RING,
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/20">
                            <Avatar loading="lazy" src={va.voiceActor.image} name={va.voiceActor.name.full} color={primaryColor} alt={name} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[14px] font-semibold text-white">{name}</span>
                              <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-200">
                                {t.cardOverlap(va.degree)}
                              </span>
                            </div>
                            {secondary && secondary !== name && (
                              <p className="mt-0.5 truncate text-[11.5px] text-zinc-500">{secondary}</p>
                            )}
                          </div>
                          <ChevronRight size={16} className="shrink-0 text-zinc-500" aria-hidden="true" />
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {animeIds.map((id) => {
                            const anime = graph.animeById.get(id);
                            if (!anime) return null;
                            return (
                              <span
                                key={id}
                                className="inline-flex max-w-[160px] items-center rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] text-zinc-300"
                                style={{ borderLeft: `2px solid ${anime.color}` }}
                              >
                                <span className="truncate">{pickTitle(anime.title, locale)}</span>
                              </span>
                            );
                          })}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Shared popover overlay (filters / overflow menu) */}
      <AnimatePresence>
        {popover && (
          <>
            <motion.div
              key="tabs-popover-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-auto fixed inset-0 z-[44] bg-black/40"
              onClick={() => setPopover(null)}
            />
            <motion.div
              key="tabs-popover-card"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="sc-glass pointer-events-auto fixed inset-x-2.5 z-[45] rounded-2xl p-3.5"
              style={{ top: 64 + sharedTop }}
            >
              {popover === 'filters' ? (
                <MobileFilterPanel onClose={() => setPopover(null)} />
              ) : (
                <MobileOverflowMenu onClose={() => setPopover(null)} />
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Persistent Bottom Tab Bar */}
      <nav
        aria-label="기본 탭"
        className="sc-glass pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-x-0 border-b-0 px-2 pt-1.5"
        style={{
          height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {tabs.map(({ id, label, Icon, badge }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPopover(null);
                setActiveTab(id);
              }}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'relative flex min-h-[48px] min-w-[72px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-medium whitespace-nowrap break-keep transition-colors',
                MOBILE_FOCUS_RING,
                active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200',
              )}
            >
              <span className="relative flex items-center justify-center">
                <Icon size={18} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
                {typeof badge === 'number' && (
                  <span className="absolute -top-1.5 -right-3.5 rounded-full bg-white/15 px-1.5 font-mono text-[9.5px] font-semibold text-zinc-200">
                    {badge}
                  </span>
                )}
                {badge === true && (
                  <span className="absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full bg-sky-400" aria-hidden="true" />
                )}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
