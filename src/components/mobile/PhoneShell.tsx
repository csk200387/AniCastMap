import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import type { AnimeDataSource } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { useKeyboardShortcuts } from '../hud/useKeyboardShortcuts';
import { FloatShell } from './FloatShell';
import { useSharedBannerHeight } from './MobileControls';
import { SheetShell } from './SheetShell';
import { TabsShell } from './TabsShell';

export interface PhoneShellProps {
  variant: 'sheet' | 'tabs' | 'float';
  dataSource: AnimeDataSource;
  onGenerate: () => void;
}

export function PhoneShell({ variant, dataSource, onGenerate }: PhoneShellProps) {
  useKeyboardShortcuts();
  const sharedTop = useSharedBannerHeight();

  useEffect(() => {
    return () => {
      useGraphStore.getState().setStageInsets(null);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      {variant === 'sheet' ? (
        <SheetShell dataSource={dataSource} onGenerate={onGenerate} sharedTop={sharedTop} />
      ) : variant === 'tabs' ? (
        <TabsShell dataSource={dataSource} onGenerate={onGenerate} sharedTop={sharedTop} />
      ) : (
        <FloatShell dataSource={dataSource} onGenerate={onGenerate} sharedTop={sharedTop} />
      )}
    </MotionConfig>
  );
}
