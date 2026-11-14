import { memo } from 'react';
import { Crown } from 'lucide-react';
import { pickTitle, type AnimeNode, type DisplayLocale } from '../../types/contract';
import { animeMeta, useT } from '../../i18n/ui';
import { Avatar } from './Avatar';
import { withAlpha } from './nodeTheme';

interface AnimeViewProps {
  node: AnimeNode;
  locale: DisplayLocale;
}

/** Compact anime node (MODE_CHARACTER / MODE_VA): cover-art tile filling the shell. */
export const AnimeTile = memo(function AnimeTile({ node, locale }: AnimeViewProps) {
  const { anime } = node;
  const title = pickTitle(anime.title, locale);

  return (
    <div className="sc-tile">
      <div className="sc-tile-clip">
        <Avatar src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
        <div className="sc-tile-caption">
          <span className="line-clamp-2 text-[10px] font-semibold leading-[12px] tracking-[-0.01em] text-white">{title}</span>
        </div>
      </div>
      {node.isAnchor && (
        <span className="sc-crown" aria-hidden="true">
          <Crown size={12} strokeWidth={2.4} />
        </span>
      )}
    </div>
  );
});

/** MODE_DETAIL 220×110 anime card: cover, title, year/seasons, cast count. Fixed size. */
export const AnimeDetailCard = memo(function AnimeDetailCard({ node, locale }: AnimeViewProps) {
  const t = useT();
  const { anime } = node;
  const title = pickTitle(anime.title, locale);

  return (
    <div className="sc-card flex" style={{ backgroundImage: `linear-gradient(90deg, ${withAlpha(anime.color, 0.1)}, transparent 55%)` }}>
      <div className="sc-card-cover">
        <Avatar src={anime.coverImage} name={anime.title.romaji} color={anime.color} alt={title} />
        <span className="sc-card-cover-edge" style={{ background: anime.color }} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-2.5 pl-2.5 pr-3">
        <div className="flex items-center gap-1.5">
          {node.isAnchor && (
            <span className="sc-role sc-role--anchor">
              <Crown size={9} strokeWidth={2.4} className="fill-current" />
              {t.favorite}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="line-clamp-2 text-[12.5px] font-semibold leading-[15px] tracking-[-0.01em] text-white">{title}</div>
          <div className="mt-0.5 truncate text-[10px] leading-3 text-white/45">{animeMeta(t, anime)}</div>
        </div>

        <div className="text-[10px] leading-3 text-white/45">
          {t.cast} <span className="font-mono text-white/80">{node.degree}</span>
        </div>
      </div>
    </div>
  );
});
