import { classifyRoleNote } from '../types/contract';
import type { CastEntry, SubVoiceActor, VoiceActorRecord } from '../types/contract';
export interface VoiceCredit { roleNotes: string | null; dubGroup?: string | null; voiceActor: VoiceActorRecord }
/** Preserve AniList relevance order; an unqualified adult credit takes priority. */
export function selectVoiceCredits(credits: readonly VoiceCredit[]): Pick<CastEntry, 'voiceActor' | 'subVoiceActors'> {
  const adult = credits.filter(c => classifyRoleNote(c.roleNotes) !== 'CHILDHOOD');
  const primary = adult.find(c => !c.roleNotes?.trim()) ?? adult[0];
  const subs = new Map<number, SubVoiceActor>();
  for (const [index, c] of credits.entries()) {
    if (c.voiceActor.id === primary?.voiceActor.id) continue;
    const childhood = classifyRoleNote(c.roleNotes);
    if (!childhood && primary && index < credits.indexOf(primary)) continue;
    const kind = childhood ?? 'ALTERNATE';
    if (!subs.has(c.voiceActor.id) || kind === 'CHILDHOOD') subs.set(c.voiceActor.id, { voiceActor: c.voiceActor, kind, roleNote: c.roleNotes });
  }
  return { voiceActor: primary?.voiceActor ?? null, ...(subs.size ? { subVoiceActors: [...subs.values()] } : {}) };
}
