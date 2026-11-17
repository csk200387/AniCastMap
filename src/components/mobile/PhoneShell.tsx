import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import type { AnimeDataSource } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';
import { useKeyboardShortcuts } from '../hud/useKeyboardShortcuts';
import { FloatShell } from './FloatShell';
import { useSharedBannerHeight } from './MobileControls';

export interface PhoneShellProps {
  dataSource: AnimeDataSource;
  onGenerate: () => void;
}

export function PhoneShell({ dataSource, onGenerate }: PhoneShellProps) {
  useKeyboardShortcuts();
  const sharedTop = useSharedBannerHeight();

  useEffect(() => {
    return () => {
      useGraphStore.getState().setStageInsets(null);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <FloatShell dataSource={dataSource} onGenerate={onGenerate} sharedTop={sharedTop} />
    </MotionConfig>
  );
}
