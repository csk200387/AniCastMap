import { memo } from 'react';
import { motion } from 'framer-motion';
import { LayoutGrid, Mic, Share2, User } from 'lucide-react';
import { VIEW_MODES, type DisplayLocale, type ViewMode } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { cx } from '../nodes/nodeTheme';

const MODE_META: Record<ViewMode, { key: 'modeCharacter' | 'modeVa' | 'modeDetail'; hotkey: string; Icon: typeof User }> = {
  MODE_CHARACTER: { key: 'modeCharacter', hotkey: '1', Icon: User },
  MODE_VA: { key: 'modeVa', hotkey: '2', Icon: Mic },
  MODE_DETAIL: { key: 'modeDetail', hotkey: '3', Icon: LayoutGrid },
};

// The language switcher is the one place where locale codes are shown side by side — by design.
const LOCALES: ReadonlyArray<{ id: DisplayLocale; label: string; aria: string }> = [
  { id: 'ko', label: 'KR', aria: '한국어' },
  { id: 'ja', label: 'JP', aria: '日本語' },
  { id: 'en', label: 'EN', aria: 'English' },
];

const PILL_SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const;

export const ModeSwitcher = memo(function ModeSwitcher() {
  const t = useT();
  const viewMode = useGraphStore((s) => s.viewMode);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const locale = useGraphStore((s) => s.locale);
  const setLocale = useGraphStore((s) => s.setLocale);
  const hasGraph = useGraphStore((s) => s.graph !== null);

  return (
    <div
      className="sc-glass pointer-events-auto flex items-center gap-1.5 rounded-2xl p-1.5"
      role="toolbar"
      aria-label={`${t.modeGroup} / ${t.localeGroup}`}
    >
      <div className="flex items-center gap-1" role="group" aria-label={t.modeGroup}>
        {VIEW_MODES.map((mode) => {
          const { key, hotkey, Icon } = MODE_META[mode];
          const active = viewMode === mode;

          return (
            <motion.button
              key={mode}
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => setViewMode(mode)}
              aria-pressed={active}
              className={cx(
                'relative flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                active ? 'text-white' : 'text-white/55 hover:text-white/85',
              )}
            >
              {active && (
                <motion.span
                  layoutId="sc-mode-pill"
                  transition={PILL_SPRING}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-xl border border-white/15 bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_14px_rgba(0,0,0,0.35)]"
                />
              )}

              <Icon
                size={14}
                strokeWidth={2.2}
                className={cx('relative z-10 shrink-0', active ? 'text-white' : 'text-white/45')}
                aria-hidden="true"
              />

              <span className="relative z-10 text-[12px] font-medium tracking-[-0.01em]">{t[key]}</span>

              <kbd className="sc-kbd relative z-10 ml-0.5 hidden sm:inline-flex" aria-hidden="true">
                {hotkey}
              </kbd>
            </motion.button>
          );
        })}
      </div>

      <span className="mx-0.5 h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />

      <div className="flex items-center gap-0.5 rounded-xl bg-black/25 p-0.5" role="group" aria-label={t.localeGroup}>
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
                'relative cursor-pointer rounded-lg px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.04em] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                active ? 'text-[#090a0f]' : 'text-white/55 hover:text-white/85',
              )}
            >
              {active && (
                <motion.span
                  layoutId="sc-locale-pill"
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

      {hasGraph && (
        <>
          <span className="mx-0.5 h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => useGraphStore.getState().setShareOpen(true)}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Share2 size={14} strokeWidth={2.2} aria-hidden="true" />
            {t.share}
          </motion.button>
        </>
      )}
    </div>
  );
});
