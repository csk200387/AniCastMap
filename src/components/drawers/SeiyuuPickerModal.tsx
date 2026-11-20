import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, Loader2, Plus, RotateCw, Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  franchiseMemberIds,
  pickName,
  pickTitle,
  type AnimeDataSource,
  type FilmographyEntry,
  type VoiceActorRecord,
} from '../../types/contract';
import { selectCanGenerate, selectHasPendingGraphChanges, useGraphStore } from '../../store/useGraphStore';
import { addAnimeToWatched, removeWatchedAnime } from '../../lib/addAnime';
import { hoverIntent, prefetchAnime } from '../../lib/prefetch';
import { applyPendingGraphChanges, rebuildGraph } from '../../lib/rebuildGraph';
import { normalizeKey } from '../../services/localize';
import { roleLabel, useT } from '../../i18n/ui';
import { Avatar } from '../nodes/Avatar';
import { cx } from '../nodes/nodeTheme';
import { groupFilmography } from './InspectorDrawer';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

export function SeiyuuPickerModal({ dataSource }: { dataSource: AnimeDataSource }) {
  const va = useGraphStore((s) => s.seiyuuPicker);
  return <AnimatePresence>{va && <PickerDialog key={va.id} va={va} dataSource={dataSource} />}</AnimatePresence>;
}

function PickerDialog({ va, dataSource }: { va: VoiceActorRecord; dataSource: AnimeDataSource }) {
  const t = useT();
  const locale = useGraphStore((s) => s.locale);
  const close = useGraphStore((s) => s.closeSeiyuuPicker);
  const watched = useGraphStore(useShallow((s) => s.watchedAnime));
  const addingIds = useGraphStore((s) => s.addingAnimeIds);
  const hasGraph = useGraphStore((s) => s.graph !== null);
  const liveUpdate = useGraphStore((s) => s.liveUpdate);
  const hasPendingChanges = useGraphStore(selectHasPendingGraphChanges);
  const canGenerate = useGraphStore(selectCanGenerate);
  const panelRef = useRef<HTMLDivElement>(null);

  const [film, setFilm] = useState<FilmographyEntry[] | null>(() => dataSource.peekVoiceActorFilmography?.(va.id) ?? null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mainOnly, setMainOnly] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    dataSource.getVoiceActorFilmography(va.id, controller.signal).then(
      (entries) => {
        if (controller.signal.aborted) return;
        setFilm(entries);
        dataSource.refineFilmographyNames?.(entries, controller.signal).then(
          (changed) => { if (changed && !controller.signal.aborted) setFilm([...entries]); },
          () => undefined,
        );
      },
      (err) => { if (!controller.signal.aborted && !(err instanceof DOMException && err.name === 'AbortError')) setFailed(true); },
    );
    return () => controller.abort();
  }, [va.id, dataSource, retry]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Watched member id → its watched record id (a row may be any member of the franchise).
  const watchedBy = useMemo(() => {
    const map = new Map<number, number>();
    for (const w of watched) for (const id of franchiseMemberIds(w)) map.set(id, w.id);
    return map;
  }, [watched]);

  const rows = useMemo(() => {
    const q = normalizeKey(filter);
    return groupFilmography(film ?? []).filter((g) => {
      if (mainOnly && g.role !== 'MAIN') return false;
      if (!q) return true;
      const a = g.anime!;
      const keys = [...Object.values(a.title), ...g.characters.flatMap((c) => [c.name.full, c.name.native, c.name.ko])];
      return keys.some((k) => k && normalizeKey(k).includes(q));
    });
  }, [film, mainOnly, filter]);

  const name = pickName(va.name, locale);
  const secondary = locale === 'ja' ? va.name.full : va.name.native;

  const update = () => {
    close();
    if (!hasGraph && canGenerate) rebuildGraph();
    else if (hasGraph && !liveUpdate && hasPendingChanges) applyPendingGraphChanges();
  };

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
        aria-label={name}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="sc-glass flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl outline-none"
      >
        <header className="shrink-0 border-b border-white/8 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/20">
                <Avatar src={va.image} name={va.name.full} color="#8b9cff" alt={name} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-white">{name}</h2>
                {secondary && secondary !== name && <p className="mt-0.5 truncate text-[12px] text-zinc-500">{secondary}</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t.close}
              className={cx('flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:border-white/25 hover:text-white', FOCUS_RING)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-black/30 p-0.5" role="group">
              {[false, true].map((main) => (
                <button
                  key={String(main)}
                  type="button"
                  aria-pressed={mainOnly === main}
                  onClick={() => setMainOnly(main)}
                  className={cx(
                    'min-h-11 cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                    FOCUS_RING,
                    mainOnly === main ? 'bg-white/90 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100',
                  )}
                >
                  {main ? t.pickerMainOnly : t.pickerAllRoles}
                </button>
              ))}
            </div>
            <div className="relative min-w-[160px] flex-1">
              <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t.pickerFilter}
                aria-label={t.pickerFilter}
                className="w-full rounded-lg border border-white/10 bg-zinc-950/70 py-1.5 pr-2 pl-8 text-[12px] text-white placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
              />
            </div>
          </div>
        </header>

        <div className="sc-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {failed && !film ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3 text-[12px] text-zinc-300">
              <span className="flex items-center gap-1.5"><AlertCircle size={14} aria-hidden="true" />{t.loadFailed}</span>
              <button type="button" onClick={() => setRetry((n) => n + 1)} className={cx('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/10', FOCUS_RING)}>
                <RotateCw size={12} aria-hidden="true" />{t.retry}
              </button>
            </div>
          ) : !film ? (
            <div className="flex flex-col gap-1.5" aria-hidden="true">
              {Array.from({ length: 7 }).map((_, i) => <div key={i} className="sc-skeleton h-[64px] rounded-xl" />)}
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[12px] text-zinc-500">{t.pickerEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.map((g) => {
                const anime = g.anime!;
                const title = pickTitle(anime.title, locale);
                const owner = franchiseMemberIds(anime).map((id) => watchedBy.get(id)).find((id) => id !== undefined);
                const adding = addingIds.has(anime.id);
                const lead = film.find((e) => e.anime.id === g.animeId && e.role === g.role) ?? film.find((e) => e.anime.id === g.animeId)!;
                const chars = g.characters.map((c) => pickName(c.name, locale)).join(' / ');
                const toggle = () => {
                  if (owner !== undefined) removeWatchedAnime(owner);
                  else void addAnimeToWatched(dataSource, anime, { seed: { character: lead.character, role: lead.role, voiceActor: va } });
                };
                return (
                  <li
                    key={g.animeId}
                    className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/8 bg-white/[0.03] p-2 pl-3"
                    {...hoverIntent(() => prefetchAnime(dataSource, anime.id))}
                  >
                    <span className="absolute top-2 bottom-2 left-1.5 w-[2px] rounded-full" style={{ background: anime.color }} aria-hidden="true" />
                    <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-white/12">
                      <Avatar loading="lazy" src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="line-clamp-1 text-[12.5px] font-medium text-white">{title}</span>
                        {anime.seasonYear && <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">{anime.seasonYear}</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-white/15">
                          <Avatar loading="lazy" src={lead.character.image} name={lead.character.name.full} color={anime.color} alt={chars} />
                        </div>
                        <span className="truncate text-[11.5px] text-zinc-300">{chars}</span>
                        <span className={cx('sc-role shrink-0', `sc-role--${g.role.toLowerCase()}`)}>{roleLabel(t, g.role)}</span>
                      </div>
                    </div>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      onClick={toggle}
                      disabled={adding && owner === undefined}
                      aria-pressed={owner !== undefined}
                      title={owner !== undefined ? t.pickerRemoveTip : (hasGraph && liveUpdate ? t.recAddToGraph : t.addToWatched)}
                      className={cx(
                        'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors disabled:cursor-wait',
                        FOCUS_RING,
                        owner !== undefined
                          ? 'border border-white/20 text-zinc-200 hover:border-white/35'
                          : 'bg-zinc-100 text-zinc-950 hover:bg-white',
                      )}
                    >
                      {owner !== undefined ? <Check size={13} aria-hidden="true" /> : adding ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Plus size={13} strokeWidth={2.6} aria-hidden="true" />}
                      {owner !== undefined ? t.added : (hasGraph && liveUpdate ? t.recAddToGraph : t.addToWatched)}
                    </motion.button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/8 px-4 py-3">
          <span className="font-mono text-[11.5px] text-zinc-400">{t.pickerCount(watched.length)}</span>
          <motion.button
            type="button"
            whileTap={hasGraph || canGenerate ? { scale: 0.98 } : undefined}
            disabled={!hasGraph && !canGenerate}
            onClick={update}
            title={!hasGraph && !canGenerate ? t.generateNeedMore : undefined}
            className={cx(
              'min-h-11 rounded-xl px-4 py-2 text-[12.5px] font-medium transition-colors',
              FOCUS_RING,
              hasGraph || canGenerate ? 'cursor-pointer bg-zinc-100 text-zinc-950 hover:bg-white' : 'cursor-not-allowed border border-white/8 text-zinc-500',
            )}
          >
            {hasGraph
              ? (!liveUpdate && hasPendingChanges ? t.updateGraph : t.close)
              : `${t.titleCount(watched.length)} · ${t.generate}`}
          </motion.button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
