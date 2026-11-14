import { MAX_CAST_POOL } from '../types/contract';
import type { AnimeRecord, CastEntry, CharacterRole, SubVoiceActor } from '../types/contract';
import { ensureKoName } from './localize';

export const roleOrder: Record<CharacterRole, number> = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };
/** Fetch-only ranking metadata; not part of the public CastEntry contract. */
export type RankedCastEntry = CastEntry & { favourites?: number };
/** Members are in release order; one merged entry per character. */
export function mergeFranchiseCast(members: readonly Pick<AnimeRecord, 'cast' | 'fullCastPool'>[], localize = true): CastEntry[] {
  const found = new Map<number, { entry: CastEntry; primaries: Set<number>; subs: Map<number, SubVoiceActor>; firstPrimary: CastEntry['voiceActor']; primaryByRole: Map<CharacterRole, NonNullable<CastEntry['voiceActor']>>; appearances: number; favourites: number; relevance: number }>();
  let relevance = 0;
  for (const member of members) {
    const seen = new Set<number>();
    for (const c of member.fullCastPool ?? member.cast) {
      const entry: CastEntry = {
        character: { ...c.character, name: localize ? ensureKoName(c.character.name, {kind:'character',id:c.character.id}) : c.character.name }, role: c.role,
        voiceActor: c.voiceActor ? { ...c.voiceActor, name: localize ? ensureKoName(c.voiceActor.name, {kind:'voiceActor',id:c.voiceActor.id}) : c.voiceActor.name } : null,
      };
      let old = found.get(c.character.id);
      if (!old) {
        old = { entry, primaries: new Set(), subs: new Map(), firstPrimary: null, primaryByRole: new Map(), appearances: 0, favourites: 0, relevance: relevance++ };
        found.set(c.character.id, old);
      }
      if (!seen.has(c.character.id)) old.appearances++;
      seen.add(c.character.id);
      old.favourites = Math.max(old.favourites, (c as RankedCastEntry).favourites ?? 0);
      if (roleOrder[c.role] < roleOrder[old.entry.role]) old.entry = entry;
      if (entry.voiceActor) {
        old.primaries.add(entry.voiceActor.id); old.firstPrimary ??= entry.voiceActor;
        if (!old.primaryByRole.has(c.role)) old.primaryByRole.set(c.role,entry.voiceActor);
      }
      for (const sub of c.subVoiceActors ?? []) {
        if (!old.subs.has(sub.voiceActor.id) || sub.kind === 'CHILDHOOD') old.subs.set(sub.voiceActor.id, {
          ...sub, voiceActor: {...sub.voiceActor, name: localize ? ensureKoName(sub.voiceActor.name,{kind:'voiceActor',id:sub.voiceActor.id}) : sub.voiceActor.name},
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => roleOrder[a.entry.role] - roleOrder[b.entry.role]
    || b.favourites - a.favourites || b.appearances - a.appearances || a.relevance - b.relevance)
    .map(({entry, primaries, subs, firstPrimary, primaryByRole}) => {
      const subVoiceActors = [...subs.values()].filter(s => !primaries.has(s.voiceActor.id));
      return {...entry, voiceActor:primaryByRole.get(entry.role)??firstPrimary, ...(subVoiceActors.length ? {subVoiceActors} : {})};
    }).filter(c => c.voiceActor || c.subVoiceActors?.length).slice(0, MAX_CAST_POOL);
}
