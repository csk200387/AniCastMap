/**
 * Shared motion + visual tokens for the polymorphic graph node (owner: agy).
 * Pure module — no React, no DOM reads.
 */
import type { AnimeSummary, RoleRef, StageNode, ViewMode } from '../../types/contract';

export type AnimeLookup = ReadonlyMap<number, AnimeSummary> | undefined;

export const FALLBACK_COLOR = '#8b9cff';

/* ------------------------------------------------------------------ */
/* Springs                                                             */
/* ------------------------------------------------------------------ */

/** Shell morph between modes (width / height / borderRadius). */
export const MORPH_SPRING = { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 } as const;
/** Spawn pop + spotlight scale. */
export const POP_SPRING = { type: 'spring', stiffness: 420, damping: 24, mass: 0.8 } as const;
/** 3D Y-axis flip CHARACTER ⇄ VA. Slightly softer so the turn reads. */
export const FLIP_SPRING = { type: 'spring', stiffness: 170, damping: 21, mass: 1 } as const;
/** Role-deck fan-out. */
export const FAN_SPRING = { type: 'spring', stiffness: 320, damping: 22, mass: 0.7 } as const;

/** Mode-switch ripple: nodes morph outward from the anchor by BFS wave. */
export function waveStagger(waveIndex: number): number {
  return Math.min(Math.max(waveIndex, 0), 8) * 0.035;
}

/** Shell corner radius per kind/mode (root box = getNodeFootprint). */
export function shellRadius(node: StageNode, mode: ViewMode, size: number): number {
  if (node.kind === 'RECOMMENDATION') return mode === 'MODE_DETAIL' ? 16 : 18;
  if (mode === 'MODE_DETAIL') return 16;
  if (node.kind === 'ANIME') return node.isAnchor ? 24 : 20;
  return mode === 'MODE_VA' ? size / 2 : 20;
}

/* ------------------------------------------------------------------ */
/* Colour helpers                                                      */
/* ------------------------------------------------------------------ */

export function animeColor(lookup: AnimeLookup, animeId: number | undefined): string {
  if (animeId === undefined) return FALLBACK_COLOR;
  return lookup?.get(animeId)?.color ?? FALLBACK_COLOR;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [139, 156, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

const gradientCache = new Map<string, string>();

/** Initials-fallback backdrop seeded by an anime colour (cached — string is stable per colour). */
export function fallbackGradient(color: string): string {
  let g = gradientCache.get(color);
  if (!g) {
    g =
      `radial-gradient(120% 120% at 22% 12%, ${withAlpha(color, 0.95)} 0%, ` +
      `${withAlpha(color, 0.38)} 52%, #10121a 100%)`;
    gradientCache.set(color, g);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const LATIN = /^[A-Za-z0-9]/;

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  if (!LATIN.test(first)) return first.slice(0, 1);
  const second = words[1];
  return (first.charAt(0) + (second ? second.charAt(0) : first.charAt(1))).toUpperCase();
}

export function distinctAnimeIds(roles: readonly RoleRef[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of roles) {
    if (!seen.has(r.animeId)) {
      seen.add(r.animeId);
      out.push(r.animeId);
    }
  }
  return out;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
