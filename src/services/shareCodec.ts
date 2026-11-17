import { VIEW_MODES, type DisplayLocale, type ViewMode } from '../types/contract';
import { MAX_WATCHED } from './userState';

/**
 * Stateless share links: `?s=<payload>` carries a whole map, no backend. Schema (spec names):
 *   { a: anchorAnimeId, w: watchedAnimeIds[], m: viewModeIndex, f: filterBitmask, l: localeIndex }
 *
 * Wire format — URL-safe, no escaping needed:  `1<k>.<anchor>.<id>.<id>…`
 *   1        format version
 *   <k>      ONE base36 digit packing m (0–2), f (0–3: supporting | sub VAs) and l (0–2): k = m·12 + f·3 + l
 *   <anchor> base36 index of the anchor inside w
 *   <id>…    w in the sender's order, each base36 zigzag delta from the previous id (first from 0)
 * 12 typical AniList ids encode to ~60 characters.
 */
export interface SharePayload { a: number; w: number[]; m: number; f: number; l: number }
export interface SharedMap {
  anchorAnimeId: number;
  watched: number[];
  viewMode: ViewMode;
  showSupportingRoles: boolean;
  includeSubVoiceActors: boolean;
  locale: DisplayLocale;
}

const LOCALES: readonly DisplayLocale[] = ['ko', 'ja', 'en'];
/** 500 safe-integer ids: up to 11 base36 chars per delta + separators + header/anchor. */
const MAX_PAYLOAD_CHARS = MAX_WATCHED * 12 + 5;
const zig = (n: number) => (n >= 0 ? 2 * n : -2 * n - 1);
const unzig = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

export function toPayload(map: SharedMap): SharePayload {
  return {
    a: map.anchorAnimeId,
    w: map.watched,
    m: Math.max(0, VIEW_MODES.indexOf(map.viewMode)),
    f: (map.showSupportingRoles ? 1 : 0) | (map.includeSubVoiceActors ? 2 : 0),
    l: Math.max(0, LOCALES.indexOf(map.locale)),
  };
}

export function encodeShare(p: SharePayload): string {
  const anchor = Math.max(0, p.w.indexOf(p.a));
  const deltas = p.w.map((id, i) => zig(id - (i ? p.w[i - 1]! : 0)).toString(36));
  return [`1${(p.m * 12 + p.f * 3 + p.l).toString(36)}`, anchor.toString(36), ...deltas].join('.');
}

/** null for anything malformed: a bad link must fall back to the visitor's own map, never throw. */
export function decodeShare(s: string | null | undefined): SharedMap | null {
  if (!s || s.length > MAX_PAYLOAD_CHARS || !/^1[0-9a-z](\.[0-9a-z]+)+$/.test(s)) return null;
  const [head, anchorPart, ...rest] = s.split('.');
  const k = parseInt(head!.slice(1), 36), m = Math.floor(k / 12), f = Math.floor((k % 12) / 3), l = k % 3;
  if (m >= VIEW_MODES.length || !rest.length || rest.length > MAX_WATCHED) return null;
  const watched: number[] = [];
  for (const part of rest) {
    const id = (watched.at(-1) ?? 0) + unzig(parseInt(part, 36));
    if (!Number.isSafeInteger(id) || id <= 0 || watched.includes(id)) return null;
    watched.push(id);
  }
  const anchor = watched[parseInt(anchorPart!, 36)];
  if (anchor === undefined) return null;
  return {
    anchorAnimeId: anchor,
    watched,
    viewMode: VIEW_MODES[m]!,
    showSupportingRoles: (f & 1) === 1,
    includeSubVoiceActors: (f & 2) === 2,
    locale: LOCALES[l]!,
  };
}

export const CANONICAL_ORIGIN = 'https://anicastmap.vercel.app';
export function linkOrigin(): string {
  return import.meta.env?.PROD ? CANONICAL_ORIGIN : location.origin;
}

/** Synchronous: copying the link never waits on anything. */
export function shareUrl(map: SharedMap, origin = linkOrigin()): string {
  return `${origin}/?s=${encodeShare(toPayload(map))}`;
}

export function backupUrl(map: SharedMap, origin = linkOrigin()): string {
  return `${origin}/?b=${encodeShare(toPayload(map))}`;
}

export const sharedParam = (search = typeof location === 'undefined' ? '' : location.search): string | null =>
  new URLSearchParams(search).get('s');

export const backupParam = (search = typeof location === 'undefined' ? '' : location.search): string | null =>
  new URLSearchParams(search).get('b');
