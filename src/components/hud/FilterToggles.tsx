import { memo } from 'react';
import { setGraphFilter } from '../../lib/rebuildGraph';
import { useGraphStore } from '../../store/useGraphStore';
import { useT } from '../../i18n/ui';
import { Switch } from './Switch';

/** Graph filters in the HUD: supporting-role visibility, childhood/sub voice actors, and bridges-only view. */
export const FilterToggles = memo(function FilterToggles() {
  const t = useT();
  const showSupporting = useGraphStore((s) => s.showSupportingRoles);
  const includeSub = useGraphStore((s) => s.includeSubVoiceActors);
  const bridgesOnly = useGraphStore((s) => s.bridgesOnly);

  const items = [
    { key: 'supporting', label: t.filterSupporting, tip: t.filterSupportingTip, on: showSupporting, flip: () => setGraphFilter({ showSupportingRoles: !showSupporting }) },
    { key: 'sub', label: t.filterSub, tip: t.filterSubTip, on: includeSub, flip: () => setGraphFilter({ includeSubVoiceActors: !includeSub }) },
    { key: 'bridges', label: t.filterBridges, tip: t.filterBridgesTip, on: bridgesOnly, flip: () => setGraphFilter({ bridgesOnly: !bridgesOnly }) },
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
          className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <Switch on={item.on} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
});
