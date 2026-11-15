import { GraphStage } from './components/canvas/GraphStage';
import { AnimePreviewModal } from './components/drawers/AnimePreviewModal';
import { InspectorDrawer } from './components/drawers/InspectorDrawer';
import { WatchedListDrawer } from './components/drawers/WatchedListDrawer';
import { lazy, Suspense, useState } from 'react';
import { SharedBanner } from './components/hud/SharedBanner';
import { EmptyState } from './components/hud/EmptyState';
import { Hud } from './components/hud/Hud';
import { GraphNodeItem } from './components/nodes/GraphNodeItem';
import { DataSourceProvider } from './lib/dataSource';
import { rebuildGraph } from './lib/rebuildGraph';
import { bootSession } from './lib/session';
import { useRecommendationSync } from './lib/useRecommendationSync';
import { useGraphPrefetch } from './lib/prefetch';
import { anilistDataSource } from './services/anilistClient';
import type { PersistenceHandle } from './store/persistence';
import { useGraphStore } from './store/useGraphStore';
import type { StageNode } from './types/contract';

const renderNode = (node: StageNode) => <GraphNodeItem node={node} />;
// On-demand chunks: loaded the first time they open, then kept mounted so their exit animations still play.
const SeiyuuPickerModal = lazy(() => import('./components/drawers/SeiyuuPickerModal').then((m) => ({ default: m.SeiyuuPickerModal })));
const ShareModal = lazy(() => import('./components/drawers/ShareModal').then((m) => ({ default: m.ShareModal })));
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

/** "Generate": rebuild from scratch (full BFS ripple). Incremental extension lives in lib/addAnime. */
const generate = () => rebuildGraph();

// Session boot — module scope (not an effect) so StrictMode double-mount can't run it twice, and the `??=` keeps
// Vite HMR re-evaluation from re-seeding/re-restoring. First visit → curated presets + genesis; returning visitor →
// the exact saved list, anchor, filters, language, view mode and (if one was on screen) the graph, restored instantly.
const boot = globalThis as { __anicastSession?: PersistenceHandle };
boot.__anicastSession ??= bootSession(anilistDataSource);

export default function App() {
  const hasGraph = useGraphStore((s) => s.graph !== null);
  const pickerUsed = useOpenedOnce(useGraphStore((s) => s.seiyuuPicker !== null));
  const shareUsed = useOpenedOnce(useGraphStore((s) => s.shareOpen));
  useRecommendationSync(anilistDataSource);
  useGraphPrefetch(anilistDataSource);
  return (
    <DataSourceProvider value={anilistDataSource}>
      <main className="relative h-full w-full overflow-hidden bg-obsidian text-white">
        <GraphStage renderNode={renderNode} />
        {!hasGraph && <EmptyState />}
        <Hud />
        <WatchedListDrawer dataSource={anilistDataSource} onGenerate={generate} />
        <InspectorDrawer dataSource={anilistDataSource} />
        <AnimePreviewModal dataSource={anilistDataSource} />
        <Suspense fallback={null}>
          {pickerUsed && <SeiyuuPickerModal dataSource={anilistDataSource} />}
          {shareUsed && <ShareModal />}
        </Suspense>
        <SharedBanner />
      </main>
    </DataSourceProvider>
  );
}
