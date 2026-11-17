import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Globe, Info, Share2, SlidersHorizontal } from 'lucide-react';
import { animeNodeId, type AnimeDataSource } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { InspectorPanel } from '../drawers/InspectorDrawer';
import { WatchedListPanel } from '../drawers/WatchedListDrawer';
import { openDisclaimerModal } from '../hud/Disclaimer';
import { OPEN_WATCHED_LIST_EVENT } from '../hud/EmptyState';
import { cx } from '../nodes/nodeTheme';
import {
  MOBILE_FOCUS_RING,
  MobileFilterPanel,
  MobileLocalePills,
  MobileModePills,
  MobileOverflowMenu,
  MobilePlaybackStrip,
  useActiveFilterCount,
  useViewportSize,
} from './MobileControls';

type ListSnap = 'peek' | 'half' | 'full';
type InspectorSnap = 'half' | 'full';

const PEEK_HEIGHT = 156;
const PLAYBACK_CLEARANCE = 68;
const SHEET_SPRING = { type: 'spring', stiffness: 360, damping: 34 } as const;

export function SheetShell({
  dataSource,
  onGenerate,
  sharedTop,
}: {
  dataSource: AnimeDataSource;
  onGenerate: () => void;
  sharedTop: number;
}) {
  const t = useT();
  const viewport = useViewportSize();
  const graph = useGraphStore((s) => s.graph);
  const hasGraph = graph !== null;
  const locale = useGraphStore((s) => s.locale);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const setShareOpen = useGraphStore((s) => s.setShareOpen);
  const setStageInsets = useGraphStore((s) => s.setStageInsets);
  const activeFilters = useActiveFilterCount();

  const selectedNode = useMemo(
    () => (selectedNodeId && graph ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, graph],
  );
  const isInspecting = Boolean(selectedNode && graph);

  const [listSnap, setListSnap] = useState<ListSnap>('peek');
  const [inspectorSnap, setInspectorSnap] = useState<InspectorSnap>('half');
  const [popover, setPopover] = useState<'filters' | 'locale' | 'more' | null>(null);

  // Dragging state on the sheet handle (live pixel height while dragging)
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startH: number; lastY: number; lastTime: number; vy: number; moved: boolean } | null>(null);

  // Reset inspector to half height whenever a node is selected
  useEffect(() => {
    if (selectedNodeId) setInspectorSnap('half');
  }, [selectedNodeId]);

  // Listen to EmptyState's "시청 목록 열기" button
  useEffect(() => {
    const onOpen = () => {
      selectNode(null);
      setListSnap('half');
    };
    window.addEventListener(OPEN_WATCHED_LIST_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WATCHED_LIST_EVENT, onOpen);
  }, [selectNode]);

  const topChrome = 68 + sharedTop;
  const halfH = Math.round(Math.min(Math.max(viewport.height * 0.48, 320), viewport.height - topChrome - 100));
  const fullH = Math.max(halfH + 80, viewport.height - topChrome - 8);

  const snapHeight = isInspecting
    ? inspectorSnap === 'full'
      ? fullH
      : halfH
    : listSnap === 'full'
      ? fullH
      : listSnap === 'half'
        ? halfH
        : PEEK_HEIGHT;

  const activeHeight = dragHeight ?? snapHeight;
  const isFull = isInspecting ? inspectorSnap === 'full' : listSnap === 'full';
  const showPlayback = hasGraph && !isFull && dragHeight === null;

  // Report visible map insets to camera/fitView
  useEffect(() => {
    const visibleSheetBottom = isFull ? halfH : snapHeight;
    const bottomInset = visibleSheetBottom + (hasGraph && !isFull ? PLAYBACK_CLEARANCE : 8);
    setStageInsets({ left: 0, top: topChrome, right: 0, bottom: bottomInset });
  }, [topChrome, snapHeight, halfH, isFull, hasGraph, setStageInsets]);

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startH: snapHeight,
      lastY: e.clientY,
      lastTime: performance.now(),
      vy: 0,
      moved: false,
    };
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) >= 6) d.moved = true;
    if (!d.moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastTime);
    d.vy = (d.lastY - e.clientY) / dt; // positive = dragging up
    d.lastY = e.clientY;
    d.lastTime = now;
    const minH = isInspecting ? halfH - 40 : PEEK_HEIGHT - 20;
    const nextH = Math.min(fullH + 16, Math.max(minH, d.startH + dy));
    setDragHeight(nextH);
  };

  const onHandlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragHeight(null);

    if (!d.moved) {
      // Tap cycles heights
      if (isInspecting) {
        setInspectorSnap((cur) => (cur === 'half' ? 'full' : 'half'));
      } else {
        setListSnap((cur) => (cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'peek'));
      }
      return;
    }

    const projected = Math.min(fullH, Math.max(PEEK_HEIGHT, d.startH + (d.startY - e.clientY) + d.vy * 140));
    if (isInspecting) {
      setInspectorSnap(projected >= (halfH + fullH) / 2 ? 'full' : 'half');
    } else {
      const snaps: Array<{ key: ListSnap; h: number }> = [
        { key: 'peek', h: PEEK_HEIGHT },
        { key: 'half', h: halfH },
        { key: 'full', h: fullH },
      ];
      let best = snaps[0]!;
      let bestDist = Infinity;
      for (const s of snaps) {
        const dist = Math.abs(projected - s.h);
        if (dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      }
      setListSnap(best.key);
    }
  };

  const handleGenerate = () => {
    onGenerate();
    setListSnap('peek');
  };

  const localeCode = locale === 'ko' ? 'KR' : locale === 'ja' ? 'JP' : 'EN';

  return (
    <div data-phone-shell="sheet" className="pointer-events-none fixed inset-0 z-30">
      {/* Compact Top Bar: Mode switch + Filter button + Language + Share */}
      <div
        className="pointer-events-none fixed inset-x-2.5 z-[35] flex flex-col gap-2"
        style={{ top: 10 + sharedTop }}
      >
        <div className="sc-glass pointer-events-auto flex items-center justify-between gap-1 rounded-2xl p-1">
          <div className="min-w-0 flex-1">
            <MobileModePills layoutId="sc-sheet-mode" />
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
              onClick={() => setPopover((p) => (p === 'locale' ? null : 'locale'))}
              aria-expanded={popover === 'locale'}
              aria-label={t.localeGroup}
              className={cx(
                'flex h-11 min-w-[44px] cursor-pointer items-center justify-center rounded-xl px-2 font-mono text-[11px] font-semibold transition-colors',
                MOBILE_FOCUS_RING,
                popover === 'locale' ? 'bg-white/15 text-white' : 'text-zinc-300 hover:bg-white/8 hover:text-white',
              )}
            >
              {localeCode}
            </button>

            {hasGraph && (
              <button
                type="button"
                onClick={() => {
                  setPopover(null);
                  setShareOpen(true);
                }}
                aria-label={t.share}
                title={t.share}
                className={cx(
                  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-zinc-200 transition-colors hover:bg-white/8 hover:text-white',
                  MOBILE_FOCUS_RING,
                )}
              >
                <Share2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Popovers under top bar */}
        <AnimatePresence>
          {popover && (
            <motion.div
              key={popover}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className="sc-glass pointer-events-auto rounded-2xl p-3"
            >
              {popover === 'filters' ? (
                <MobileFilterPanel onClose={() => setPopover(null)} />
              ) : popover === 'locale' ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-300">
                      <Globe size={13} aria-hidden="true" />
                      {t.localeGroup}
                    </span>
                  </div>
                  <MobileLocalePills layoutId="sc-sheet-locale" />
                  <button
                    type="button"
                    onClick={() => {
                      setPopover(null);
                      openDisclaimerModal();
                    }}
                    className={cx(
                      'flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium whitespace-nowrap break-keep text-zinc-200 hover:border-white/25',
                      MOBILE_FOCUS_RING,
                    )}
                  >
                    <Info size={14} aria-hidden="true" />
                    <span>{t.disclaimerLabel}</span>
                  </button>
                </div>
              ) : (
                <MobileOverflowMenu onClose={() => setPopover(null)} showLocale={false} showShare={false} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tap-away backdrop when a top popover is open */}
      {popover && (
        <div
          className="pointer-events-auto fixed inset-0 z-[34]"
          aria-hidden="true"
          onClick={() => setPopover(null)}
        />
      )}

      {/* Compact playback strip floating just above the sheet */}
      <AnimatePresence>
        {showPlayback && (
          <motion.div
            key="sheet-playback"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-none fixed inset-x-2.5 z-20"
            style={{ bottom: snapHeight + 10 }}
          >
            <MobilePlaybackStrip onOpenMenu={() => setPopover((p) => (p === 'more' ? null : 'more'))} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Sheet */}
      <motion.section
        aria-label={isInspecting ? (selectedNode?.kind === 'VOICE_ACTOR' ? t.seiyuu : t.castInGraph) : t.watchedList}
        className="sc-glass pointer-events-auto fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-3xl border-b-0"
        animate={{ height: activeHeight }}
        transition={dragHeight !== null ? { duration: 0 } : SHEET_SPRING}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Drag / tap handle (>= 44px hit target) */}
        <button
          type="button"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          aria-label="시트 크기 전환"
          className={cx(
            'flex min-h-[44px] w-full shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-1 select-none active:cursor-grabbing',
            MOBILE_FOCUS_RING,
          )}
        >
          <span className="h-1 w-10 rounded-full bg-white/30" aria-hidden="true" />
        </button>

        {isInspecting && selectedNode && graph ? (
          <InspectorPanel
            node={selectedNode}
            graph={graph}
            dataSource={dataSource}
            variant="phone"
            onClose={() => {
              selectNode(null);
              setListSnap('peek');
            }}
            onFocusAnime={(animeId) => {
              focusNode(animeNodeId(animeId));
              if (inspectorSnap === 'full') setInspectorSnap('half');
            }}
            onFocusCluster={() => {
              focusNode(selectedNode.id);
              if (inspectorSnap === 'full') setInspectorSnap('half');
            }}
            onSelectVA={(id) => selectNode(id)}
          />
        ) : (
          <WatchedListPanel
            dataSource={dataSource}
            onGenerate={handleGenerate}
            variant="phone"
            showHeader={false}
            peekMode={listSnap === 'peek' && dragHeight === null}
            onSearchFocus={() => {
              if (listSnap === 'peek') setListSnap('full');
            }}
            onFocusAnimeNode={(nodeId) => {
              focusNode(nodeId);
              setListSnap('peek');
            }}
          />
        )}
      </motion.section>
    </div>
  );
}
