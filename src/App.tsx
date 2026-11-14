import { GraphStage } from './components/canvas/GraphStage';
import { AnimePreviewModal } from './components/drawers/AnimePreviewModal';
import { InspectorDrawer } from './components/drawers/InspectorDrawer';
import { WatchedListDrawer } from './components/drawers/WatchedListDrawer';
import { EmptyState } from './components/hud/EmptyState';
import { Hud } from './components/hud/Hud';
import { GraphNodeItem } from './components/nodes/GraphNodeItem';
import { DataSourceProvider } from './lib/dataSource';
import { rebuildGraph } from './lib/rebuildGraph';
import { useRecommendationSync } from './lib/useRecommendationSync';
import { anilistDataSource } from './services/anilistClient';
import { useGraphStore } from './store/useGraphStore';
import type { StageNode } from './types/contract';

const renderNode = (node: StageNode) => <GraphNodeItem node={node} />;

/** "Generate": rebuild from scratch (full BFS ripple). Incremental extension lives in lib/addAnime. */
const generate = () => rebuildGraph();

// First load: seed the curated offline presets (anchor = first) and play Genesis instantly — zero network.
// Module scope (not an effect) so StrictMode double-mount can't seed twice.
if (useGraphStore.getState().watchedAnime.length === 0) {
  const { addAnime } = useGraphStore.getState();
  anilistDataSource.presets.forEach(addAnime);
  generate();
}

export default function App() {
  const hasGraph = useGraphStore((s) => s.graph !== null);
  useRecommendationSync(anilistDataSource);
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
