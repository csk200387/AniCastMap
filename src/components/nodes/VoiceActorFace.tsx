import { memo, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { pickName, pickTitle, type DisplayLocale, type SpotlightState, type VoiceActorNode } from '../../types/contract';
import { Avatar } from './Avatar';
import { RoleDeck } from './RoleDeck';
import { SubBadge } from './SubBadge';
import { animeColor, cx, FAN_SPRING, FLIP_SPRING, type AnimeLookup } from './nodeTheme';

export interface VoiceActorFaceProps {
  node: VoiceActorNode;
  /** Compact modes only — MODE_DETAIL renders <VoiceActorBento />. */
  isVAMode: boolean;
  locale: DisplayLocale;
  spotlight: SpotlightState;
  animeById: AnimeLookup;
  /** Degree-1 VA in MODE_VA with no spotlight → desaturated portrait. */
  muted: boolean;
  /** BFS-wave delay for the mode-switch ripple. */
  stagger: number;
}

type BridgeTier = 'neon' | 'gold' | null;

export function bridgeTier(degree: number): BridgeTier {
  if (degree >= 3) return 'gold';
  if (degree >= 2) return 'neon';
  return null;
}

/** Deck pose: resting stack, fanned spread (focus), or merged into the hub (MODE_VA). */
function deckPose(i: number, count: number, isVAMode: boolean, fanned: boolean) {
  if (isVAMode) return { x: 0, y: 0, rotate: 0, scale: 0.72, opacity: 0 };
  const side = count === 1 || i === 1 ? 1 : -1;
  // Focus: the full RoleDeck above the node takes over, so the resting stack tucks away.
  if (fanned) return { x: 0, y: 0, rotate: 0, scale: 0.8, opacity: 0 };
  return { x: side * 6, y: -3 - i, rotate: side * (7 + i * 2), scale: 0.92 - i * 0.03, opacity: 1 };
}

/**
 * Compact VA node (MODE_CHARACTER ⇄ MODE_VA).
 * Front face = roles[0] character, back face = VA portrait; the flipper turns 180° on Y.
 * Fills the shell; overlays (chips, badge, name pill) overflow it without catching pointers.
 */
export const VoiceActorFace = memo(function VoiceActorFace({
  node,
  isVAMode,
  locale,
  spotlight,
  animeById,
  muted,
  stagger,
}: VoiceActorFaceProps) {
  const focus = spotlight === 'focus';
  const lit = focus || spotlight === 'linked';

  const primary = node.roles[0];
  const primaryColor = animeColor(animeById, primary?.animeId);
  const primaryAnime = primary ? animeById?.get(primary.animeId) : undefined;
  const extras = node.roles.slice(1, 3);
  const extraCount = node.roles.length - 1;
  const fanned = !isVAMode && focus && extras.length > 0;
  const tier = bridgeTier(node.degree);

  const vaName = pickName(node.voiceActor.name, locale);
  const charName = primary ? pickName(primary.character.name, locale) : vaName;
  const showDeck = !isVAMode && focus && node.roles.length >= 2;
  const showNamePill = isVAMode ? tier !== null || lit : focus && !showDeck;

  return (
    <div className="sc-square">
      {/* Stacked role deck — behind the face. */}
      {extras.map((role, i) => {
        const color = animeColor(animeById, role.animeId);
        return (
          <motion.div
            key={`${role.animeId}:${role.character.id}`}
            className="sc-deck-card"
            aria-hidden="true"
            initial={false}
            animate={deckPose(i, extras.length, isVAMode, fanned)}
            transition={{ ...FAN_SPRING, delay: isVAMode ? stagger : i * 0.035 }}
          >
            <Avatar src={role.character.image} name={role.character.name.full} color={color} />
            <span className="sc-deck-bar" style={{ background: color }} />
            <span className="sc-deck-shade" data-on={!fanned} />
          </motion.div>
        );
      })}

      {/* Full multi-role deck: every character this VA voices in the watched list (hover / focus). */}
      <RoleDeck node={node} locale={locale} animeById={animeById} show={showDeck} />

      {/* 3D flipper. */}
      <motion.div
        className="sc-flipper"
        initial={false}
        animate={{ rotateY: isVAMode ? 180 : 0 }}
        transition={{ ...FLIP_SPRING, delay: stagger }}
      >
        <div className="sc-face">
          <Avatar
            src={primary ? primary.character.image : node.voiceActor.image}
            name={primary ? primary.character.name.full : node.voiceActor.name.full}
            color={primaryColor}
            alt={charName}
          />
        </div>
        <div className={cx('sc-face sc-face--back', muted && 'sc-face--muted')}>
          <Avatar src={node.voiceActor.image} name={node.voiceActor.name.full} color={primaryColor} alt={vaName} />
        </div>
      </motion.div>

      {/* MODE_VA bridge tier ring: neon (2 anime) / gold (3+). */}
      {tier && isVAMode && <span className={cx('sc-tier', `sc-tier--${tier}`)} data-on="true" aria-hidden="true" />}

      {/* Corner chips. */}
      {extraCount > 0 && !isVAMode && (
        <span className="sc-chip -right-2 -top-2" data-on="true" aria-hidden="true">
          +{extraCount}
        </span>
      )}
      {tier && isVAMode && (
        <span className={cx('sc-chip -right-2 -top-2', `sc-chip--${tier}`)} data-on="true" aria-hidden="true">
          ×{node.degree}
        </span>
      )}

      {/* Childhood / alternate credit marker (only when the face character is a sub credit). */}
      {primary?.sub && !isVAMode && <SubBadge sub={primary.sub} className="absolute -bottom-2 -left-2 z-[8] bg-zinc-950/90" />}

      {/* Anime badge (MODE_CHARACTER): colour dot, title slides out on focus. */}
      {primary && !isVAMode && (
        <span
          className="sc-badge"
          data-on="true"
          aria-hidden="true"
          style={{ '--badge-color': primaryColor } as CSSProperties}
        >
          <span className="sc-badge-label" data-on={focus && !isVAMode}>
            {primaryAnime ? pickTitle(primaryAnime.title, locale) : ''}
          </span>
        </span>
      )}

      {/* Floating name pill: VA name in MODE_VA (bridges always), character name on focus in MODE_CHARACTER. */}
      {showNamePill && (
        <span className={cx('sc-namepill', isVAMode && tier && `sc-namepill--${tier}`)} data-on="true" aria-hidden="true">
          {isVAMode ? vaName : charName}
        </span>
      )}
    </div>
  );
});
