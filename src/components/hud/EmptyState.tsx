import { motion } from 'framer-motion';
import { PanelLeftOpen } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';

export function EmptyState() {
  const t = useT();
  const leftDrawerOpen = useGraphStore((s) => s.leftDrawerOpen);
  const setLeftDrawerOpen = useGraphStore((s) => s.setLeftDrawerOpen);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="sc-glass pointer-events-auto w-full max-w-[400px] rounded-2xl p-6 text-center"
      >
        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{t.brand}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">{t.emptyBody}</p>
        <p className="mt-3 text-[12px] leading-relaxed text-zinc-500">{t.emptyStep}</p>
        {!leftDrawerOpen && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setLeftDrawerOpen(true)}
            className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-100 px-3.5 py-2 text-[12.5px] font-medium text-zinc-950 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <PanelLeftOpen size={14} aria-hidden="true" />
            {t.openDrawer}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
