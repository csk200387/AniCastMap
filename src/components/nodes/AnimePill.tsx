import { memo, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { animeNodeId, pickTitle, type DisplayLocale } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { animeColor, type AnimeLookup } from './nodeTheme';

export interface AnimePillProps {
  animeId: number;
  animeById: AnimeLookup;
  locale: DisplayLocale;
}

/* Stop the engine wrapper from starting a drag / selecting the node. */
const stopPointer = (e: PointerEvent<HTMLButtonElement>) => e.stopPropagation();

/** Clickable anime tag (MODE_DETAIL). Flies the camera to that anime's cluster. */
export const AnimePill = memo(function AnimePill({ animeId, animeById, locale }: AnimePillProps) {
  const anime = animeById?.get(animeId);
  const title = anime ? pickTitle(anime.title, locale) : `#${animeId}`;
  const color = animeColor(animeById, animeId);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    useGraphStore.getState().focusNode(animeNodeId(animeId));
  };

  return (
    <button
      type="button"
      className="sc-pill"
      onPointerDown={stopPointer}
      onClick={onClick}
      aria-label={title}
      style={{ '--pill-color': color } as CSSProperties}
    >
      <span className="sc-pill-dot" aria-hidden="true" />
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
});
