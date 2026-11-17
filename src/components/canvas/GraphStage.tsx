import { useLayoutEffect, useRef } from 'react';
import type { CameraTransform, GraphEngineHandle, GraphStageProps, SimulationEdge, StageNode, ViewMode } from '../../types/contract';
import { selectSpotlightSource, useGraphStore } from '../../store/useGraphStore';
import { createForceEngine, deckKeepOut } from '../../engine/forceSimulation';
import { bindCamera, createCamera } from '../../engine/camera';
import { createRecommendationOverlay } from '../../engine/recommendationOverlay';
import { createGenesis } from '../../engine/genesisSequencer';
import { createEdgeCanvas } from './EdgeCanvas';
import { NodeLayer, positionNode } from './NodeLayer';
import type { NodeInteraction } from './NodeLayer';

const NO_EDGES: readonly SimulationEdge[] = [];
let lastCamera: CameraTransform | null = null;

export function needsHiResImages(k: number, dpr: number, mode: ViewMode) {
  return k * dpr * (mode === 'MODE_VA' ? 120 : 64) > 100;
}

export function GraphStage({ renderNode }: GraphStageProps) {
  const graph = useGraphStore(s => s.graph);
  const stageRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), layerRef = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const interaction = useRef<NodeInteraction | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current!, canvas = canvasRef.current!, layer = layerRef.current!;
    // Selected multi-role VA in MODE_CHARACTER: its upward card deck is a no-go box for every other node.
    const keepOut = () => {
      const s = useGraphStore.getState();
      const anchor = s.viewMode === 'MODE_CHARACTER' && s.selectedNodeId ? byId.get(s.selectedNodeId) : undefined;
      return anchor?.kind === 'VOICE_ACTOR' && anchor.roles.length >= 2 ? deckKeepOut(anchor, camera.value.k) : null;
    };
    const initial = useGraphStore.getState(), camera = createCamera(), engine = createForceEngine(initial.viewMode, keepOut);
    engine.setPhysicsPaused(initial.physicsPaused);
    const renderer = createEdgeCanvas(canvas, graph);
    const byId = new Map<string, StageNode>(graph?.nodes.map(n => [n.id, n]));
    const rect = { left: 0, top: 0, width: 0, height: 0 };
    let dirty = true, disposed = false, raf = 0;
    const wake = () => { if (!disposed && !raf) raf = requestAnimationFrame(frame); };
    const drags = new Map<number, { id: string; startX: number; startY: number; moved: boolean; offsetX: number; offsetY: number }>();
    // Keep store notifications outside the animation callback; reports remain discrete.
    const report = (action: () => void) => queueMicrotask(() => { if (!disposed) action(); });
    const overlay = createRecommendationOverlay(engine, () => ({ nodes: genesis?.nodes ?? [], edges: genesis?.edges ?? [] }), node => {
      const element = elements.current.get(node.id); if (element) positionNode(element, node);
      byId.delete(node.id);
      for (const [pointer, drag] of drags) if (drag.id === node.id) drags.delete(pointer);
      if (!drags.size) engine.sim.alphaTarget(0);
    });
    const insets = () => {
      const state = useGraphStore.getState();
      return { left: state.leftDrawerOpen ? 384 : 0, right: state.selectedNodeId !== null ? 404 : 0, top: state.isSharedView ? 128 : 72, bottom: 96 };
    };
    const fit = (animate = true) => camera.fly(camera.frame(engine.sim.nodes(), useGraphStore.getState().viewMode, insets()), animate);
    const genesis = graph ? createGenesis(graph, engine, initial.instantGenesis ? 'INSTANT' : initial.genesisSpeed, {
      reset(totalSteps) {
        renderer.reset(); overlay.sync(null); if (!graph?.carry || (!drags.size && !unbind.isGesturing())) camera.cancel(); dirty = true;
        const store = useGraphStore.getState(); store.resetReveal(); store.setGenesisState({ status: 'playing', step: 0, totalSteps });
      },
      carry(nodeIds, bridgeIds) { useGraphStore.getState().revealNodes(nodeIds, bridgeIds); },
      step(step, done) {
        dirty = true; overlay.refresh(); renderer.syncRecommendations(overlay.edges);
        for (const node of overlay.nodes) byId.set(node.id, node);
        report(() => {
          const store = useGraphStore.getState(); store.revealNodes(step.nodeIds, step.bridgeNodeIds);
          store.setGenesisState({ step: step.index + 1, ...(done ? { status: 'done' as const } : {}) });
        });
      },
      effects: renderer.effects,
      finish(instant) {
        if (genesis?.tracking || (instant && !graph?.carry)) fit(!instant);
        report(() => useGraphStore.getState().setGenesisState({ status: 'done' }));
        // A restored session builds instantly once; afterwards the sequencer follows the user's speed setting again (Replay).
        if (initial.instantGenesis) genesis?.setSpeed(initial.genesisSpeed);
      },
    }) : null;
    const stopTracking = () => { wake(); genesis?.stopTracking(); camera.cancel(); };
    const tap = (node: StageNode | undefined) => {
      const state = useGraphStore.getState();
      if (node?.kind === 'RECOMMENDATION') state.openAnimePreview(node.anime);
      else state.selectNode(node && state.selectedNodeId !== node.id ? node.id : null);
    };
    const unbind = bindCamera(stage, camera, stopTracking, event => {
      const id = (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id');
      tap(id ? byId.get(id) : undefined);
    }, rect);
    const world = (e: { clientX: number; clientY: number }) => { return camera.world(e.clientX - rect.left, e.clientY - rect.top); };
    interaction.current = {
      down(id, e) {
        if (e.button !== 0 || e.pointerType === 'touch') return;
        const node = byId.get(id); if (!node) return;
        e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
        const p = world(e);
        drags.set(e.pointerId, { id, startX: e.clientX, startY: e.clientY, moved: false, offsetX: (node.x ?? 0) - p.x, offsetY: (node.y ?? 0) - p.y });
        node.fx = node.x ?? 0; node.fy = node.y ?? 0; engine.sim.alphaTarget(node.kind === 'RECOMMENDATION' ? 0.25 : 0.3).alpha(node.kind === 'RECOMMENDATION' ? 0.25 : 0.3);
      },
      move(id, e) {
        const drag = drags.get(e.pointerId), node = byId.get(id); if (!drag || !node) return;
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= 4) drag.moved = true;
        if (!drag.moved) return;
        stopTracking(); const p = world(e);
        node.x = node.fx = p.x + drag.offsetX; node.y = node.fy = p.y + drag.offsetY;
      },
      up(id, e) {
        const drag = drags.get(e.pointerId), node = byId.get(id); if (!drag || !node) return;
        drags.delete(e.pointerId);
        if (node.isAnchor && genesis?.playing) node.fx = node.fy = 0;
        else node.fx = node.fy = null;
        if (!drags.size) engine.sim.alphaTarget(0);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (!drag.moved && e.type === 'pointerup') {
          tap(node);
        }
      },
    };
    const handle: GraphEngineHandle = {
      replayGenesis() { wake(); useGraphStore.getState().retractRecommendations(); drags.clear(); engine.sim.alphaTarget(0); genesis?.restart(); },
      setViewMode(mode) { engine.setViewMode(mode); wake(); }, setPhysicsPaused(paused) { engine.setPhysicsPaused(paused); wake(); },
      setGenesisSpeed(speed) { wake(); genesis?.setSpeed(speed); },
      focusNode(id) { wake();
        const node = byId.get(id); if (!node || (node.kind !== 'RECOMMENDATION' && !useGraphStore.getState().revealedNodeIds.has(id))) return;
        stopTracking();
        const cluster = node.kind === 'ANIME' ? engine.sim.nodes().filter(n => n.id === id || graph!.neighbors.get(id)?.has(n.id)) : [node];
        camera.fly(camera.frame(cluster, useGraphStore.getState().viewMode, insets(), node.kind === 'RECOMMENDATION'));
      },
      fitView() { stopTracking(); fit(); },
      syncRecommendations(set) { wake();
        overlay.sync(set); renderer.syncRecommendations(overlay.edges);
        for (const node of overlay.nodes) byId.set(node.id, node);
        dirty = true;
      },
    };
    let lastDpr = 0;
    const resize = () => { wake();
      Object.assign(rect, (() => { const r = stage.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })());
      if (canvas.width !== Math.ceil(rect.width * window.devicePixelRatio) || canvas.height !== Math.ceil(rect.height * window.devicePixelRatio) || lastDpr !== window.devicePixelRatio) {
        lastDpr = window.devicePixelRatio;
        renderer.resize(rect.width, rect.height); camera.resize(rect.width, rect.height); dirty = true;
      }
    };
    resize();
    if (graph?.carry && lastCamera) Object.assign(camera.value, lastCamera);
    const observer = new ResizeObserver(resize); observer.observe(stage);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    useGraphStore.getState().registerEngine(handle);
    genesis?.restart();
    handle.syncRecommendations(initial.recommendations);

    let previousState = useGraphStore.getState();
    let cameraX = NaN, cameraY = NaN, cameraK = NaN;
    // Zoom re-rasterises every shadowed DOM node (≈50ms/frame at 120+ nodes). Promote the layer only while the
    // scale is changing; dropping will-change afterwards lets the browser re-raster crisply at rest.
    // --cam-k (read only by the fan deck) is written once zoom settles: per-frame writes restyle every descendant.
    let promotedUntil = 0, promoted = false, camKWritten = NaN;
    function frame(now: number) {
      raf = 0;
      if (disposed) return;
      genesis?.update(now);
      const state = useGraphStore.getState();
      // A newly opened deck clears its box: gentle reheat (overlays never exceed .25, this stays below).
      if (state.selectedNodeId !== previousState.selectedNodeId && keepOut()) engine.sim.alpha(Math.max(engine.sim.alpha(), 0.2));
      const ticked = engine.tick();
      const revealed = state.revealedNodeIds !== previousState.revealedNodeIds || state.recommendations !== previousState.recommendations;
      const positionsDirty = ticked || drags.size > 0 || revealed;
      const stackingDirty = revealed || state.hoveredNodeId !== previousState.hoveredNodeId || state.selectedNodeId !== previousState.selectedNodeId;
      if (positionsDirty || stackingDirty) for (const node of engine.sim.nodes()) {
        const element = elements.current.get(node.id); if (!element) continue;
        if (positionsDirty) positionNode(element, node);
        const z = node.id === state.hoveredNodeId ? '30' : node.kind === 'RECOMMENDATION' ? '25' : node.id === state.selectedNodeId ? '20' : node.kind === 'ANIME' ? '2' : '1';
        if (element.style.zIndex !== z) element.style.zIndex = z;
      }
      if (genesis?.playing && genesis.tracking) camera.track(camera.frame(engine.sim.nodes(), state.viewMode, insets()));
      camera.update(now);
      const c = camera.value;
      let zoomSettled = false;
      const cameraMoved = c.x !== cameraX || c.y !== cameraY || c.k !== cameraK;
      if (cameraMoved) layer.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.k})`;
      // Zoom level for CSS that must stay legible when zoomed out (multi-role fan deck). Written on zoom only.
      if (c.k !== cameraK) {
        promotedUntil = now + 220;
        if (!promoted) { layer.style.willChange = 'transform'; promoted = true; }
      } else if (now > promotedUntil) {
        if (promoted) { layer.style.willChange = ''; promoted = false; }
        if (camKWritten !== c.k) { layer.style.setProperty('--cam-k', String(c.k)); camKWritten = c.k; zoomSettled = true; }
      }
      if (zoomSettled || state.viewMode !== previousState.viewMode) {
        const hi = needsHiResImages(c.k, window.devicePixelRatio, state.viewMode);
        if (hi !== state.hiResImages) report(() => useGraphStore.setState({ hiResImages: hi }));
      }
      if (positionsDirty || cameraMoved || camera.active || selectSpotlightSource(state) !== null || stackingDirty || renderer.active || dirty) {
        renderer.draw(now, c, genesis?.edges ?? NO_EDGES, state);
      }
      cameraX = c.x; cameraY = c.y; cameraK = c.k; previousState = state; dirty = false;
      if (ticked || genesis?.playing || camera.active || renderer.active || renderer.spotlightActive || promoted) wake();
    };
    const unsubscribe = useGraphStore.subscribe(() => { dirty = true; wake(); });
    const wakeEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel'] as const;
    for (const event of wakeEvents) stage.addEventListener(event, wake, { capture: true, passive: true });
    wake();
    return () => {
      lastCamera = { ...camera.value };
      disposed = true;
      for (const n of engine.sim.nodes()) n.fx = n.fy = null;
      overlay.dispose(); drags.clear();
      unsubscribe();
      for (const event of wakeEvents) stage.removeEventListener(event, wake, true);
      cancelAnimationFrame(raf); observer.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('scroll', resize, true); unbind(); engine.dispose(); renderer.reset();
      interaction.current = null;
      if (useGraphStore.getState().engine === handle) useGraphStore.getState().registerEngine(null);
    };
  }, [graph]);
  return <div ref={stageRef} className="absolute inset-0 overflow-hidden" style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none', background: '#090A0F' }}>
    <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
    <NodeLayer renderNode={renderNode} elements={elements.current} interaction={interaction} layerRef={layerRef} />
  </div>;
}
