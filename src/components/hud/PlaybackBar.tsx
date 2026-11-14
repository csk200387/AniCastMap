import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, Pause, Play, RotateCcw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { GenesisSpeed } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { cx } from '../nodes/nodeTheme';

const SPEEDS: ReadonlyArray<{ value: GenesisSpeed; label: string | null }> = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 'INSTANT', label: null }, // localized
];

const BAR_SPRING = { type: 'spring', stiffness: 360, damping: 30 } as const;

export const PlaybackBar = memo(function PlaybackBar() {
  const t = useT();
  const hasGraph = useGraphStore((s) => s.graph !== null);
  const genesis = useGraphStore(useShallow((s) => s.genesis));
  const genesisSpeed = useGraphStore((s) => s.genesisSpeed);
  const physicsPaused = useGraphStore((s) => s.physicsPaused);
  const setGenesisSpeed = useGraphStore((s) => s.setGenesisSpeed);
  const togglePhysics = useGraphStore((s) => s.togglePhysics);
  const replayGenesis = useGraphStore((s) => s.replayGenesis);
  const fitView = useGraphStore((s) => s.fitView);

  const isPlaying = genesis.status === 'playing';
  const total = Math.max(genesis.totalSteps, 0);
  const step = Math.min(Math.max(genesis.step, 0), total || genesis.step);
  const progress =
    genesis.status === 'done'
      ? 100
      : total > 0
        ? Math.min(100, Math.max(0, (step / total) * 100))
        : 0;
  const tickCount = Math.min(Math.max(total - 1, 0), 20);

  return (
    <AnimatePresence>
      {hasGraph && (
        <motion.div
          key="playback-bar"
          initial={{ y: 24, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.96 }}
          transition={BAR_SPRING}
          className="sc-glass pointer-events-auto flex w-auto max-w-[calc(100vw-24px)] flex-col gap-2 rounded-2xl px-3 py-2"
          role="region"
          aria-label={t.replay}
        >
          {/* Thin timeline scrubber-style progress track */}
          <div className="flex items-center gap-2.5">
            <span className="w-[44px] text-[11px] font-medium text-zinc-300">{isPlaying ? t.statusPlaying : t.statusDone}</span>

            <div
              className="relative h-1.5 min-w-[140px] flex-1 overflow-hidden rounded-full bg-white/8"
              role="progressbar"
              aria-label={isPlaying ? t.statusPlaying : t.statusDone}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={step}
            >
              <motion.div
                className="h-full rounded-full bg-zinc-200"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              />
              {tickCount > 0 && (
                <div className="pointer-events-none absolute inset-0 flex justify-evenly" aria-hidden="true">
                  {Array.from({ length: tickCount }).map((_, idx) => (
                    <span key={idx} className="h-full w-px bg-[#090a0f]/75" />
                  ))}
                </div>
              )}
            </div>

            <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/55">
              {String(step).padStart(2, '0')}
              <span className="text-white/30"> / </span>
              {String(total).padStart(2, '0')}
            </span>
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={replayGenesis}
              aria-label={`${t.replay} (R)`}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11.5px] font-medium text-white/85 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <RotateCcw size={13} strokeWidth={2.2} aria-hidden="true" />
              <span>{t.replay}</span>
              <kbd className="sc-kbd" aria-hidden="true">
                R
              </kbd>
            </motion.button>

            <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden="true" />

            <div className="flex items-center gap-0.5 rounded-xl bg-black/30 p-0.5" role="group" aria-label="Genesis speed">
              {SPEEDS.map((item) => {
                const active = genesisSpeed === item.value;
                return (
                  <motion.button
                    key={String(item.value)}
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setGenesisSpeed(item.value)}
                    aria-pressed={active}
                    aria-label={item.label ?? t.speedInstant}
                    className={cx(
                      'relative cursor-pointer rounded-lg px-2 py-1 font-mono text-[10.5px] font-semibold transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                      active ? 'text-[#090a0f]' : 'text-white/55 hover:text-white/85',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="sc-speed-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-lg bg-zinc-100"
                      />
                    )}
                    <span className="relative z-10">{item.label ?? t.speedInstant}</span>
                  </motion.button>
                );
              })}
            </div>

            <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden="true" />

            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={togglePhysics}
              aria-pressed={physicsPaused}
              aria-label={`${physicsPaused ? t.paused : t.physics} (Space)`}
              className={cx(
                'flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                physicsPaused
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-white/10 bg-white/5 text-white/85 hover:border-white/20 hover:bg-white/10 hover:text-white',
              )}
            >
              {physicsPaused ? (
                <Play size={13} strokeWidth={2.2} className="fill-current" aria-hidden="true" />
              ) : (
                <Pause size={13} strokeWidth={2.2} aria-hidden="true" />
              )}
              <span>{physicsPaused ? t.paused : t.physics}</span>
              <kbd className="sc-kbd" aria-hidden="true">
                Space
              </kbd>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={fitView}
              aria-label={`${t.fit} (F)`}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11.5px] font-medium text-white/85 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <Maximize2 size={13} strokeWidth={2.2} aria-hidden="true" />
              <span>{t.fit}</span>
              <kbd className="sc-kbd" aria-hidden="true">
                F
              </kbd>
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
