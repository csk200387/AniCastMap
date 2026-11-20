import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Globe,
  Info,
  LayoutGrid,
  Mic,
  Pause,
  Play,
  Share2,
  User,
  X,
} from 'lucide-react';
import { VIEW_MODES, type DisplayLocale, type GenesisSpeed, type ViewMode } from '../../types/contract';
import { setGraphFilter } from '../../lib/rebuildGraph';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { openDisclaimerModal } from '../hud/Disclaimer';
import { Switch } from '../hud/Switch';
import { cx } from '../nodes/nodeTheme';

export const MOBILE_FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

const MODE_META: Record<ViewMode, { key: 'modeCharacter' | 'modeVa' | 'modeDetail'; Icon: typeof User }> = {
  MODE_CHARACTER: { key: 'modeCharacter', Icon: User },
  MODE_VA: { key: 'modeVa', Icon: Mic },
  MODE_DETAIL: { key: 'modeDetail', Icon: LayoutGrid },
};

const LOCALES: ReadonlyArray<{ id: DisplayLocale; label: string; aria: string }> = [
  { id: 'ko', label: 'KR', aria: '한국어' },
  { id: 'ja', label: 'JP', aria: '日本語' },
  { id: 'en', label: 'EN', aria: 'English' },
];

const SPEEDS: ReadonlyArray<{ value: GenesisSpeed; label: string | null }> = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 'INSTANT', label: null },
];

const PILL_SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const;

export function useActiveFilterCount(): number {
  const showSupporting = useGraphStore((s) => s.showSupportingRoles);
  const includeSub = useGraphStore((s) => s.includeSubVoiceActors);
  const bridgesOnly = useGraphStore((s) => s.bridgesOnly);
  const showNameLabels = useGraphStore((s) => s.showNameLabels);
  return Number(showSupporting) + Number(includeSub) + Number(bridgesOnly) + Number(showNameLabels);
}

/** Tracks the pixel height of the shared-map banner when `?s=` is active. */
export function useSharedBannerHeight(): number {
  const isSharedView = useGraphStore((s) => s.isSharedView);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!isSharedView) {
      setHeight(0);
      return;
    }
    const measure = () => {
      const el = document.querySelector<HTMLElement>('[data-shared-banner="true"]');
      setHeight(el ? Math.ceil(el.getBoundingClientRect().height) + 12 : 96);
    };
    measure();
    const el = document.querySelector<HTMLElement>('[data-shared-banner="true"]');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isSharedView]);

  return height;
}

export function MobileModePills({ layoutId = 'sc-mobile-mode-pill' }: { layoutId?: string }) {
  const t = useT();
  const viewMode = useGraphStore((s) => s.viewMode);
  const setViewMode = useGraphStore((s) => s.setViewMode);

  return (
    <div
      className="flex w-full flex-col items-stretch gap-1"
      role="group"
      aria-label={t.modeGroup}
    >
      {VIEW_MODES.map((mode) => {
        const { key, Icon } = MODE_META[mode];
        const active = viewMode === mode;
        return (
          <motion.button
            key={mode}
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setViewMode(mode)}
            aria-pressed={active}
            aria-label={t[key]}
            className={cx(
              'relative flex min-h-[44px] min-w-[44px] w-full cursor-pointer items-center justify-start gap-1.5 rounded-xl px-3 text-[12px] font-medium whitespace-nowrap break-keep transition-colors',
              MOBILE_FOCUS_RING,
              active ? 'text-white' : 'text-white/60 hover:text-white/90',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={PILL_SPRING}
                aria-hidden="true"
                className="absolute inset-0 rounded-xl border border-white/15 bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
              />
            )}
            <Icon size={14} strokeWidth={2.2} className="relative z-10 shrink-0" aria-hidden="true" />
            <span className="relative z-10">{t[key]}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

function MobileLocalePills({ layoutId = 'sc-mobile-locale-pill' }: { layoutId?: string }) {
  const t = useT();
  const locale = useGraphStore((s) => s.locale);
  const setLocale = useGraphStore((s) => s.setLocale);

  return (
    <div className="flex items-center gap-1 rounded-xl bg-black/30 p-1" role="group" aria-label={t.localeGroup}>
      {LOCALES.map((item) => {
        const active = locale === item.id;
        return (
          <motion.button
            key={item.id}
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocale(item.id)}
            aria-pressed={active}
            aria-label={item.aria}
            className={cx(
              'relative flex min-h-[44px] min-w-[44px] flex-1 cursor-pointer items-center justify-center rounded-lg px-2.5 font-mono text-[12px] font-semibold tracking-[0.04em] transition-colors',
              MOBILE_FOCUS_RING,
              active ? 'text-[#090a0f]' : 'text-white/60 hover:text-white/90',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={PILL_SPRING}
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-white/90 shadow-[0_2px_8px_rgba(255,255,255,0.2)]"
              />
            )}
            <span className="relative z-10">{item.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

export function MobileFilterPanel({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const showSupporting = useGraphStore((s) => s.showSupportingRoles);
  const includeSub = useGraphStore((s) => s.includeSubVoiceActors);
  const bridgesOnly = useGraphStore((s) => s.bridgesOnly);
  const showNameLabels = useGraphStore((s) => s.showNameLabels);
  const setShowNameLabels = useGraphStore((s) => s.setShowNameLabels);

  const items = [
    {
      key: 'supporting',
      label: t.filterSupporting,
      tip: t.filterSupportingTip,
      on: showSupporting,
      flip: () => setGraphFilter({ showSupportingRoles: !showSupporting }),
    },
    {
      key: 'sub',
      label: t.filterSub,
      tip: t.filterSubTip,
      on: includeSub,
      flip: () => setGraphFilter({ includeSubVoiceActors: !includeSub }),
    },
    {
      key: 'bridges',
      label: t.filterBridges,
      tip: t.filterBridgesTip,
      on: bridgesOnly,
      flip: () => setGraphFilter({ bridgesOnly: !bridgesOnly }),
    },
    {
      key: 'labels',
      label: t.filterNameLabels,
      tip: t.filterNameLabelsTip,
      on: showNameLabels,
      flip: () => setShowNameLabels(!showNameLabels),
    },
  ];

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={t.filterGroup}>
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-zinc-300">{t.filterGroup}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className={cx('flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white', MOBILE_FOCUS_RING)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="switch"
          aria-checked={item.on}
          onClick={item.flip}
          className={cx(
            'flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5 text-left transition-colors hover:border-white/20',
            MOBILE_FOCUS_RING,
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium break-keep text-white">{item.label}</span>
            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-zinc-400">{item.tip}</span>
          </span>
          <Switch on={item.on} />
        </button>
      ))}
    </div>
  );
}

export function MobileOverflowMenu({ onClose }: { onClose: () => void }) {
  const t = useT();
  const hasGraph = useGraphStore((s) => s.graph !== null);
  const physicsPaused = useGraphStore((s) => s.physicsPaused);
  const togglePhysics = useGraphStore((s) => s.togglePhysics);
  const genesisSpeed = useGraphStore((s) => s.genesisSpeed);
  const setGenesisSpeed = useGraphStore((s) => s.setGenesisSpeed);
  const setShareOpen = useGraphStore((s) => s.setShareOpen);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-zinc-300">더보기</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className={cx('flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white', MOBILE_FOCUS_RING)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-zinc-400">
          <Globe size={12} aria-hidden="true" />
          {t.localeGroup}
        </span>
        <MobileLocalePills layoutId="sc-overflow-locale" />
      </div>

      {hasGraph && (
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-[11px] font-medium text-zinc-400">재생 속도</span>
          <div className="flex items-center gap-1 rounded-xl bg-black/30 p-1" role="group" aria-label="재생 속도">
            {SPEEDS.map((item) => {
              const active = genesisSpeed === item.value;
              return (
                <button
                  key={String(item.value)}
                  type="button"
                  onClick={() => setGenesisSpeed(item.value)}
                  aria-pressed={active}
                  className={cx(
                    'flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-lg font-mono text-[12px] font-semibold whitespace-nowrap break-keep transition-colors',
                    MOBILE_FOCUS_RING,
                    active ? 'bg-zinc-100 text-zinc-950' : 'text-white/60 hover:text-white',
                  )}
                >
                  {item.label ?? t.speedInstant}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {hasGraph && (
        <button
          type="button"
          role="switch"
          aria-checked={!physicsPaused}
          onClick={togglePhysics}
          className={cx(
            'flex min-h-[48px] w-full cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-medium whitespace-nowrap break-keep text-white hover:border-white/25',
            MOBILE_FOCUS_RING,
          )}
        >
          <span className="flex items-center gap-2">
            {physicsPaused ? <Play size={14} className="fill-current" aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
            <span>{physicsPaused ? t.paused : t.physics}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            {!physicsPaused && <Check size={13} className="text-emerald-300" aria-hidden="true" />}
            <Switch on={!physicsPaused} />
          </span>
        </button>
      )}

      {hasGraph && (
        <button
          type="button"
          onClick={() => {
            onClose();
            setShareOpen(true);
          }}
          className={cx(
            'flex min-h-[48px] w-full cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-medium whitespace-nowrap break-keep text-white hover:border-white/25',
            MOBILE_FOCUS_RING,
          )}
        >
          <Share2 size={15} aria-hidden="true" />
          <span>{t.shareTitle}</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          onClose();
          openDisclaimerModal();
        }}
        className={cx(
          'flex min-h-[48px] w-full cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-medium whitespace-nowrap break-keep text-zinc-200 hover:border-white/25',
          MOBILE_FOCUS_RING,
        )}
      >
        <Info size={15} aria-hidden="true" />
        <span>{t.disclaimerLabel}</span>
      </button>
    </div>
  );
}
