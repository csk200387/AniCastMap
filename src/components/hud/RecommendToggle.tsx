import { memo } from 'react';
import { Loader2 } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { Switch } from './Switch';

/** ON/OFF switch for "main-role recommendation expansion" of the selected voice actor. */
export const RecommendToggle = memo(function RecommendToggle({ variant }: { variant: 'hud' | 'inspector' }) {
  const t = useT();
  const enabled = useGraphStore((s) => s.recommendEnabled);
  const setEnabled = useGraphStore((s) => s.setRecommendEnabled);
  const status = useGraphStore((s) => s.recommendations?.status);

  const note =
    !enabled ? null
    : status === 'loading' ? t.recLoading
    : status === 'empty' ? t.recEmpty
    : status === 'error' ? t.recError
    : null;

  const sw = <Switch on={enabled} />;

  if (variant === 'hud') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled(!enabled)}
        className="sc-glass pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        {sw}
        <span>{t.recToggle}</span>
        {enabled && status === 'loading' && <Loader2 size={12} className="animate-spin text-zinc-400" aria-hidden="true" />}
        {note && status !== 'loading' && <span className="text-[11px] font-normal text-zinc-500">{note}</span>}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled(!enabled)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-white">{t.recToggle}</span>
          <span className="mt-0.5 block text-[11px] leading-[14px] text-zinc-500">{t.recToggleHint}</span>
        </span>
        {sw}
      </button>
      {note && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
          {status === 'loading' && <Loader2 size={11} className="animate-spin" aria-hidden="true" />}
          {note}
        </p>
      )}
    </div>
  );
});
