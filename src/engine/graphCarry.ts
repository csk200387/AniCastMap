import type { GraphData, SimulationEdge } from '../types/contract';

/** Engine-local carry metadata; the shared contract only needs surviving node IDs. */
export type EngineCarry = NonNullable<GraphData['carry']> & { edgeIds: ReadonlySet<string> };

export const endpointId = (endpoint: SimulationEdge['source']): string =>
  typeof endpoint === 'string' ? endpoint : endpoint.id;

export function carriedEdgeIds(graph: GraphData): ReadonlySet<string> {
  const carry = graph.carry as Partial<EngineCarry> | undefined;
  if (carry?.edgeIds) return carry.edgeIds;
  // Also accept callers constructing the original contract's carry shape by hand.
  return new Set(graph.edges.filter(edge => carry?.nodeIds?.has(endpointId(edge.source)) &&
    carry.nodeIds.has(endpointId(edge.target))).map(edge => edge.id));
}
