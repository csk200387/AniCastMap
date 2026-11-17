import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowUpRight, Crown, Loader2, MapPin, Plus, RotateCw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  animeNodeId,
  franchiseMemberIds,
  pickName,
  pickTitle,
  type AnimeDataSource,
  type AnimeNode,
  type AnimeSummary,
  type CharacterRecord,
  type CharacterRole,
  type DisplayLocale,
  type FilmographyEntry,
  type GraphData,
  type InspectorDrawerProps,
  type RoleRef,
  type VoiceActorNode,
} from '../../types/contract';
import { useGraphStore, watchedMemberIds } from '../../store/useGraphStore';
import { addAnimeToWatched } from '../../lib/addAnime';
import { hoverIntent, prefetchAnime } from '../../lib/prefetch';
import { animeMeta, roleLabel, useT } from '../../i18n/ui';
import { RecommendToggle } from '../hud/RecommendToggle';
import { Avatar } from '../nodes/Avatar';
import { SubBadge } from '../nodes/SubBadge';
import { animeColor, cx, distinctAnimeIds, type AnimeLookup } from '../nodes/nodeTheme';

const DRAWER_SPRING = { type: 'spring', stiffness: 340, damping: 32 } as const;
const MAX_FILMOGRAPHY = 24;
const ROLE_ORDER: Record<CharacterRole, number> = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';
const sectionTitle = 'text-[11.5px] font-semibold tracking-[-0.01em] text-zinc-400';

const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';
const bestRole = (a: CharacterRole, b: CharacterRole): CharacterRole => (ROLE_ORDER[a] <= ROLE_ORDER[b] ? a : b);

/** One anime, every character this VA voices there ("Alluka Zoldyck / Nanika"). */
export interface AnimeRoles {
  anime: AnimeSummary | undefined;
  animeId: number;
  characters: CharacterRecord[];
  role: CharacterRole;
  /** Set when EVERY credit here is a childhood / alternate (sub) voice. */
  sub?: RoleRef['sub'];
}

function groupRoles(roles: readonly RoleRef[], animeById: AnimeLookup): AnimeRoles[] {
  const out = new Map<number, AnimeRoles>();
  for (const r of roles) {
    const g = out.get(r.animeId);
    if (!g) out.set(r.animeId, { anime: animeById?.get(r.animeId), animeId: r.animeId, characters: [r.character], role: r.role, sub: r.sub });
    else {
      if (!g.characters.some((c) => c.id === r.character.id)) g.characters.push(r.character);
      g.role = bestRole(g.role, r.role);
      if (!r.sub) g.sub = undefined;
    }
  }
  return [...out.values()];
}

/** One row per anime (best role first, then AniList popularity order). `exclude`: anime ids to leave out. */
export function groupFilmography(entries: readonly FilmographyEntry[], exclude: ReadonlySet<number> = new Set(), limit = Infinity): AnimeRoles[] {
  const out = new Map<number, AnimeRoles>();
  for (const e of entries) {
    // Already shown under "Roles in your list" → never repeat it in the broader filmography.
    if (franchiseMemberIds(e.anime).some((id) => exclude.has(id))) continue;
    const g = out.get(e.anime.id);
    if (!g) out.set(e.anime.id, { anime: e.anime, animeId: e.anime.id, characters: [e.character], role: e.role });
    else {
      if (!g.characters.some((c) => c.id === e.character.id)) g.characters.push(e.character);
      g.role = bestRole(g.role, e.role);
    }
  }
  return [...out.values()].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]).slice(0, limit);
}

const joinNames = (chars: readonly CharacterRecord[], locale: DisplayLocale) =>
  chars.map((c) => pickName(c.name, locale)).join(' / ');

function CloseButton({ onClose, isPhone = false }: { onClose: () => void; isPhone?: boolean }) {
  const t = useT();
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onClose}
      aria-label={t.close}
      title={t.close}
      className={cx(
        'flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white',
        isPhone ? 'h-11 w-11' : 'h-7 w-7',
        FOCUS_RING,
      )}
    >
      <X size={isPhone ? 16 : 14} aria-hidden="true" />
    </motion.button>
  );
}

export interface InspectorPanelProps {
  node: AnimeNode | VoiceActorNode;
  graph: GraphData;
  dataSource: AnimeDataSource;
  onClose?: () => void;
  onFocusAnime?: (animeId: number) => void;
  onFocusCluster?: () => void;
  onSelectVA?: (vaNodeId: string) => void;
  variant?: 'desktop' | 'phone';
  /** Optional button in the inspector header (e.g. "지도에서 보기"). */
  onFocusOnMap?: () => void;
  extraHeaderAction?: ReactNode;
}

export function InspectorPanel({
  node,
  graph,
  dataSource,
  onClose,
  onFocusAnime,
  onFocusCluster,
  onSelectVA,
  variant = 'desktop',
  onFocusOnMap,
  extraHeaderAction,
}: InspectorPanelProps) {
  const locale = useGraphStore((s) => s.locale);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);

  if (node.kind === 'VOICE_ACTOR') {
    return (
      <VoiceActorInspector
        key={node.id}
        node={node}
        locale={locale}
        animeById={graph.animeById}
        dataSource={dataSource}
        variant={variant}
        onClose={onClose}
        onFocusAnime={(animeId) => (onFocusAnime ? onFocusAnime(animeId) : focusNode(animeNodeId(animeId)))}
        onFocusOnMap={onFocusOnMap}
        extraHeaderAction={extraHeaderAction}
      />
    );
  }

  return (
    <AnimeInspector
      key={node.id}
      node={node}
      locale={locale}
      neighbors={graph.neighbors.get(node.id)}
      allNodes={graph.nodes}
      variant={variant}
      onClose={onClose}
      onSelectVA={(id) => (onSelectVA ? onSelectVA(id) : selectNode(id))}
      onFocusCluster={() => (onFocusCluster ? onFocusCluster() : focusNode(node.id))}
      onFocusOnMap={onFocusOnMap}
      extraHeaderAction={extraHeaderAction}
    />
  );
}

export function InspectorDrawer({ dataSource }: InspectorDrawerProps) {
  const t = useT();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const graph = useGraphStore((s) => s.graph);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);

  const selectedNode = useMemo(
    () => (selectedNodeId && graph ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, graph],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <AnimatePresence>
        {selectedNode && graph && (
          <motion.aside
            key="inspector-drawer"
            initial={{ x: 380, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 380, opacity: 0 }}
            transition={DRAWER_SPRING}
            aria-label={selectedNode.kind === 'VOICE_ACTOR' ? t.seiyuu : t.castInGraph}
            className="sc-glass pointer-events-auto absolute top-3 right-3 bottom-3 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl"
          >
            <InspectorPanel
              node={selectedNode}
              graph={graph}
              dataSource={dataSource}
              onClose={() => selectNode(null)}
              onFocusAnime={(animeId) => focusNode(animeNodeId(animeId))}
              onSelectVA={(id) => selectNode(id)}
              onFocusCluster={() => focusNode(selectedNode.id)}
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voice actor deep-dive                                               */
/* ------------------------------------------------------------------ */

interface VoiceActorInspectorProps {
  node: VoiceActorNode;
  locale: DisplayLocale;
  animeById: AnimeLookup;
  dataSource: InspectorDrawerProps['dataSource'];
  variant?: 'desktop' | 'phone';
  onClose?: () => void;
  onFocusAnime: (animeId: number) => void;
  onFocusOnMap?: () => void;
  extraHeaderAction?: ReactNode;
}

function VoiceActorInspector({
  node,
  locale,
  animeById,
  dataSource,
  variant = 'desktop',
  onClose,
  onFocusAnime,
  onFocusOnMap,
  extraHeaderAction,
}: VoiceActorInspectorProps) {
  const t = useT();
  const isPhone = variant === 'phone';
  const watched = useGraphStore(useShallow((s) => s.watchedAnime));
  const openAnimePreview = useGraphStore((s) => s.openAnimePreview);
  const addingIds = useGraphStore((s) => s.addingAnimeIds);
  const { voiceActor, roles, degree } = node;
  const primaryColor = animeColor(animeById, roles[0]?.animeId);
  const isBridge = degree >= 2;

  const primaryName = pickName(voiceActor.name, locale);
  // One subtle secondary line in the native script (or romaji when already reading Japanese).
  const secondary = locale === 'ja' ? voiceActor.name.full : voiceActor.name.native;

  // Warm (hover / idle prefetch) → rendered in the first frame, no skeleton.
  const [filmography, setFilmography] = useState<FilmographyEntry[]>(() => dataSource.peekVoiceActorFilmography?.(voiceActor.id) ?? []);
  const [loading, setLoading] = useState(() => !dataSource.peekVoiceActorFilmography?.(voiceActor.id));
  const [failed, setFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!dataSource.peekVoiceActorFilmography?.(voiceActor.id)) setLoading(true);
    setFailed(false);
    dataSource
      .getVoiceActorFilmography(voiceActor.id, controller.signal)
      .then((entries) => {
        if (controller.signal.aborted) return;
        setFilmography(entries);
        setLoading(false);
        // Labels the local dictionary could only transliterate are patched in later; never blocks the list.
        dataSource.refineFilmographyNames?.(entries, controller.signal).then(
          (changed) => { if (changed && !controller.signal.aborted) setFilmography([...entries]); },
          () => undefined,
        );
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setFailed(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [voiceActor.id, dataSource, retryToken]);

  const watchedRoles = useMemo(() => groupRoles(roles, animeById), [roles, animeById]);
  const broader = useMemo(() => groupFilmography(filmography, watchedMemberIds(watched), MAX_FILMOGRAPHY), [filmography, watched]);

  const meta = [t.metaWatched(degree), t.metaRoles(roles.length), isBridge ? t.bridgeVa : null].filter(Boolean).join(' · ');

  return (
    <>
      <header className="shrink-0 border-b border-white/8 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/20">
              <Avatar loading="lazy" src={voiceActor.image} name={voiceActor.name.full} color={primaryColor} alt={primaryName} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-white">{primaryName}</h2>
              {secondary && secondary !== primaryName && (
                <p className="mt-0.5 truncate text-[11.5px] text-zinc-500">{secondary}</p>
              )}
              <p className="mt-1.5 text-[11.5px] text-zinc-400">{meta}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {extraHeaderAction}
            {onClose && <CloseButton onClose={onClose} isPhone={isPhone} />}
          </div>
        </div>
        {onFocusOnMap && (
          <div className="mt-3">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={onFocusOnMap}
              className={cx(
                'flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-[13px] font-medium whitespace-nowrap break-keep text-white transition-colors hover:border-white/30 hover:bg-white/[0.1]',
                FOCUS_RING,
              )}
            >
              <MapPin size={14} aria-hidden="true" />
              <span>지도에서 보기</span>
            </motion.button>
          </div>
        )}
        <div className="mt-3.5">
          <RecommendToggle variant="inspector" />
        </div>
      </header>

      <div className="sc-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <section aria-label={t.rolesInList}>
          <h3 className={cx(sectionTitle, 'mb-2.5')}>{t.rolesInList}</h3>
          <div className="flex flex-col gap-2">
            {watchedRoles.map((g) => {
              const color = animeColor(animeById, g.animeId);
              const animeTitle = g.anime ? pickTitle(g.anime.title, locale) : `#${g.animeId}`;
              const lead = g.characters[0];
              return (
                <button
                  key={g.animeId}
                  type="button"
                  onClick={() => onFocusAnime(g.animeId)}
                  className={cx(
                    'relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl border border-white/8 bg-white/[0.03] p-2 pl-3 text-left transition-colors hover:border-white/20',
                    isPhone && 'min-h-[60px]',
                    FOCUS_RING,
                  )}
                >
                  <span className="absolute top-2 bottom-2 left-1.5 w-[2px] rounded-full" style={{ background: color }} aria-hidden="true" />
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/12">
                    {lead && <Avatar loading="lazy" src={lead.image} name={lead.name.full} color={color} alt={pickName(lead.name, locale)} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-white">{joinNames(g.characters, locale)}</span>
                      <span className={cx('sc-role shrink-0', `sc-role--${g.role.toLowerCase()}`)}>{roleLabel(t, g.role)}</span>
                      {g.sub && <SubBadge sub={g.sub} className="shrink-0" />}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-zinc-500">{animeTitle}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label={t.filmography}>
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className={sectionTitle}>{t.filmography}</h3>
            {!loading && !failed && <span className="font-mono text-[10.5px] text-zinc-500">{broader.length}</span>}
          </div>

          {loading ? (
            <div className={cx('grid gap-2', isPhone ? 'grid-cols-1' : 'grid-cols-2')} aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-white/6 p-2">
                  <div className="sc-skeleton h-11 w-8 shrink-0 rounded-md" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="sc-skeleton h-2.5 w-4/5 rounded" />
                    <div className="sc-skeleton h-2 w-3/5 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : failed ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3 text-[11.5px] text-zinc-300">
              <span className="flex items-center gap-1.5">
                <AlertCircle size={14} aria-hidden="true" />
                {t.loadFailed}
              </span>
              <button
                type="button"
                onClick={() => setRetryToken((n) => n + 1)}
                className={cx(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-[11px] font-medium whitespace-nowrap break-keep text-white hover:bg-white/10',
                  isPhone ? 'min-h-[44px] py-2' : 'py-1',
                  FOCUS_RING,
                )}
              >
                <RotateCw size={12} aria-hidden="true" />
                {t.retry}
              </button>
            </div>
          ) : broader.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11.5px] text-zinc-500">{t.filmographyEmpty}</p>
          ) : isPhone ? (
            <div className="flex flex-col gap-2">
              {broader.map((g) => {
                const anime = g.anime!;
                const title = pickTitle(anime.title, locale);
                const adding = addingIds.has(anime.id);
                const lead = filmography.find((e) => e.anime.id === g.animeId && e.role === g.role) ?? filmography.find((e) => e.anime.id === g.animeId);
                const onAdd = () =>
                  void addAnimeToWatched(dataSource, anime, {
                    extendGraph: true,
                    seed: lead && { character: lead.character, role: lead.role, voiceActor },
                  });
                return (
                  <div
                    key={g.animeId}
                    className="relative flex min-h-[64px] items-center gap-2 overflow-hidden rounded-xl border border-white/8 bg-white/[0.025] p-1.5 pl-3"
                  >
                    <span className="absolute top-2 bottom-2 left-1.5 w-[2px] rounded-full" style={{ background: anime.color }} aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => openAnimePreview(anime)}
                      className={cx('flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg py-1 text-left', FOCUS_RING)}
                    >
                      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border border-white/12">
                        <Avatar loading="lazy" src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-1 text-[12.5px] font-medium text-white">{title}</div>
                        <div className="mt-0.5 truncate text-[11px] text-zinc-400">{joinNames(g.characters, locale)}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-zinc-500">
                          {anime.seasonYear && <span className="font-mono">{anime.seasonYear}</span>}
                          <span>{roleLabel(t, g.role)}</span>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={onAdd}
                      disabled={adding}
                      aria-label={`${t.recAddToGraph}: ${title}`}
                      title={t.recAddToGraph}
                      className={cx(
                        'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-zinc-100 text-zinc-950 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-70',
                        FOCUS_RING,
                      )}
                    >
                      {adding ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={16} strokeWidth={2.4} aria-hidden="true" />}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {broader.map((g) => {
                const anime = g.anime!;
                const title = pickTitle(anime.title, locale);
                const adding = addingIds.has(anime.id);
                const lead = filmography.find((e) => e.anime.id === g.animeId && e.role === g.role) ?? filmography.find((e) => e.anime.id === g.animeId);
                const onAdd = () =>
                  void addAnimeToWatched(dataSource, anime, {
                    extendGraph: true,
                    seed: lead && { character: lead.character, role: lead.role, voiceActor },
                  });
                return (
                  <div key={g.animeId} className="relative" {...hoverIntent(() => prefetchAnime(dataSource, anime.id))}>
                    <button
                      type="button"
                      onClick={() => openAnimePreview(anime)}
                      className={cx(
                        'relative flex h-full w-full cursor-pointer flex-col gap-1.5 overflow-hidden rounded-xl border border-white/8 bg-white/[0.025] p-2 pl-3 text-left transition-colors hover:border-white/20',
                        FOCUS_RING,
                      )}
                    >
                      <span className="absolute top-2 bottom-2 left-1.5 w-[2px] rounded-full" style={{ background: anime.color }} aria-hidden="true" />
                      <div className="flex items-start gap-2">
                        <div className="relative h-11 w-8 shrink-0 overflow-hidden rounded-md border border-white/12">
                          <Avatar loading="lazy" src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-[11px] leading-[13px] font-medium text-white">{title}</div>
                          <div className="mt-0.5 line-clamp-2 text-[10px] leading-[12px] text-zinc-500">{joinNames(g.characters, locale)}</div>
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between pr-6 text-[10px] text-zinc-500">
                        <span className="font-mono">{anime.seasonYear ?? ''}</span>
                        <span>{roleLabel(t, g.role)}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={onAdd}
                      disabled={adding}
                      aria-label={`${t.recAddToGraph}: ${title}`}
                      title={t.recAddToGraph}
                      className={cx(
                        'absolute right-1.5 bottom-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-zinc-100 text-zinc-950 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-70',
                        FOCUS_RING,
                      )}
                    >
                      {adding ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <Plus size={12} strokeWidth={2.6} aria-hidden="true" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Anime cluster inspector                                             */
/* ------------------------------------------------------------------ */

interface AnimeInspectorProps {
  node: AnimeNode;
  locale: DisplayLocale;
  neighbors: ReadonlySet<string> | undefined;
  allNodes: ReadonlyArray<AnimeNode | VoiceActorNode>;
  variant?: 'desktop' | 'phone';
  onClose?: () => void;
  onSelectVA: (vaNodeId: string) => void;
  onFocusCluster: () => void;
  onFocusOnMap?: () => void;
  extraHeaderAction?: ReactNode;
}

function AnimeInspector({
  node,
  locale,
  neighbors,
  allNodes,
  variant = 'desktop',
  onClose,
  onSelectVA,
  onFocusCluster,
  onFocusOnMap,
  extraHeaderAction,
}: AnimeInspectorProps) {
  const t = useT();
  const isPhone = variant === 'phone';
  const animeById = useGraphStore((s) => s.graph?.animeById);
  const { anime, isAnchor } = node;
  const title = pickTitle(anime.title, locale);
  const secondary = locale === 'ja' ? (anime.title.english ?? anime.title.romaji) : anime.title.native;

  const castVAs = useMemo(() => {
    const list = allNodes.filter(
      (n): n is VoiceActorNode =>
        n.kind === 'VOICE_ACTOR' && (neighbors ? neighbors.has(n.id) : n.roles.some((r) => r.animeId === anime.id)),
    );
    const roleOf = (n: VoiceActorNode) => n.roles.find((r) => r.animeId === anime.id)?.role ?? 'BACKGROUND';
    return list.sort(
      (a, b) =>
        Number(b.degree >= 2) - Number(a.degree >= 2) || b.degree - a.degree || ROLE_ORDER[roleOf(a)] - ROLE_ORDER[roleOf(b)],
    );
  }, [allNodes, neighbors, anime.id]);
  const bridgeCount = castVAs.filter((v) => v.degree >= 2).length;
  const meta = [animeMeta(t, anime), t.metaCast(castVAs.length), bridgeCount ? t.metaBridges(bridgeCount) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <header className="shrink-0 border-b border-white/8 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="relative h-24 w-[68px] shrink-0 overflow-hidden rounded-xl border border-white/15">
              <Avatar loading="lazy" src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
              <span className="absolute inset-y-0 right-0 w-[2px]" style={{ background: anime.color }} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              {isAnchor && (
                <span className="sc-role sc-role--anchor mb-1.5">
                  <Crown size={9} className="fill-current" aria-hidden="true" />
                  {t.favorite}
                </span>
              )}
              <h2 className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-[-0.02em] text-white">{title}</h2>
              {secondary && secondary !== title && <p className="mt-0.5 truncate text-[11.5px] text-zinc-500">{secondary}</p>}
              <p className="mt-1.5 text-[11.5px] leading-[15px] text-zinc-400">{meta}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {extraHeaderAction}
            {!onFocusOnMap && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={onFocusCluster}
                aria-label={t.focusCluster}
                title={t.focusCluster}
                className={cx(
                  'flex cursor-pointer items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white',
                  isPhone ? 'h-11 w-11' : 'h-7 w-7',
                  FOCUS_RING,
                )}
              >
                <ArrowUpRight size={isPhone ? 16 : 14} aria-hidden="true" />
              </motion.button>
            )}
            {onClose && <CloseButton onClose={onClose} isPhone={isPhone} />}
          </div>
        </div>
        {onFocusOnMap && (
          <div className="mt-3">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={onFocusOnMap}
              className={cx(
                'flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-[13px] font-medium whitespace-nowrap break-keep text-white transition-colors hover:border-white/30 hover:bg-white/[0.1]',
                FOCUS_RING,
              )}
            >
              <MapPin size={14} aria-hidden="true" />
              <span>지도에서 보기</span>
            </motion.button>
          </div>
        )}
      </header>

      <div className="sc-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        <h3 className={cx(sectionTitle, 'mb-1')}>{t.castInGraph}</h3>
        {castVAs.map((va) => {
          const isBridge = va.degree >= 2;
          const vaName = pickName(va.voiceActor.name, locale);
          const here = va.roles.filter((r) => r.animeId === anime.id);
          const lead = here[0];
          const role = here.reduce<CharacterRole>((acc, r) => bestRole(acc, r.role), 'BACKGROUND');
          const others = distinctAnimeIds(va.roles).filter((id) => id !== anime.id);
          return (
            <motion.button
              key={va.id}
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={() => onSelectVA(va.id)}
              className={cx(
                'flex w-full cursor-pointer flex-col gap-2 rounded-xl border bg-white/[0.03] p-2.5 text-left transition-colors hover:border-white/25 hover:bg-white/[0.06]',
                isPhone && 'min-h-[60px]',
                FOCUS_RING,
                isBridge ? 'border-white/20' : 'border-white/8',
              )}
            >
              <div className="flex items-center gap-2.5">
                <div className="relative flex shrink-0 items-center">
                  <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-white/15">
                    {lead && <Avatar loading="lazy" src={lead.character.image} name={lead.character.name.full} color={anime.color} alt={pickName(lead.character.name, locale)} />}
                  </div>
                  <div className="relative -ml-2.5 h-10 w-10 overflow-hidden rounded-full border-2 border-[#10121b] bg-[#090a0f]">
                    <Avatar loading="lazy" src={va.voiceActor.image} name={va.voiceActor.name.full} color={anime.color} alt={vaName} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-white">{vaName}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {here.every((r) => r.sub) && lead?.sub && <SubBadge sub={lead.sub} />}
                      <span className={cx('sc-role', `sc-role--${role.toLowerCase()}`)}>{roleLabel(t, role)}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500">{lead ? joinNames(here.map((r) => r.character), locale) : ''}</div>
                </div>
              </div>

              {isBridge && others.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 border-t border-white/8 pt-1.5">
                  <span className="mr-0.5 text-[10px] font-medium text-zinc-500">{t.connectsTo}</span>
                  {others.map((id) => {
                    const other = animeById?.get(id);
                    return (
                      <span
                        key={id}
                        className="inline-flex max-w-[150px] items-center gap-1.5 truncate rounded-md bg-white/[0.05] py-0.5 pr-1.5 pl-1.5 text-[10.5px] text-zinc-300"
                        style={{ borderLeft: `2px solid ${other?.color ?? '#8b9cff'}` }}
                      >
                        <span className="truncate">{other ? pickTitle(other.title, locale) : `#${id}`}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </>
  );
}
