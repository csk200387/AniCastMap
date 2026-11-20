import { X } from 'lucide-react';
import { useT } from '../../i18n/ui';
import { removeWatchedAnime } from '../../lib/addAnime';
import { useGraphStore } from '../../store/useGraphStore';
import { animeNodeId, pickTitle } from '../../types/contract';

export function AdditionNotice() {
  const t = useT();
  const notice = useGraphStore((s) => s.additionNotice);
  const visible = useGraphStore((s) => !!s.graph && !!notice && s.watchedAnime.includes(notice.record));
  const loading = useGraphStore((s) => !!notice && s.addingAnimeIds.has(notice.requestId));
  const failed = useGraphStore((s) => !!notice && s.addErrors.has(notice.requestId));
  const linked = useGraphStore((s) => !!notice && !!s.graph?.neighbors.get(animeNodeId(notice.record.id))?.size);
  const locale = useGraphStore((s) => s.locale);
  if (!notice || !visible) return null;
  const dismiss = () => useGraphStore.setState({ additionNotice: null });
  return (
    <div className="sc-glass fixed inset-x-3 bottom-[max(5rem,env(safe-area-inset-bottom))] z-[70] mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl px-3 shadow-lg">
      <div role="status" className="min-w-0 py-2 text-xs">
        <div className="truncate font-semibold">{pickTitle(notice.record.title, locale)}</div>
        <div className="text-zinc-300">{loading ? t.loadingCast : failed ? t.castUnavailable : linked ? t.inGraph : t.noCastLinks}</div>
      </div>
      <button type="button" onClick={() => { removeWatchedAnime(notice.record.id); dismiss(); }} className="min-h-11 shrink-0 px-2 text-sm underline">{t.undo}</button>
      <button type="button" onClick={dismiss} aria-label={t.close} className="grid size-11 shrink-0 place-items-center"><X size={15} /></button>
    </div>
  );
}
