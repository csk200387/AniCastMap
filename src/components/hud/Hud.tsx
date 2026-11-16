import { AnimatePresence, motion } from 'framer-motion';
import { useGraphStore } from '../../store/useGraphStore';
import { FilterToggles } from './FilterToggles';
import { ModeSwitcher } from './ModeSwitcher';
import { PlaybackBar } from './PlaybackBar';
import { RecommendToggle } from './RecommendToggle';
import { SHARED_BANNER_OFFSET } from './SharedBanner';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

/**
 * Floating Observatory HUD (z-20): top-centre mode/locale switcher, a recommendation toggle that
 * appears while a voice actor is selected, bottom-centre playback bar, and global keyboard shortcuts.
 */
export function Hud() {
  useKeyboardShortcuts();
  const vaSelected = useGraphStore((s) => s.selectedNodeId?.startsWith('va:') ?? false);
  // The shared-map banner owns the top strip; everything else slides under it.
  const top = useGraphStore((s) => (s.isSharedView ? SHARED_BANNER_OFFSET : 0));

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-between p-3" style={{ paddingTop: 12 + top, paddingBottom: 28 }}>
      <ModeSwitcher />
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 68 + top }}>
        <FilterToggles />
      </div>
      <AnimatePresence>
        {vaSelected && (
          <motion.div
            key="rec-toggle"
            className="absolute left-1/2"
            style={{ top: 110 + top }}
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
