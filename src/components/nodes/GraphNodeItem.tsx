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
import type { SpotlightState } from '../../types/contract';
import { selectSharedWithActive, selectSpotlight, selectSpotlightSource, useGraphStore, type GraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
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
  // Dimming is CSS on the wrapper's data-spot (NodeLayer); only the focused tile re-renders on hover.
  const focusSelector = useMemo(() => (s: GraphStore) => selectSpotlightSource(s) === node.id, [node.id]);
  const spotlight: SpotlightState = useGraphStore(focusSelector) ? 'focus' : 'idle';
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
        opacity: hidden ? 0 : 1,
      }}
      transition={{ width: MORPH_SPRING, height: MORPH_SPRING, borderRadius: MORPH_SPRING, scale: POP_SPRING, opacity: OPACITY_TWEEN }}
    >
      <RecommendationTile node={node} locale={locale} mode={viewMode} />
    </motion.div>
  );
});

const GraphNodeShell = memo(function GraphNodeShell({ node }: { node: SimulationNode }) {
  const t = useT();
  const viewMode = useGraphStore((s) => s.viewMode);
  const locale = useGraphStore((s) => s.locale);
  // A hover re-renders only the nodes it lights (focus / linked). "dimmed" — every other node — is applied by CSS
  // from the wrapper's data-spot (NodeLayer), so here it reads as 'idle'.
  const spotlightSelector = useMemo(() => {
    const select = selectSpotlight(node.id);
    return (s: GraphStore): SpotlightState => { const v = select(s); return v === 'dimmed' ? 'idle' : v; };
  }, [node.id]);
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
  // Single-anime voice actors recede until hovered or lit, so bridges stand out.
  const solo = isVA && node.degree < 2 && !isDetail;
  // (no opacity for receded faces: 100+ translucent shadowed elements made panning a large map slower)
  const opacity = spotlight === 'dimmed' ? 0.15 : muted ? 0.55 : 1;
  const scale = spotlight === 'focus' ? 1.08 : solo && !lit ? 0.62 : 1;
  // On a large map (> 110 nodes) always-on actor labels pile up: there, actors are named only while lit.
  const dense = useGraphStore((s) => (s.graph?.nodes.length ?? 0) > 110);
  const sharedSelector = useMemo(() => selectSharedWithActive(node.id), [node.id]);
  const shared = useGraphStore(sharedSelector);

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
      data-bridge={isVA && node.degree >= 2}
      data-solo={solo && !lit ? 'true' : undefined}
      data-muted={muted ? 'true' : undefined}
      aria-label={label}
      style={style}
      initial={{ width, height, borderRadius: radius, scale: 0.2, opacity: 0 }}
      animate={{ width, height, borderRadius: radius, scale, opacity }}
      transition={transition}
    >
      {/* How many voice actors this anime shares with the one under the spotlight */}
      {shared > 0 && (
        <span className="sc-shared" aria-hidden="true">
          {t.sharedWith(shared)}
        </span>
      )}
      {/* Always-on labels (anime title; bridge voice actor name) that stay legible when zoomed out */}
      {!isDetail &&
        (node.kind === 'ANIME' ||
          (viewMode === 'MODE_CHARACTER' &&
            spotlight !== 'focus' &&
            spotlight !== 'dimmed' &&
            ((node.degree >= 3 && !dense) || (node.degree >= 2 && spotlight === 'linked')))) && (
          <span
            className="sc-label"
            data-kind={node.kind}
            data-tier={isVA ? (node.degree >= 3 ? 'gold' : 'neon') : undefined}
            aria-hidden="true"
          >
            {node.kind === 'ANIME' ? label : `${label} ×${node.degree}`}
          </span>
        )}
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
