import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, X } from 'lucide-react';
import { useT } from '../../i18n/ui';

const REPO = 'https://github.com/csk200387/AniCastMap';
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

/** Bottom-right "About & Disclaimer" pill + dismissible glass modal (Esc / backdrop / ✕). */
export function Disclaimer() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`pointer-events-auto fixed right-2 bottom-1 z-20 flex cursor-pointer items-center gap-1 rounded-full border border-white/8 bg-black/30 px-2 py-0.5 text-[10px] text-zinc-500 transition-colors hover:text-zinc-300 ${FOCUS_RING}`}
      >
        <Info size={10} aria-hidden="true" />
        {t.disclaimerLabel}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t.disclaimerTitle}
              className="sc-glass w-full max-w-[440px] rounded-2xl p-5 text-[13px] leading-relaxed text-zinc-300"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">{t.disclaimerTitle}</h2>
                <button
                  type="button"
                  autoFocus
                  aria-label={t.disclaimerClose}
                  onClick={() => setOpen(false)}
                  className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="flex flex-col gap-2.5">
                <p>{t.disclaimerNature}</p>
                <p>{t.disclaimerData}</p>
                <p>{t.disclaimerImages}</p>
                <p>
                  {t.disclaimerRemoval}{' '}
                  <a href={REPO} target="_blank" rel="noopener noreferrer" className="break-all text-sky-400 underline-offset-2 hover:underline">
                    {REPO}
                  </a>
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
