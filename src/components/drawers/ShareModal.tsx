import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ClipboardCopy, Download, Link2, Loader2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { buildCardData, cardBlob, CARD, drawSummaryCard } from '../../lib/summaryCard';
import { shareUrl } from '../../services/shareCodec';
import { cx } from '../nodes/nodeTheme';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';
type Status = 'idle' | 'busy' | 'done' | 'failed';

/** 공유 및 요약 카드: interactive `?s=` link + a legible bento PNG of the map (download or straight to the clipboard). */
export function ShareModal() {
  const open = useGraphStore((s) => s.shareOpen && s.graph !== null);
  return <AnimatePresence>{open && <ShareDialog />}</AnimatePresence>;
}

function ShareDialog() {
  const t = useT();
  const close = () => useGraphStore.getState().setShareOpen(false);
  const { graph, watched, anchor, locale, viewMode, showSupportingRoles, includeSubVoiceActors } = useGraphStore(
    useShallow((s) => ({ graph: s.graph!, watched: s.watchedAnime, anchor: s.anchorAnimeId, locale: s.locale, viewMode: s.viewMode,
      showSupportingRoles: s.showSupportingRoles, includeSubVoiceActors: s.includeSubVoiceActors })),
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [link, setLink] = useState<Status>('idle');
  const [image, setImage] = useState<Status>('idle');

  const data = useMemo(() => buildCardData(graph, watched, anchor, locale, t), [graph, watched, anchor, locale, t]);
  const url = useMemo(
    () => shareUrl({ anchorAnimeId: anchor ?? watched[0]?.id ?? 0, watched: watched.map((a) => a.id), viewMode, showSupportingRoles, includeSubVoiceActors, locale }),
    [anchor, watched, viewMode, showSupportingRoles, includeSubVoiceActors, locale],
  );

  useEffect(() => {
    let live = true;
    setReady(false);
    void drawSummaryCard(canvasRef.current!, data).then(() => live && setReady(true));
    return () => { live = false; };
  }, [data]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const flash = (set: (s: Status) => void, ok: boolean) => { set(ok ? 'done' : 'failed'); window.setTimeout(() => set('idle'), 1800); };
  const copyLink = () => navigator.clipboard.writeText(url).then(() => flash(setLink, true), () => flash(setLink, false));
  const download = async () => {
    const href = URL.createObjectURL(await cardBlob(canvasRef.current!));
    const a = Object.assign(document.createElement('a'), { href, download: 'anicastmap-summary.png' });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const copyImage = () => {
    setImage('busy');
    // The item is built synchronously inside the click (Safari's user-activation rule); the blob resolves later.
    navigator.clipboard.write([new ClipboardItem({ 'image/png': cardBlob(canvasRef.current!) })]).then(
      () => flash(setImage, true),
      () => flash(setImage, false),
    );
  };

  const action = 'flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-zinc-100 transition-colors hover:border-white/25 hover:bg-white/[0.05] disabled:cursor-wait disabled:opacity-60';

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t.shareTitle}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="sc-glass flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl outline-none"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-white">{t.shareTitle}</h2>
          <button type="button" onClick={close} aria-label={t.close} className={cx('flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:border-white/25 hover:text-white', FOCUS_RING)}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="sc-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:flex-row">
          <div className="relative mx-auto w-full max-w-[520px] shrink-0 sm:mx-0" style={{ aspectRatio: `${CARD.width} / ${CARD.height}` }}>
            <canvas ref={canvasRef} className="h-full w-full rounded-xl border border-white/10" />
            {!ready && (
              <div className="sc-skeleton absolute inset-0 flex items-center justify-center rounded-xl">
                <Loader2 size={18} className="animate-spin text-zinc-400" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <button type="button" onClick={copyLink} className={cx(action, FOCUS_RING)}>
              {link === 'done' ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
              {link === 'done' ? t.copied : link === 'failed' ? t.copyFailed : t.copyLink}
            </button>
            <p className="truncate px-1 font-mono text-[10.5px] text-zinc-500" title={url}>{url}</p>
            <button type="button" onClick={() => void download()} disabled={!ready} className={cx(action, FOCUS_RING)}>
              <Download size={15} aria-hidden="true" />
              {t.downloadPng}
            </button>
            <button type="button" onClick={copyImage} disabled={!ready || image === 'busy'} className={cx(action, FOCUS_RING)}>
              {image === 'busy' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : image === 'done' ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}
              {image === 'done' ? t.copied : image === 'failed' ? t.copyFailed : t.copyImage}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
