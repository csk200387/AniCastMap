import { AnimatePresence, motion } from 'framer-motion';
import { useGraphStore } from '../../store/useGraphStore';
import { useDataSource } from '../../lib/dataSource';
import { mergeSharedIntoMine, returnToMyMap, saveSharedAsMine } from '../../lib/session';
import { useT } from '../../i18n/ui';
import { cx } from '../nodes/nodeTheme';

/** Height the HUD reserves under the banner while a shared map is open. */
export const SHARED_BANNER_OFFSET = 56;
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';
const BUTTON = 'cursor-pointer rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium whitespace-nowrap transition-colors';

/** Shared-link sandbox: nothing is saved until the visitor picks one of these. */
export function SharedBanner() {
  const t = useT();
  const ds = useDataSource();
  const shared = useGraphStore((s) => s.isSharedView);
  return (
    <AnimatePresence>
      {shared && (
        <motion.div
          key="shared-banner"
          role="region"
          aria-label={t.sharedBanner}
          initial={{ opacity: 0, y: -8, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -8, x: '-50%' }}
          transition={{ duration: 0.18 }}
          className="sc-glass pointer-events-auto fixed top-3 left-1/2 z-40 flex max-w-[calc(100vw-24px)] flex-wrap items-center justify-center gap-1.5 rounded-2xl py-1.5 pr-1.5 pl-3.5"
        >
          <span className="mr-1 text-[12px] font-medium text-zinc-200">{t.sharedBanner}</span>
          <button type="button" onClick={saveSharedAsMine} className={cx(BUTTON, FOCUS_RING, 'bg-zinc-100 text-zinc-950 hover:bg-white')}>
            {t.sharedSave}
          </button>
          <button type="button" onClick={() => mergeSharedIntoMine(ds)} className={cx(BUTTON, FOCUS_RING, 'border border-white/15 text-zinc-100 hover:border-white/30')}>
            {t.sharedMerge}
          </button>
          <button type="button" onClick={() => returnToMyMap(ds)} className={cx(BUTTON, FOCUS_RING, 'text-zinc-400 hover:text-zinc-100')}>
            {t.sharedReturn}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
