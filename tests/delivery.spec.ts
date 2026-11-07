import { expect, test, type Page } from '@playwright/test';
import { captureSaves, convertAndRead, open, pick } from './lib/harness';
import { readHeader } from './lib/inspect';
import { faultyProxy } from './lib/proxy';

// Faults are injected in Node, so these run once, against the local build.
test.skip(({ browserName }) => browserName !== 'chromium' || !!process.env.REBAKE_URL, 'local Chromium only');

let proxy: Awaited<ReturnType<typeof faultyProxy>>;
test.beforeEach(async ({ baseURL }) => { proxy = await faultyProxy(baseURL!); });
test.afterEach(() => proxy.close());

async function visit(page: Page) {
  await captureSaves(page);
  await page.goto(proxy.url);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('an engine reaches the page as it downloads, so progress is live', async ({ page }) => {
  await visit(page);
  await open(page, 'sample.png');
  await convertAndRead(page, 'webp');
  const wasm = await page.evaluate(async () => {
    const keys = await (await caches.open('rebake-engines')).keys();
    const path = new URL(keys.find((key) => key.url.endsWith('/vips.wasm'))!.url).pathname;
    await caches.delete('rebake-engines');
    return path;
  });
  proxy.faults.rate = 2e6;
  const timing = await page.evaluate(async (path) => {
    const start = performance.now();
    const response = await fetch(path, { cache: 'reload' });
    const headers = performance.now() - start;
    await response.arrayBuffer();
    return { headers, total: performance.now() - start };
  }, wasm);
  expect(timing.total).toBeGreaterThan(1000);
  expect(timing.headers).toBeLessThan(timing.total / 2);
});

test('a new build drops the engines it no longer uses and keeps the rest', async ({ page }) => {
  await visit(page);
  await open(page, 'sample.png');
  await convertAndRead(page, 'webp');
  const cached = () => page.evaluate(async () => {
    const keys = await (await caches.open('rebake-engines')).keys();
    return keys.map((key) => new URL(key.url).pathname);
  });
  await page.evaluate(async () => {
    await (await caches.open('rebake-engines')).put('/engines/old-0000000000/old.wasm', new Response('old'));
  });
  expect(await cached()).toContain('/engines/old-0000000000/old.wasm');

  proxy.faults.serviceWorkerPrelude = '// the next build';
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  await expect.poll(cached).not.toContain('/engines/old-0000000000/old.wasm');
  expect((await cached()).some((path) => path.endsWith('/vips.wasm'))).toBe(true);
});

test('a full disk costs offline use, not the conversion', async ({ page, context }) => {
  await visit(page);
  const [worker] = context.serviceWorkers();
  await worker!.evaluate(() => {
    Cache.prototype.put = () => Promise.reject(new DOMException('full', 'QuotaExceededError'));
  });
  await open(page, 'sample.png');
  const { bytes } = await convertAndRead(page, 'webp');
  expect((await readHeader(bytes)).format).toBe('webp');
});

test('a dropped connection retries by itself', async ({ page }) => {
  test.setTimeout(90_000);
  await visit(page);
  proxy.faults.cut = { path: /pandoc\.wasm\.gz$/, times: 2 };
  await open(page, 'sample.docx');
  const { bytes } = await convertAndRead(page, 'html');
  expect(bytes.length).toBeGreaterThan(0);
  expect(proxy.faults.cut.times).toBe(0);
});

test('a connection that keeps dropping says so, and offers no false offline story', async ({ page }) => {
  await visit(page);
  proxy.faults.cut = { path: /pandoc\.wasm\.gz$/, times: 99 };
  await open(page, 'sample.docx');
  await pick(page, 'html');
  await page.click('#primary');
  await expect(page.locator('#meta.error')).toContainText('interrupted', { timeout: 30_000 });
});

test('a refused engine reports an interrupted download', async ({ page }) => {
  await visit(page);
  proxy.faults.block = { path: /pandoc\.wasm\.gz$/, status: 429 };
  await open(page, 'sample.docx');
  await pick(page, 'html');
  await page.click('#primary');
  await expect(page.locator('#meta.error')).toContainText('interrupted', { timeout: 30_000 });
});

test('an engine removed by a newer deploy asks for a reload', async ({ page }) => {
  await visit(page);
  proxy.faults.block = { path: /pandoc\.wasm\.gz$/, status: 404 };
  await open(page, 'sample.docx');
  await pick(page, 'html');
  await page.click('#primary');
  await expect(page.locator('#meta.error')).toContainText('Reload');
});

test('gzipped engines unpack without DecompressionStream, for Safari before 16.4', async ({ page }) => {
  test.setTimeout(90_000);
  proxy.faults.workerPrelude = 'delete self.DecompressionStream;';
  await visit(page);
  await open(page, 'sample.docx');
  const { bytes } = await convertAndRead(page, 'html');
  expect(bytes.length).toBeGreaterThan(0);
});
