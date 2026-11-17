import { memo, type MouseEvent, type PointerEvent } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { pickName, pickTitle, type DisplayLocale, type RecommendationNode, type ViewMode } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { addAnimeToWatched } from '../../lib/addAnime';
import { useDataSource } from '../../lib/dataSource';
import { useT } from '../../i18n/ui';
import { Avatar, NodeAvatar } from './Avatar';

const stopPointer = (e: PointerEvent<HTMLElement>) => e.stopPropagation();

/**
 * Recommendation satellite. Tap (handled by the engine wrapper) opens the anime preview modal;
 * the "+" corner button adds the anime to the watched list and ripples it into the graph.
 */
export const RecommendationTile = memo(function RecommendationTile({
  node,
  locale,
  mode,
}: {
  node: RecommendationNode;
  locale: DisplayLocale;
  mode: ViewMode;
}) {
  const t = useT();
  const ds = useDataSource();
  const adding = useGraphStore((s) => s.addingAnimeIds.has(node.anime.id));
  const title = pickTitle(node.anime.title, locale);
  const charName = pickName(node.character.name, locale);

  const onAdd = (e: MouseEvent) => {
    e.stopPropagation();
    // The satellite already knows its bridge (this character ⇄ the via VA): spawn it now, hydrate after.
    const via = useGraphStore.getState().graph?.nodes.find((n) => n.id === node.viaNodeId);
    const seed = via?.kind === 'VOICE_ACTOR' ? { character: node.character, role: node.role, voiceActor: via.voiceActor } : undefined;
    void addAnimeToWatched(ds, node.anime, { extendGraph: true, seed });
  };
  const addLabel = `${t.recAddToGraph}: ${title}`;

  if (mode === 'MODE_DETAIL') {
    return (
      <div className="sc-card flex">
        <div className="sc-card-cover" style={{ width: 56 }}>
          <Avatar src={node.anime.coverImage} name={node.anime.title.romaji} color={node.anime.color} alt={title} />
          <span className="sc-card-cover-edge" style={{ background: node.anime.color }} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between py-2 pr-2.5 pl-2.5">
          <div className="min-w-0">
            <div className="line-clamp-2 text-[12px] leading-[14px] font-semibold tracking-[-0.01em] text-white">{title}</div>
            <div className="mt-0.5 truncate text-[10px] text-white/50">{charName}</div>
          </div>
          <button
            type="button"
            onPointerDown={stopPointer}
            onClick={onAdd}
            disabled={adding}
            aria-label={addLabel}
            className="inline-flex h-[22px] w-fit cursor-pointer items-center gap-1 rounded-md bg-zinc-100 px-2 text-[10.5px] font-medium text-zinc-950 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-70"
          >
            {adding ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <Plus size={11} strokeWidth={2.6} aria-hidden="true" />}
            {t.recAdd}
          </button>
        </div>
        <span className="sc-rec-badge">{t.recBadge}</span>
      </div>
    );
  }

  return (
    <>
      <div className="sc-layer overflow-hidden" style={{ borderRadius: 'inherit' }}>
        <NodeAvatar src={node.character.image} name={node.character.name.full} color={node.anime.color} alt={charName} />
      </div>
      <span className="sc-rec-badge">{t.recBadge}</span>
      <span className="sc-namepill" data-on="true" aria-hidden="true">
        {title}
      </span>
      <button
        type="button"
        className="sc-rec-add"
        onPointerDown={stopPointer}
        onClick={onAdd}
        disabled={adding}
        aria-label={addLabel}
        title={addLabel}
      >
        {adding ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Plus size={13} strokeWidth={2.8} aria-hidden="true" />}
      </button>
    </>
  );
});
