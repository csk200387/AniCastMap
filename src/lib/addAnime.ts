import { provisionalRecords, useGraphStore } from '../store/useGraphStore';
import { rebuildGraph } from './rebuildGraph';
import { applyRecord, flushSavedState } from './session';
import { animeNodeId, franchiseMemberIds, type AnimeDataSource, type AnimeRecord, type AnimeSummary, type CastEntry } from '../types/contract';

const state = useGraphStore.getState;
const inList = (record: AnimeRecord) => state().watchedAnime.includes(record);
const requests = new Map<number, symbol>();

function updateMap(): void {
  if (!state().graph || !state().liveUpdate) return;
  if (state().watchedAnime.length) rebuildGraph({ extend: true });
  else state().setGraph(null);
}

export function removeWatchedAnime(id: number): void {
  state().removeAnime(id);
  updateMap();
  flushSavedState();
}

/** Wait for the new hub to have coordinates before carrying its full cast into the map. */
function placed(nodeId: string): Promise<void> {
  return new Promise((resolve) => {
    const ok = () => !state().graph?.neighbors.has(nodeId) || state().revealedNodeIds.has(nodeId);
    if (ok()) return resolve();
    const done = () => { off(); clearTimeout(timer); resolve(); };
    const off = useGraphStore.subscribe(() => { if (ok()) done(); });
    const timer = setTimeout(done, 3000);
  });
}

/** Commit the title before starting network work. Only its own live list entry may receive late results. */
export async function addAnimeToWatched(
  ds: AnimeDataSource,
  summary: AnimeSummary,
  { seed }: { seed?: CastEntry } = {},
): Promise<void> {
  const preset = ds.presets.find((r) => franchiseMemberIds(r).includes(summary.id));
  let current: AnimeRecord = preset ?? { ...summary, cast: seed ? [seed] : [] };
  const before = state().watchedAnime;
  state().addAnime(current);
  if (state().watchedAnime === before) return;
  const token = Symbol();
  requests.set(summary.id, token);
  if (!preset) provisionalRecords.add(current);
  state().markAdding(summary.id, !preset);
  if (state().graph && state().liveUpdate) useGraphStore.setState({ additionNotice: { record: current, requestId: summary.id } });
  updateMap();
  flushSavedState();

  async function replace(record: AnimeRecord) {
    if (!inList(current)) return false;
    if (state().graph && state().liveUpdate) await placed(animeNodeId(current.id));
    if (!inList(current) || requests.get(summary.id) !== token) return false;
    const ownsNotice = state().additionNotice?.record === current;
    const beforeReplaceLength = state().watchedAnime.length;
    applyRecord(current.id, record);
    current = record;
    // Undo belongs to this addition only, including when two seasons resolve to one canonical title.
    const replaced = state().watchedAnime.length === beforeReplaceLength;
    if (ownsNotice) {
      useGraphStore.setState({ additionNotice: replaced && state().liveUpdate ? { record, requestId: summary.id } : null });
    }
    if (state().graph && (state().liveUpdate || state().graph!.animeById.has(record.id))) {
      rebuildGraph({ extend: true, fromGraph: !state().liveUpdate });
    }
    flushSavedState();
    return replaced;
  }
  let error: string | undefined;
  try {
    if (preset) return;
    const full = ds.getAnime(summary.id);
    if (!seed && ds.getAnimeShallow) {
      const shallow = ds.getAnimeShallow([summary.id], undefined, { urgent: true }).then((m) => m.get(summary.id), () => undefined);
      const quick = await Promise.race([shallow, full.then(() => undefined, () => undefined)]);
      if (quick?.cast.length) {
        provisionalRecords.add(quick);
        if (!await replace(quick)) return;
      }
    }
    await replace(await full);
  } catch (err) {
    error = err instanceof Error ? err.message : 'error';
  } finally {
    if (requests.get(summary.id) === token) {
      requests.delete(summary.id);
      state().markAdding(summary.id, false, inList(current) ? error : undefined);
    }
  }
}
