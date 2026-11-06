import { expect, test } from '@playwright/test';
import { captureSaves, convertAndRead, hasFixture, open } from './lib/harness';
import { readHeader } from './lib/inspect';

test('converts with no network after one online visit', async ({ page, context }) => {
  await captureSaves(page);
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const heic = hasFixture('sample.heic');
  await open(page, heic ? 'sample.heic' : 'sample.png');
  await convertAndRead(page, 'jpg');

  // setOffline doesn't reach Firefox's service worker, so prove the cache directly too.
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('rebake-engines');
    return (await cache.keys()).map((request) => new URL(request.url).pathname.split('/').pop());
  });
  expect(cached).toEqual(expect.arrayContaining(['vips-es6.js', 'vips.wasm']));

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#choose')).toBeVisible();
  await open(page, heic ? 'sample.heic' : 'sample.png');
  const { bytes } = await convertAndRead(page, 'jpg');
  expect((await readHeader(bytes)).format).toBe('jpg');
});

test('every category converts with no network after one visit', async ({ page, context, browserName }) => {
  test.setTimeout(240_000);
  const jobs = [
    ['sample.png', 'webp'], ['h264-aac.mov', 'mp4'], ['sample.wav', 'mp3'],
    ['sample.docx', 'pdf'], ['sample.pdf', 'png'], ['sample.png', 'pdf'], ['sample.xlsx', 'csv'], ['sample.json', 'yaml'],
  ] as const;
  await captureSaves(page);
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  for (const [file, target] of jobs) {
    await open(page, file);
    await convertAndRead(page, target, 100_000);
    await page.click('#primary');
  }

  await context.setOffline(true);
  await page.reload();
  // A deep link has never been fetched, and the shell has to stand in for it.
  if (browserName !== 'firefox') await page.goto('/docx-to-pdf');
  await expect(page.locator('#choose')).toBeVisible();
  for (const [file, target] of jobs) {
    await open(page, file);
    const { bytes } = await convertAndRead(page, target, 100_000);
    expect(bytes.length).toBeGreaterThan(0);
    await page.click('#primary');
  }
});

test('an engine that was never cached says so when offline', async ({ page, context, browserName }) => {
  test.skip(browserName === 'firefox', "Playwright's setOffline doesn't reach Firefox's service worker");
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await open(page, 'sample.png');
  await page.click('#primary');
  await expect(page.locator('#meta.error')).toContainText('offline');
});
