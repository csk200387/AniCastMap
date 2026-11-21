import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const middlewareMode = process.env.TEST_VITE_MIDDLEWARE === '1';
const base = new URL(process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5278').origin;
const evidence = resolve('.claude/mobile-detail-evidence');
const capture = process.env.TEST_SCREENSHOTS;
const viewports = [[320, 720], [360, 800], [390, 844], [412, 915]];
const longTitle = 'ChroniclesOfTheNeverEndingJourneyAcrossTheForgottenKingdom — 잊혀진 왕국을 지나 별들이 잠든 바다까지 이어지는 여정';
const alternateTitle = '星の眠る海へ向かう長い旅と忘れられた王国の仲間たち'.repeat(4);

if (capture) assert.ok(['before', 'after'].includes(capture), 'TEST_SCREENSHOTS must be before or after');
if (capture || middlewareMode) await mkdir(evidence, { recursive: true });

let browser;
let vite;
let cacheDir;
const failures = [];
try {
  // Run the same Vite transforms through Playwright routing when localhost cannot bind.
  if (middlewareMode) {
    cacheDir = await mkdtemp(join(evidence, 'vite-cache-'));
    const { createServer } = await import('vite');
    vite = await createServer({
      configLoader: 'native',
      envDir: false,
      cacheDir,
      server: { middlewareMode: true, ws: false, watch: null },
    });
  }
  browser = await chromium.launch(middlewareMode && process.platform === 'darwin'
    ? { args: ['--single-process', '--disable-gpu'] }
    : {});
  const page = await browser.newPage({ isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  if (vite) await page.routeWebSocket('**/*', (socket) => socket.send('{"type":"connected"}'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!vite) return route.continue();
    if (url.pathname === '/') {
      const html = await readFile('index.html', 'utf8');
      return route.fulfill({ contentType: 'text/html', body: await vite.transformIndexHtml('/', html) });
    }
    const module = await vite.transformRequest(url.pathname + url.search);
    return module
      ? route.fulfill({ contentType: 'text/javascript', body: module.code })
      : route.fulfill({ status: 404, body: 'Not found' });
  });

  for (const [width, height] of viewports) {
    try {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/?demo=1`);
      await page.locator('[data-phone-shell="float"]').waitFor();
      await page.evaluate(async ({ longTitle, alternateTitle }) => {
        const { useGraphStore } = await import('/src/store/useGraphStore.ts');
        const { graph, setLocale, selectNode } = useGraphStore.getState();
        const animeNode = graph.nodes.filter((node) => node.kind === 'ANIME')
          .sort((a, b) => b.degree - a.degree)[0];
        animeNode.anime.title = { ...animeNode.anime.title, ko: longTitle, native: alternateTitle };
        setLocale('ko');
        selectNode(animeNode.id);
      }, { longTitle, alternateTitle });

      const details = page.getByRole('button', { name: '자세히', exact: true });
      await details.tap();
      const dialog = page.getByRole('dialog', { name: '이 작품의 성우', exact: true });
      await dialog.waitFor();
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="이 작품의 성우"]');
        return dialog && getComputedStyle(dialog).opacity === '1' && getComputedStyle(dialog).transform === 'none';
      });
      await page.evaluate(async () => { await document.fonts.ready; });
      assert.equal(await dialog.getByRole('heading', { level: 2 }).textContent(), longTitle);
      assert.equal(await dialog.getByText(alternateTitle, { exact: true }).count(), 1);
      assert.equal(await dialog.getByText(/출연 성우 \d+명/).count(), 1);

      if (capture) await page.screenshot({ path: join(evidence, `${capture}-${width}.png`) });

      const layout = await dialog.evaluate((panel) => {
        const box = (element) => element.getBoundingClientRect();
        const scroller = panel.querySelector('.sc-scroll');
        const rows = [...scroller.querySelectorAll('button')];
        const actions = [...panel.querySelectorAll('button')].filter((button) => !scroller.contains(button));
        const headerText = [...panel.querySelectorAll('header h2, header p')].map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return { bounds: box(element), lines: [...range.getClientRects()] };
        });
        const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1
          && a.top < b.bottom - 1 && a.bottom > b.top + 1;

        return {
          viewportWidth: innerWidth,
          headerTextOverflow: headerText.some(({ bounds, lines }) => lines.some((line) => line.right > bounds.right + 1 || line.bottom > bounds.bottom + 1)),
          headerTextActionOverlap: actions.some((action) => headerText.some(({ lines }) => lines.some((line) => overlaps(line, box(action))))),
          actionOverlap: actions.some((action, index) => actions.slice(index + 1).some((other) => overlaps(box(action), box(other)))),
          actionsInViewport: actions.every((action) => {
            const rect = box(action);
            return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
              && rect.width >= 44 && rect.height >= 44;
          }),
          castRows: rows.length,
          castContentOverflow: rows.filter((row) => [...row.children].some((child) => box(child).bottom > box(row).bottom + 1)).length,
          castRowOverlap: rows.some((row, index) => index > 0 && overlaps(box(row), box(rows[index - 1]))),
          horizontalOverflow: [panel, scroller, document.documentElement].some((el) => el.scrollWidth > el.clientWidth + 1),
        };
      });
      console.log(`${width}×${height} ${JSON.stringify(layout)}`);

      const scroller = dialog.locator('.sc-scroll');
      const lastCast = scroller.getByRole('button').last();
      const close = dialog.getByRole('button', { name: '닫기', exact: true });
      const closeTop = (await close.first().boundingBox()).y;
      const { castRows, ...positions } = layout;
      assert.ok(castRows > 1, 'Fixture must have multiple cast rows');
      await lastCast.scrollIntoViewIfNeeded();
      assert.ok(await scroller.evaluate((el) => el.scrollTop > 0), 'Cast list must scroll');
      assert.ok(await lastCast.evaluate((row) => {
        const rect = row.getBoundingClientRect();
        const scrollBounds = row.closest('.sc-scroll').getBoundingClientRect();
        return rect.top >= scrollBounds.top && rect.bottom <= scrollBounds.bottom + 1;
      }), 'Last cast row must be fully visible after scrolling');
      assert.equal((await close.first().boundingBox()).y, closeTop, 'Close controls must stay in place while scrolling');
      await close.first().tap();
      await dialog.waitFor({ state: 'hidden' });
      await details.tap();
      await close.last().tap();
      await dialog.waitFor({ state: 'hidden' });
      await details.waitFor({ state: 'hidden' });

      assert.deepEqual(positions, {
        viewportWidth: width,
        headerTextOverflow: false,
        headerTextActionOverlap: false,
        actionOverlap: false,
        actionsInViewport: true,
        castContentOverflow: 0,
        castRowOverlap: false,
        horizontalOverflow: false,
      });
    } catch (error) {
      failures.push(new Error(`${width}×${height}: ${error.message}`, { cause: error }));
    }
  }
} finally {
  await browser?.close();
  await vite?.close();
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
}

if (failures.length) throw new AggregateError(failures, 'Mobile anime detail checks failed');
console.log('PASS: mobile anime detail layout, cast scrolling, and both close controls');
