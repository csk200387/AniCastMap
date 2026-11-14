import { memo } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { pickName, type DisplayLocale, type VoiceActorNode } from '../../types/contract';
import { AnimePill } from './AnimePill';
import { Avatar } from './Avatar';
import { SubBadge } from './SubBadge';
import { roleLabel, useT } from '../../i18n/ui';
import { animeColor, cx, distinctAnimeIds, fallbackGradient, withAlpha, type AnimeLookup } from './nodeTheme';

export interface VoiceActorBentoProps {
  node: VoiceActorNode;
  locale: DisplayLocale;
  animeById: AnimeLookup;
}

const MAX_PILLS = 2;

/**
 * MODE_DETAIL 220×110 bento: Character ⇄ Voice Actor split header, names, role badge,
 * and clickable anime pills. Fixed size (no reflow while the shell springs open).
 */
export const VoiceActorBento = memo(function VoiceActorBento({ node, locale, animeById }: VoiceActorBentoProps) {
  const t = useT();
  const primary = node.roles[0];
  const color = animeColor(animeById, primary?.animeId);
  const vaName = pickName(node.voiceActor.name, locale);
  const charName = primary ? pickName(primary.character.name, locale) : '—';
  const animeIds = distinctAnimeIds(node.roles);
  const shown = animeIds.slice(0, MAX_PILLS);
  const overflow = animeIds.length - shown.length;
  const role = primary?.role ?? 'SUPPORTING';

  return (
    <div
      className="sc-card flex flex-col justify-between p-2.5"
      style={{ backgroundImage: `linear-gradient(90deg, ${withAlpha(color, 0.1)}, transparent 55%)` }}
    >
      {/* Split header */}
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="relative flex shrink-0 items-center">
          <div className="sc-mini rounded-[12px]">
            {primary ? (
              <Avatar src={primary.character.image} name={primary.character.name.full} color={color} alt={charName} />
            ) : (
              <div className="sc-avatar" style={{ backgroundImage: fallbackGradient(color) }} />
            )}
          </div>
          <span className="sc-swap" aria-hidden="true">
            <ArrowLeftRight size={9} strokeWidth={2.6} />
          </span>
          <div className="sc-mini ml-[7px] rounded-full">
            <Avatar src={node.voiceActor.image} name={node.voiceActor.name.full} color={color} alt={vaName} />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <div className="truncate text-[12.5px] font-semibold leading-[15px] tracking-[-0.01em] text-white">{charName}</div>
          <div className="flex items-center gap-1">
            {primary?.sub && <SubBadge sub={primary.sub} />}
            <span className={cx('sc-role', `sc-role--${role.toLowerCase()}`)}>{roleLabel(t, role)}</span>
            {node.roles.length > 1 && (
              <span className="font-mono text-[9.5px] font-medium text-white/45">+{node.roles.length - 1}</span>
            )}
          </div>
          <div className="flex min-w-0 items-baseline gap-1">
            <span className="shrink-0 text-[9px] font-semibold text-white/35">{t.seiyuu}</span>
            <span className="truncate text-[11px] leading-[13px] text-white/70">{vaName}</span>
          </div>
        </div>
      </div>

      {/* Anime pills */}
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {shown.map((id) => (
          <AnimePill key={id} animeId={id} animeById={animeById} locale={locale} />
        ))}
        {overflow > 0 && (
          <span className="shrink-0 rounded-full px-1.5 font-mono text-[9.5px] leading-5 text-white/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
            +{overflow}
          </span>
        )}
        <span className="ml-auto shrink-0 pl-1 font-mono text-[9.5px] text-white/35">
          ×<span className="text-white/70">{node.degree}</span>
        </span>
      </div>
    </div>
  );
});
