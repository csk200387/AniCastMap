import { memo } from 'react';
import { motion, type Transition } from 'framer-motion';
import type { NodeKind, SpotlightState } from '../../types/contract';

export interface NodeRingsProps {
  kind: NodeKind;
  isAnchor: boolean;
  spotlight: SpotlightState;
  isSelected: boolean;
  isBridge: boolean;
}

const PULSE_GOLD = (ring: number, ringA: number, blur: number, spread: number, glowA: number) =>
  `0 0 0 ${ring}px rgba(245, 196, 81, ${ringA}), 0 0 ${blur}px ${spread}px rgba(245, 196, 81, ${glowA})`;

const PULSE_KEYFRAMES = {
  boxShadow: [PULSE_GOLD(0, 0.95, 0, 0, 0.9), PULSE_GOLD(9, 0.45, 34, 10, 0.6), PULSE_GOLD(22, 0, 52, 18, 0)],
  opacity: [1, 1, 0],
};
const PULSE_TRANSITION: Transition = { duration: 0.9, ease: 'easeOut', times: [0, 0.35, 1] };

/**
 * Decorative halo + state rings. Radius-inherit overlays on the shell, mounted only while active and
 * faded in by CSS; only the one-shot bridge pulse uses framer-motion (and is display:none afterwards).
 * Rendered first inside the shell so badges/chips paint above the glow.
 */
export const NodeRings = memo(function NodeRings({ kind, isAnchor, spotlight, isSelected, isBridge }: NodeRingsProps) {
  return (
    <>
      {isAnchor && <span className="sc-halo" aria-hidden="true" />}
      {kind === 'ANIME' && <span className="sc-ring sc-ring--anime" data-on="true" aria-hidden="true" />}
      {/* Mounted only while active: 200+ nodes × 3 always-present transparent rings made zoom paint-bound. */}
      {isBridge && <span className="sc-ring sc-ring--bridge" data-on="true" aria-hidden="true" />}
      {spotlight === 'focus' && <span className="sc-ring sc-ring--focus" data-on="true" aria-hidden="true" />}
      {isSelected && <span className="sc-ring sc-ring--selected" data-on="true" aria-hidden="true" />}
      {isBridge && (
        // Mounts the moment the bridge is discovered → plays exactly once, then rests at opacity 0.
        <motion.span
          className="sc-ring sc-pulse"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ ...PULSE_KEYFRAMES, transitionEnd: { display: 'none' } }}
          transition={PULSE_TRANSITION}
        />
      )}
    </>
  );
});
