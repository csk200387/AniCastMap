import { getNodeFootprint } from '../types/contract';
import type { CameraTransform, StageNode, ViewMode } from '../types/contract';

export interface FrameInsets { left: number; right: number; top: number; bottom: number }
export interface StageRect { left: number; top: number; width: number; height: number }

export function createCamera() {
  const value: CameraTransform = { x: 0, y: 0, k: 1 };
  let width = 1, height = 1, initialized = false;
  let target: CameraTransform | null = null;
  let flight: { from: CameraTransform; to: CameraTransform; start: number } | null = null;
  function frame(nodes: readonly StageNode[], mode: ViewMode, insets: FrameInsets = { left: 0, right: 0, top: 0, bottom: 0 }, includeRecommendations = false): CameraTransform | null {
    if (!nodes.length) return null;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const n of nodes) {
      if (n.kind === 'RECOMMENDATION' && !includeRecommendations) continue;
      const box = getNodeFootprint(n, mode), x = n.x ?? 0, y = n.y ?? 0;
      left = Math.min(left, x - box.width / 2); right = Math.max(right, x + box.width / 2);
      top = Math.min(top, y - box.height / 2); bottom = Math.max(bottom, y + box.height / 2);
    }
    if (left === Infinity) return null;
    const availableWidth = Math.max(1, width - insets.left - insets.right);
    const availableHeight = Math.max(1, height - insets.top - insets.bottom);
    const k = Math.max(0.15, Math.min(1.6, Math.max(1, availableWidth - 96) / Math.max(1, right - left), Math.max(1, availableHeight - 96) / Math.max(1, bottom - top)));
    return { x: insets.left + availableWidth / 2 - (left + right) / 2 * k, y: insets.top + availableHeight / 2 - (top + bottom) / 2 * k, k };
  }
  return { value, frame,
    get active() { return flight !== null || target !== null; },
    resize(w: number, h: number) {
      if (!initialized) { value.x = w / 2; value.y = h / 2; initialized = true; }
      else { value.x += (w - width) / 2; value.y += (h - height) / 2; }
      width = w; height = h;
    },
    world(x: number, y: number) { return { x: (x - value.x) / value.k, y: (y - value.y) / value.k }; },
    cancel() { target = null; flight = null; },
    track(next: CameraTransform | null) { target = next; flight = null; },
    fly(next: CameraTransform | null, animate = true) {
      target = null;
      if (!next) return;
      if (!animate) { Object.assign(value, next); flight = null; }
      else flight = { from: { ...value }, to: next, start: performance.now() };
    },
    update(now: number) {
      if (flight) {
        const t = Math.min(1, Math.max(0, (now - flight.start) / 750)), e = t * t * (3 - 2 * t);
        value.x = flight.from.x + (flight.to.x - flight.from.x) * e;
        value.y = flight.from.y + (flight.to.y - flight.from.y) * e;
        value.k = Math.exp(Math.log(flight.from.k) + Math.log(flight.to.k / flight.from.k) * e);
        if (t === 1) flight = null;
      } else if (target) {
        if (Math.abs(target.x - value.x) < 0.01 && Math.abs(target.y - value.y) < 0.01 && Math.abs(target.k - value.k) < 0.00001) {
          Object.assign(value, target); target = null; return;
        }
        value.x += (target.x - value.x) * 0.08; value.y += (target.y - value.y) * 0.08; value.k += (target.k - value.k) * 0.08;
      }
    },
  };
}
export type Camera = ReturnType<typeof createCamera>;

/** Pointer events provide mouse/touch pan and two-pointer pinch without a second animation timer. */
export function bindCamera(stage: HTMLElement, camera: Camera, onGesture: () => void, onClick: (event: PointerEvent) => void, rect: StageRect) {
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = false, startX = 0, startY = 0, startEvent: PointerEvent | null = null;
  const local = (e: { clientX: number; clientY: number }) => { return { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
  const ignore = (e: Event) => (e.target as Element).closest('[data-node-id]');
  const zoom = (x: number, y: number, factor: number) => {
    const world = camera.world(x, y), c = camera.value;
    c.k = Math.max(0.15, Math.min(3, c.k * factor)); c.x = x - world.x * c.k; c.y = y - world.y * c.k;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault(); onGesture(); camera.cancel();
    const p = local(e); zoom(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.035 : 0.002)));
  };
  const down = (e: PointerEvent) => {
    if ((ignore(e) && e.pointerType !== 'touch') || e.button !== 0) return;
    const p = local(e); if (!pointers.size) { startX = p.x; startY = p.y; moved = false; startEvent = e; }
    pointers.set(e.pointerId, p); stage.setPointerCapture(e.pointerId);
    if (pointers.size > 1) { moved = true; onGesture(); camera.cancel(); }
  };
  const move = (e: PointerEvent) => {
    const old = pointers.get(e.pointerId); if (!old) return;
    const p = local(e), other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (Math.hypot(p.x - startX, p.y - startY) >= 4) moved = true;
    if (moved) {
      onGesture(); camera.cancel();
      if (other) {
        const ox = (old.x + other.x) / 2, oy = (old.y + other.y) / 2;
        zoom(ox, oy, Math.hypot(p.x - other.x, p.y - other.y) / Math.max(1, Math.hypot(old.x - other.x, old.y - other.y)));
        camera.value.x += (p.x - old.x) / 2; camera.value.y += (p.y - old.y) / 2;
      } else { camera.value.x += p.x - old.x; camera.value.y += p.y - old.y; }
    }
    pointers.set(e.pointerId, p);
  };
  const up = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (!moved && e.type === 'pointerup') onClick(startEvent ?? e);
    if (!pointers.size) startEvent = null;
  };
  stage.addEventListener('wheel', wheel, { passive: false }); stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('lostpointercapture', up);
  const unbind = () => { stage.removeEventListener('wheel', wheel); stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); stage.removeEventListener('lostpointercapture', up); pointers.clear(); startEvent = null; };
  unbind.isGesturing = () => pointers.size > 0;
  return unbind;
}
