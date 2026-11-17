/**
 * Live promotional captures — no mocked API data or screenshot-only UI styling.
 * Run: npx tsx scripts/capture-promo-images.ts
 * Optional: PROMO_URL=https://... PROMO_OUTPUT=dist/promo-images
 * The requested legacy URL currently returns Vercel DEPLOYMENT_NOT_FOUND;
 * the default below is the live URL in README.md and the app's canonical tag.
 */
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile, stat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const URL = process.env.PROMO_URL ?? 'https://anicastmap.vercel.app/';
const OUTPUT = path.resolve(process.env.PROMO_OUTPUT ?? 'dist/promo-images');
const VIEWPORT = { width: 1600, height: 1000 };
const SEARCH = 'aside input[placeholder="Search anime (Korean, Japanese or English)"]';
const RESULT = 'aside section ul > li';
const NODE = '[data-node-id] > .sc-node';
const KOYASU = '[data-node-id="va:95160"] > .sc-node';
const FIRST_TWO = ['JUJUTSU KAISEN', 'Attack on Titan'];
const EXTRA = [
  { query: 'Frieren', title: 'Frieren: Beyond Journey’s End', id: 154587 },
  { query: 'Demon Slayer', title: 'Demon Slayer: Kimetsu no Yaiba', id: 101922 },
  { query: 'Chainsaw', title: 'Chainsaw Man', id: 127230 },
  { query: 'Oshi', title: 'OSHI NO KO', id: 150672 },
];
const report: Record<string, unknown> = {
  requestedUrl: 'https://ani-cast-map.vercel.app/', actualUrl: URL,
  viewport: VIEWPORT, deviceScaleFactor: 2,
  hook: { voiceActor: 'Takehito Koyasu', voiceActorId: 95160,
    roles: ['Zeke — Attack on Titan', 'Touji Fushiguro — JUJUTSU KAISEN'] },
  screenshots: [], consoleErrors: [],
};

async function drawer(page: Page, open: boolean) {
  const control = page.getByRole('button', { name: open ? 'Expand list' : 'Collapse list', exact: true });
  if (await control.count()) { await control.click(); await page.waitForTimeout(650); }
}
async function pause(page: Page, paused: boolean) {
  const control = page.getByRole('button', { name: paused ? 'Physics (Space)' : 'Paused (Space)', exact: true });
  if (await control.count()) await control.click();
}
async function positions(page: Page) {
  return page.locator(NODE).evaluateAll(es => es.map(e => {
    const r = e.getBoundingClientRect();
    return { id: e.parentElement!.getAttribute('data-node-id'), x: r.x, y: r.y };
  }));
}
async function settle(page: Page) {
  // A fixed minimum is mandatory even when the new graph initially appears static.
  await page.waitForTimeout(3500);
  await page.waitForFunction(() => {
    const p = document.querySelector('[role="progressbar"]');
    return p && p.getAttribute('aria-valuenow') === p.getAttribute('aria-valuemax');
  }, undefined, { timeout: 45000 });
  let previous = await positions(page), stable = 0;
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(500);
    const current = await positions(page);
    const same = current.length === previous.length && current.every((n, j) =>
      n.id === previous[j]?.id && Math.hypot(n.x - previous[j]!.x, n.y - previous[j]!.y) < 0.4);
    stable = same ? stable + 1 : 0;
    if (stable >= 3) return;
    previous = current;
  }
  throw new Error('Force graph did not settle (movement threshold 0.4 CSS px).');
}
async function fit(page: Page) {
  await page.getByRole('button', { name: 'Fit view (F)', exact: true }).click();
  await page.mouse.move(80, 90);
  await page.waitForTimeout(1300);
}
async function cameraScale(page: Page) {
  return page.locator('[data-node-id]').first().evaluate(e =>
    new DOMMatrixReadOnly(getComputedStyle(e.parentElement!).transform).a);
}
async function dragNode(page: Page, id: string, x: number, y: number) {
  const node = page.locator(`[data-node-id="${id}"] > .sc-node`);
  const r = await node.boundingBox(); assert(r, `Missing node ${id}`);
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 24 });
  await page.mouse.up();
  await page.mouse.move(80, 90);
  await page.waitForTimeout(500);
}
async function pan(page: Page, dx: number, dy: number) {
  const start = await page.evaluate(() => {
    for (const y of [840, 500, 200, 880]) for (const x of [100, 1450, 250, 1350, 800]) {
      const e = document.elementFromPoint(x, y);
      if (e && !e.closest('button, aside, [data-node-id], input') && e.closest('main')) return { x, y };
    }
    throw new Error('No empty graph surface available for panning');
  });
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 30 }); await page.mouse.up();
  await page.waitForTimeout(600);
}
async function imagesReady(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Load real thumbnails, including lazy images needed after a pan or drawer opening.
    await Promise.all(Array.from(document.images, async img => {
      img.loading = 'eager';
      await Promise.race([img.decode().catch(() => undefined), new Promise(r => setTimeout(r, 20000))]);
    }));
  });
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.animate-spin')).some(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.x < innerWidth && r.y < innerHeight;
  }), undefined, { timeout: 60000 });
}
async function audit(page: Page) {
  return page.evaluate(() => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.x >= innerWidth || r.y >= innerHeight) return false;
      for (let p: Element | null = e; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.02) return false;
      }
      return true;
    };
    const nodes = Array.from(document.querySelectorAll('[data-node-id] > .sc-node')).map(e => {
      const r = e.getBoundingClientRect();
      return { id: e.parentElement!.getAttribute('data-node-id'), label: e.getAttribute('aria-label'),
        kind: e.getAttribute('data-kind'), spot: e.getAttribute('data-spot'),
        x: r.x, y: r.y, width: r.width, height: r.height, visible: visible(e) };
    });
    const broken = Array.from(document.images).filter(i => visible(i) && (!i.complete || !i.naturalWidth))
      .map(i => ({ src: i.src, alt: i.alt }));
    const blankAvatars = Array.from(document.querySelectorAll('.sc-avatar')).filter(e => visible(e) && !e.querySelector('img'))
      .map(e => e.closest('.sc-node')?.getAttribute('aria-label') ?? 'UI thumbnail');
    const labels = Array.from(document.querySelectorAll('.sc-fan-char, .sc-fan-name')).filter(visible).map(e => {
      const range = document.createRange(); range.selectNodeContents(e);
      const r = range.getBoundingClientRect();
      return { text: e.textContent, x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const overlaps = labels.flatMap((a, i) => labels.slice(i + 1).filter(b =>
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1).map(b => [a.text, b.text]));
    return { nodes, broken, blankAvatars, labels, labelOverlaps: overlaps,
      canvas: Array.from(document.querySelectorAll('canvas')).map(c => ({ width: c.width, height: c.height })),
      background: getComputedStyle(document.querySelector('canvas')!.parentElement!).backgroundColor,
      focusedSearch: document.activeElement?.getAttribute('placeholder'),
      searchResults: Array.from(document.querySelectorAll('aside section ul > li')).map(e => e.textContent),
    };
  });
}
async function capture(page: Page, filename: string, animeCount: number) {
  await imagesReady(page); await page.waitForTimeout(600);
  const checks = await audit(page);
  assert.equal(checks.nodes.filter(n => n.kind === 'ANIME').length, animeCount);
  assert.deepEqual(checks.broken, [], 'Broken or pending visible images');
  assert.deepEqual(checks.blankAvatars, [], 'Blank thumbnail fallback in the frame');
  assert.equal(checks.background, 'rgb(9, 10, 15)');
  if (filename.startsWith('01-')) {
    assert.deepEqual(checks.labelOverlaps, [], 'Illegible hook label overlaps');
    assert.equal(checks.labels.filter(l => /Zeke|Touji Fushiguro/.test(l.text ?? '')).length, 2);
    const subjects = checks.nodes.filter(n => n.spot === 'focus' || n.spot === 'linked');
    const occupied = Math.max(...subjects.map(n => n.x + n.width)) - Math.min(...subjects.map(n => n.x));
    assert(occupied / VIEWPORT.width >= 0.6 && occupied / VIEWPORT.width <= 0.85,
      'Hook subjects must fill approximately 65% of the frame width');
  } else {
    assert(checks.nodes.every(n => n.visible && n.x >= 80 && n.y >= 108 &&
      n.x + n.width <= VIEWPORT.width - 80 && n.y + n.height <= 880),
    'Whole constellation must fit with dark margins clear of the HUD');
  }
  if (filename.startsWith('03-')) {
    assert.equal(checks.focusedSearch, 'Search anime (Korean, Japanese or English)');
    assert(checks.searchResults.some(text => text?.includes('Chainsaw Man')));
    assert(await page.getByRole('button', { name: 'Chainsaw Man · Add', exact: true }).isEnabled());
  }
  const output = path.join(OUTPUT, filename);
  await page.screenshot({ path: output, type: 'png', fullPage: false, scale: 'device', caret: 'hide' });
  const buffer = await readFile(output);
  const dimensions = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  assert.deepEqual(dimensions, { width: 3200, height: 2000 });
  const bytes = (await stat(output)).size; assert(bytes > 100000);
  const entry = { filename, path: output, bytes, ...dimensions, animeCount, checks };
  (report.screenshots as unknown[]).push(entry);
  await writeFile(path.join(OUTPUT, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log(`Captured ${filename}: ${dimensions.width}×${dimensions.height}, ${bytes} bytes`);
}
async function addAnime(page: Page, item: typeof EXTRA[number]) {
  await pause(page, false); await drawer(page, true);
  await page.locator(SEARCH).fill(item.query);
  const row = page.locator(RESULT).filter({ has: page.locator(`button[title="${item.title}"]`) });
  await row.waitFor({ state: 'visible', timeout: 60000 });
  await row.getByRole('button', { name: `${item.title} · Add`, exact: true }).click();
  await page.waitForTimeout(3500);
  await row.getByRole('button', { name: `${item.title} · Added`, exact: true }).waitFor();
  await page.locator(SEARCH).fill('');
  // Search quick-add updates the list; Build is the app's explicit graph commit.
  await page.getByRole('button', { name: 'Build the map', exact: true }).click();
  await page.locator(`[data-node-id="anime:${item.id}"]`).waitFor({ state: 'attached', timeout: 60000 });
  await settle(page);
}

await mkdir(OUTPUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'en-US', colorScheme: 'dark' });
// tsx/esbuild preserves nested callback names with this helper; evaluate() serializes
// those callbacks into Chromium, so supply the same identity helper in that realm.
await context.addInitScript({ content: 'globalThis.__name = (value) => value;' });
const page = await context.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', error => (report.consoleErrors as string[]).push(error.message));
try {
  const response = await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  assert(response?.ok(), `Live app returned HTTP ${response?.status()}`);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator(NODE).first().waitFor();
  await page.locator(SEARCH).fill('Jujutsu');
  await page.locator(RESULT).first().waitFor();
  report.domInspection = await page.evaluate(() => ({
    input: document.querySelector('aside input')?.outerHTML,
    result: document.querySelector('aside section ul > li')?.outerHTML,
    nodes: Array.from(document.querySelectorAll('[data-node-id] > .sc-node')).slice(0, 3).map(e => e.outerHTML.slice(0, 700)),
    rendering: 'HTML div[data-node-id] overlays, .sc-node[data-kind=ANIME|VOICE_ACTOR]; Canvas 2D edges. Characters are cards inside the shared VA node, not separate graph vertices.',
    gestures: 'Native wheel zoom (0.15–3), pointer drag pan/node positioning, Fit view (F), Physics (Space).',
  }));
  await page.locator(SEARCH).fill('');
  // A fresh session seeds eleven real presets. Retain only the intended pair via the actual UI.
  const names = await page.locator('aside button[aria-label$=" · Remove"]').evaluateAll(es => es.map(e => e.getAttribute('aria-label')!));
  for (const name of names) if (!FIRST_TWO.some(t => name === `${t} · Remove`)) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Build the map', exact: true }).click();
  await settle(page); await drawer(page, false); await fit(page); await pause(page, true);

  // Use real node drags while paused to bring the two anime hubs into a balanced close-up.
  // The native camera's 3× zoom preserves their real edges to the shared VA bridge.
  const bridge = await page.locator(KOYASU).boundingBox(); assert(bridge);
  const center = { x: bridge.x + bridge.width / 2, y: bridge.y + bridge.height / 2 };
  const k = await cameraScale(page);
  await dragNode(page, 'anime:113415', center.x - 146 * k, center.y - 20 * k);
  await dragNode(page, 'anime:16498', center.x + 146 * k, center.y - 20 * k);
  // Chromium can split/coalesce a large wheel gesture. Read back native camera scale
  // and keep applying real wheel events until the requested 3× close-up is reached.
  for (let i = 0; i < 18; i++) {
    const current = await cameraScale(page);
    if (current >= 2.99) break;
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -Math.min(220, Math.log(3 / current) / 0.002 + 1));
    await page.waitForTimeout(350);
  }
  report.hookCameraScale = await cameraScale(page);
  assert((report.hookCameraScale as number) >= 2.99, 'Native camera did not reach the 3× close-up');
  await page.waitForTimeout(900);
  const zoomed = await page.locator(KOYASU).boundingBox(); assert(zoomed);
  await pan(page, 800 - zoomed.x - zoomed.width / 2, 720 - zoomed.y - zoomed.height / 2);
  await page.locator(KOYASU).hover();
  await page.locator(`${KOYASU} .sc-fan`).waitFor();
  await page.waitForTimeout(3000);
  const roles = await page.locator(`${KOYASU} .sc-fan-card`).allTextContents();
  assert(roles.some(t => t.includes('Zeke') && t.includes('Attack on Titan')));
  assert(roles.some(t => t.includes('Touji Fushiguro') && t.includes('JUJUTSU KAISEN')));
  report.hookLiveRoles = roles;
  await capture(page, '01-hook-closeup.png', 2);

  await page.mouse.move(80, 90); await pause(page, false); await fit(page);
  for (const item of EXTRA) await addAnime(page, item);
  await drawer(page, false);
  await page.getByRole('group', { name: 'View mode', exact: true }).getByRole('button', { name: /Voice actors/ }).click();
  await settle(page); await fit(page); await pause(page, true);
  await capture(page, '02-full-constellation.png', 6);

  await drawer(page, true);
  for (const item of EXTRA.slice(2)) await page.getByRole('button', { name: `${item.title} · Remove`, exact: true }).click();
  await pause(page, false);
  await page.getByRole('group', { name: 'View mode', exact: true }).getByRole('button', { name: /Characters/ }).click();
  await page.getByRole('button', { name: 'Build the map', exact: true }).click();
  await settle(page); await fit(page); await pause(page, true);
  await page.locator(SEARCH).fill('Chainsaw');
  await page.locator(RESULT).first().waitFor();
  await imagesReady(page); await page.waitForTimeout(3000);
  await page.locator(SEARCH).focus();
  await capture(page, '03-search-ui-flow.png', 4);
  assert.equal((report.screenshots as unknown[]).length, 3);
  assert.deepEqual(report.consoleErrors, []);
  report.finishedAt = new Date().toISOString();
  await rm(path.join(OUTPUT, 'capture-error.png'), { force: true });
  await writeFile(path.join(OUTPUT, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ url: URL, output: OUTPUT, files: (report.screenshots as {filename: string}[]).map(s => s.filename), hook: report.hook }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(OUTPUT, 'capture-error.png'), scale: 'device' }).catch(() => {});
  await writeFile(path.join(OUTPUT, 'capture-report.json'), JSON.stringify({ ...report, error: String(error) }, null, 2));
  throw error;
} finally {
  await context.close(); await browser.close();
}
