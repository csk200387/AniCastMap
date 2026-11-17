import { memo, useCallback, useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { GraphStageProps, StageNode } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';

export interface NodeInteraction {
  down(id: string, event: PointerEvent<HTMLDivElement>): void;
  move(id: string, event: PointerEvent<HTMLDivElement>): void;
  up(id: string, event: PointerEvent<HTMLDivElement>): void;
}
export function positionNode(element: HTMLDivElement, node: StageNode) {
  element.style.transform = `translate3d(${Math.round((node.x ?? 0) * 10) / 10}px, ${Math.round((node.y ?? 0) * 10) / 10}px, 0)`;
}
const NodeWrapper = memo(function NodeWrapper({ node, elements, interaction, renderNode }: GraphStageProps & {
  node: StageNode; elements: Map<string, HTMLDivElement>; interaction: RefObject<NodeInteraction | null>;
}) {
  const hovered = useGraphStore(s => s.hoveredNodeId === node.id);
  const selected = useGraphStore(s => s.selectedNodeId === node.id);
  const current = useRef(node); current.current = node;
  const register = useCallback((element: HTMLDivElement | null) => {
    if (element) { positionNode(element, current.current); elements.set(current.current.id, element); }
    else elements.delete(current.current.id);
  }, [elements]);
  const enter = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // Sweeping over nodes during a map/node drag must not repeatedly rebuild the spotlight.
    if (e.buttons !== 0) return;
    useGraphStore.getState().setHoveredNode(current.current.id);
  }, []);
  const leave = useCallback(() => { if (useGraphStore.getState().hoveredNodeId === current.current.id) useGraphStore.getState().setHoveredNode(null); }, []);
  const down = useCallback((e: PointerEvent<HTMLDivElement>) => interaction.current?.down(current.current.id, e), [interaction]);
  const move = useCallback((e: PointerEvent<HTMLDivElement>) => interaction.current?.move(current.current.id, e), [interaction]);
  const up = useCallback((e: PointerEvent<HTMLDivElement>) => interaction.current?.up(current.current.id, e), [interaction]);
  return <div ref={register} data-node-id={node.id}
    style={{ contain: 'layout style', backfaceVisibility: 'hidden', position: 'absolute', left: 0, top: 0, width: 0, height: 0, zIndex: hovered ? 30 : node.kind === 'RECOMMENDATION' ? 25 : selected ? 20 : node.kind === 'ANIME' ? 2 : 1, pointerEvents: 'auto', touchAction: 'none' }}
    onPointerEnter={enter} onPointerLeave={leave}
    onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={up} onLostPointerCapture={up}>{renderNode(node)}</div>;
});
export function NodeLayer({ renderNode, elements, interaction, layerRef }: GraphStageProps & {
  elements: Map<string, HTMLDivElement>; interaction: RefObject<NodeInteraction | null>; layerRef: RefObject<HTMLDivElement | null>;
}) {
  const graph = useGraphStore(s => s.graph);
  const recommendations = useGraphStore(s => s.recommendations);
  const revealed = useGraphStore(s => s.revealedNodeIds);
  return <div ref={layerRef} style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', pointerEvents: 'none' }}>
    {graph?.nodes.filter(n => revealed.has(n.id)).map(node => <NodeWrapper key={node.id} node={node} elements={elements} interaction={interaction} renderNode={renderNode} />)}
    {recommendations?.status === 'ready' && recommendations.nodes.map(node => <NodeWrapper key={node.id} node={node} elements={elements} interaction={interaction} renderNode={renderNode} />)}
  </div>;
}
