import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5179';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/?demo=1`);
  await page.waitForSelector('[data-kind="VOICE_ACTOR"][data-bridge="true"] .sc-face img');
  await page.waitForTimeout(3000);
  // The sample map exercises exactly the same node components as a personal map.
  // Drop the demo flag to verify that cycling no longer depends on URL variants.
  await page.evaluate(() => history.replaceState(null, '', '/'));
  const info = await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/store/useGraphStore.ts');
    const state = useGraphStore.getState();
    const actor = state.graph.nodes.find(n => n.kind === 'VOICE_ACTOR' && new Set(n.roles.map(r => r.character.image)).size > 1);
    if (!actor) throw new Error('No multi-character actor in sample map');
    return { actor: actor.id, anime: actor.roles[0].animeId };
  });
  const select = async id => page.evaluate(async id => {
    const { useGraphStore } = await import('/src/store/useGraphStore.ts');
    useGraphStore.setState({ selectedNodeId: id });
  }, id);
  const snapshot = () => page.locator('.sc-node[data-kind="VOICE_ACTOR"][data-bridge="true"] .sc-face img').evaluateAll(imgs => imgs.map(i => i.src).join('|'));
  const before = await snapshot();
  await page.waitForTimeout(2600);
  assert.equal(await snapshot(), before, 'Unselected map must not cycle');
  await page.evaluate(async id => {
    const { useGraphStore } = await import('/src/store/useGraphStore.ts');
    useGraphStore.getState().setHoveredNode(`anime:${id}`);
  }, info.anime);
  await page.waitForTimeout(1000);
  const hovered = await snapshot();
  await page.waitForTimeout(2600);
  assert.equal(await snapshot(), hovered, 'Hover must not start cycling');
  await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/store/useGraphStore.ts');
    useGraphStore.getState().setHoveredNode(null);
  });
  await select(`anime:${info.anime}`);
  await page.waitForTimeout(1000);
  const first = await snapshot();
  await page.waitForTimeout(2200);
  assert.notEqual(await snapshot(), first, 'Selected anime must cycle portraits without a demo flag');
  await select(null);
  await page.waitForTimeout(1000);
  const stopped = await snapshot();
  await page.waitForTimeout(2600);
  assert.equal(await snapshot(), stopped, 'Clearing selection must stop cycling');
  await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/store/useGraphStore.ts');
    useGraphStore.setState({ viewMode: 'MODE_DETAIL' });
  });
  await select(`anime:${info.anime}`);
  await page.waitForTimeout(1000);
  const detailSnapshot = () => page.locator('.sc-node[data-kind="VOICE_ACTOR"] .sc-mini img').evaluateAll(imgs => imgs.map(i => i.src).join('|'));
  const detail = await detailSnapshot();
  assert.ok(detail.length > 0, 'Detail portraits are rendered');
  await page.waitForTimeout(2200);
  assert.notEqual(await detailSnapshot(), detail, 'Detail mode must cycle too');
  await page.goto(`${base}/?demo=2`);
  await page.waitForSelector('[data-shared-banner]');
  assert.equal(await page.getByText('demo 1 (고정 전환)', { exact: true }).count(), 0, 'Comparison switcher must be removed');
  assert.equal(await page.getByText('demo 2 (자동 순환)', { exact: true }).count(), 0);
  console.log('PASS: default cycling, no idle cycling, selection cleanup, legacy demo link, no comparison switcher');
} finally {
  await browser.close();
}
