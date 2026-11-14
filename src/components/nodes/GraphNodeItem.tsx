import { memo, useMemo } from 'react';
import { AnimatePresence, motion, type MotionStyle } from 'framer-motion';
import {
  getNodeFootprint,
  pickName,
  pickTitle,
  type GraphNodeItemProps,
  type RecommendationNode,
  type SimulationNode,
} from '../../types/contract';
import { selectSpotlight, useGraphStore } from '../../store/useGraphStore';
import { AnimeDetailCard, AnimeTile } from './AnimeNodeViews';
import { NodeRings } from './NodeRings';
import { VoiceActorBento } from './VoiceActorBento';
import { RecommendationTile } from './RecommendationTile';
import { VoiceActorFace } from './VoiceActorFace';
import { animeColor, MORPH_SPRING, POP_SPRING, shellRadius, waveStagger } from './nodeTheme';

const OPACITY_TWEEN = { duration: 0.28, ease: 'easeOut' } as const;

/**
 * Tri-Mode polymorphic graph node (MODE_CHARACTER / MODE_VA / MODE_DETAIL).
 *
 * Mounted by the engine inside a zero-size, imperatively translated wrapper that owns all
 * pointer events. This root:
 *  - centres itself on the wrapper origin (x/y -50%, composed with scale by framer-motion),
 *  - is a "glass shell" whose box ALWAYS equals getNodeFootprint(node, viewMode) and springs
 *    width/height/borderRadius between modes (rippling outward by BFS wave),
 *  - pops in on mount, and expresses spotlight via opacity/scale only.
 * Content layers cross-fade (compact face ⇄ fixed-size bento card) via AnimatePresence.
 */
export const GraphNodeItem = memo(function GraphNodeItem({ node }: GraphNodeItemProps) {
  return node.kind === 'RECOMMENDATION' ? <RecommendationShell node={node} /> : <GraphNodeShell node={node} />;
});

/** Satellite shell: dashed glass tile that blooms in and shrinks out when the set retracts. */
const RecommendationShell = memo(function RecommendationShell({ node }: { node: RecommendationNode }) {
  const viewMode = useGraphStore((s) => s.viewMode);
  const locale = useGraphStore((s) => s.locale);
  const retracting = useGraphStore((s) => s.recommendations?.retracting ?? false);
  const spotlightSelector = useMemo(() => selectSpotlight(node.id), [node.id]);
  const spotlight = useGraphStore(spotlightSelector);
  const { width, height } = getNodeFootprint(node, viewMode);
  const radius = shellRadius(node, viewMode, width);
  const style = useMemo(() => ({ x: '-50%', y: '-50%', '--node-color': node.anime.color }) as MotionStyle, [node.anime.color]);
  const hidden = retracting;
  return (
    <motion.div
      className="sc-node sc-node--rec"
      data-kind="RECOMMENDATION"
      data-mode={viewMode}
      data-spot={spotlight}
      aria-label={pickTitle(node.anime.title, locale)}
      style={style}
      initial={{ width, height, borderRadius: radius, scale: 0.2, opacity: 0 }}
      animate={{
        width,
        height,
        borderRadius: radius,
        scale: hidden ? 0.2 : spotlight === 'focus' ? 1.08 : 1,
        opacity: hidden ? 0 : spotlight === 'dimmed' ? 0.15 : 1,
      }}
      transition={{ width: MORPH_SPRING, height: MORPH_SPRING, borderRadius: MORPH_SPRING, scale: POP_SPRING, opacity: OPACITY_TWEEN }}
    >
      <RecommendationTile node={node} locale={locale} mode={viewMode} />
    </motion.div>
  );
});

const GraphNodeShell = memo(function GraphNodeShell({ node }: { node: SimulationNode }) {
  const viewMode = useGraphStore((s) => s.viewMode);
  const locale = useGraphStore((s) => s.locale);
  const spotlightSelector = useMemo(() => selectSpotlight(node.id), [node.id]);
  const spotlight = useGraphStore(spotlightSelector);
  const isBridge = useGraphStore((s) => s.activeBridgeIds.has(node.id));
  const isSelected = useGraphStore((s) => s.selectedNodeId === node.id);
  const animeById = useGraphStore((s) => s.graph?.animeById);

  const { width, height } = getNodeFootprint(node, viewMode);
  const radius = shellRadius(node, viewMode, width);
  const stagger = waveStagger(node.waveIndex);
  const isDetail = viewMode === 'MODE_DETAIL';
  const isVA = node.kind === 'VOICE_ACTOR';

  const lit = spotlight === 'focus' || spotlight === 'linked';
  const muted = isVA && viewMode === 'MODE_VA' && node.degree < 2 && !lit;
  const opacity = spotlight === 'dimmed' ? 0.15 : muted ? 0.55 : 1;
  const scale = spotlight === 'focus' ? 1.08 : 1;

  const color = node.kind === 'ANIME' ? node.anime.color : animeColor(animeById, node.roles[0]?.animeId);
  const label =
    node.kind === 'ANIME' ? pickTitle(node.anime.title, locale) : pickName(node.voiceActor.name, locale);

  const transition = useMemo(
    () => ({
      width: { ...MORPH_SPRING, delay: stagger },
      height: { ...MORPH_SPRING, delay: stagger },
      borderRadius: { ...MORPH_SPRING, delay: stagger },
      scale: POP_SPRING,
      opacity: OPACITY_TWEEN,
    }),
    [stagger],
  );

  const style = useMemo(() => ({ x: '-50%', y: '-50%', '--node-color': color }) as MotionStyle, [color]);

  return (
    <motion.div
      className="sc-node"
      data-kind={node.kind}
      data-mode={viewMode}
      data-spot={spotlight}
      aria-label={label}
      style={style}
      initial={{ width, height, borderRadius: radius, scale: 0.2, opacity: 0 }}
      animate={{ width, height, borderRadius: radius, scale, opacity }}
      transition={transition}
    >
      <NodeRings
        kind={node.kind}
        isAnchor={node.isAnchor}
        spotlight={spotlight}
        isSelected={isSelected}
        isBridge={isBridge}
      />

      <AnimatePresence initial={false}>
        {isDetail ? (
          <motion.div
            key="detail"
            className="sc-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.22, delay: stagger + 0.14 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            {node.kind === 'ANIME' ? (
              <AnimeDetailCard node={node} locale={locale} />
            ) : (
              <VoiceActorBento node={node} locale={locale} animeById={animeById} />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="compact"
            className="sc-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2, delay: stagger + 0.06 } }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
          >
            {node.kind === 'ANIME' ? (
              <AnimeTile node={node} locale={locale} />
            ) : (
              <VoiceActorFace
                node={node}
                isVAMode={viewMode === 'MODE_VA'}
                locale={locale}
                spotlight={spotlight}
                animeById={animeById}
                muted={muted}
                stagger={stagger}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
