import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, Loader2, Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  franchiseMemberIds,
  pickName,
  pickTitle,
  type AnimePreviewModalProps,
  type AnimeRecord,
  type AnimeSummary,
  type CastEntry,
  type CharacterRole,
  vaIdentityKeys,
} from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { addAnimeToWatched } from '../../lib/addAnime';
import { animeMeta, franchiseBadge, genreLabel, roleLabel, seasonLabel, useT } from '../../i18n/ui';
import { Avatar } from '../nodes/Avatar';
import { cx } from '../nodes/nodeTheme';

const MAX_CAST = 8;
const ROLE_ORDER: Record<CharacterRole, number> = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

/** Anime preview (search rows + recommendation satellites): cover, seasons, main cast ⇄ VA, add button. */
export function AnimePreviewModal({ dataSource }: AnimePreviewModalProps) {
  const preview = useGraphStore((s) => s.animePreview);
  return <AnimatePresence>{preview && <PreviewDialog key={preview.id} summary={preview} dataSource={dataSource} />}</AnimatePresence>;
}

function PreviewDialog({ summary, dataSource }: { summary: AnimeSummary; dataSource: AnimePreviewModalProps['dataSource'] }) {
  const t = useT();
  const locale = useGraphStore((s) => s.locale);
  const close = useGraphStore((s) => s.closeAnimePreview);
  const hasGraph = useGraphStore((s) => !!s.graph);
  const watched = useGraphStore(useShallow((s) => s.watchedAnime));
  const adding = useGraphStore((s) => s.addingAnimeIds.has(summary.id));
  const addError = useGraphStore((s) => s.addErrors.get(summary.id));

  // Loaded record, or the search row's six-MAIN preview: the cast shows in the first frame while the full one loads.
  const [record, setRecord] = useState<AnimeRecord | null>(() => dataSource.peekAnime?.(summary.id) ?? null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    dataSource
      .getAnime(summary.id, controller.signal)
      .then((r) => !controller.signal.aborted && setRecord(r))
      .catch((err) => {
        if (!controller.signal.aborted && !(err instanceof DOMException && err.name === 'AbortError')) setFailed(true);
      });
    return () => controller.abort();
  }, [summary.id, dataSource, retry]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const anime: AnimeSummary = record ?? summary;
  const title = pickTitle(anime.title, locale);
  const watchedIds = useMemo(() => new Set(watched.flatMap(franchiseMemberIds)), [watched]);
  const isWatched = franchiseMemberIds(anime).some((id) => watchedIds.has(id));

  // Identity key → titles of OTHER watched anime whose DEEP cast pool already has that voice actor.
  const inGraph = useMemo(() => {
    const own = new Set(franchiseMemberIds(anime));
    const map = new Map<string, Set<string>>();
    for (const w of watched) {
      if (own.has(w.id)) continue;
      const title = pickTitle(w.title, locale);
      for (const c of w.fullCastPool ?? w.cast) {
        if (!c.voiceActor) continue;
        for (const key of vaIdentityKeys(c.voiceActor)) (map.get(key) ?? map.set(key, new Set()).get(key)!).add(title);
      }
    }
    return map;
  }, [watched, anime, locale]);

  const cast: CastEntry[] = useMemo(
    () =>
      (record?.cast ?? [])
        .filter((c) => c.voiceActor)
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
        .slice(0, MAX_CAST),
    [record],
  );

  const members = anime.franchise?.members;
  const sub = [animeMeta(t, { ...anime, franchise: undefined }), anime.studio].filter(Boolean).join(' · ');

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
        aria-label={title}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="sc-glass flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl outline-none"
      >
        <header className="flex shrink-0 gap-4 border-b border-white/8 p-4">
          <div className="relative h-[150px] w-[104px] shrink-0 overflow-hidden rounded-xl border border-white/12">
            <Avatar loading="lazy" src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
            <span className="absolute inset-y-0 right-0 w-[2px]" style={{ background: anime.color }} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[17px] leading-snug font-semibold tracking-[-0.02em] text-white">{title}</h2>
              <button
                type="button"
                onClick={close}
                aria-label={t.close}
                title={t.close}
                className={cx('flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white', FOCUS_RING)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            {sub && <p className="mt-1 text-[12px] text-zinc-400">{sub}</p>}
            {anime.genres && anime.genres.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {anime.genres.slice(0, 4).map((g) => (
                  <span key={g} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] text-zinc-300">
                    {genreLabel(locale, g)}
                  </span>
                ))}
              </div>
            )}
            {members && members.length >= 2 && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-medium text-zinc-500">
                  {t.mergedSeasons}
                  <span className="ml-1.5 font-normal text-zinc-600">{franchiseBadge(t, anime)}</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {members.map((m, i) => (
                    <span key={m.id} className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10.5px] text-zinc-300" title={pickTitle(m.title, locale)}>
                      {seasonLabel(t, members, i)}
                      {m.seasonYear ? <span className="ml-1 font-mono text-zinc-500">{m.seasonYear}</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>

        <div className="sc-scroll min-h-0 flex-1 overflow-y-auto p-4">
          <h3 className="mb-2.5 text-[11.5px] font-semibold tracking-[-0.01em] text-zinc-400">{t.mainCast}</h3>
          {failed ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3 text-[12px] text-zinc-300">
              <span className="flex items-center gap-1.5">
                <AlertCircle size={14} aria-hidden="true" />
                {t.loadFailed}
              </span>
              <button type="button" onClick={() => setRetry((n) => n + 1)} className={cx('cursor-pointer rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/10', FOCUS_RING)}>
                {t.retry}
              </button>
            </div>
          ) : !record ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="sc-skeleton h-[60px] rounded-xl" />
              ))}
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {cast.map((c) => {
                const va = c.voiceActor!;
                const hits = new Set<string>();
                for (const key of vaIdentityKeys(va)) inGraph.get(key)?.forEach((t) => hits.add(t));
                const others = hits.size ? [...hits] : undefined;
                return (
                  <li
                    key={`${c.character.id}:${va.id}`}
                    title={others?.join(' · ')}
                    className={cx(
                      'flex items-center gap-2.5 rounded-xl border p-2',
                      others ? 'border-white/30 bg-white/[0.07]' : 'border-white/8 bg-white/[0.03]',
                    )}
                  >
                    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/12">
                      <Avatar loading="lazy" src={c.character.image} name={c.character.name.full} color={anime.color} alt={pickName(c.character.name, locale)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-white">{pickName(c.character.name, locale)}</span>
                        <span className={cx('sc-role shrink-0', `sc-role--${c.role.toLowerCase()}`)} style={{ ['--node-color' as string]: anime.color }}>
                          {roleLabel(t, c.role)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full">
                          <Avatar loading="lazy" src={va.image} name={va.name.full} color={anime.color} alt={pickName(va.name, locale)} />
                        </span>
                        <span className="truncate">{pickName(va.name, locale)}</span>
                      </div>
                      {others && <div className="mt-1 text-[10px] font-medium text-white/80">{t.inGraph} · {others.length}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-white/8 p-4">
          <motion.button
            type="button"
            whileTap={isWatched ? undefined : { scale: 0.98 }}
            disabled={isWatched || adding}
            onClick={() => void addAnimeToWatched(dataSource, anime)}
            className={cx(
              'inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors',
              FOCUS_RING,
              isWatched
                ? 'cursor-default border border-white/10 text-zinc-400'
                : 'min-h-11 cursor-pointer bg-zinc-100 text-zinc-950 hover:bg-white disabled:cursor-wait disabled:opacity-80',
            )}
          >
            {adding ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : isWatched ? <Check size={14} aria-hidden="true" /> : <Plus size={14} strokeWidth={2.4} aria-hidden="true" />}
            {isWatched ? t.alreadyWatched : hasGraph ? t.recAddToGraph : t.addToWatched}
          </motion.button>
          {addError && <span className="text-[11.5px] text-red-300">{t.loadFailed}</span>}
        </footer>
      </motion.div>
    </motion.div>
  );
}
