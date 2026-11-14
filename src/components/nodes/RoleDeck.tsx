import { memo, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  animeNodeId,
  pickName,
  pickTitle,
  type DisplayLocale,
  type VoiceActorNode,
} from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { Avatar } from './Avatar';
import { SubBadge } from './SubBadge';
import { animeColor, FAN_SPRING, type AnimeLookup } from './nodeTheme';

const STEP = 48; // horizontal spacing between fanned cards (card width 64)
const stopPointer = (e: PointerEvent<HTMLElement>) => e.stopPropagation();

export interface RoleDeckProps {
  node: VoiceActorNode;
  locale: DisplayLocale;
  animeById: AnimeLookup;
  show: boolean;
}

/**
 * MODE_CHARACTER multi-role deck: ALL characters this VA voices inside the watched list, fanned above
 * the node like a hand of cards — portrait, localized character name, localized anime tag — with the
 * VA's name anchoring the group. Lives inside the node wrapper, so hovering the deck keeps the node
 * spotlit; clicking a card flies the camera to that anime's cluster.
 */
export const RoleDeck = memo(function RoleDeck({ node, locale, animeById, show }: RoleDeckProps) {
  const t = useT();
  const roles = node.roles;
  const n = roles.length;
  const width = 64 + (n - 1) * STEP;
  const vaName = pickName(node.voiceActor.name, locale);

  return (
    <AnimatePresence>
      {show && n >= 2 && (
        <motion.div
          key="fan"
          className="sc-fan"
          style={{ width }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.12 } }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          role="group"
          aria-label={`${vaName} · ${n}`}
        >
          {roles.map((role, i) => {
            const mid = (n - 1) / 2;
            const off = i - mid;
            const pose = { x: 0, y: Math.pow(Math.abs(off), 1.7) * 3.5, rotate: off * 5.5, scale: 1, opacity: 1 };
            const color = animeColor(animeById, role.animeId);
            const anime = animeById?.get(role.animeId);
            const charName = pickName(role.character.name, locale);
            const animeTitle = anime ? pickTitle(anime.title, locale) : '';
            const onClick = (e: MouseEvent) => {
              e.stopPropagation();
              useGraphStore.getState().focusNode(animeNodeId(role.animeId));
            };
            return (
              <motion.button
                key={`${role.animeId}:${role.character.id}`}
                type="button"
                className="sc-fan-card"
                style={{ left: i * STEP, '--tag-color': color } as CSSProperties}
                initial={{ x: -off * STEP * 0.7, y: 26, rotate: 0, scale: 0.6, opacity: 0 }}
                animate={pose}
                whileHover={{ y: pose.y - 12, scale: 1.1, rotate: off * 2.5, zIndex: 10 }}
                transition={{ ...FAN_SPRING, delay: i * 0.035 }}
                onPointerDown={stopPointer}
                onClick={onClick}
                title={animeTitle ? `${charName} · ${animeTitle}` : charName}
                aria-label={animeTitle ? `${charName} · ${animeTitle}` : charName}
              >
                <Avatar src={role.character.image} name={role.character.name.full} color={color} alt={charName} />
                {role.sub && <SubBadge sub={role.sub} className="absolute top-1 left-1 z-10 bg-zinc-950/80" />}
                <span className="sc-fan-meta">
                  <span className="sc-fan-char">{charName}</span>
                  {animeTitle && <span className="sc-fan-tag">{animeTitle}</span>}
                </span>
              </motion.button>
            );
          })}
          <span className="sc-fan-name">
            <span className="relative h-[18px] w-[18px] shrink-0 overflow-hidden rounded-full">
              <Avatar src={node.voiceActor.image} name={node.voiceActor.name.full} color={animeColor(animeById, roles[0]?.animeId)} alt={vaName} />
            </span>
            <span className="truncate">{vaName}</span>
            <span className="font-mono text-[9.5px] font-medium text-white/50">{t.metaRoles(n)}</span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
