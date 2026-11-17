import { motion } from 'framer-motion';
import { PanelLeftOpen } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';

export const OPEN_WATCHED_LIST_EVENT = 'anicast:open-watched-list';

export function EmptyState() {
  const t = useT();
  const isPhone = useGraphStore((s) => s.isPhone);
  const leftDrawerOpen = useGraphStore((s) => s.leftDrawerOpen);
  const setLeftDrawerOpen = useGraphStore((s) => s.setLeftDrawerOpen);
  const restoring = useGraphStore((s) => s.restoring);

  if (restoring) {
    return (
      <div className={`pointer-events-none fixed inset-0 ${isPhone ? 'z-10' : 'z-20'} flex items-center justify-center p-4`}>
        <p role="status" className="sc-glass rounded-xl px-4 py-2.5 text-[13px] text-zinc-300">
          {t.restoring}
        </p>
      </div>
    );
  }

  const handleOpen = () => {
    if (isPhone) window.dispatchEvent(new CustomEvent(OPEN_WATCHED_LIST_EVENT));
    else setLeftDrawerOpen(true);
  };

  return (
    <div className={`pointer-events-none fixed inset-0 ${isPhone ? 'z-10' : 'z-20'} flex items-center justify-center p-4`}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="sc-glass pointer-events-auto w-full max-w-[400px] rounded-2xl p-6 text-center"
      >
        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{t.brand}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">{t.emptyBody}</p>
        <p className="mt-3 text-[12px] leading-relaxed text-zinc-500">{t.emptyStep}</p>
        {(isPhone || !leftDrawerOpen) && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={handleOpen}
            className={`mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-100 px-4 text-[12.5px] font-medium whitespace-nowrap break-keep text-zinc-950 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
              isPhone ? 'min-h-[44px] py-2.5' : 'py-2'
            }`}
          >
            <PanelLeftOpen size={14} aria-hidden="true" />
            {t.openDrawer}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
