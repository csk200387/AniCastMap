import { cx } from '../nodes/nodeTheme';

/** Neutral ON/OFF track + thumb used by every HUD / inspector toggle. */
export function Switch({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={cx('relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors', on ? 'bg-zinc-100' : 'bg-zinc-700')}>
      <span className={cx('absolute top-[3px] h-3 w-3 rounded-full transition-all', on ? 'left-[17px] bg-zinc-950' : 'left-[3px] bg-zinc-300')} />
    </span>
  );
}
