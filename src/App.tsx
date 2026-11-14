import { GraphStage } from './components/canvas/GraphStage';
import { AnimePreviewModal } from './components/drawers/AnimePreviewModal';
import { InspectorDrawer } from './components/drawers/InspectorDrawer';
import { WatchedListDrawer } from './components/drawers/WatchedListDrawer';
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

/** "Generate": rebuild from scratch (full BFS ripple). Incremental extension lives in lib/addAnime. */
const generate = () => rebuildGraph();

// Session boot — module scope (not an effect) so StrictMode double-mount can't run it twice, and the `??=` keeps
// Vite HMR re-evaluation from re-seeding/re-restoring. First visit → curated presets + genesis; returning visitor →
// the exact saved list, anchor, filters, language, view mode and (if one was on screen) the graph, restored instantly.
const boot = globalThis as { __anicastSession?: PersistenceHandle };
boot.__anicastSession ??= bootSession(anilistDataSource);

export default function App() {
  const hasGraph = useGraphStore((s) => s.graph !== null);
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
      </main>
    </DataSourceProvider>
  );
}
