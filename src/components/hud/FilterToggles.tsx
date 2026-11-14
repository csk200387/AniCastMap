import { memo } from 'react';
import { setGraphFilter } from '../../lib/rebuildGraph';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { Switch } from './Switch';

/** Two graph filters in the HUD: supporting-role visibility and childhood/sub voice actors. */
export const FilterToggles = memo(function FilterToggles() {
  const t = useT();
  const showSupporting = useGraphStore((s) => s.showSupportingRoles);
  const includeSub = useGraphStore((s) => s.includeSubVoiceActors);

  const items = [
    { key: 'supporting', label: t.filterSupporting, tip: t.filterSupportingTip, on: showSupporting, flip: () => setGraphFilter({ showSupportingRoles: !showSupporting }) },
    { key: 'sub', label: t.filterSub, tip: t.filterSubTip, on: includeSub, flip: () => setGraphFilter({ includeSubVoiceActors: !includeSub }) },
  ];

  return (
    <div className="sc-glass pointer-events-auto flex items-center gap-1 rounded-xl p-1" role="group" aria-label={t.filterGroup}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="switch"
          aria-checked={item.on}
          title={item.tip}
          onClick={item.flip}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <Switch on={item.on} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
});
