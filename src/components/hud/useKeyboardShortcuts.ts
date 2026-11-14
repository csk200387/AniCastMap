import { useEffect } from 'react';
import { VIEW_MODES } from '../../types/contract';
import { useGraphStore } from '../../store/useGraphStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.matches('input, textarea, select')) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest('[contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * Global Observatory keyboard shortcuts:
 *  - 1 / 2 / 3 : Switch ViewMode (Character / Voice Actor / Detail Card)
 *  - Space     : Pause / resume force physics
 *  - R         : Replay BFS Ripple Genesis
 *  - F         : Fit graph to viewport
 *  - Escape    : Clear selected node / close inspector
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      const store = useGraphStore.getState();

      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const mode = VIEW_MODES[Number(e.key) - 1];
        if (mode) store.setViewMode(mode);
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) store.togglePhysics();
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        if (!e.repeat) store.replayGenesis();
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        if (!e.repeat) store.fitView();
        return;
      }

      if (e.key === 'Escape') {
        if (store.animePreview) store.closeAnimePreview();
        else store.selectNode(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
