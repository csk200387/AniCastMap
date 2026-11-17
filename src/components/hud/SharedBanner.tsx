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
  const sharedSource = useGraphStore((s) => s.sharedSource);
  const ownSavedCount = useGraphStore((s) => s.ownSavedCount);

  const isBackup = sharedSource === 'backup';
  const bannerText = isBackup ? t.backupBanner : t.sharedBanner;

  return (
    <AnimatePresence>
      {shared && (
        <motion.div
          key="shared-banner"
          role="region"
          aria-label={bannerText}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="sc-glass pointer-events-auto fixed inset-x-3 top-3 z-40 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 rounded-2xl px-3 py-2 sm:py-1.5 sm:pr-1.5 sm:pl-3.5"
        >
          <div className="mr-1 flex max-w-full flex-col text-center break-keep wrap-break-word sm:text-left">
            <span className="text-[12px] font-medium text-zinc-200">{bannerText}</span>
            {ownSavedCount > 0 && <span className="text-[11px] text-zinc-400">{t.ownListSafe(ownSavedCount)}</span>}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button type="button" onClick={saveSharedAsMine} className={cx(BUTTON, FOCUS_RING, 'bg-zinc-100 text-zinc-950 hover:bg-white')}>
              {isBackup ? t.backupReplace : t.sharedSave}
            </button>
            <button type="button" onClick={() => mergeSharedIntoMine(ds)} className={cx(BUTTON, FOCUS_RING, 'border border-white/15 text-zinc-100 hover:border-white/30')}>
              {isBackup ? t.backupMerge : t.sharedMerge}
            </button>
            <button type="button" onClick={() => returnToMyMap(ds)} className={cx(BUTTON, FOCUS_RING, 'text-zinc-400 hover:text-zinc-100')}>
              {isBackup ? t.backupKeep : t.sharedReturn}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
