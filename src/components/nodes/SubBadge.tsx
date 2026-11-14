import { memo } from 'react';
import type { RoleRef } from '../../types/contract';
import { useT } from '../../i18n/ui';

/** "유년기" / "서브 성우": marks a credit where the VA voices a childhood or alternate version of the character. */
export const SubBadge = memo(function SubBadge({ sub, className }: { sub: NonNullable<RoleRef['sub']>; className?: string }) {
  const t = useT();
  return <span className={`sc-sub ${className ?? ''}`}>{sub.kind === 'CHILDHOOD' ? t.subChildhood : t.subAlternate}</span>;
});
