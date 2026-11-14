import { AnimatePresence, motion } from 'framer-motion';
import { useGraphStore } from '../../store/useGraphStore';
import { FilterToggles } from './FilterToggles';
import { ModeSwitcher } from './ModeSwitcher';
import { PlaybackBar } from './PlaybackBar';
import { RecommendToggle } from './RecommendToggle';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

/**
 * Floating Observatory HUD (z-20): top-centre mode/locale switcher, a recommendation toggle that
 * appears while a voice actor is selected, bottom-centre playback bar, and global keyboard shortcuts.
 */
export function Hud() {
  useKeyboardShortcuts();
  const vaSelected = useGraphStore((s) => s.selectedNodeId?.startsWith('va:') ?? false);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-between p-3">
      <ModeSwitcher />
      <div className="absolute top-[68px] left-1/2 -translate-x-1/2">
        <FilterToggles />
      </div>
      <AnimatePresence>
        {vaSelected && (
          <motion.div
            key="rec-toggle"
            className="absolute top-[110px] left-1/2"
            initial={{ opacity: 0, y: -6, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -6, x: '-50%' }}
            transition={{ duration: 0.18 }}
          >
            <RecommendToggle variant="hud" />
          </motion.div>
        )}
      </AnimatePresence>
      <PlaybackBar />
    </div>
  );
}
